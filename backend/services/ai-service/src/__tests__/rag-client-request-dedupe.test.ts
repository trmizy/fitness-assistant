/**
 * Server-side de-duplication of a retried chat action (V-T012 follow-up, found by REAL BROWSER verification): after a lost response the
 * client retried with the SAME clientRequestId, but only generation commands were de-duplicated, so a plain question created a second
 * conversation and a second model call. Real ragService + real DB (ai test DB, migration 20261020100000 applied); only the orchestrator
 * (the model) is replaced, and it counts its calls.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.LLM_PROVIDER = "mock";
const dbUrl = process.env.DATABASE_URL ?? "";
const canUseDb = /localhost:55433\/[a-z_]*_test(\?|$)/.test(dbUrl);
const dbOpts = { skip: canUseDb ? false : "Requires DATABASE_URL on the isolated ai test DB (localhost:55433/*_test).", timeout: 60_000 };

const userPrefix = `dedupe-${randomUUID().slice(0, 8)}`;
let modelCalls = 0;
let delayMs = 0;

async function setup() {
  const { ragService } = await import("../services/rag.service");
  const { llmOrchestrator } = await import("../llm/orchestrator.service");
  const { withClientRequestId } = await import("../services/request-identity");
  const { prisma } = await import("../repositories/conversation.repository");
  (llmOrchestrator as any).run = async (question: string) => {
    modelCalls++;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return { answer: `Trả lời #${modelCalls} cho: ${question}`, promptTokens: 1, completionTokens: 1, totalTokens: 2, traceId: `t${modelCalls}`, usedFallback: false, usedDeterministicFallbackBecauseOfValidation: false, responseLanguage: "vi", routeIntent: "general", warningCount: 0, missingFields: [], validationNotes: [], structuredBlocks: [{ type: "TEST_BLOCK", n: modelCalls }] };
  };
  const ask = (userId: string, id: string | null, question: string, sessionId?: string) =>
    withClientRequestId(id, () => ragService.rag(question, userId, "Bearer t", sessionId)) as Promise<any>;
  return { ask, prisma };
}
test.beforeEach(() => { modelCalls = 0; delayMs = 0; });
test.after(async () => {
  if (!canUseDb) return;
  const { prisma } = await import("../repositories/conversation.repository");
  await prisma.conversation.deleteMany({ where: { userId: { startsWith: userPrefix } } });
  await prisma.chatSession.deleteMany({ where: { userId: { startsWith: userPrefix } } });
  await prisma.$disconnect();
});

test("retry of the same action (lost response: no sessionId) is answered from the stored turn — no 2nd model call, one session, one message", dbOpts, async () => {
  const { ask, prisma } = await setup();
  const u = `${userPrefix}-a`; const id = randomUUID();
  const first = await ask(u, id, "Protein giúp gì cho cơ bắp?");
  const retry = await ask(u, id, "Protein giúp gì cho cơ bắp?");
  assert.equal(modelCalls, 1, "the model ran once");
  assert.equal(retry.replayed, true);
  assert.equal(retry.conversationId, first.conversationId);
  assert.equal(retry.sessionId, first.sessionId, "the client adopts the ORIGINAL session instead of getting a new one");
  assert.equal(retry.answer, first.answer);
  assert.deepEqual(retry.structuredBlocks, first.structuredBlocks);
  assert.equal(await prisma.chatSession.count({ where: { userId: u } }), 1);
  assert.equal(await prisma.conversation.count({ where: { userId: u } }), 1);
});

test("retry inside a known session (same sessionId) also replays; a DIFFERENT sessionId for the same id is refused", dbOpts, async () => {
  const { ask, prisma } = await setup();
  const u = `${userPrefix}-b`; const id = randomUUID();
  const first = await ask(u, id, "Câu hỏi A");
  assert.equal((await ask(u, id, "Câu hỏi A", first.sessionId)).replayed, true);
  const other = await prisma.chatSession.create({ data: { userId: u, title: "other" } });
  await assert.rejects(() => ask(u, id, "Câu hỏi A", other.id), (e: any) => e.code === "IDEMPOTENCY_KEY_CONFLICT" && e.statusCode === 409);
  assert.equal(modelCalls, 1);
});

test("same id with a DIFFERENT message is refused (409), never answered with another turn", dbOpts, async () => {
  const { ask } = await setup();
  const u = `${userPrefix}-c`; const id = randomUUID();
  await ask(u, id, "Câu hỏi 1");
  await assert.rejects(() => ask(u, id, "Câu hỏi khác hẳn"), (e: any) => e.code === "IDEMPOTENCY_KEY_CONFLICT");
  assert.equal(modelCalls, 1);
});

test("identity: the lookup is per verified user — another account with the same id gets its own turn and never sees the first", dbOpts, async () => {
  const { ask } = await setup();
  const id = randomUUID();
  const a = await ask(`${userPrefix}-d1`, id, "Cùng câu hỏi");
  const b = await ask(`${userPrefix}-d2`, id, "Cùng câu hỏi");
  assert.equal(modelCalls, 2);
  assert.notEqual(a.conversationId, b.conversationId);
  assert.notEqual(a.sessionId, b.sessionId);
  assert.notEqual(a.replayed, true);
  assert.notEqual(b.replayed, true);
});

test("a deliberate new send (new id) and a legacy client (no id) are NOT de-duplicated, even with identical text", dbOpts, async () => {
  const { ask, prisma } = await setup();
  const u = `${userPrefix}-e`;
  await ask(u, randomUUID(), "Giống nhau");
  await ask(u, randomUUID(), "Giống nhau");
  await ask(u, null, "Giống nhau");
  await ask(u, null, "Giống nhau");
  assert.equal(modelCalls, 4);
  assert.equal(await prisma.conversation.count({ where: { userId: u } }), 4);
});

test("RACE: 6 concurrent attempts of one action persist exactly one turn, all answer with it, and the losers' empty sessions are cleaned up", dbOpts, async () => {
  const { ask, prisma } = await setup();
  delayMs = 60; // all attempts get past the (empty) lookup before any persists
  const u = `${userPrefix}-f`; const id = randomUUID();
  const results = await Promise.all(Array.from({ length: 6 }, () => ask(u, id, "Đua nhau")));
  assert.equal(await prisma.conversation.count({ where: { userId: u } }), 1, "unique (user, clientRequestId) kept one turn");
  assert.equal(new Set(results.map((r) => r.conversationId)).size, 1, "every attempt answers with the same turn");
  assert.equal(new Set(results.map((r) => r.sessionId)).size, 1);
  assert.equal(await prisma.chatSession.count({ where: { userId: u } }), 1, "no orphan empty sessions left behind");
  assert.ok(modelCalls >= 1 && modelCalls <= 6, "the redundant model calls are the only cost of a true race");
});
