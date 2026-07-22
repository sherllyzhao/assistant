import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { normalizeSyncData, normalizeSyncEnvelope, SYNC_SCHEMA_VERSION } from "./shared.js";
import { clearStoredAuth, getStoredAuth, saveStoredAuth } from "./authStorage.js";

const DEVICE_ID_KEY = "sherlly.mobile.device-id.v1";
const apiUrl = String(process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl || "")
  .trim()
  .replace(/\/$/, "");

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

  if (auth?.token) {
    headers.Authorization = `Bearer ${auth.token}`;
  }

  const response = await fetch(`${requireApiUrl()}${path}`, {
    ...options,
    headers,
  });
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

export async function loadCurrentData() {
  return normalizeSyncEnvelope(await request("/api/data"));
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

  return normalizeSyncEnvelope(envelope);
}

export { getStoredAuth };
