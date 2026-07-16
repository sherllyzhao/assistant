import {
  SYNC_SCHEMA_VERSION,
  createSyncEnvelope,
  normalizeSyncData,
  validateEmbeddedImageLimits,
} from "../src/lib/syncModel.js";

const MAX_BACKUP_COUNT = 20;

function firstRow(cursor) {
  return Array.from(cursor)[0] || null;
}

function rowToEnvelope(row) {
  if (!row) {
    return null;
  }

  return {
    schemaVersion: Number(row.schema_version),
    revision: Number(row.revision),
    updatedAt: String(row.updated_at),
    deviceId: String(row.device_id),
    checksum: String(row.checksum),
    data: normalizeSyncData(JSON.parse(String(row.data_json))),
  };
}

export class SherllyUserData {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(async () => {
      this.state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS current_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          schema_version INTEGER NOT NULL,
          revision INTEGER NOT NULL,
          updated_at TEXT NOT NULL,
          device_id TEXT NOT NULL,
          checksum TEXT NOT NULL,
          data_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS state_backups (
          revision INTEGER PRIMARY KEY,
          schema_version INTEGER NOT NULL,
          updated_at TEXT NOT NULL,
          device_id TEXT NOT NULL,
          checksum TEXT NOT NULL,
          data_json TEXT NOT NULL,
          backed_up_at TEXT NOT NULL
        );
      `);
    });
  }

  readCurrent() {
    return rowToEnvelope(firstRow(this.state.storage.sql.exec(`
      SELECT schema_version, revision, updated_at, device_id, checksum, data_json
      FROM current_state
      WHERE id = 1
    `)));
  }

  saveCurrent(envelope) {
    this.state.storage.sql.exec(
      `INSERT INTO current_state (
        id, schema_version, revision, updated_at, device_id, checksum, data_json
      ) VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        schema_version = excluded.schema_version,
        revision = excluded.revision,
        updated_at = excluded.updated_at,
        device_id = excluded.device_id,
        checksum = excluded.checksum,
        data_json = excluded.data_json`,
      envelope.schemaVersion,
      envelope.revision,
      envelope.updatedAt,
      envelope.deviceId,
      envelope.checksum,
      JSON.stringify(envelope.data),
    );
  }

  saveBackup(envelope) {
    this.state.storage.sql.exec(
      `INSERT OR REPLACE INTO state_backups (
        revision, schema_version, updated_at, device_id, checksum, data_json, backed_up_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      envelope.revision,
      envelope.schemaVersion,
      envelope.updatedAt,
      envelope.deviceId,
      envelope.checksum,
      JSON.stringify(envelope.data),
      new Date().toISOString(),
    );
    this.state.storage.sql.exec(
      `DELETE FROM state_backups
      WHERE revision NOT IN (
        SELECT revision FROM state_backups ORDER BY revision DESC LIMIT ?
      )`,
      MAX_BACKUP_COUNT,
    );
  }

  async read() {
    return this.readCurrent();
  }

  async initializeLegacy(data) {
    const envelope = await createSyncEnvelope(data, {
      revision: 0,
      deviceId: "legacy-kv",
    });
    const existing = this.readCurrent();

    if (existing) {
      return existing;
    }

    this.saveCurrent(envelope);
    return envelope;
  }

  async write(payload) {
    const baseRevision = Number(payload?.baseRevision);
    const schemaVersion = Number(payload?.schemaVersion);
    const deviceId = String(payload?.deviceId || "").trim().slice(0, 128);

    if (!Number.isInteger(baseRevision) || baseRevision < 0 || !deviceId || !payload?.data) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_SYNC_REQUEST",
        message: "同步请求缺少有效的 baseRevision、deviceId 或 data",
      };
    }

    if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > SYNC_SCHEMA_VERSION) {
      return {
        ok: false,
        status: 422,
        code: "UNSUPPORTED_SCHEMA_VERSION",
        message: `不支持 schemaVersion ${payload?.schemaVersion}`,
      };
    }

    const imageValidation = validateEmbeddedImageLimits(payload.data);

    if (!imageValidation.ok) {
      return {
        ok: false,
        status: 413,
        code: imageValidation.code,
        message: imageValidation.message,
        usage: imageValidation.usage,
      };
    }

    const nextEnvelope = await createSyncEnvelope(payload.data, {
      revision: 0,
      deviceId,
    });
    const current = this.readCurrent();
    const currentRevision = current?.revision || 0;

    if (baseRevision !== currentRevision) {
      return {
        ok: false,
        status: 409,
        code: "REVISION_CONFLICT",
        message: "云端数据已被其他设备更新",
        envelope: current,
      };
    }

    nextEnvelope.revision = currentRevision + 1;

    if (current) {
      this.saveBackup(current);
    }

    this.saveCurrent(nextEnvelope);

    return {
      ok: true,
      envelope: nextEnvelope,
    };
  }
}
