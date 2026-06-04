const defaultData = {
  tasks: [],
  candidates: [],
  logs: [],
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
    settings: {
      ...defaultData.settings,
      ...(data?.settings && typeof data.settings === "object" ? data.settings : {}),
    },
  };
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
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
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

function getStorageKey(userId) {
  return `appData:${userId}`;
}

function getUserKey(username) {
  return `users:${username}`;
}

function getSessionKey(tokenHash) {
  return `sessions:${tokenHash}`;
}

async function loadData(env, userId) {
  const stored = await env.SHERLLY_DATA.get(getStorageKey(userId));

  if (!stored) {
    return defaultData;
  }

  return normalizeData(JSON.parse(stored)?.data);
}

async function saveData(env, userId, data) {
  const normalized = normalizeData(data);

  await env.SHERLLY_DATA.put(
    getStorageKey(userId),
    JSON.stringify({
      userId,
      data: normalized,
      updatedAt: new Date().toISOString(),
    }),
  );

  return normalized;
}

async function getUser(env, username) {
  const stored = await env.SHERLLY_DATA.get(getUserKey(username));
  return stored ? JSON.parse(stored) : null;
}

async function saveUser(env, user) {
  await env.SHERLLY_DATA.put(getUserKey(user.username), JSON.stringify(user));
}

async function createAuthResponse(env, user) {
  const token = randomBase64Url(32);
  const tokenHash = await sha256Base64Url(token);
  const expiresAt = new Date();
  const ttlSeconds = Math.max(1, Number.parseInt(env.SHERLLY_SESSION_TTL_DAYS || SESSION_TTL_DAYS, 10)) * 24 * 60 * 60;
  expiresAt.setSeconds(expiresAt.getSeconds() + ttlSeconds);

  await env.SHERLLY_DATA.put(
    getSessionKey(tokenHash),
    JSON.stringify({
      tokenHash,
      userId: user.id,
      username: user.username,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
    }),
    { expirationTtl: ttlSeconds },
  );

  return {
    token,
    expiresAt: expiresAt.toISOString(),
    user: publicUser(user),
  };
}

async function registerAccount(env, body) {
  const username = normalizeUsername(body?.username);
  const password = String(body?.password || "");
  const displayName = String(body?.displayName || "").trim().slice(0, 40) || username;

  validateAccountInput(username, password);

  if (await getUser(env, username)) {
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

  await saveUser(env, user);
  return createAuthResponse(env, user);
}

async function loginAccount(env, body) {
  const username = normalizeUsername(body?.username);
  const user = await getUser(env, username);

  if (!user || !(await verifyPassword(String(body?.password || ""), user.password))) {
    throw createHttpError(401, "账号或密码不正确");
  }

  await saveUser(env, {
    ...user,
    lastLoginAt: new Date().toISOString(),
  });

  return createAuthResponse(env, user);
}

async function deleteUserSessionsExcept(env, userId, currentTokenHash) {
  let cursor = undefined;
  let deletedCount = 0;

  do {
    const listed = await env.SHERLLY_DATA.list({
      prefix: "sessions:",
      cursor,
    });

    for (const key of listed.keys || []) {
      const stored = await env.SHERLLY_DATA.get(key.name);
      const session = stored ? JSON.parse(stored) : null;

      if (session?.userId === userId && session.tokenHash !== currentTokenHash) {
        await env.SHERLLY_DATA.delete(key.name);
        deletedCount += 1;
      }
    }

    cursor = listed.list_complete ? undefined : listed.cursor;
  } while (cursor);

  return deletedCount;
}

async function changeAccountPassword(env, auth, body) {
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

  await saveUser(env, {
    ...auth.user,
    password: await createPasswordHash(nextPassword),
    passwordUpdatedAt: now,
    updatedAt: now,
  });

  return {
    ok: true,
    signedOutSessions: await deleteUserSessionsExcept(env, auth.user.id, auth.session.tokenHash),
  };
}

async function getAuthenticatedSession(request, env) {
  const token = getBearerToken(request);

  if (!token) {
    throw createHttpError(401, "请先登录");
  }

  const tokenHash = await sha256Base64Url(token);
  const stored = await env.SHERLLY_DATA.get(getSessionKey(tokenHash));
  const session = stored ? JSON.parse(stored) : null;

  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
    throw createHttpError(401, "登录已过期，请重新登录");
  }

  const user = await getUser(env, session.username);

  if (!user || user.id !== session.userId) {
    await env.SHERLLY_DATA.delete(getSessionKey(tokenHash));
    throw createHttpError(401, "登录已失效，请重新登录");
  }

  return {
    session,
    user,
  };
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

    return jsonResponse(request, env, {
      ok: kvReady,
      storage: kvReady ? "kv" : "missing",
    }, kvReady ? 200 : 500);
  }

  if (url.pathname !== "/api/data" && !url.pathname.startsWith("/api/auth/")) {
    return jsonResponse(request, env, { ok: false, message: "Not found" }, 404);
  }

  if (!isAuthorized(request, env, url)) {
    return jsonResponse(request, env, { ok: false, message: "Unauthorized" }, 401);
  }

  if (url.pathname === "/api/auth/register" && request.method === "POST") {
    return jsonResponse(request, env, await registerAccount(env, await request.json()), 201);
  }

  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    return jsonResponse(request, env, await loginAccount(env, await request.json()));
  }

  if (url.pathname === "/api/auth/me" && request.method === "GET") {
    const auth = await getAuthenticatedSession(request, env);
    return jsonResponse(request, env, { user: publicUser(auth.user) });
  }

  if (url.pathname === "/api/auth/password" && request.method === "PUT") {
    const auth = await getAuthenticatedSession(request, env);
    return jsonResponse(request, env, await changeAccountPassword(env, auth, await request.json()));
  }

  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    const auth = await getAuthenticatedSession(request, env);
    await env.SHERLLY_DATA.delete(getSessionKey(auth.session.tokenHash));
    return jsonResponse(request, env, { ok: true });
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
    const data = body?.data || body;

    return jsonResponse(request, env, await saveData(env, userId, data));
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
