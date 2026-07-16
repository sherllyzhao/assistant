import { normalizeSyncData } from "../src/lib/syncModel.js";

export { SherllyUserData } from "./userDataStore.js";

const defaultData = {
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
};
const PASSWORD_HASH_ITERATIONS = 100000;
const PASSWORD_HASH_KEY_LENGTH = 32;
const SESSION_TTL_DAYS = 30;
const textEncoder = new TextEncoder();

function normalizeData(data) {
  return {
    tasks: Array.isArray(data?.tasks) ? data.tasks : [],
    candidates: Array.isArray(data?.candidates) ? data.candidates : [],
    logs: Array.isArray(data?.logs) ? data.logs : [],
    vaultItems: Array.isArray(data?.vaultItems) ? data.vaultItems : [],
    settings: {
      ...defaultData.settings,
      ...(data?.settings && typeof data.settings === "object" ? data.settings : {}),
    },
  };
}

function hasOwnField(data, field) {
  return Boolean(data && Object.prototype.hasOwnProperty.call(data, field));
}

function normalizeDataForSave(data, currentData = defaultData) {
  const current = normalizeData(currentData);

  return {
    tasks: hasOwnField(data, "tasks") ? (Array.isArray(data.tasks) ? data.tasks : []) : current.tasks,
    candidates: hasOwnField(data, "candidates")
      ? (Array.isArray(data.candidates) ? data.candidates : [])
      : current.candidates,
    logs: hasOwnField(data, "logs") ? (Array.isArray(data.logs) ? data.logs : []) : current.logs,
    vaultItems: hasOwnField(data, "vaultItems")
      ? (Array.isArray(data.vaultItems) ? data.vaultItems : [])
      : current.vaultItems,
    settings: {
      ...current.settings,
      ...(hasOwnField(data, "settings") && data.settings && typeof data.settings === "object" ? data.settings : {}),
    },
  };
}

function hasMeaningfulData(data) {
  const normalized = normalizeData(data);
  return (
    normalized.tasks.length > 0 ||
    normalized.candidates.length > 0 ||
    normalized.logs.length > 0 ||
    normalized.vaultItems.length > 0
  );
}

function isSameData(left, right) {
  return JSON.stringify(normalizeData(left)) === JSON.stringify(normalizeData(right));
}

function shouldBackupBeforeSave(currentData, nextData) {
  const current = normalizeData(currentData);
  const next = normalizeData(nextData);

  return (
    hasMeaningfulData(current) &&
    !isSameData(current, next) &&
    (next.tasks.length < current.tasks.length ||
      next.candidates.length < current.candidates.length ||
      next.logs.length < current.logs.length ||
      next.vaultItems.length < current.vaultItems.length)
  );
}

function normalizeUserId(value, defaultUserId) {
  const fallback = defaultUserId || "default";

  return (
    String(value || fallback)
      .trim()
      .replace(/[^\w:.-]/g, "_")
      .slice(0, 80) || fallback
  );
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function validateAccountInput(username, password) {
  if (!/^[\w.@-]{3,80}$/.test(username)) {
    throw createHttpError(400, "账号需为 3-80 位，只能包含字母、数字、下划线、点、@ 或连字符");
  }

  validatePasswordInput(password);
}

function validatePasswordInput(password) {
  if (String(password || "").length < 6) {
    throw createHttpError(400, "密码至少需要 6 位");
  }
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function bytesToBase64Url(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const base64 = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(String(value || "").length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function randomBase64Url(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(String(value)));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function pbkdf2Hash(password, salt, iterations, keyLength) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(String(password)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: base64UrlToBytes(salt),
      iterations,
    },
    key,
    keyLength * 8,
  );

  return bytesToBase64Url(new Uint8Array(bits));
}

function timingSafeEqualString(left, right) {
  const leftValue = String(left || "");
  const rightValue = String(right || "");
  let diff = leftValue.length ^ rightValue.length;
  const length = Math.max(leftValue.length, rightValue.length);

  for (let index = 0; index < length; index += 1) {
    diff |= (leftValue.charCodeAt(index) || 0) ^ (rightValue.charCodeAt(index) || 0);
  }

  return diff === 0;
}

async function createPasswordHash(password) {
  const salt = randomBase64Url(16);

  return {
    algorithm: "pbkdf2",
    digest: "sha256",
    hash: await pbkdf2Hash(password, salt, PASSWORD_HASH_ITERATIONS, PASSWORD_HASH_KEY_LENGTH),
    iterations: PASSWORD_HASH_ITERATIONS,
    keyLength: PASSWORD_HASH_KEY_LENGTH,
    salt,
  };
}

async function verifyPassword(password, passwordHash) {
  if (!passwordHash?.salt || !passwordHash?.hash) {
    return false;
  }

  const hash = await pbkdf2Hash(
    password,
    passwordHash.salt,
    Number.parseInt(passwordHash.iterations || PASSWORD_HASH_ITERATIONS, 10),
    Number.parseInt(passwordHash.keyLength || PASSWORD_HASH_KEY_LENGTH, 10),
  );

  return timingSafeEqualString(hash, passwordHash.hash);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
  };
}

function getAllowedOrigins(env) {
  return String(env.CORS_ORIGIN || "*")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function getCorsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowedOrigins = getAllowedOrigins(env);
  const allowAnyOrigin = allowedOrigins.includes("*");
  const allowRequestOrigin = !origin || origin === "null" || allowAnyOrigin || allowedOrigins.includes(origin);

  return {
    allowed: allowRequestOrigin,
    headers: {
      "Access-Control-Allow-Origin": allowAnyOrigin ? "*" : origin || allowedOrigins[0] || "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Sherlly-Token",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  };
}

function jsonResponse(request, env, body, status = 200) {
  const cors = getCorsHeaders(request, env);

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors.headers,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function getBearerToken(request) {
  const authorization = request.headers.get("Authorization") || "";

  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }

  return "";
}

function getRequestToken(request, url, env) {
  const directToken = String(request.headers.get("X-Sherlly-Token") || url.searchParams.get("token") || "").trim();

  if (directToken) {
    return directToken;
  }

  const bearerToken = getBearerToken(request);
  const expectedToken = String(env.SHERLLY_API_TOKEN || "").trim();
  return bearerToken === expectedToken ? bearerToken : "";
}

function isAuthorized(request, env, url) {
  const expectedToken = String(env.SHERLLY_API_TOKEN || "").trim();

  return !expectedToken || getRequestToken(request, url, env) === expectedToken;
}

function getClientIp(request) {
  return String(request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "")
    .split(",")[0]
    .trim();
}

async function verifyTurnstileToken(request, env, body) {
  const secret = String(env.TURNSTILE_SECRET_KEY || "").trim();

  if (!secret) {
    return;
  }

  const token = String(body?.turnstileToken || body?.["cf-turnstile-response"] || "").trim();

  if (!token) {
    throw createHttpError(400, "请先完成人类验证");
  }

  const formData = new FormData();
  formData.append("secret", secret);
  formData.append("response", token);

  const clientIp = getClientIp(request);

  if (clientIp) {
    formData.append("remoteip", clientIp);
  }

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: formData,
  });
  const result = await response.json().catch(() => null);

  if (!response.ok || !result?.success) {
    throw createHttpError(400, "人类验证失败，请重试");
  }
}

function getStorageKey(userId) {
  return `appData:${userId}`;
}

function getBackupStorageKey(userId, timestamp) {
  return `backups:appData:${userId}:${timestamp}`;
}

function getUserKey(username) {
  return `users:${username}`;
}

function getSessionKey(tokenHash) {
  return `sessions:${tokenHash}`;
}

function jsonInternalResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function getUserDataStoreStub(env, userId) {
  if (typeof env.SHERLLY_USER_DATA.getByName === "function") {
    return env.SHERLLY_USER_DATA.getByName(userId);
  }

  return env.SHERLLY_USER_DATA.get(env.SHERLLY_USER_DATA.idFromName(userId));
}

async function loadData(env, userId) {
  const store = getUserDataStoreStub(env, userId);
  const current = await store.read();

  if (current) {
    return current;
  }

  const stored = await env.SHERLLY_DATA.get(getStorageKey(userId));
  const legacyDocument = stored ? JSON.parse(stored) : null;
  return store.initializeLegacy(normalizeSyncData(legacyDocument?.data || defaultData));
}

async function saveData(env, userId, payload) {
  const result = await getUserDataStoreStub(env, userId).write(payload);

  if (!result?.ok) {
    return result;
  }

  return result.envelope;
}

export class SherllyAuthStore {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      const body = await readJsonBody(request);

      if (url.pathname === "/register" && request.method === "POST") {
        return jsonInternalResponse(await this.registerAccount(body), 201);
      }

      if (url.pathname === "/login" && request.method === "POST") {
        return jsonInternalResponse(await this.loginAccount(body));
      }

      if (url.pathname === "/session" && request.method === "GET") {
        const auth = await this.getAuthenticatedSession(request);
        return jsonInternalResponse({
          session: publicSession(auth.session),
          user: publicUser(auth.user),
        });
      }

      if (url.pathname === "/password" && request.method === "PUT") {
        return jsonInternalResponse(await this.changeAccountPassword(request, body));
      }

      if (url.pathname === "/logout" && request.method === "POST") {
        return jsonInternalResponse(await this.logoutAccount(request));
      }

      return jsonInternalResponse({ ok: false, message: "Not found" }, 404);
    } catch (error) {
      return jsonInternalResponse({ ok: false, message: error.message || "Auth store error" }, error.status || 500);
    }
  }

  async readLegacyJson(key) {
    if (!this.env.SHERLLY_DATA?.get) {
      return null;
    }

    const stored = await this.env.SHERLLY_DATA.get(key);
    return stored ? JSON.parse(stored) : null;
  }

  async deleteLegacyKey(key) {
    if (this.env.SHERLLY_DATA?.delete) {
      await this.env.SHERLLY_DATA.delete(key);
    }
  }

  async getUser(username) {
    const normalizedUsername = normalizeUsername(username);
    const key = getUserKey(normalizedUsername);
    const stored = await this.state.storage.get(key);

    if (stored) {
      return stored;
    }

    const legacyUser = await this.readLegacyJson(key);

    if (!legacyUser) {
      return null;
    }

    const user = {
      ...legacyUser,
      username: normalizedUsername,
    };

    await this.saveUser(user);
    return user;
  }

  async saveUser(user) {
    await this.state.storage.put(getUserKey(user.username), user);
  }

  async createAuthResponse(user) {
    const token = randomBase64Url(32);
    const tokenHash = await sha256Base64Url(token);
    const expiresAt = new Date();
    const ttlSeconds =
      Math.max(1, Number.parseInt(this.env.SHERLLY_SESSION_TTL_DAYS || SESSION_TTL_DAYS, 10)) * 24 * 60 * 60;
    expiresAt.setSeconds(expiresAt.getSeconds() + ttlSeconds);

    await this.state.storage.put(getSessionKey(tokenHash), {
      tokenHash,
      userId: user.id,
      username: user.username,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    return {
      token,
      expiresAt: expiresAt.toISOString(),
      user: publicUser(user),
    };
  }

  async registerAccount(body) {
    const username = normalizeUsername(body?.username);
    const password = String(body?.password || "");
    const displayName = String(body?.displayName || "").trim().slice(0, 40) || username;

    validateAccountInput(username, password);

    if (await this.getUser(username)) {
      throw createHttpError(409, "这个账号已经存在");
    }

    const now = new Date().toISOString();
    const user = {
      id: `user_${crypto.randomUUID()}`,
      username,
      displayName,
      password: await createPasswordHash(password),
      createdAt: now,
      updatedAt: now,
    };

    await this.saveUser(user);
    return this.createAuthResponse(user);
  }

  async loginAccount(body) {
    const username = normalizeUsername(body?.username);
    const user = await this.getUser(username);

    if (!user || !(await verifyPassword(String(body?.password || ""), user.password))) {
      throw createHttpError(401, "账号或密码不正确");
    }

    const updatedUser = {
      ...user,
      lastLoginAt: new Date().toISOString(),
    };

    await this.saveUser(updatedUser);
    return this.createAuthResponse(updatedUser);
  }

  async changeAccountPassword(request, body) {
    const auth = await this.getAuthenticatedSession(request);
    const currentPassword = String(body?.currentPassword || "");
    const nextPassword = String(body?.nextPassword || "");

    validatePasswordInput(nextPassword);

    if (!(await verifyPassword(currentPassword, auth.user.password))) {
      throw createHttpError(401, "当前密码不正确");
    }

    if (currentPassword === nextPassword) {
      throw createHttpError(400, "新密码不能和当前密码相同");
    }

    const now = new Date().toISOString();
    const user = {
      ...auth.user,
      password: await createPasswordHash(nextPassword),
      passwordUpdatedAt: now,
      updatedAt: now,
    };

    await this.saveUser(user);
    await this.state.storage.put(getSessionKey(auth.session.tokenHash), {
      ...auth.session,
      passwordVerifiedAt: now,
    });

    return {
      ok: true,
      signedOutSessions: await this.deleteUserSessionsExcept(user.id, auth.session.tokenHash),
    };
  }

  async logoutAccount(request) {
    const tokenHash = await this.getRequestTokenHash(request);
    await this.deleteSessionByTokenHash(tokenHash);
    return { ok: true };
  }

  async getRequestTokenHash(request) {
    const token = getBearerToken(request);

    if (!token) {
      throw createHttpError(401, "请先登录");
    }

    return sha256Base64Url(token);
  }

  async getAuthenticatedSession(request) {
    const tokenHash = await this.getRequestTokenHash(request);
    const key = getSessionKey(tokenHash);
    const session = (await this.state.storage.get(key)) || (await this.migrateLegacySession(tokenHash));

    if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
      await this.deleteSessionByTokenHash(tokenHash);
      throw createHttpError(401, "登录已过期，请重新登录");
    }

    const user = await this.getUser(session.username);

    if (!user || user.id !== session.userId) {
      await this.deleteSessionByTokenHash(tokenHash);
      throw createHttpError(401, "登录已失效，请重新登录");
    }

    if (isSessionBeforePasswordUpdate(session, user)) {
      await this.deleteSessionByTokenHash(tokenHash);
      throw createHttpError(401, "登录已失效，请重新登录");
    }

    return {
      session,
      user,
    };
  }

  async migrateLegacySession(tokenHash) {
    const key = getSessionKey(tokenHash);
    const legacySession = await this.readLegacyJson(key);

    if (!legacySession) {
      return null;
    }

    await this.state.storage.put(key, legacySession);
    return legacySession;
  }

  async deleteSessionByTokenHash(tokenHash) {
    const key = getSessionKey(tokenHash);
    await this.state.storage.delete(key);
    await this.deleteLegacyKey(key);
  }

  async deleteUserSessionsExcept(userId, currentTokenHash) {
    const deletedTokenHashes = new Set();
    let deletedCount = 0;
    const sessions = await this.state.storage.list({ prefix: "sessions:" });

    for (const [key, session] of sessions) {
      if (session?.userId === userId && session.tokenHash !== currentTokenHash) {
        await this.state.storage.delete(key);
        deletedTokenHashes.add(session.tokenHash);
        deletedCount += 1;
      }
    }

    return deletedCount + (await this.deleteLegacyUserSessionsExcept(userId, currentTokenHash, deletedTokenHashes));
  }

  async deleteLegacyUserSessionsExcept(userId, currentTokenHash, deletedTokenHashes) {
    if (!this.env.SHERLLY_DATA?.list || !this.env.SHERLLY_DATA?.delete) {
      return 0;
    }

    let cursor = undefined;
    let deletedCount = 0;

    do {
      const listed = await this.env.SHERLLY_DATA.list({
        prefix: "sessions:",
        cursor,
      });

      for (const key of listed.keys || []) {
        const session = await this.readLegacyJson(key.name);

        if (session?.userId === userId && session.tokenHash !== currentTokenHash) {
          await this.env.SHERLLY_DATA.delete(key.name);

          if (!deletedTokenHashes.has(session.tokenHash)) {
            deletedTokenHashes.add(session.tokenHash);
            deletedCount += 1;
          }
        }
      }

      cursor = listed.list_complete ? undefined : listed.cursor;
    } while (cursor);

    return deletedCount;
  }
}

async function readJsonBody(request) {
  if (request.method === "GET" || request.method === "HEAD") {
    return {};
  }

  try {
    return await request.json();
  } catch {
    return {};
  }
}

function publicSession(session) {
  return {
    tokenHash: session.tokenHash,
    userId: session.userId,
    username: session.username,
    createdAt: session.createdAt,
    passwordVerifiedAt: session.passwordVerifiedAt,
    expiresAt: session.expiresAt,
  };
}

function isSessionBeforePasswordUpdate(session, user) {
  const sessionCreatedAt = Date.parse(session?.passwordVerifiedAt || session?.createdAt || "");
  const passwordUpdatedAt = Date.parse(user?.passwordUpdatedAt || "");

  return Boolean(sessionCreatedAt && passwordUpdatedAt && sessionCreatedAt < passwordUpdatedAt);
}

function getAuthStoreStub(env) {
  if (!env.SHERLLY_AUTH_STORE?.idFromName || !env.SHERLLY_AUTH_STORE?.get) {
    throw createHttpError(500, "缺少 SHERLLY_AUTH_STORE Durable Object 绑定");
  }

  return env.SHERLLY_AUTH_STORE.get(env.SHERLLY_AUTH_STORE.idFromName("global"));
}

async function requestAuthStore(env, path, options = {}) {
  const headers = new Headers(options.headers || {});

  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await getAuthStoreStub(env).fetch(`https://sherlly-auth.internal${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await response.json();

  if (!response.ok) {
    throw createHttpError(response.status, body?.message || "账号服务请求失败");
  }

  return body;
}

async function registerAccount(env, body) {
  return requestAuthStore(env, "/register", {
    method: "POST",
    body,
  });
}

async function loginAccount(env, body) {
  return requestAuthStore(env, "/login", {
    method: "POST",
    body,
  });
}

async function getAuthenticatedSession(request, env) {
  return requestAuthStore(env, "/session", {
    headers: {
      Authorization: request.headers.get("Authorization") || "",
    },
  });
}

async function changeAccountPassword(env, request, body) {
  return requestAuthStore(env, "/password", {
    method: "PUT",
    headers: {
      Authorization: request.headers.get("Authorization") || "",
    },
    body,
  });
}

async function logoutAccount(env, request) {
  return requestAuthStore(env, "/logout", {
    method: "POST",
    headers: {
      Authorization: request.headers.get("Authorization") || "",
    },
  });
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const cors = getCorsHeaders(request, env);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: cors.allowed ? 204 : 403,
      headers: cors.headers,
    });
  }

  if (!cors.allowed) {
    return jsonResponse(request, env, { ok: false, message: "CORS origin is not allowed" }, 403);
  }

  if (url.pathname === "/health" && request.method === "GET") {
    return jsonResponse(request, env, { ok: true, service: "sherlly-cloudflare-worker" });
  }

  if (url.pathname === "/ready" && request.method === "GET") {
    const kvReady = Boolean(env.SHERLLY_DATA?.get && env.SHERLLY_DATA?.put);
    const authReady = Boolean(env.SHERLLY_AUTH_STORE?.idFromName && env.SHERLLY_AUTH_STORE?.get);
    const userDataReady = Boolean(
      env.SHERLLY_USER_DATA?.getByName ||
      (env.SHERLLY_USER_DATA?.idFromName && env.SHERLLY_USER_DATA?.get),
    );

    return jsonResponse(request, env, {
      ok: kvReady && authReady && userDataReady,
      storage: userDataReady ? "durable_object" : "missing",
      migrationStorage: kvReady ? "kv" : "missing",
      authStorage: authReady ? "durable_object" : "missing",
    }, kvReady && authReady && userDataReady ? 200 : 500);
  }

  if (url.pathname !== "/api/data" && !url.pathname.startsWith("/api/auth/")) {
    return jsonResponse(request, env, { ok: false, message: "Not found" }, 404);
  }

  if (!isAuthorized(request, env, url)) {
    return jsonResponse(request, env, { ok: false, message: "Unauthorized" }, 401);
  }

  if (url.pathname === "/api/auth/register" && request.method === "POST") {
    const body = await request.json();
    await verifyTurnstileToken(request, env, body);
    return jsonResponse(request, env, await registerAccount(env, body), 201);
  }

  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    const body = await request.json();
    await verifyTurnstileToken(request, env, body);
    return jsonResponse(request, env, await loginAccount(env, body));
  }

  if (url.pathname === "/api/auth/me" && request.method === "GET") {
    const auth = await getAuthenticatedSession(request, env);
    return jsonResponse(request, env, { user: publicUser(auth.user) });
  }

  if (url.pathname === "/api/auth/password" && request.method === "PUT") {
    return jsonResponse(request, env, await changeAccountPassword(env, request, await request.json()));
  }

  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    return jsonResponse(request, env, await logoutAccount(env, request));
  }

  if (url.pathname !== "/api/data") {
    return jsonResponse(request, env, { ok: false, message: "Not found" }, 404);
  }

  const auth = await getAuthenticatedSession(request, env);
  const userId = normalizeUserId(auth.user.id);

  if (request.method === "GET") {
    return jsonResponse(request, env, await loadData(env, userId));
  }

  if (request.method === "PUT") {
    const body = await request.json();
    const result = await saveData(env, userId, body);

    if (result?.ok === false) {
      return jsonResponse(request, env, result, result.status || 400);
    }

    return jsonResponse(request, env, result);
  }

  return jsonResponse(request, env, { ok: false, message: "Method not allowed" }, 405);
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      return jsonResponse(request, env, { ok: false, message: error.message || "Worker error" }, error.status || 500);
    }
  },
};
