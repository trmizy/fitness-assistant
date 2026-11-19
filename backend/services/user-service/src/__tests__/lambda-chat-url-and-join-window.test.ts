/**
 * Two small demo-rehearsal fixes (19/11), no database:
 *  - chat-service URL: on Lambda with CHAT_SERVICE_URL unset the chat calls are SKIPPED (no connection attempt at all);
 *    locally the compose default stays.                                                         [TEST FIXTURE + REAL HTTP stub]
 *  - join window: the {joinOpensAt, joinClosesAt} a session carries is exactly the rule joinSession() enforces
 *    (opens ROOM_OPEN_BEFORE_MINUTES before the start, closes hard at scheduledEndAt).           [TEST FIXTURE]
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

process.env.INTERNAL_API_SECRET = "lambda-url-test-secret";

test("resolveChatServiceUrl: configured wins; unset locally = compose default; unset/blank on Lambda = null", async () => {
  const { resolveChatServiceUrl } = await import("../utils/chat-service-url");
  assert.equal(resolveChatServiceUrl({ CHAT_SERVICE_URL: "http://alb.example:3005" } as any), "http://alb.example:3005");
  assert.equal(resolveChatServiceUrl({} as any), "http://chat-service:3005");
  assert.equal(resolveChatServiceUrl({ CHAT_SERVICE_URL: "" } as any), "http://chat-service:3005");
  assert.equal(resolveChatServiceUrl({ AWS_LAMBDA_FUNCTION_NAME: "user" } as any), null);
  assert.equal(resolveChatServiceUrl({ AWS_LAMBDA_FUNCTION_NAME: "user", CHAT_SERVICE_URL: "  " } as any), null);
  assert.equal(
    resolveChatServiceUrl({ AWS_LAMBDA_FUNCTION_NAME: "user", CHAT_SERVICE_URL: "http://alb:3005" } as any),
    "http://alb:3005",
  );
});

test("connectContractPartiesInChat on Lambda with CHAT_SERVICE_URL unset: no HTTP call, resolves false; with the URL set it calls", async () => {
  const { connectContractPartiesInChat } = await import("../services/chat-connect.service");
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits++;
    res.setHeader("content-type", "application/json");
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const saved = { fn: process.env.AWS_LAMBDA_FUNCTION_NAME, url: process.env.CHAT_SERVICE_URL };
  const contract = { id: "c1", ptUserId: "pt", clientUserId: "cl", packageName: null };
  try {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "gymini-user";
    delete process.env.CHAT_SERVICE_URL;
    assert.equal(await connectContractPartiesInChat(contract), false);
    assert.equal(hits, 0, "nothing was sent");

    process.env.CHAT_SERVICE_URL = url;
    assert.equal(await connectContractPartiesInChat(contract), true);
    assert.equal(hits, 1);
  } finally {
    if (saved.fn === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    else process.env.AWS_LAMBDA_FUNCTION_NAME = saved.fn;
    if (saved.url === undefined) delete process.env.CHAT_SERVICE_URL;
    else process.env.CHAT_SERVICE_URL = saved.url;
    await new Promise((r) => server.close(r));
  }
});

test("joinWindowOf / withJoinWindow: opens N min before the start, closes exactly at the end; same numbers joinSession() uses", async () => {
  const { joinWindowOf, withJoinWindow } = await import("../services/session-join-window");
  const { ROOM_OPEN_BEFORE_MINUTES } = await import("../services/booking.service");
  assert.equal(ROOM_OPEN_BEFORE_MINUTES, 15);
  const start = new Date("2026-11-20T10:00:00.000Z");
  const end = new Date("2026-11-20T11:00:00.000Z");
  assert.deepEqual(joinWindowOf(start, end), {
    joinOpensAt: "2026-11-20T09:45:00.000Z",
    joinClosesAt: "2026-11-20T11:00:00.000Z",
  });
  assert.equal(joinWindowOf(start, end, 5)!.joinOpensAt, "2026-11-20T09:55:00.000Z");
  assert.equal(joinWindowOf(null, end), null);
  assert.equal(joinWindowOf("garbage", end), null);

  const row = { id: "s1", scheduledStartAt: start.toISOString(), scheduledEndAt: end.toISOString(), status: "CONFIRMED" };
  const [decorated] = withJoinWindow([row]);
  assert.equal((decorated as any).joinOpensAt, "2026-11-20T09:45:00.000Z");
  assert.equal(decorated.id, "s1");
  assert.equal(withJoinWindow(null), null);
  assert.deepEqual(withJoinWindow({ id: "x" }), { id: "x" });
});
