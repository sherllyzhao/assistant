require("dotenv").config();

const cors = require("cors");
const express = require("express");
const { MongoClient } = require("mongodb");

const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "sherlly";
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || "appData";
const MONGODB_SERVER_SELECTION_TIMEOUT_MS = Number.parseInt(
  process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || "10000",
  10,
);
const DEFAULT_USER_ID = process.env.SHERLLY_USER_ID || "default";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://127.0.0.1:5188";
const SHERLLY_API_TOKEN = String(process.env.SHERLLY_API_TOKEN || "").trim();

const defaultData = {
  tasks: [],
  candidates: [],
  logs: [],
  settings: {
    soundEnabled: true,
  },
};

let clientPromise = null;

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
  return String(value || DEFAULT_USER_ID)
    .trim()
    .replace(/[^\w:.-]/g, "_")
    .slice(0, 80) || DEFAULT_USER_ID;
}

function getAllowedOrigins() {
  return CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function getCollection() {
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
  return client.db(MONGODB_DB).collection(MONGODB_COLLECTION);
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
  const collection = await getCollection();
  const document = await collection.findOne({ userId });
  return document?.data ? normalizeData(document.data) : defaultData;
}

async function saveData(userId, data) {
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
  const collection = await getCollection();
  await collection.db.command({ ping: 1 });
}

function getRequestToken(request) {
  const authorization = String(request.get("authorization") || "");

  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }

  return String(request.get("x-sherlly-token") || request.query.token || "").trim();
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

  app.get("/api/data", async (request, response, next) => {
    try {
      const userId = normalizeUserId(request.query.userId);
      response.json(await loadData(userId));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/data", async (request, response, next) => {
    try {
      const userId = normalizeUserId(request.query.userId || request.body?.userId);
      response.json(await saveData(userId, request.body?.data || request.body));
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _request, response, _next) => {
    console.error(error);
    response.status(500).json({
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
