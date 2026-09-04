import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.NODE_ENV = "test";
process.env.AUTH_SERVICE_URL = "http://127.0.0.1:4001";
process.env.AI_SERVICE_URL = "http://127.0.0.1:3999";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret";

let app: any;
let gatewayServer: http.Server;
let aiServer: http.Server;
let authServer: http.Server;
let gatewayBaseUrl = "";
let forwardedInternalToken = "";
let forwardedUserId = "";
let forwardedAdminBody = "";
let forwardedAdminInternalToken = "";
let forwardedAdminUserId = "";

test.before(async () => {
  ({ default: app } = await import("../app"));

  authServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/auth/verify") {
      const authorization = String(req.headers.authorization || "");
      const isAdmin = authorization.includes("admin-token");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          user: {
            id: isAdmin ? "admin-42" : "user-42",
            email: isAdmin ? "admin@example.com" : "u@example.com",
            role: isAdmin ? "ADMIN" : "CUSTOMER",
          },
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  aiServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/ai/ask") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const parsed = JSON.parse(body) as { question: string };

        forwardedInternalToken = String(req.headers["x-internal-token"] || "");
        forwardedUserId = String(req.headers["x-user-id"] || "");

        assert.equal(parsed.question, "create my workout plan");
        assert.equal(forwardedInternalToken, "gateway-secret");
        assert.equal(forwardedUserId, "user-42");

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              conversationId: "conv-1",
              question: parsed.question,
              answer: "AI response",
            },
          }),
        );
      });
      return;
    }

    if (req.method === "POST" && req.url === "/ai/ask/stream") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const parsed = JSON.parse(body) as { question: string };

        forwardedInternalToken = String(req.headers["x-internal-token"] || "");
        forwardedUserId = String(req.headers["x-user-id"] || "");

        assert.equal(parsed.question, "leg day exercises");
        assert.equal(forwardedInternalToken, "gateway-secret");
        assert.equal(forwardedUserId, "user-42");

        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write('data: {"type":"status","message":"working"}\n\n');
        res.write('data: {"type":"done","conversationId":"conv-1"}\n\n');
        res.end();
      });
      return;
    }

    if (req.method === "POST" && req.url === "/admin/ai/knowledge/jobs/local") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        forwardedAdminBody = Buffer.concat(chunks).toString("utf8");
        forwardedAdminInternalToken = String(
          req.headers["x-internal-token"] || "",
        );
        forwardedAdminUserId = String(req.headers["x-user-id"] || "");

        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              queued: true,
              kind: "local",
              jobId: "job-1",
              queue: "knowledge-pipeline",
            },
          }),
        );
      });
      return;
    }

    if (
      req.method === "POST" &&
      req.url === "/admin/ai/knowledge/review/review-1/approve"
    ) {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        forwardedAdminBody = Buffer.concat(chunks).toString("utf8");
        forwardedAdminInternalToken = String(
          req.headers["x-internal-token"] || "",
        );
        forwardedAdminUserId = String(req.headers["x-user-id"] || "");

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              approved: true,
              reviewId: "review-1",
              documentId: "doc-1",
              embeddedChunks: 0,
            },
          }),
        );
      });
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) =>
    authServer.listen(4001, "127.0.0.1", resolve),
  );
  await new Promise<void>((resolve) =>
    aiServer.listen(3999, "127.0.0.1", resolve),
  );
  gatewayServer = http.createServer(app);
  await new Promise<void>((resolve) =>
    gatewayServer.listen(0, "127.0.0.1", resolve),
  );

  const address = gatewayServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start gateway test server");
  }

  gatewayBaseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise<void>((resolve, reject) =>
    gatewayServer.close((err) => (err ? reject(err) : resolve())),
  );
  await new Promise<void>((resolve, reject) =>
    aiServer.close((err) => (err ? reject(err) : resolve())),
  );
  await new Promise<void>((resolve, reject) =>
    authServer.close((err) => (err ? reject(err) : resolve())),
  );
});

test("gateway forwards x-internal-token and user identity to AI service", async () => {
  const res = await fetch(`${gatewayBaseUrl}/ai/ask`, {
    method: "POST",
    headers: {
      Authorization: "Bearer gateway-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question: "create my workout plan" }),
  });

  const responseBody = (await res.json()) as { success: boolean };

  assert.equal(res.status, 200);
  assert.equal(responseBody.success, true);
  assert.equal(forwardedInternalToken, "gateway-secret");
  assert.equal(forwardedUserId, "user-42");
});

test("gateway streams AI SSE responses through to the client", async () => {
  const res = await fetch(`${gatewayBaseUrl}/ai/ask/stream`, {
    method: "POST",
    headers: {
      Authorization: "Bearer gateway-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question: "leg day exercises" }),
  });

  const text = await res.text();

  assert.equal(res.status, 200);
  assert.match(text, /data: \{"type":"status","message":"working"\}/);
  assert.match(text, /data: \{"type":"done","conversationId":"conv-1"\}/);
});

test("gateway forwards admin AI POST body, token, and admin identity", async () => {
  const res = await fetch(`${gatewayBaseUrl}/admin/ai/knowledge/jobs/local`, {
    method: "POST",
    headers: {
      Authorization: "Bearer admin-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ embed: false, limit: 1 }),
  });

  const responseBody = (await res.json()) as {
    success: boolean;
    data: { queued: boolean };
  };
  const forwardedBody = JSON.parse(forwardedAdminBody) as {
    embed: boolean;
    limit: number;
  };

  assert.equal(res.status, 202);
  assert.equal(responseBody.success, true);
  assert.equal(responseBody.data.queued, true);
  assert.equal(forwardedAdminInternalToken, "gateway-secret");
  assert.equal(forwardedAdminUserId, "admin-42");
  assert.equal(forwardedBody.embed, false);
  assert.equal(forwardedBody.limit, 1);
});

test("gateway forwards admin knowledge review approval body", async () => {
  const res = await fetch(
    `${gatewayBaseUrl}/admin/ai/knowledge/review/review-1/approve`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer admin-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ embed: false }),
    },
  );

  const responseBody = (await res.json()) as {
    success: boolean;
    data: { approved: boolean; embeddedChunks: number };
  };
  const forwardedBody = JSON.parse(forwardedAdminBody) as { embed: boolean };

  assert.equal(res.status, 200);
  assert.equal(responseBody.success, true);
  assert.equal(responseBody.data.approved, true);
  assert.equal(responseBody.data.embeddedChunks, 0);
  assert.equal(forwardedAdminInternalToken, "gateway-secret");
  assert.equal(forwardedAdminUserId, "admin-42");
  assert.equal(forwardedBody.embed, false);
});
