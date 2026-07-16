export const SYNC_SCHEMA_VERSION = 3;
export const EMBEDDED_IMAGE_LIMITS = Object.freeze({
  perAttachmentBytes: 2 * 1024 * 1024,
  perTaskBytes: 5 * 1024 * 1024,
  accountBytes: 20 * 1024 * 1024,
});

export const DEFAULT_SYNC_DATA = Object.freeze({
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
  },
});

const entityCollections = ["tasks", "candidates", "logs", "vaultItems", "tools", "habits", "vaultCandidates"];

function normalizeTimestamp(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeEntityList(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && item.id) : [];
}

export function normalizeTombstones(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const byKey = new Map();

  for (const item of value) {
    const entityType = String(item?.entityType || "").trim();
    const entityId = String(item?.entityId || "").trim();

    if (!entityType || !entityId) {
      continue;
    }

    const normalized = {
      entityType,
      entityId,
      deletedAt: item.deletedAt || new Date(0).toISOString(),
      deviceId: String(item.deviceId || ""),
    };
    const key = `${entityType}:${entityId}`;
    const existing = byKey.get(key);

    if (!existing || normalizeTimestamp(normalized.deletedAt) >= normalizeTimestamp(existing.deletedAt)) {
      byKey.set(key, normalized);
    }
  }

  return [...byKey.values()];
}

export function normalizeSyncData(data, defaults = DEFAULT_SYNC_DATA) {
  const normalized = {
    settings: {
      ...defaults.settings,
      ...(data?.settings && typeof data.settings === "object" ? data.settings : {}),
    },
    tombstones: normalizeTombstones(data?.tombstones),
  };

  for (const collection of entityCollections) {
    normalized[collection] = normalizeEntityList(data?.[collection]);
  }

  return normalized;
}

export function createTombstone(entityType, entityId, deviceId = "", deletedAt = new Date()) {
  return {
    entityType: String(entityType || "").trim(),
    entityId: String(entityId || "").trim(),
    deviceId: String(deviceId || ""),
    deletedAt: deletedAt.toISOString(),
  };
}

function mergeCollection(collection, cloudItems, localItems, tombstones) {
  const itemsById = new Map();

  for (const item of [...cloudItems, ...localItems]) {
    const existing = itemsById.get(item.id);
    const itemTime = normalizeTimestamp(item.updatedAt || item.createdAt || item.detectedAt);
    const existingTime = normalizeTimestamp(existing?.updatedAt || existing?.createdAt || existing?.detectedAt);

    if (!existing || itemTime >= existingTime) {
      itemsById.set(item.id, item);
    }
  }

  for (const tombstone of tombstones) {
    if (tombstone.entityType !== collection) {
      continue;
    }

    const item = itemsById.get(tombstone.entityId);
    const itemTime = normalizeTimestamp(item?.updatedAt || item?.createdAt || item?.detectedAt);

    if (!item || normalizeTimestamp(tombstone.deletedAt) >= itemTime) {
      itemsById.delete(tombstone.entityId);
    }
  }

  return [...itemsById.values()];
}

export function mergeSyncData(cloudData, localData) {
  const cloud = normalizeSyncData(cloudData);
  const local = normalizeSyncData(localData);
  const tombstones = normalizeTombstones([...cloud.tombstones, ...local.tombstones]);
  const merged = {
    settings: {
      ...cloud.settings,
      ...local.settings,
    },
    tombstones,
  };

  for (const collection of entityCollections) {
    merged[collection] = mergeCollection(collection, cloud[collection], local[collection], tombstones);
  }

  return merged;
}

function sortForStableJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortForStableJson);
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = sortForStableJson(value[key]);
        return result;
      }, {});
  }

  return value;
}

export function stableStringify(value) {
  return JSON.stringify(sortForStableJson(value));
}

export async function calculateChecksum(data) {
  const bytes = new TextEncoder().encode(stableStringify(normalizeSyncData(data)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function createSyncEnvelope(data, metadata = {}) {
  const normalized = normalizeSyncData(data);

  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    revision: Number.isInteger(metadata.revision) ? metadata.revision : 0,
    updatedAt: metadata.updatedAt || new Date().toISOString(),
    deviceId: String(metadata.deviceId || ""),
    checksum: await calculateChecksum(normalized),
    data: normalized,
  };
}

export function normalizeSyncEnvelope(value) {
  if (value?.data && typeof value.data === "object") {
    return {
      schemaVersion: Number.parseInt(value.schemaVersion || SYNC_SCHEMA_VERSION, 10),
      revision: Math.max(0, Number.parseInt(value.revision || 0, 10)),
      updatedAt: String(value.updatedAt || ""),
      deviceId: String(value.deviceId || ""),
      checksum: String(value.checksum || ""),
      data: normalizeSyncData(value.data),
    };
  }

  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    revision: 0,
    updatedAt: "",
    deviceId: "",
    checksum: "",
    data: normalizeSyncData(value),
  };
}

function getDataUrlBytes(value) {
  const dataUrl = String(value || "");

  if (!dataUrl.startsWith("data:image/")) {
    return 0;
  }

  const commaIndex = dataUrl.indexOf(",");

  if (commaIndex < 0) {
    return 0;
  }

  const metadata = dataUrl.slice(0, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);

  if (!metadata.includes(";base64")) {
    return new TextEncoder().encode(decodeURIComponent(payload)).byteLength;
  }

  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

export function getEmbeddedImageUsage(data, limits = EMBEDDED_IMAGE_LIMITS) {
  const normalized = normalizeSyncData(data);
  const violations = [];
  let totalBytes = 0;

  for (const task of normalized.tasks) {
    let taskBytes = 0;

    for (const attachment of Array.isArray(task.attachments) ? task.attachments : []) {
      const value = String(attachment?.path || attachment?.url || "");

      if (!value.startsWith("data:image/")) {
        continue;
      }

      const bytes = getDataUrlBytes(value);
      taskBytes += bytes;
      totalBytes += bytes;

      if (bytes > limits.perAttachmentBytes) {
        violations.push({
          code: "EMBEDDED_IMAGE_ATTACHMENT_LIMIT",
          taskId: task.id,
          attachmentId: attachment.id,
          bytes,
          limitBytes: limits.perAttachmentBytes,
        });
      }
    }

    if (taskBytes > limits.perTaskBytes) {
      violations.push({
        code: "EMBEDDED_IMAGE_TASK_LIMIT",
        taskId: task.id,
        bytes: taskBytes,
        limitBytes: limits.perTaskBytes,
      });
    }
  }

  if (totalBytes > limits.accountBytes) {
    violations.push({
      code: "EMBEDDED_IMAGE_ACCOUNT_LIMIT",
      bytes: totalBytes,
      limitBytes: limits.accountBytes,
    });
  }

  return {
    totalBytes,
    limits,
    violations,
  };
}

export function getEmbeddedImageBytes(data) {
  return getEmbeddedImageUsage(data).totalBytes;
}

export function validateEmbeddedImageLimits(data, limits = EMBEDDED_IMAGE_LIMITS) {
  const usage = getEmbeddedImageUsage(data, limits);
  const violation = usage.violations[0];

  if (!violation) {
    return { ok: true, usage };
  }

  const label = violation.code === "EMBEDDED_IMAGE_ATTACHMENT_LIMIT"
    ? "单张嵌入图片"
    : violation.code === "EMBEDDED_IMAGE_TASK_LIMIT"
      ? "单个任务的嵌入图片"
      : "账号嵌入图片总量";

  return {
    ok: false,
    code: violation.code,
    message: `${label}超过限制（${Math.ceil(violation.bytes / 1024)} KB / ${Math.ceil(violation.limitBytes / 1024)} KB）`,
    usage,
  };
}
