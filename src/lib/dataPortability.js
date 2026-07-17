import {
  SYNC_SCHEMA_VERSION,
  calculateChecksum,
  normalizeSyncData,
  normalizeSyncEnvelope,
  validateEmbeddedImageLimits,
} from "./syncModel.js";

const EXPORT_FORMAT = "sherlly-assistant-data-export";

const entityCollections = [
  "tasks",
  "candidates",
  "logs",
  "vaultItems",
  "tools",
  "habits",
  "vaultCandidates",
];

const vaultItemFields = [
  "id",
  "title",
  "category",
  "usernameHint",
  "tags",
  "createdAt",
  "updatedAt",
  "lastViewedAt",
];

const encryptedVaultFields = [
  "version",
  "algorithm",
  "kdf",
  "iterations",
  "salt",
  "iv",
  "ciphertext",
];

function copyAllowedFields(value, fields) {
  const result = {};

  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      result[field] = field === "tags" && Array.isArray(value[field])
        ? [...value[field]]
        : value[field];
    }
  }

  return result;
}

function sanitizeVaultItem(item) {
  const source = item && typeof item === "object" ? item : {};
  const sanitized = copyAllowedFields(source, vaultItemFields);

  if (source.encrypted && typeof source.encrypted === "object") {
    sanitized.encrypted = copyAllowedFields(source.encrypted, encryptedVaultFields);
  }

  return sanitized;
}

function sanitizePortableData(data) {
  const normalized = normalizeSyncData(data);

  return {
    ...normalized,
    vaultItems: normalized.vaultItems.map(sanitizeVaultItem),
  };
}

function getEntityStatistics(data) {
  const normalized = normalizeSyncData(data);
  const statistics = {};

  for (const collection of entityCollections) {
    statistics[collection] = normalized[collection].length;
  }

  statistics.tombstones = normalized.tombstones.length;
  statistics.embeddedImageBytes = validateEmbeddedImageLimits(normalized).usage.totalBytes;
  return statistics;
}

function validateEntityIds(data) {
  for (const collection of entityCollections) {
    for (const item of Array.isArray(data?.[collection]) ? data[collection] : []) {
      if (!item?.id) {
        throw new Error(`${collection} 中存在缺少 id 的实体`);
      }
    }
  }

  for (const tombstone of Array.isArray(data?.tombstones) ? data.tombstones : []) {
    if (!tombstone?.entityType || !tombstone?.entityId || !tombstone?.deletedAt) {
      throw new Error("tombstones 中存在缺少必要字段的删除记录");
    }
  }
}

export async function createDataExport(data, metadata = {}) {
  const normalized = sanitizePortableData(data);
  const envelope = normalizeSyncEnvelope({
    schemaVersion: SYNC_SCHEMA_VERSION,
    revision: Number.isInteger(metadata.revision) ? metadata.revision : 0,
    updatedAt: metadata.updatedAt || new Date().toISOString(),
    deviceId: metadata.deviceId || "",
    data: normalized,
  });

  envelope.checksum = await calculateChecksum(normalized);

  return {
    format: EXPORT_FORMAT,
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    appVersion: String(metadata.appVersion || ""),
    statistics: getEntityStatistics(normalized),
    envelope,
  };
}

export async function validateDataImport(value) {
  if (!value || value.format !== EXPORT_FORMAT || value.formatVersion !== 1) {
    throw new Error("不是受支持的 Sherlly 数据导出文件");
  }

  const envelope = normalizeSyncEnvelope(value.envelope);

  if (envelope.schemaVersion < 1 || envelope.schemaVersion > SYNC_SCHEMA_VERSION) {
    throw new Error(`不支持 schemaVersion ${envelope.schemaVersion}`);
  }

  validateEntityIds(envelope.data);

  const expectedChecksum = await calculateChecksum(envelope.data);

  if (!envelope.checksum || envelope.checksum !== expectedChecksum) {
    throw new Error("导出文件 checksum 校验失败，已拒绝导入");
  }

  const sanitizedData = sanitizePortableData(envelope.data);
  const imageValidation = validateEmbeddedImageLimits(sanitizedData);

  if (!imageValidation.ok) {
    throw new Error(imageValidation.message);
  }

  envelope.data = sanitizedData;
  envelope.checksum = await calculateChecksum(sanitizedData);

  return {
    envelope,
    statistics: getEntityStatistics(sanitizedData),
    exportedAt: String(value.exportedAt || ""),
    appVersion: String(value.appVersion || ""),
  };
}

export function downloadDataExport(exportDocument, filename = "sherlly-data-export.json") {
  const blob = new Blob([JSON.stringify(exportDocument, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export { EXPORT_FORMAT };
