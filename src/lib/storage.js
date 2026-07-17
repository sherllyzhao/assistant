import { DEFAULT_FTP_CLIENT_PATH } from "./domain.js";
import {
  SYNC_SCHEMA_VERSION,
  mergeSyncData,
  normalizeSyncData,
  normalizeSyncEnvelope,
  stableStringify,
  validateEmbeddedImageLimits,
} from "./syncModel.js";

const fallbackStorageKey = "sherlly-assistant:v1";
const scopedFallbackStoragePrefix = "sherlly-assistant:v1:data";
const migrationStoragePrefix = "sherlly-assistant:v1:migrated";
const authStorageKey = "sherlly-assistant:auth:v1";
const deviceIdStorageKey = "sherlly-assistant:device:v1";
const syncStateStoragePrefix = "sherlly-assistant:sync:v1";
const legacyToolsStorageKey = "sherlly_tools_library";
const syncStatusEventName = "sherlly:sync-status";
const cloudApiBaseUrl = String(import.meta.env.VITE_SHERLLY_API_URL || "").replace(/\/+$/, "");
const cloudApiToken = String(import.meta.env.VITE_SHERLLY_API_TOKEN || "").trim();
const turnstileSiteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || "").trim();

export const initialData = {
  tasks: [],
  candidates: [],
  logs: [],
  vaultItems: [],
  tools: [],
  habits: [],
  vaultCandidates: [],
  tombstones: [],
  settings: {
    soundEnabled: true,
    ftpClientPath: DEFAULT_FTP_CLIENT_PATH,
  },
};

function normalizeData(data) {
  return normalizeSyncData(data, initialData);
}

function readStorageJson(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

function writeStorageJson(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function normalizeStorageScope(value) {
  return (
    String(value || "guest")
      .trim()
      .replace(/[^\w:.-]/g, "_")
      .slice(0, 80) || "guest"
  );
}

function getScopedFallbackStorageKey(scope) {
  return `${scopedFallbackStoragePrefix}:${normalizeStorageScope(scope)}`;
}

function getMigrationStorageKey(scope) {
  return `${migrationStoragePrefix}:${normalizeStorageScope(scope)}`;
}

function getSyncStateStorageKey(scope) {
  return `${syncStateStoragePrefix}:${normalizeStorageScope(scope)}`;
}

function getDeviceId() {
  const stored = String(window.localStorage.getItem(deviceIdStorageKey) || "").trim();

  if (stored) {
    return stored;
  }

  const deviceId = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(deviceIdStorageKey, deviceId);
  return deviceId;
}

export function getSyncDeviceId() {
  return getDeviceId();
}

function getSyncState(scope = getCurrentStorageScope()) {
  const stored = readStorageJson(getSyncStateStorageKey(scope));

  return {
    revision: Math.max(0, Number.parseInt(stored?.revision || 0, 10)),
    checksum: String(stored?.checksum || ""),
    updatedAt: String(stored?.updatedAt || ""),
    lastSyncedAt: String(stored?.lastSyncedAt || ""),
    status: String(stored?.status || "idle"),
    message: String(stored?.message || ""),
  };
}

function updateSyncState(scope, patch) {
  const nextState = {
    ...getSyncState(scope),
    ...patch,
  };
  writeStorageJson(getSyncStateStorageKey(scope), nextState);
  window.dispatchEvent(new CustomEvent(syncStatusEventName, { detail: nextState }));
  return nextState;
}

export function getSyncStatus(scope = getCurrentStorageScope()) {
  return getSyncState(scope);
}

export function subscribeSyncStatus(listener) {
  const handleStatus = (event) => listener(event.detail);
  window.addEventListener(syncStatusEventName, handleStatus);
  return () => window.removeEventListener(syncStatusEventName, handleStatus);
}

function normalizeAccount(user) {
  if (!user?.id) {
    return null;
  }

  return {
    id: String(user.id),
    username: String(user.username || ""),
    displayName: String(user.displayName || user.username || ""),
  };
}

function normalizeAuthPayload(payload) {
  const user = normalizeAccount(payload?.user);
  const token = String(payload?.token || "").trim();

  if (!user || !token) {
    throw new Error("登录响应缺少账号信息");
  }

  return {
    user,
    token,
    expiresAt: String(payload?.expiresAt || ""),
  };
}

export function isCloudSyncEnabled() {
  return Boolean(cloudApiBaseUrl);
}

export function getTurnstileSiteKey() {
  return turnstileSiteKey;
}

export function getStoredAuth() {
  const auth = readStorageJson(authStorageKey);

  if (!auth?.token) {
    return null;
  }

  const user = normalizeAccount(auth.user);

  if (!user) {
    return null;
  }

  return {
    user,
    token: String(auth.token),
    expiresAt: String(auth.expiresAt || ""),
  };
}

export function getStoredAccount() {
  return getStoredAuth()?.user || null;
}

function saveStoredAuth(auth) {
  const normalized = normalizeAuthPayload(auth);
  writeStorageJson(authStorageKey, normalized);
  return normalized;
}

export function clearStoredAuth() {
  window.localStorage.removeItem(authStorageKey);
}

function getCurrentStorageScope() {
  return getStoredAccount()?.id || "guest";
}

function getFallbackData(scope = getCurrentStorageScope()) {
  const scopedData = readStorageJson(getScopedFallbackStorageKey(scope));
  const legacyData = readStorageJson(fallbackStorageKey);

  if (scopedData && legacyData) {
    return mergeData(scopedData, legacyData);
  }

  if (scopedData) {
    return normalizeData(scopedData);
  }

  return legacyData ? normalizeData(legacyData) : initialData;
}

function saveFallbackData(scope, data) {
  writeStorageJson(getScopedFallbackStorageKey(scope), normalizeData(data));
}

function clearFallbackData(scope) {
  window.localStorage.removeItem(getScopedFallbackStorageKey(scope));
  window.localStorage.removeItem(fallbackStorageKey);
}

function hasCompletedMigration(scope) {
  return window.localStorage.getItem(getMigrationStorageKey(scope)) === "true";
}

function markMigrationComplete(scope) {
  window.localStorage.setItem(getMigrationStorageKey(scope), "true");
}

async function loadLocalDataForMigration(scope) {
  const fallbackData = getFallbackData(scope);

  if (hasCompletedMigration(scope)) {
    return fallbackData;
  }

  const legacyTools = readStorageJson(legacyToolsStorageKey);
  const migrationData = mergeData(fallbackData, {
    ...initialData,
    tools: Array.isArray(legacyTools) ? legacyTools : [],
  });

  if (!window.sherlly?.loadData) {
    return migrationData;
  }

  try {
    return mergeData(migrationData, await window.sherlly.loadData());
  } catch (error) {
    console.error(error);
    return migrationData;
  }
}

function hasMeaningfulData(data) {
  const normalized = normalizeData(data);
  return [
    "tasks",
    "candidates",
    "logs",
    "vaultItems",
    "tools",
    "habits",
    "vaultCandidates",
    "tombstones",
  ].some((collection) => normalized[collection].length > 0);
}

export function mergeData(cloudData, localData) {
  return mergeSyncData(cloudData, localData);
}

export function isSameData(left, right) {
  return stableStringify(normalizeData(left)) === stableStringify(normalizeData(right));
}

function createAuthRequiredError(message = "请先登录 Sherlly 账号") {
  const error = new Error(message);
  error.code = "AUTH_REQUIRED";
  error.status = 401;
  return error;
}

export function isAuthRequiredError(error) {
  return error?.code === "AUTH_REQUIRED" || error?.status === 401;
}

async function parseCloudResponse(response, fallbackMessage) {
  let body = null;

  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const error = new Error(body?.message || `${fallbackMessage}：${response.status}`);
    error.status = response.status;
    error.code = body?.code || "";
    error.body = body;

    if (response.status === 401) {
      error.code = "AUTH_REQUIRED";
    }

    throw error;
  }

  return body;
}

async function requestCloud(path, options = {}) {
  const response = await fetch(`${cloudApiBaseUrl}${path}`, {
    ...options,
    headers: getCloudHeaders(options.headers, options.authToken),
  });

  return parseCloudResponse(response, options.fallbackMessage || "云端请求失败");
}

export async function uploadCloudAttachment(file, filename = "attachment") {
  const auth = getStoredAuth();

  if (!cloudApiBaseUrl || !auth) {
    throw createAuthRequiredError();
  }

  return requestCloud("/api/attachments", {
    method: "POST",
    headers: {
      "Content-Type": file?.type || "application/octet-stream",
      "X-Sherlly-Filename": String(filename || "attachment").slice(0, 160),
    },
    body: file,
    fallbackMessage: "云附件上传失败",
  });
}

export async function requestCloudAi({ prompt, context = "" }) {
  if (!cloudApiBaseUrl || !getStoredAuth()) {
    const error = new Error("云端 AI 不可用");
    error.code = "AI_UNAVAILABLE";
    throw error;
  }

  return requestCloud("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, context }),
    fallbackMessage: "云端 AI 请求失败",
  });
}

async function loadCloudEnvelope() {
  return normalizeSyncEnvelope(await requestCloud("/api/data", { fallbackMessage: "云端读取失败" }));
}

async function putCloudData(scope, data, baseRevision) {
  const envelope = normalizeSyncEnvelope(await requestCloud("/api/data", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schemaVersion: SYNC_SCHEMA_VERSION,
      baseRevision,
      deviceId: getDeviceId(),
      data: normalizeData(data),
    }),
    fallbackMessage: "云端保存失败",
  }));
  updateSyncState(scope, {
    revision: envelope.revision,
    checksum: envelope.checksum,
    updatedAt: envelope.updatedAt,
    lastSyncedAt: new Date().toISOString(),
    status: "synced",
    message: "",
  });
  clearFallbackData(scope);
  return envelope;
}

async function saveCloudData(scope, data) {
  const normalized = normalizeData(data);
  const syncState = getSyncState(scope);
  updateSyncState(scope, { status: "syncing", message: "" });

  try {
    return await putCloudData(scope, normalized, syncState.revision);
  } catch (error) {
    if (error.status !== 409 || !error.body?.envelope) {
      throw error;
    }

    const currentEnvelope = normalizeSyncEnvelope(error.body.envelope);
    const merged = mergeData(currentEnvelope.data, normalized);
    updateSyncState(scope, {
      revision: currentEnvelope.revision,
      checksum: currentEnvelope.checksum,
      updatedAt: currentEnvelope.updatedAt,
      status: "conflict-resolving",
      message: "检测到其他设备更新，正在自动合并",
    });
    return putCloudData(scope, merged, currentEnvelope.revision);
  }
}

function getCloudHeaders(headers = {}, authToken = getStoredAuth()?.token) {
  const nextHeaders = {
    ...headers,
  };

  if (cloudApiToken) {
    nextHeaders["X-Sherlly-Token"] = cloudApiToken;
  }

  if (authToken) {
    nextHeaders.Authorization = `Bearer ${authToken}`;
  }

  return nextHeaders;
}

export async function loginAccount(credentials) {
  const auth = await requestCloud("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    authToken: "",
    body: JSON.stringify({
      username: credentials?.username,
      password: credentials?.password,
      turnstileToken: credentials?.turnstileToken,
    }),
    fallbackMessage: "登录失败",
  });

  return saveStoredAuth(auth);
}

export async function registerAccount(credentials) {
  const auth = await requestCloud("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    authToken: "",
    body: JSON.stringify({
      username: credentials?.username,
      password: credentials?.password,
      displayName: credentials?.displayName,
      turnstileToken: credentials?.turnstileToken,
    }),
    fallbackMessage: "注册失败",
  });

  return saveStoredAuth(auth);
}

export async function loadCurrentAccount() {
  const auth = getStoredAuth();

  if (!auth) {
    return null;
  }

  const payload = await requestCloud("/api/auth/me", {
    fallbackMessage: "登录校验失败",
  });
  const user = normalizeAccount(payload?.user);

  if (!user) {
    clearStoredAuth();
    throw createAuthRequiredError("登录已失效，请重新登录");
  }

  saveStoredAuth({
    ...auth,
    user,
  });

  return user;
}

export async function changePassword(payload) {
  return requestCloud("/api/auth/password", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      currentPassword: payload?.currentPassword,
      nextPassword: payload?.nextPassword,
    }),
    fallbackMessage: "修改密码失败",
  });
}

export async function logoutAccount() {
  try {
    if (cloudApiBaseUrl && getStoredAuth()) {
      await requestCloud("/api/auth/logout", {
        method: "POST",
        fallbackMessage: "退出登录失败",
      });
    }
  } finally {
    clearStoredAuth();
  }
}

export async function loadAppData() {
  if (cloudApiBaseUrl) {
    const auth = getStoredAuth();

    if (!auth) {
      throw createAuthRequiredError();
    }

    try {
      const cloudEnvelope = await loadCloudEnvelope();
      updateSyncState(auth.user.id, {
        revision: cloudEnvelope.revision,
        checksum: cloudEnvelope.checksum,
        updatedAt: cloudEnvelope.updatedAt,
        lastSyncedAt: new Date().toISOString(),
        status: "synced",
        message: "",
      });
      const localData = await loadLocalDataForMigration(auth.user.id);

      if (hasMeaningfulData(localData)) {
        const mergedData = mergeData(cloudEnvelope.data, localData);
        const savedEnvelope = await saveCloudData(auth.user.id, mergedData);
        clearFallbackData(auth.user.id);
        window.localStorage.removeItem(legacyToolsStorageKey);
        markMigrationComplete(auth.user.id);
        return savedEnvelope.data;
      }

      markMigrationComplete(auth.user.id);
      return cloudEnvelope.data;
    } catch (error) {
      console.error(error);

      if (isAuthRequiredError(error)) {
        clearStoredAuth();
        throw error;
      }

      const fallbackData = getFallbackData(auth.user.id);

      if (hasMeaningfulData(fallbackData)) {
        updateSyncState(auth.user.id, {
          status: "offline-pending",
          message: "云端不可用，本地数据等待同步",
        });
        return fallbackData;
      }

      throw error;
    }
  }

  if (window.sherlly?.loadData) {
    return normalizeData(await window.sherlly.loadData());
  }

  return getFallbackData("guest");
}

export async function saveAppData(data) {
  const normalized = normalizeData(data);
  const imageValidation = validateEmbeddedImageLimits(normalized);

  if (!imageValidation.ok) {
    const error = new Error(imageValidation.message);
    error.code = imageValidation.code;
    error.status = 413;
    throw error;
  }

  if (cloudApiBaseUrl) {
    const auth = getStoredAuth();

    if (!auth) {
      throw createAuthRequiredError();
    }

    try {
      const envelope = await saveCloudData(auth.user.id, normalized);
      return envelope.data;
    } catch (error) {
      console.error(error);

      if (isAuthRequiredError(error)) {
        clearStoredAuth();
        throw error;
      }

      saveFallbackData(auth.user.id, normalized);
      updateSyncState(auth.user.id, {
        status: "offline-pending",
        message: error.message || "云端保存失败，本地数据等待同步",
      });
      return normalized;
    }
  }

  if (window.sherlly?.saveData) {
    return window.sherlly.saveData(normalized);
  }

  saveFallbackData("guest", normalized);
  return normalized;
}

export async function sendNotification(payload) {
  if (window.sherlly?.notify) {
    return window.sherlly.notify(payload);
  }

  if (!("Notification" in window)) {
    return false;
  }

  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }

  if (Notification.permission === "granted") {
    new Notification(payload.title || "Sherlly Assistant", {
      body: payload.body,
      silent: payload.sound === false,
    });
    return true;
  }

  return false;
}

export async function launchAction(action) {
  if (window.sherlly?.launchAction) {
    return window.sherlly.launchAction(action);
  }

  if (action?.type === "url" && action.target) {
    window.open(action.target, "_blank", "noopener,noreferrer");
    return { ok: true };
  }

  return {
    ok: false,
    message: "当前环境不支持打开本机软件或路径，请在 Electron 桌面端使用。",
  };
}

export async function selectAttachments() {
  if (window.sherlly?.selectAttachments) {
    return window.sherlly.selectAttachments();
  }

  return {
    ok: false,
    message: "当前环境不支持选择本机附件，请在 Electron 桌面端使用。",
    filePaths: [],
  };
}

function isEmbeddedImageAttachment(filePath) {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(String(filePath || ""));
}

export async function getAttachmentPreview(attachment) {
  const filePath = String(attachment?.path || "").trim();

  if (isEmbeddedImageAttachment(filePath)) {
    return {
      ok: true,
      imageUrl: filePath,
      name: attachment?.name || "粘贴图片",
      type: "image",
    };
  }

  if (attachment?.type !== "image") {
    return {
      ok: false,
      message: "非图片附件暂不支持预览，可以直接打开附件。",
    };
  }

  if (window.sherlly?.getAttachmentPreview) {
    return window.sherlly.getAttachmentPreview(attachment);
  }

  return {
    ok: false,
    message: "当前环境不支持本机图片预览，请在 Electron 桌面端使用。",
  };
}

function dataUrlToBlob(dataUrl) {
  const [metadata, content] = dataUrl.split(",");
  const mimeType = metadata.match(/^data:([^;]+)/i)?.[1] || "image/png";
  const binary = window.atob(content || "");
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function openEmbeddedImageAttachment(dataUrl) {
  try {
    const objectUrl = URL.createObjectURL(dataUrlToBlob(dataUrl));
    const previewWindow = window.open(objectUrl, "_blank");

    if (!previewWindow) {
      URL.revokeObjectURL(objectUrl);
      return {
        ok: false,
        message: "图片预览窗口被浏览器拦截。",
      };
    }

    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60 * 1000);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error.message || "无法打开粘贴图片。",
    };
  }
}

export async function openAttachment(filePath) {
  if (isEmbeddedImageAttachment(filePath)) {
    return openEmbeddedImageAttachment(filePath);
  }

  if (window.sherlly?.openAttachment) {
    return window.sherlly.openAttachment(filePath);
  }

  return {
    ok: false,
    message: "当前环境不支持打开本机附件，请在 Electron 桌面端使用。",
  };
}
