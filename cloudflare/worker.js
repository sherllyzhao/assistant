const defaultData = {
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

function getRequestToken(request, url) {
  const authorization = request.headers.get("Authorization") || "";

  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }

  return String(request.headers.get("X-Sherlly-Token") || url.searchParams.get("token") || "").trim();
}

function isAuthorized(request, env, url) {
  const expectedToken = String(env.SHERLLY_API_TOKEN || "").trim();

  return !expectedToken || getRequestToken(request, url) === expectedToken;
}

function getStorageKey(userId) {
  return `appData:${userId}`;
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

  if (url.pathname !== "/api/data") {
    return jsonResponse(request, env, { ok: false, message: "Not found" }, 404);
  }

  if (!isAuthorized(request, env, url)) {
    return jsonResponse(request, env, { ok: false, message: "Unauthorized" }, 401);
  }

  const userId = normalizeUserId(url.searchParams.get("userId"), env.SHERLLY_USER_ID);

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
      return jsonResponse(request, env, { ok: false, message: error.message || "Worker error" }, 500);
    }
  },
};
