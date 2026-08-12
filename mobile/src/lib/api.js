import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { normalizeSyncData, normalizeSyncEnvelope, SYNC_SCHEMA_VERSION } from "./shared.js";
import { clearStoredAuth, getStoredAuth, saveStoredAuth } from "./authStorage.js";

const DEVICE_ID_KEY = "sherlly.mobile.device-id.v1";
const apiUrl = String(process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl || "")
  .trim()
  .replace(/\/$/, "");
const apiToken = String(process.env.EXPO_PUBLIC_API_TOKEN || Constants.expoConfig?.extra?.apiToken || "").trim();

function requireApiUrl() {
  if (!apiUrl) {
    throw new Error("尚未配置 EXPO_PUBLIC_API_URL，请先设置 Sherlly Worker 地址");
  }

  return apiUrl;
}

async function getDeviceId() {
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);

  if (stored) {
    return stored;
  }

  const generated = `mobile_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  await AsyncStorage.setItem(DEVICE_ID_KEY, generated);
  return generated;
}

async function request(path, options = {}) {
  const auth = await getStoredAuth();
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };

  if (apiToken) {
    headers["X-Sherlly-Token"] = apiToken;
  }

  if (auth?.token) {
    headers.Authorization = `Bearer ${auth.token}`;
  }

  // 设置 30 秒超时（国内网络环境可能较慢）
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${requireApiUrl()}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(body?.message || `请求失败：${response.status}`);
      error.status = response.status;
      error.code = body?.code || "";
      error.body = body;

      if (response.status === 401) {
        await clearStoredAuth();
      }

      throw error;
    }

    return body;
  } catch (err) {
    clearTimeout(timeoutId);

    // 超时错误提供更友好的提示
    if (err.name === 'AbortError') {
      const error = new Error('网络请求超时，请检查网络连接后重试');
      error.code = 'TIMEOUT';
      throw error;
    }

    throw err;
  }
}

export async function login(username, password) {
  const auth = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  return saveStoredAuth(auth);
}

export async function register(username, password, displayName) {
  const auth = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password, displayName }),
  });
  return saveStoredAuth(auth);
}

function unwrapEnvelope(value) {
  if (value?.envelope && typeof value.envelope === "object") {
    return value.envelope;
  }

  if (value?.data?.data && typeof value.data.data === "object") {
    return value.data;
  }

  return value;
}

export async function loadCurrentData() {
  return normalizeSyncEnvelope(unwrapEnvelope(await request("/api/data")));
}

export async function saveCurrentData(data, baseRevision) {
  const envelope = await request("/api/data", {
    method: "PUT",
    body: JSON.stringify({
      schemaVersion: SYNC_SCHEMA_VERSION,
      baseRevision: Number.isInteger(baseRevision) ? baseRevision : 0,
      deviceId: await getDeviceId(),
      data: normalizeSyncData(data),
    }),
  });

  return normalizeSyncEnvelope(unwrapEnvelope(envelope));
}

export { getStoredAuth };
