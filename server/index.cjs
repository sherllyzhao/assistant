require("dotenv").config();

const cors = require("cors");
const crypto = require("node:crypto");
const express = require("express");
const { MongoClient } = require("mongodb");

const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "sherlly";
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || "appData";
const MONGODB_USERS_COLLECTION = process.env.MONGODB_USERS_COLLECTION || "users";
const MONGODB_SESSIONS_COLLECTION = process.env.MONGODB_SESSIONS_COLLECTION || "sessions";
const MONGODB_SERVER_SELECTION_TIMEOUT_MS = Number.parseInt(
  process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || "10000",
  10,
);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://127.0.0.1:5188";
const SHERLLY_API_TOKEN = String(process.env.SHERLLY_API_TOKEN || "").trim();
const SESSION_TTL_DAYS = Number.parseInt(process.env.SHERLLY_SESSION_TTL_DAYS || "30", 10);
const PASSWORD_HASH_ITERATIONS = 310000;
const PASSWORD_HASH_KEY_LENGTH = 32;
const PASSWORD_HASH_DIGEST = "sha256";

const defaultData = {
  tasks: [],
  candidates: [],
  logs: [],
  settings: {
    soundEnabled: true,
  },
};

let clientPromise = null;
let indexesPromise = null;

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

function normalizeUserId(value) {
  return String(value || "default")
    .trim()
    .replace(/[^\w:.-]/g, "_")
    .slice(0, 80) || "default";
}

function getAllowedOrigins() {
  return CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function getCollection() {
  const database = await getDatabase();
  return database.collection(MONGODB_COLLECTION);
}

async function getDatabase() {
  if (!MONGODB_URI) {
    throw new Error("缺少 MONGODB_URI，请先配置 .env");
  }

  if (!clientPromise) {
    const client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: MONGODB_SERVER_SELECTION_TIMEOUT_MS,
    });
    clientPromise = client.connect();
  }

  const client = await clientPromise;
  return client.db(MONGODB_DB);
}

async function ensureIndexes() {
  if (!indexesPromise) {
    indexesPromise = (async () => {
      const database = await getDatabase();

      await Promise.all([
        database.collection(MONGODB_COLLECTION).createIndex({ userId: 1 }),
        database.collection(MONGODB_USERS_COLLECTION).createIndex({ username: 1 }, { unique: true }),
        database.collection(MONGODB_SESSIONS_COLLECTION).createIndex({ tokenHash: 1 }, { unique: true }),
        database.collection(MONGODB_SESSIONS_COLLECTION).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        database.collection(MONGODB_SESSIONS_COLLECTION).createIndex({ userId: 1 }),
      ]);
    })();
  }

  await indexesPromise;
}

async function getUsersCollection() {
  await ensureIndexes();
  const database = await getDatabase();
  return database.collection(MONGODB_USERS_COLLECTION);
}

async function getSessionsCollection() {
  await ensureIndexes();
  const database = await getDatabase();
  return database.collection(MONGODB_SESSIONS_COLLECTION);
}

async function closeDatabase() {
  if (!clientPromise) {
    return;
  }

  const client = await clientPromise;
  await client.close();
  clientPromise = null;
}

async function loadData(userId) {
  await ensureIndexes();
  const collection = await getCollection();
  const document = await collection.findOne({ userId });
  return document?.data ? normalizeData(document.data) : defaultData;
}

async function saveData(userId, data) {
  await ensureIndexes();
  const collection = await getCollection();
  const normalized = normalizeData(data);
  const now = new Date();

  await collection.updateOne(
    { userId },
    {
      $set: {
        userId,
        data: normalized,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true },
  );

  return normalized;
}

async function pingDatabase() {
  await ensureIndexes();
  const collection = await getCollection();
  await collection.db.command({ ping: 1 });
}

function getBearerToken(request) {
  const authorization = String(request.get("authorization") || "");

  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }

  return "";
}

function getRequestToken(request) {
  const directToken = String(request.get("x-sherlly-token") || request.query.token || "").trim();

  if (directToken) {
    return directToken;
  }

  const bearerToken = getBearerToken(request);
  return bearerToken === SHERLLY_API_TOKEN ? bearerToken : "";
}

function requireApiToken(request, response, next) {
  if (!SHERLLY_API_TOKEN) {
    next();
    return;
  }

  if (getRequestToken(request) === SHERLLY_API_TOKEN) {
    next();
    return;
  }

  response.status(401).json({
    ok: false,
    message: "未授权：缺少或错误的 SHERLLY_API_TOKEN",
  });
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
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

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto
    .pbkdf2Sync(String(password), salt, PASSWORD_HASH_ITERATIONS, PASSWORD_HASH_KEY_LENGTH, PASSWORD_HASH_DIGEST)
    .toString("base64url");

  return {
    algorithm: "pbkdf2",
    digest: PASSWORD_HASH_DIGEST,
    hash,
    iterations: PASSWORD_HASH_ITERATIONS,
    keyLength: PASSWORD_HASH_KEY_LENGTH,
    salt,
  };
}

function verifyPassword(password, passwordHash) {
  if (!passwordHash?.salt || !passwordHash?.hash) {
    return false;
  }

  const digest = passwordHash.digest || PASSWORD_HASH_DIGEST;
  const iterations = Number.parseInt(passwordHash.iterations || PASSWORD_HASH_ITERATIONS, 10);
  const keyLength = Number.parseInt(passwordHash.keyLength || PASSWORD_HASH_KEY_LENGTH, 10);
  const expected = Buffer.from(String(passwordHash.hash), "base64url");
  const actual = crypto.pbkdf2Sync(String(password), passwordHash.salt, iterations, keyLength, digest);

  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
  };
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("base64url");
}

function createSessionExpiresAt() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + Math.max(1, SESSION_TTL_DAYS));
  return expiresAt;
}

async function createAuthResponse(user) {
  const sessions = await getSessionsCollection();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = createSessionExpiresAt();

  await sessions.insertOne({
    tokenHash: hashSessionToken(token),
    userId: user.id,
    createdAt: new Date(),
    expiresAt,
  });

  return {
    token,
    expiresAt: expiresAt.toISOString(),
    user: publicUser(user),
  };
}

async function registerAccount(body) {
  const username = normalizeUsername(body?.username);
  const password = String(body?.password || "");
  const displayName = String(body?.displayName || "").trim().slice(0, 40) || username;

  validateAccountInput(username, password);

  const users = await getUsersCollection();
  const now = new Date();
  const user = {
    id: `user_${crypto.randomUUID()}`,
    username,
    displayName,
    password: createPasswordHash(password),
    createdAt: now,
    updatedAt: now,
  };

  try {
    await users.insertOne(user);
  } catch (error) {
    if (error?.code === 11000) {
      throw createHttpError(409, "这个账号已经存在");
    }

    throw error;
  }

  return createAuthResponse(user);
}

async function loginAccount(body) {
  const username = normalizeUsername(body?.username);
  const password = String(body?.password || "");
  const users = await getUsersCollection();
  const user = await users.findOne({ username });

  if (!user || !verifyPassword(password, user.password)) {
    throw createHttpError(401, "账号或密码不正确");
  }

  await users.updateOne({ id: user.id }, { $set: { lastLoginAt: new Date() } });
  return createAuthResponse(user);
}

async function changeAccountPassword(user, session, body) {
  const currentPassword = String(body?.currentPassword || "");
  const nextPassword = String(body?.nextPassword || "");

  validatePasswordInput(nextPassword);

  if (!verifyPassword(currentPassword, user.password)) {
    throw createHttpError(401, "当前密码不正确");
  }

  if (currentPassword === nextPassword) {
    throw createHttpError(400, "新密码不能和当前密码相同");
  }

  const users = await getUsersCollection();
  const sessions = await getSessionsCollection();
  const now = new Date();

  const updateResult = await users.updateOne(
    { id: user.id },
    {
      $set: {
        password: createPasswordHash(nextPassword),
        passwordUpdatedAt: now,
        updatedAt: now,
      },
    },
  );

  if (!updateResult.matchedCount) {
    throw createHttpError(500, "账号更新失败，请重新登录后再试");
  }

  const deleteResult = await sessions.deleteMany({
    userId: user.id,
    _id: { $ne: session._id },
  });

  return {
    ok: true,
    signedOutSessions: deleteResult.deletedCount || 0,
  };
}

async function getAuthenticatedSession(request) {
  const token = getBearerToken(request);

  if (!token) {
    throw createHttpError(401, "请先登录");
  }

  const sessions = await getSessionsCollection();
  const session = await sessions.findOne({
    tokenHash: hashSessionToken(token),
    expiresAt: { $gt: new Date() },
  });

  if (!session) {
    throw createHttpError(401, "登录已过期，请重新登录");
  }

  const users = await getUsersCollection();
  const user = await users.findOne({ id: session.userId });

  if (!user) {
    await sessions.deleteOne({ _id: session._id });
    throw createHttpError(401, "登录已失效，请重新登录");
  }

  return {
    session,
    user,
  };
}

async function requireAccount(request, _response, next) {
  try {
    request.sherllyAuth = await getAuthenticatedSession(request);
    next();
  } catch (error) {
    next(error);
  }
}

function createServer() {
  const app = express();
  const allowedOrigins = getAllowedOrigins();

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || origin === "null" || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error(`CORS 拒绝来源：${origin}`));
      },
    }),
  );
  app.use(express.json({ limit: "10mb" }));

  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: "sherlly-server" });
  });

  app.get("/ready", async (_request, response, next) => {
    try {
      await pingDatabase();
      response.json({ ok: true, database: "connected" });
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", requireApiToken);

  app.post("/api/auth/register", async (request, response, next) => {
    try {
      response.status(201).json(await registerAccount(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/login", async (request, response, next) => {
    try {
      response.json(await loginAccount(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/me", requireAccount, async (request, response, next) => {
    try {
      response.json({ user: publicUser(request.sherllyAuth.user) });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/auth/password", requireAccount, async (request, response, next) => {
    try {
      response.json(
        await changeAccountPassword(request.sherllyAuth.user, request.sherllyAuth.session, request.body),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/logout", requireAccount, async (request, response, next) => {
    try {
      const sessions = await getSessionsCollection();
      await sessions.deleteOne({ _id: request.sherllyAuth.session._id });
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/data", requireAccount, async (request, response, next) => {
    try {
      response.json(await loadData(request.sherllyAuth.user.id));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/data", requireAccount, async (request, response, next) => {
    try {
      response.json(await saveData(request.sherllyAuth.user.id, request.body?.data || request.body));
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _request, response, _next) => {
    console.error(error);
    response.status(error.status || 500).json({
      ok: false,
      message: error.message || "服务器错误",
    });
  });

  return app;
}

if (require.main === module) {
  const app = createServer();
  const server = app.listen(PORT, () => {
    console.log(`Sherlly server listening on port ${PORT}`);
  });

  const shutdown = async () => {
    server.close();

    await closeDatabase();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

module.exports = {
  closeDatabase,
  createServer,
  normalizeData,
  normalizeUserId,
  requireApiToken,
};
