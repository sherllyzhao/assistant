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
        CREATE TABLE IF NOT EXISTS oauth_states (
          provider TEXT NOT NULL,
          state_id TEXT PRIMARY KEY,
          code_verifier TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS oauth_tokens (
          provider TEXT PRIMARY KEY,
          ciphertext TEXT NOT NULL,
          scope TEXT NOT NULL,
          token_type TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
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

  async migrateLegacy(data) {
    const existing = this.readCurrent();
    const existingData = normalizeSyncData(existing?.data);
    const hasExistingData = [
      "tasks",
      "candidates",
      "logs",
      "vaultItems",
      "tools",
      "habits",
      "vaultCandidates",
      "tombstones",
    ].some((collection) => existingData[collection].length > 0);

    if (existing && (existing.revision !== 0 || hasExistingData)) {
      return existing;
    }

    const envelope = await createSyncEnvelope(data, {
      revision: existing?.revision || 0,
      deviceId: "legacy-kv",
    });
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

  async saveOAuthState(payload) {
    const provider = String(payload?.provider || "").trim().slice(0, 64);
    const stateId = String(payload?.stateId || "").trim().slice(0, 160);
    const codeVerifier = String(payload?.codeVerifier || "").trim().slice(0, 256);
    const expiresAt = String(payload?.expiresAt || "").trim();
    const createdAt = String(payload?.createdAt || new Date().toISOString()).trim();

    if (!provider || !stateId || !codeVerifier || !expiresAt) {
      return { ok: false, code: "INVALID_OAUTH_STATE", message: "OAuth state 参数无效" };
    }

    this.state.storage.sql.exec("DELETE FROM oauth_states WHERE expires_at <= ?", new Date().toISOString());
    this.state.storage.sql.exec(
      `INSERT OR REPLACE INTO oauth_states (provider, state_id, code_verifier, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      provider,
      stateId,
      codeVerifier,
      expiresAt,
      createdAt,
    );

    return { ok: true };
  }

  async consumeOAuthState(providerValue, stateIdValue) {
    const provider = String(providerValue || "").trim().slice(0, 64);
    const stateId = String(stateIdValue || "").trim().slice(0, 160);
    const row = firstRow(this.state.storage.sql.exec(
      `SELECT provider, state_id, code_verifier, expires_at, created_at
       FROM oauth_states
       WHERE provider = ? AND state_id = ?`,
      provider,
      stateId,
    ));

    this.state.storage.sql.exec("DELETE FROM oauth_states WHERE provider = ? AND state_id = ?", provider, stateId);

    if (!row || new Date(String(row.expires_at)).getTime() <= Date.now()) {
      return null;
    }

    return {
      provider: String(row.provider),
      stateId: String(row.state_id),
      codeVerifier: String(row.code_verifier),
      expiresAt: String(row.expires_at),
      createdAt: String(row.created_at),
    };
  }

  async saveOAuthToken(payload) {
    const provider = String(payload?.provider || "").trim().slice(0, 64);
    const ciphertext = String(payload?.ciphertext || "").trim().slice(0, 16000);
    const scope = String(payload?.scope || "").trim().slice(0, 1000);
    const tokenType = String(payload?.tokenType || "Bearer").trim().slice(0, 64) || "Bearer";
    const expiresAt = String(payload?.expiresAt || "").trim();
    const updatedAt = String(payload?.updatedAt || new Date().toISOString()).trim();

    if (!provider || !ciphertext || !expiresAt) {
      return { ok: false, code: "INVALID_OAUTH_TOKEN", message: "OAuth token 参数无效" };
    }

    this.state.storage.sql.exec(
      `INSERT INTO oauth_tokens (provider, ciphertext, scope, token_type, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         scope = excluded.scope,
         token_type = excluded.token_type,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`,
      provider,
      ciphertext,
      scope,
      tokenType,
      expiresAt,
      updatedAt,
    );

    return { ok: true };
  }

  async getOAuthToken(providerValue) {
    const provider = String(providerValue || "").trim().slice(0, 64);
    const row = firstRow(this.state.storage.sql.exec(
      `SELECT provider, ciphertext, scope, token_type, expires_at, updated_at
       FROM oauth_tokens
       WHERE provider = ?`,
      provider,
    ));

    if (!row) {
      return null;
    }

    return {
      provider: String(row.provider),
      ciphertext: String(row.ciphertext),
      scope: String(row.scope),
      tokenType: String(row.token_type),
      expiresAt: String(row.expires_at),
      updatedAt: String(row.updated_at),
    };
  }

  async deleteOAuthToken(providerValue) {
    const provider = String(providerValue || "").trim().slice(0, 64);
    this.state.storage.sql.exec("DELETE FROM oauth_tokens WHERE provider = ?", provider);
    return { ok: true };
  }
}
