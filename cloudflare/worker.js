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
    externalConnections: [],
  },
};
const PASSWORD_HASH_ITERATIONS = 100000;
const PASSWORD_HASH_KEY_LENGTH = 32;
const SESSION_TTL_DAYS = 30;
const GOOGLE_PROVIDER = "google-calendar";
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_EVENTS_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const GOOGLE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_ACCESS_TOKEN_SKEW_MS = 60 * 1000;
const textEncoder = new TextEncoder();
const requestBuckets = new Map();

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
  const bytes = value instanceof Uint8Array ? value : textEncoder.encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToBase64Url(new Uint8Array(digest));
}

function encodeJsonBase64Url(value) {
  return bytesToBase64Url(textEncoder.encode(JSON.stringify(value)));
}

function decodeJsonBase64Url(value) {
  const binary = atob(String(value || "").replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value || "").length / 4) * 4, "="));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function createHmacSignature(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(String(secret || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(String(value || "")));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function createOAuthState(payload, secret) {
  const encoded = encodeJsonBase64Url(payload);
  const signature = await createHmacSignature(encoded, secret);
  return `${encoded}.${signature}`;
}

async function verifyOAuthState(value, secret) {
  const [encoded, signature] = String(value || "").split(".");

  if (!encoded || !signature) {
    return null;
  }

  const expectedSignature = await createHmacSignature(encoded, secret);

  if (!timingSafeEqualString(signature, expectedSignature)) {
    return null;
  }

  try {
    return decodeJsonBase64Url(encoded);
  } catch {
    return null;
  }
}

async function deriveOAuthEncryptionKey(secret) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(String(secret || "")));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptOAuthPayload(payload, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveOAuthEncryptionKey(secret);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    textEncoder.encode(JSON.stringify(payload)),
  );

  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

async function decryptOAuthPayload(value, secret) {
  const [encodedIv, encodedCiphertext] = String(value || "").split(".");

  if (!encodedIv || !encodedCiphertext) {
    return null;
  }

  try {
    const key = await deriveOAuthEncryptionKey(secret);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlToBytes(encodedIv) },
      key,
      base64UrlToBytes(encodedCiphertext),
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return null;
  }
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

  const expectedHostname = String(env.TURNSTILE_EXPECTED_HOSTNAME || "").trim();

  if (expectedHostname && result.hostname !== expectedHostname) {
    throw createHttpError(400, "人类验证来源不匹配，请重试");
  }
}

function enforceRateLimit(request, url) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const ip = getClientIp(request) || "anonymous";
  const isAuthRoute = url.pathname.startsWith("/api/auth/");
  const limit = isAuthRoute ? 12 : 120;
  const key = `${ip}:${isAuthRoute ? "auth" : url.pathname}`;
  const current = requestBuckets.get(key);

  if (!current || now - current.startedAt >= windowMs) {
    requestBuckets.set(key, { startedAt: now, count: 1 });
    return;
  }

  current.count += 1;

  if (current.count > limit) {
    throw createHttpError(429, "请求过于频繁，请稍后再试");
  }

  if (requestBuckets.size > 2000) {
    for (const [bucketKey, bucket] of requestBuckets) {
      if (now - bucket.startedAt >= windowMs) {
        requestBuckets.delete(bucketKey);
      }
    }
  }
}

function getStorageKey(userId) {
  return `appData:${userId}`;
}

function getBackupStorageKey(userId, timestamp) {
  return `backups:appData:${userId}:${timestamp}`;
}

function getAttachmentKey(userId, value) {
  const cleanValue = String(value || "").replace(/^\/+/, "");
  return `${userId}/${cleanValue}`;
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

function getGoogleOAuthConfig(env, request) {
  const config = {
    clientId: String(env.GOOGLE_OAUTH_CLIENT_ID || "").trim(),
    clientSecret: String(env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim(),
    redirectUri: String(env.GOOGLE_OAUTH_REDIRECT_URI || "").trim(),
    successUrl: String(env.GOOGLE_OAUTH_SUCCESS_URL || "").trim(),
    stateSecret: String(env.GOOGLE_OAUTH_STATE_SECRET || "").trim(),
    tokenEncryptionKey: String(env.GOOGLE_OAUTH_TOKEN_KEY || "").trim(),
  };

  if (Object.values(config).some((value) => !value)) {
    throw createHttpError(503, "Google Calendar OAuth 尚未完成 Worker 配置");
  }

  try {
    const redirectUrl = new URL(config.redirectUri);
    const successUrl = new URL(config.successUrl);
    const requestUrl = new URL(request.url);
    const isLocalHost = (value) => ["localhost", "127.0.0.1", "::1"].includes(value.hostname);

    if (redirectUrl.protocol !== "https:" && !isLocalHost(requestUrl)) {
      throw new Error("invalid redirect protocol");
    }

    if (successUrl.protocol !== "https:" && !isLocalHost(successUrl)) {
      throw new Error("invalid success protocol");
    }
  } catch {
    throw createHttpError(503, "Google Calendar OAuth URL 配置无效");
  }

  return config;
}

function redirectGoogleOAuthResult(config, status, code = "") {
  const target = new URL(config.successUrl);
  target.searchParams.set("google_oauth", status);

  if (code) {
    target.searchParams.set("google_oauth_code", code);
  }

  return Response.redirect(target.toString(), 302);
}

async function startGoogleOAuth(env, request, userId) {
  const config = getGoogleOAuthConfig(env, request);
  const store = getUserDataStoreStub(env, userId);
  const stateId = randomBase64Url(24);
  const codeVerifier = randomBase64Url(48);
  const expiresAt = new Date(Date.now() + GOOGLE_OAUTH_STATE_TTL_MS).toISOString();
  const savedState = await store.saveOAuthState({
    provider: GOOGLE_PROVIDER,
    stateId,
    codeVerifier,
    expiresAt,
    createdAt: new Date().toISOString(),
  });

  if (!savedState?.ok) {
    throw createHttpError(500, "无法保存 Google OAuth 状态");
  }

  const state = await createOAuthState({
    provider: GOOGLE_PROVIDER,
    userId,
    stateId,
    expiresAt,
  }, config.stateSecret);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const authorizationUrl = new URL(GOOGLE_AUTH_ENDPOINT);
  authorizationUrl.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  }).toString();

  return {
    provider: GOOGLE_PROVIDER,
    authorizationUrl: authorizationUrl.toString(),
    expiresAt,
  };
}

async function exchangeGoogleAuthorizationCode(config, code, codeVerifier) {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
  });
  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.access_token) {
    throw createHttpError(502, "Google OAuth code 交换失败");
  }

  return body;
}

async function handleGoogleOAuthCallback(request, env) {
  const config = getGoogleOAuthConfig(env, request);
  const url = new URL(request.url);
  const errorCode = String(url.searchParams.get("error") || "").trim();

  if (errorCode) {
    return redirectGoogleOAuthResult(config, "error", "google_denied");
  }

  const code = String(url.searchParams.get("code") || "").trim();
  const stateValue = String(url.searchParams.get("state") || "").trim();
  const state = await verifyOAuthState(stateValue, config.stateSecret);

  if (!code || !state || state.provider !== GOOGLE_PROVIDER || !state.userId || !state.stateId) {
    return redirectGoogleOAuthResult(config, "error", "invalid_state");
  }

  if (new Date(String(state.expiresAt || "")).getTime() <= Date.now()) {
    return redirectGoogleOAuthResult(config, "error", "expired_state");
  }

  const userId = normalizeUserId(state.userId);
  const store = getUserDataStoreStub(env, userId);
  const savedState = await store.consumeOAuthState(GOOGLE_PROVIDER, state.stateId);

  if (!savedState || savedState.codeVerifier === "") {
    return redirectGoogleOAuthResult(config, "error", "replayed_state");
  }

  try {
    const tokenResponse = await exchangeGoogleAuthorizationCode(config, code, savedState.codeVerifier);
    const existingRecord = await store.getOAuthToken(GOOGLE_PROVIDER);
    const existingPayload = existingRecord
      ? await decryptOAuthPayload(existingRecord.ciphertext, config.tokenEncryptionKey)
      : null;
    const refreshToken = String(tokenResponse.refresh_token || existingPayload?.refreshToken || "").trim();

    if (!refreshToken) {
      return redirectGoogleOAuthResult(config, "error", "missing_refresh_token");
    }

    const expiresAt = new Date(Date.now() + Math.max(60, Number(tokenResponse.expires_in || 3600)) * 1000).toISOString();
    const ciphertext = await encryptOAuthPayload({ refreshToken }, config.tokenEncryptionKey);
    const savedToken = await store.saveOAuthToken({
      provider: GOOGLE_PROVIDER,
      ciphertext,
      scope: String(tokenResponse.scope || GOOGLE_SCOPE),
      tokenType: String(tokenResponse.token_type || "Bearer"),
      expiresAt,
      updatedAt: new Date().toISOString(),
    });

    if (!savedToken?.ok) {
      return redirectGoogleOAuthResult(config, "error", "token_storage_failed");
    }

    return redirectGoogleOAuthResult(config, "success");
  } catch {
    return redirectGoogleOAuthResult(config, "error", "token_exchange_failed");
  }
}

async function refreshGoogleAccessToken(env, request, userId) {
  const config = getGoogleOAuthConfig(env, request);
  const store = getUserDataStoreStub(env, userId);
  const storedToken = await store.getOAuthToken(GOOGLE_PROVIDER);
  const tokenPayload = await decryptOAuthPayload(storedToken?.ciphertext, config.tokenEncryptionKey);
  const refreshToken = String(tokenPayload?.refreshToken || "").trim();

  if (!refreshToken) {
    throw createHttpError(401, "Google Calendar 尚未连接或授权已失效");
  }

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.access_token) {
    throw createHttpError(401, "Google Calendar 授权已失效，请重新连接");
  }

  const expiresAt = new Date(Date.now() + Math.max(60, Number(body.expires_in || 3600)) * 1000).toISOString();
  const nextRefreshToken = String(body.refresh_token || refreshToken).trim();
  const ciphertext = await encryptOAuthPayload({ refreshToken: nextRefreshToken }, config.tokenEncryptionKey);
  await store.saveOAuthToken({
    provider: GOOGLE_PROVIDER,
    ciphertext,
    scope: String(body.scope || storedToken.scope || GOOGLE_SCOPE),
    tokenType: String(body.token_type || storedToken.tokenType || "Bearer"),
    expiresAt,
    updatedAt: new Date().toISOString(),
  });

  return {
    accessToken: String(body.access_token),
    tokenType: String(body.token_type || storedToken.tokenType || "Bearer"),
  };
}

export function getGoogleEventsWindow(url) {
  const now = Date.now();
  const defaultTimeMin = new Date(now).toISOString();
  const defaultTimeMax = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
  const timeMin = String(url.searchParams.get("timeMin") || defaultTimeMin);
  const timeMax = String(url.searchParams.get("timeMax") || defaultTimeMax);
  const minTime = new Date(timeMin).getTime();
  const maxTime = new Date(timeMax).getTime();

  if (!Number.isFinite(minTime) || !Number.isFinite(maxTime) || maxTime <= minTime || maxTime - minTime > 31 * 24 * 60 * 60 * 1000) {
    throw createHttpError(400, "Google Calendar 查询时间窗口无效");
  }

  return {
    timeMin: new Date(minTime).toISOString(),
    timeMax: new Date(maxTime).toISOString(),
  };
}

export function sanitizeGoogleEvent(event) {
  const start = event?.start?.dateTime || event?.start?.date || "";
  const end = event?.end?.dateTime || event?.end?.date || "";

  return {
    id: String(event?.id || "").slice(0, 200),
    title: String(event?.summary || "未命名会议").trim().slice(0, 200),
    startAt: String(start).slice(0, 64),
    endAt: String(end).slice(0, 64),
    allDay: Boolean(event?.start?.date && !event?.start?.dateTime),
    status: event?.status === "cancelled" ? "cancelled" : "confirmed",
  };
}

async function listGoogleEvents(env, request, userId) {
  const url = new URL(request.url);
  const window = getGoogleEventsWindow(url);
  const token = await refreshGoogleAccessToken(env, request, userId);
  const eventsUrl = new URL(GOOGLE_EVENTS_ENDPOINT);
  eventsUrl.search = new URLSearchParams({
    timeMin: window.timeMin,
    timeMax: window.timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    showDeleted: "false",
    maxResults: "50",
  }).toString();
  const response = await fetch(eventsUrl, {
    headers: { Authorization: `${token.tokenType} ${token.accessToken}` },
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw createHttpError(response.status === 401 ? 401 : 502, response.status === 401
      ? "Google Calendar 授权已失效，请重新连接"
      : "Google Calendar 读取失败");
  }

  return {
    provider: GOOGLE_PROVIDER,
    fetchedAt: new Date().toISOString(),
    window,
    events: (Array.isArray(body?.items) ? body.items : []).map(sanitizeGoogleEvent),
  };
}

async function getGoogleConnectionStatus(env, request, userId) {
  const config = getGoogleOAuthConfig(env, request);
  const store = getUserDataStoreStub(env, userId);
  const storedToken = await store.getOAuthToken(GOOGLE_PROVIDER);
  const tokenPayload = await decryptOAuthPayload(storedToken?.ciphertext, config.tokenEncryptionKey);

  return {
    provider: GOOGLE_PROVIDER,
    connected: Boolean(tokenPayload?.refreshToken),
    scope: storedToken?.scope || GOOGLE_SCOPE,
    updatedAt: storedToken?.updatedAt || "",
  };
}

async function disconnectGoogleCalendar(env, userId) {
  const store = getUserDataStoreStub(env, userId);
  return {
    ...(await store.deleteOAuthToken(GOOGLE_PROVIDER)),
    provider: GOOGLE_PROVIDER,
    connected: false,
  };
}

function parseLegacyData(stored) {
  if (!stored) {
    return normalizeSyncData(defaultData);
  }

  try {
    const document = JSON.parse(stored);
    const data = document?.data && typeof document.data === "object" ? document.data : document;
    return normalizeSyncData(data || defaultData);
  } catch {
    return normalizeSyncData(defaultData);
  }
}

async function loadData(env, userId) {
  const store = getUserDataStoreStub(env, userId);
  const current = await store.read();
  const stored = await env.SHERLLY_DATA?.get?.(getStorageKey(userId));
  const legacyData = parseLegacyData(stored);

  if (current) {
    // A previous deployment could create an empty Durable Object before the KV
    // migration ran. Recover meaningful legacy data only from that untouched
    // revision-0 state; never overwrite later user changes.
    if (current.revision === 0 && !hasMeaningfulData(current.data) && hasMeaningfulData(legacyData)) {
      return store.migrateLegacy(legacyData);
    }

    return current;
  }

  return store.initializeLegacy(legacyData);
}

async function saveData(env, userId, payload) {
  const result = await getUserDataStoreStub(env, userId).write(payload);

  if (!result?.ok) {
    return result;
  }

  return result.envelope;
}

async function uploadAttachment(env, userId, request) {
  if (!env.SHERLLY_ATTACHMENTS?.put) {
    throw createHttpError(503, "云附件暂未启用");
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  const maxBytes = 10 * 1024 * 1024;

  if (contentLength > maxBytes) {
    throw createHttpError(413, "云附件超过 10 MB 限制");
  }

  const body = await request.arrayBuffer();

  if (body.byteLength > maxBytes) {
    throw createHttpError(413, "云附件超过 10 MB 限制");
  }

  const objectId = randomBase64Url(18);
  const objectKey = getAttachmentKey(userId, objectId);
  const checksum = await sha256Base64Url(new Uint8Array(body));
  const filename = String(request.headers.get("X-Sherlly-Filename") || "attachment").slice(0, 160);
  const contentType = String(request.headers.get("Content-Type") || "application/octet-stream").slice(0, 120);

  await env.SHERLLY_ATTACHMENTS.put(objectKey, body, {
    httpMetadata: {
      contentType,
      contentDisposition: `attachment; filename="${filename.replace(/[^\w. -]/g, "_")}"`,
    },
    customMetadata: {
      userId,
      filename,
      checksum,
    },
  });

  return {
    ok: true,
    attachment: {
      objectKey,
      filename,
      mime: contentType,
      size: body.byteLength,
      checksum: `sha256:${checksum}`,
      createdAt: new Date().toISOString(),
      status: "available",
    },
  };
}

async function readAttachment(env, userId, objectKey, request) {
  if (!env.SHERLLY_ATTACHMENTS?.get) {
    throw createHttpError(503, "云附件暂未启用");
  }

  const cleanKey = decodeURIComponent(objectKey || "");

  if (!cleanKey.startsWith(`${userId}/`)) {
    throw createHttpError(404, "附件不存在");
  }

  const object = await env.SHERLLY_ATTACHMENTS.get(cleanKey);

  if (!object) {
    throw createHttpError(404, "附件不存在");
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Access-Control-Allow-Origin", getCorsHeaders(request, env).headers["Access-Control-Allow-Origin"]);
  headers.set("Vary", "Origin");
  headers.set("Cache-Control", "private, max-age=300");
  return new Response(object.body, { headers });
}

async function deleteAttachment(env, userId, objectKey) {
  if (!env.SHERLLY_ATTACHMENTS?.delete) {
    throw createHttpError(503, "云附件暂未启用");
  }

  const cleanKey = decodeURIComponent(objectKey || "");

  if (!cleanKey.startsWith(`${userId}/`)) {
    throw createHttpError(404, "附件不存在");
  }

  await env.SHERLLY_ATTACHMENTS.delete(cleanKey);
  return { ok: true };
}

async function runWorkersAi(env, body) {
  if (!env.AI?.run) {
    throw createHttpError(503, "Workers AI 暂未启用");
  }

  const prompt = String(body?.prompt || "").trim().slice(0, 4000);

  if (!prompt) {
    throw createHttpError(400, "AI 问题不能为空");
  }

  const context = String(body?.context || "").slice(0, 12000);
  const model = String(env.WORKERS_AI_MODEL || "").trim();

  if (!model) {
    throw createHttpError(503, "Workers AI 尚未配置模型");
  }

  const result = await env.AI.run(model, {
    messages: [
      {
        role: "system",
        content: "你是工作事项助理。只根据提供的非敏感工作上下文回答，禁止索取或复述密码、密钥和安全速记内容。",
      },
      {
        role: "user",
        content: context ? `${prompt}\n\n工作上下文：\n${context}` : prompt,
      },
    ],
  });

  return {
    ok: true,
    model,
    answer: String(result?.response || result?.result || "").trim(),
  };
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

  enforceRateLimit(request, url);

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

  if (
    url.pathname !== "/api/data" &&
    !url.pathname.startsWith("/api/auth/") &&
    !url.pathname.startsWith("/api/attachments") &&
    url.pathname !== "/api/ai" &&
    !url.pathname.startsWith("/api/integrations/google/")
  ) {
    return jsonResponse(request, env, { ok: false, message: "Not found" }, 404);
  }

  const isGoogleOAuthCallback = url.pathname === "/api/integrations/google/callback";

  if (!isGoogleOAuthCallback && !isAuthorized(request, env, url)) {
    return jsonResponse(request, env, { ok: false, message: "Unauthorized" }, 401);
  }

  if (isGoogleOAuthCallback && request.method === "GET") {
    return handleGoogleOAuthCallback(request, env);
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

  const auth = await getAuthenticatedSession(request, env);
  const userId = normalizeUserId(auth.user.id);

  if (url.pathname === "/api/integrations/google/start" && request.method === "GET") {
    return jsonResponse(request, env, await startGoogleOAuth(env, request, userId));
  }

  if (url.pathname === "/api/integrations/google/status" && request.method === "GET") {
    return jsonResponse(request, env, await getGoogleConnectionStatus(env, request, userId));
  }

  if (url.pathname === "/api/integrations/google/disconnect" && request.method === "POST") {
    return jsonResponse(request, env, await disconnectGoogleCalendar(env, userId));
  }

  if (url.pathname === "/api/integrations/google/events" && request.method === "GET") {
    return jsonResponse(request, env, await listGoogleEvents(env, request, userId));
  }

  if (url.pathname === "/api/ai" && request.method === "POST") {
    return jsonResponse(request, env, await runWorkersAi(env, await request.json()));
  }

  if (url.pathname === "/api/attachments" && request.method === "POST") {
    return jsonResponse(request, env, await uploadAttachment(env, userId, request), 201);
  }

  if (url.pathname.startsWith("/api/attachments/") && request.method === "GET") {
    return readAttachment(env, userId, url.pathname.slice("/api/attachments/".length), request);
  }

  if (url.pathname.startsWith("/api/attachments/") && request.method === "DELETE") {
    return jsonResponse(request, env, await deleteAttachment(env, userId, url.pathname.slice("/api/attachments/".length)));
  }

  if (url.pathname !== "/api/data") {
    return jsonResponse(request, env, { ok: false, message: "Method not allowed" }, 405);
  }

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
      const status = Number(error.status) || 500;
      const message = status >= 500 ? "服务暂时不可用，请稍后重试" : error.message || "Worker error";
      return jsonResponse(request, env, { ok: false, message }, status);
    }
  },
};
