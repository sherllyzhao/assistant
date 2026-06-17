const fallbackStorageKey = "sherlly-assistant:v1";
const scopedFallbackStoragePrefix = "sherlly-assistant:v1:data";
const migrationStoragePrefix = "sherlly-assistant:v1:migrated";
const authStorageKey = "sherlly-assistant:auth:v1";
const cloudApiBaseUrl = String(import.meta.env.VITE_SHERLLY_API_URL || "").replace(/\/+$/, "");
const cloudApiToken = String(import.meta.env.VITE_SHERLLY_API_TOKEN || "").trim();
const turnstileSiteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || "").trim();

export const initialData = {
  tasks: [],
  candidates: [],
  logs: [],
  vaultItems: [],
  settings: {
    soundEnabled: true,
  },
};

function normalizeData(data) {
  return {
    tasks: Array.isArray(data?.tasks) ? data.tasks : [],
    candidates: Array.isArray(data?.candidates) ? data.candidates : [],
    logs: Array.isArray(data?.logs) ? data.logs : [],
    vaultItems: Array.isArray(data?.vaultItems) ? data.vaultItems : [],
    settings: {
      ...initialData.settings,
      ...(data?.settings && typeof data.settings === "object" ? data.settings : {}),
    },
  };
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
  if (hasCompletedMigration(scope)) {
    return initialData;
  }

  const fallbackData = getFallbackData(scope);

  if (!window.sherlly?.loadData) {
    return fallbackData;
  }

  try {
    return mergeData(fallbackData, await window.sherlly.loadData());
  } catch (error) {
    console.error(error);
    return fallbackData;
  }
}

function hasMeaningfulData(data) {
  return data.tasks.length > 0 || data.candidates.length > 0 || data.logs.length > 0 || data.vaultItems.length > 0;
}

function getItemTimestamp(item) {
  return new Date(item?.updatedAt || item?.createdAt || item?.detectedAt || item?.createdAt || 0).getTime();
}

function mergeItems(cloudItems, localItems) {
  const itemsById = new Map();

  for (const item of cloudItems) {
    if (item?.id) {
      itemsById.set(item.id, item);
    }
  }

  for (const item of localItems) {
    if (!item?.id) {
      continue;
    }

    const existing = itemsById.get(item.id);

    if (!existing || getItemTimestamp(item) >= getItemTimestamp(existing)) {
      itemsById.set(item.id, item);
    }
  }

  return [...itemsById.values()];
}

export function mergeData(cloudData, localData) {
  const cloud = normalizeData(cloudData);
  const local = normalizeData(localData);

  return {
    tasks: mergeItems(cloud.tasks, local.tasks),
    candidates: mergeItems(cloud.candidates, local.candidates),
    logs: mergeItems(cloud.logs, local.logs),
    vaultItems: mergeItems(cloud.vaultItems, local.vaultItems),
    settings: {
      ...cloud.settings,
      ...local.settings,
    },
  };
}

export function isSameData(left, right) {
  return JSON.stringify(normalizeData(left)) === JSON.stringify(normalizeData(right));
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

async function loadCloudData() {
  return normalizeData(await requestCloud("/api/data", { fallbackMessage: "云端读取失败" }));
}

async function saveCloudData(data) {
  return normalizeData(await requestCloud("/api/data", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(normalizeData(data)),
    fallbackMessage: "云端保存失败",
  }));
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
      const cloudData = await loadCloudData();
      const localData = await loadLocalDataForMigration(auth.user.id);

      if (hasMeaningfulData(localData)) {
        const mergedData = mergeData(cloudData, localData);
        await saveCloudData(mergedData);
        clearFallbackData(auth.user.id);
        markMigrationComplete(auth.user.id);
        return mergedData;
      }

      markMigrationComplete(auth.user.id);
      return cloudData;
    } catch (error) {
      console.error(error);

      if (isAuthRequiredError(error)) {
        clearStoredAuth();
        throw error;
      }

      const fallbackData = getFallbackData(auth.user.id);

      if (hasMeaningfulData(fallbackData)) {
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

  if (cloudApiBaseUrl) {
    const auth = getStoredAuth();

    if (!auth) {
      throw createAuthRequiredError();
    }

    try {
      return await saveCloudData(normalized);
    } catch (error) {
      console.error(error);

      if (isAuthRequiredError(error)) {
        clearStoredAuth();
        throw error;
      }

      saveFallbackData(auth.user.id, normalized);
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
