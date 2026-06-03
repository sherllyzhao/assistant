const fallbackStorageKey = "sherlly-assistant:v1";
const cloudApiBaseUrl = String(import.meta.env.VITE_SHERLLY_API_URL || "").replace(/\/+$/, "");
const cloudUserId = String(import.meta.env.VITE_SHERLLY_USER_ID || "default");
const cloudApiToken = String(import.meta.env.VITE_SHERLLY_API_TOKEN || "").trim();

export const initialData = {
  tasks: [],
  candidates: [],
  logs: [],
  settings: {
    soundEnabled: true,
  },
};

function normalizeData(data) {
  return {
    tasks: Array.isArray(data?.tasks) ? data.tasks : [],
    candidates: Array.isArray(data?.candidates) ? data.candidates : [],
    logs: Array.isArray(data?.logs) ? data.logs : [],
    settings: {
      ...initialData.settings,
      ...(data?.settings && typeof data.settings === "object" ? data.settings : {}),
    },
  };
}

function getFallbackData() {
  const raw = window.localStorage.getItem(fallbackStorageKey);
  return raw ? normalizeData(JSON.parse(raw)) : initialData;
}

function hasMeaningfulData(data) {
  return data.tasks.length > 0 || data.candidates.length > 0 || data.logs.length > 0;
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
    settings: {
      ...cloud.settings,
      ...local.settings,
    },
  };
}

export function isSameData(left, right) {
  return JSON.stringify(normalizeData(left)) === JSON.stringify(normalizeData(right));
}

async function loadCloudData() {
  const response = await fetch(`${cloudApiBaseUrl}/api/data?userId=${encodeURIComponent(cloudUserId)}`, {
    headers: getCloudHeaders(),
  });

  if (!response.ok) {
    throw new Error(`云端读取失败：${response.status}`);
  }

  return normalizeData(await response.json());
}

async function saveCloudData(data) {
  const response = await fetch(`${cloudApiBaseUrl}/api/data?userId=${encodeURIComponent(cloudUserId)}`, {
    method: "PUT",
    headers: getCloudHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(normalizeData(data)),
  });

  if (!response.ok) {
    throw new Error(`云端保存失败：${response.status}`);
  }

  return normalizeData(await response.json());
}

function getCloudHeaders(headers = {}) {
  if (!cloudApiToken) {
    return headers;
  }

  return {
    ...headers,
    Authorization: `Bearer ${cloudApiToken}`,
  };
}

export async function loadAppData() {
  if (cloudApiBaseUrl) {
    try {
      const cloudData = await loadCloudData();
      const fallbackData = getFallbackData();

      if (hasMeaningfulData(fallbackData)) {
        const mergedData = mergeData(cloudData, fallbackData);
        await saveCloudData(mergedData);
        window.localStorage.removeItem(fallbackStorageKey);
        return mergedData;
      }

      return cloudData;
    } catch (error) {
      console.error(error);
      return getFallbackData();
    }
  }

  if (window.sherlly?.loadData) {
    return normalizeData(await window.sherlly.loadData());
  }

  return getFallbackData();
}

export async function saveAppData(data) {
  const normalized = normalizeData(data);

  if (cloudApiBaseUrl) {
    try {
      return await saveCloudData(normalized);
    } catch (error) {
      console.error(error);
      window.localStorage.setItem(fallbackStorageKey, JSON.stringify(normalized));
      return normalized;
    }
  }

  if (window.sherlly?.saveData) {
    return window.sherlly.saveData(normalized);
  }

  window.localStorage.setItem(fallbackStorageKey, JSON.stringify(normalized));
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

export async function openAttachment(filePath) {
  if (window.sherlly?.openAttachment) {
    return window.sherlly.openAttachment(filePath);
  }

  return {
    ok: false,
    message: "当前环境不支持打开本机附件，请在 Electron 桌面端使用。",
  };
}
