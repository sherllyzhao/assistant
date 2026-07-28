import { describe, expect, it, vi } from "vitest";
import worker from "../cloudflare/worker.js";

function createWorkerEnv({ apiToken = "configured-api-token" } = {}) {
  const userDataStub = {
    read: vi.fn(async () => ({
      schemaVersion: 1,
      revision: 0,
      updatedAt: "2026-07-28T00:00:00.000Z",
      deviceId: "test-device",
      checksum: "sha256:test",
      data: {
        tasks: [],
        candidates: [],
        logs: [],
        vaultItems: [],
        tools: [],
        habits: [],
        vaultCandidates: [],
        tombstones: [],
        settings: { soundEnabled: true, externalConnections: [] },
      },
    })),
  };

  const authStub = {
    fetch: vi.fn(async (input, init = {}) => {
      const url = new URL(input);
      const headers = new Headers(init.headers || {});

      if (url.pathname === "/session") {
        if (headers.get("Authorization") === "Bearer valid-session-token") {
          return new Response(JSON.stringify({
            session: { id: "session-1", userId: "user-1" },
            user: { id: "user-1", username: "tester" },
          }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ message: "请先登录" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        session: { id: "session-1", userId: "user-1" },
        user: { id: "user-1", username: "tester" },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  };

  return {
    SHERLLY_API_TOKEN: apiToken,
    SHERLLY_AUTH_STORE: {
      idFromName: vi.fn(() => "auth-id"),
      get: vi.fn(() => authStub),
    },
    SHERLLY_USER_DATA: {
      getByName: vi.fn(() => userDataStub),
    },
    AI: {
      run: vi.fn(async () => ({ response: "AI response" })),
    },
    WORKERS_AI_MODEL: "test-model",
    CORS_ORIGIN: "http://localhost:5188",
    __authStub: authStub,
    __userDataStub: userDataStub,
  };
}

describe("Cloudflare Worker routing", () => {
  it("routes a valid AI POST before the data endpoint guard", async () => {
    const env = createWorkerEnv();
    const response = await worker.fetch(new Request("https://worker.example/api/ai", {
      method: "POST",
      headers: {
        Authorization: "Bearer valid-session-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: "整理任务" }),
    }), env);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      model: "test-model",
      answer: "AI response",
    });
    expect(env.AI.run).toHaveBeenCalledOnce();
  });

  it.each([
    ["GET", "/api/ai"],
    ["PUT", "/api/attachments"],
  ])("returns 405 for unsupported %s %s without falling through to data", async (method, pathname) => {
    const env = createWorkerEnv();
    const response = await worker.fetch(new Request(`https://worker.example${pathname}`, {
      method,
      headers: { Authorization: "Bearer valid-session-token" },
    }), env);

    expect(response.status).toBe(405);
    expect(await response.json()).toMatchObject({
      ok: false,
      message: "Method not allowed",
    });
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it("allows login without the configured API token", async () => {
    const env = createWorkerEnv({ apiToken: "server-only-token" });
    const response = await worker.fetch(new Request("https://worker.example/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "tester", password: "password" }),
    }), env);

    expect(response.status).toBe(200);
    expect(env.__authStub.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/login"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("allows an authenticated data request without the API token", async () => {
    const env = createWorkerEnv({ apiToken: "server-only-token" });
    const response = await worker.fetch(new Request("https://worker.example/api/data", {
      method: "GET",
      headers: { Authorization: "Bearer valid-session-token" },
    }), env);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ revision: 0 });
    expect(env.__userDataStub.read).toHaveBeenCalledOnce();
  });

  it("rejects a data request without a valid session", async () => {
    const env = createWorkerEnv({ apiToken: "server-only-token" });
    const response = await worker.fetch(new Request("https://worker.example/api/data", {
      method: "GET",
    }), env);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      ok: false,
      message: "请先登录",
    });
    expect(env.__userDataStub.read).not.toHaveBeenCalled();
  });

  it("does not access user data when the session is invalid, even with an API token", async () => {
    const env = createWorkerEnv({ apiToken: "server-only-token" });
    const response = await worker.fetch(new Request("https://worker.example/api/data", {
      method: "GET",
      headers: {
        Authorization: "Bearer expired-session-token",
        "X-Sherlly-Token": "server-only-token",
      },
    }), env);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      ok: false,
      message: "请先登录",
    });
    expect(env.__userDataStub.read).not.toHaveBeenCalled();
  });
});
