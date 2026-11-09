/**
 * POST /ai/ask/stream typing-effect pacing (config/stream-pacing.ts).
 *
 * Streaming transport (local Express server): the answer is re-chunked into
 * small token events with a delay. Buffering transport (lambda.ts behind API
 * Gateway): pacing is skipped and the whole answer is one token event, so the
 * Lambda does not burn its ~29 s budget on a delay nobody can see. In both
 * modes the concatenated tokens equal the answer and the `done` event is sent.
 *
 * Calls the real controller with a stubbed ragService.rag — no model, no DB.
 */
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { aiController } from "../controllers/ai.controller";
import { ragService } from "../services/rag.service";
import {
  markResponseTransportBuffered,
  resetStreamPacingForTests,
} from "../config/stream-pacing";

const PING = ": ping\n\n";
const ANSWER ="Tập squat 3 hiệp x 8 lần, nghỉ 2 phút giữa các hiệp.";
const originalRag = ragService.rag;

function fakeResponse() {
  const writes: string[] = [];
  const res: any = {
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    flushHeaders() {},
    on() {},
    write(chunk: string) {
      writes.push(chunk);
      return true;
    },
    end() {
      res.writableEnded = true;
    },
  };
  return {
    res,
    writes,
    events: () =>
      writes.filter((w) => w.startsWith("data: ")).map((w) => JSON.parse(w.replace(/^data: /, "").trim())),
  };
}

async function runAskStream() {
  const { res, events } = fakeResponse();
  const req: any = {
    context: { userId: "user-1", authorizationHeader: "Bearer t" },
    body: { question: "Tập chân thế nào?" },
  };
  const startedAt = Date.now();
  await aiController.askStream(req, res, () => {});
  return { events: events(), elapsedMs: Date.now() - startedAt, ended: res.writableEnded };
}

test.beforeEach(() => {
  resetStreamPacingForTests();
  ragService.rag = (async () => ({
    answer: ANSWER,
    conversationId: "conv-1",
    sessionId: "session-1",
  })) as any;
});

test.afterEach(() => {
  ragService.rag = originalRag;
  resetStreamPacingForTests();
});

test("streaming transport: answer is paced into small token chunks", async () => {
  const { events, ended } = await runAskStream();
  const tokens = events.filter((e) => e.type === "token");

  assert.equal(tokens.length, Math.ceil(ANSWER.length / 4));
  assert.ok(tokens.every((t) => t.content.length <= 4));
  assert.equal(tokens.map((t) => t.content).join(""), ANSWER);
  assert.equal(events.at(-1).type, "done");
  assert.equal(events.at(-1).sessionId, "session-1");
  assert.ok(ended);
});

test("buffered transport: whole answer in one token event, no pacing delay", async () => {
  markResponseTransportBuffered();
  const { events, elapsedMs, ended } = await runAskStream();
  const tokens = events.filter((e) => e.type === "token");

  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].content, ANSWER);
  assert.equal(events.at(-1).type, "done");
  assert.equal(events.at(-1).conversationId, "conv-1");
  assert.ok(ended);
  // Paced, this answer would take ~13 ticks x 18 ms; unpaced it must not wait on any tick.
  assert.ok(elapsedMs < 100, `expected no pacing delay, took ${elapsedMs} ms`);
});

test("buffered transport: empty answer sends no token event but still finishes", async () => {
  markResponseTransportBuffered();
  ragService.rag = (async () => ({ answer: "", conversationId: "c", sessionId: "s" })) as any;
  const { events, ended } = await runAskStream();

  assert.equal(events.filter((e) => e.type === "token").length, 0);
  assert.equal(events.at(-1).type, "done");
  assert.ok(ended);
});

test("lambda.ts (API Gateway entrypoint) marks its transport as buffered on import", async () => {
  const { streamPacing } = await import("../config/stream-pacing");
  assert.notEqual(streamPacing(), null);
  await import("../lambda");
  assert.equal(streamPacing(), null);
});

test("streaming transport: SSE comment heartbeat while the answer is prepared, stopped afterwards", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    let finishRag!: () => void;
    ragService.rag = (() =>
      new Promise((resolve) => {
        finishRag = () => resolve({ answer: "ok", conversationId: "c", sessionId: "s" } as any);
      })) as any;
    const { res, writes } = fakeResponse();
    const req: any = { context: { userId: "u", authorizationHeader: "Bearer t" }, body: { question: "q" } };
    const run = aiController.askStream(req, res, () => {});

    await new Promise((r) => setImmediate(r));
    mock.timers.tick(10_000);
    mock.timers.tick(10_000);
    assert.equal(writes.filter((w) => w === PING).length, 2);

    finishRag();
    await run;
    mock.timers.tick(30_000);
    assert.equal(writes.filter((w) => w === PING).length, 2, "heartbeat must stop once the answer is ready");
    assert.ok(writes.some((w) => w.includes('"type":"done"')));
  } finally {
    mock.timers.reset();
  }
});

test("buffered transport: no heartbeat is written", async () => {
  markResponseTransportBuffered();
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    let finishRag!: () => void;
    ragService.rag = (() =>
      new Promise((resolve) => {
        finishRag = () => resolve({ answer: "ok", conversationId: "c", sessionId: "s" } as any);
      })) as any;
    const { res, writes } = fakeResponse();
    const req: any = { context: { userId: "u", authorizationHeader: "Bearer t" }, body: { question: "q" } };
    const run = aiController.askStream(req, res, () => {});
    await new Promise((r) => setImmediate(r));
    mock.timers.tick(30_000);
    finishRag();
    await run;
    assert.equal(writes.filter((w) => w.startsWith(":")).length, 0);
  } finally {
    mock.timers.reset();
  }
});
