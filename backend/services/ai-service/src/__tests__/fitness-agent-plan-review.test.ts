/**
 * AI Chat -> Plan Review ("Gửi plan hiện tại cho PT xem"): preview + explicit confirmation + shared Plan Review API.
 * Evidence label: BACKEND INTEGRATION against the ai test DB (real FitnessAgentAction rows) with the fitness/user-service tool
 * calls STUBBED via fitnessAgentDeps.tools (same pattern as the other fitness-agent tests) — it does NOT call the live Plan Review API.
 *
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_ai_test" \
 *     npx tsx --test src/__tests__/fitness-agent-plan-review.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";
import { parseFitnessAgentIntent } from "../services/fitness-agent-intent";

const tools = fitnessAgentDeps.tools;
const original = {
  getCurrentProgramForReview: tools.getCurrentProgramForReview,
  getActivePtContracts: tools.getActivePtContracts,
  submitPlanReview: tools.submitPlanReview,
};
test.afterEach(() => Object.assign(tools, original));
test.after(async () => {
  await prisma.$disconnect();
});

const PROGRAM = { id: "6f1f6c0e-1a2b-4c3d-8e9f-0a1b2c3d4e5f", name: "Giảm mỡ 8 tuần", version: 3 };
const PT = { ptUserId: "pt-user-1", name: "Minh Trần" };

async function fixture() {
  const userId = `agent-planreview-it-${randomUUID()}`;
  const session = await prisma.chatSession.create({ data: { userId, title: "Plan review chat" } });
  const calls = { submit: [] as any[] };
  tools.getCurrentProgramForReview = async () => PROGRAM as any;
  tools.getActivePtContracts = async () => [PT];
  tools.submitPlanReview = (async (_id: any, input: any) => {
    calls.submit.push(input);
    return { request: { id: "req-1", status: "PENDING_REVIEW" }, replayed: false };
  }) as any;
  const cleanup = async () => {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  };
  return { userId, identity: { userId }, sessionId: session.id, calls, cleanup };
}
const ask = (f: Awaited<ReturnType<typeof fixture>>, q = "Gửi plan hiện tại cho PT xem") => fitnessAgent.tryTurn(q, f.identity, f.sessionId);

// ── intent ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("AC01 intent: client -> PT direction only; questions are advisory; PT search / hiring keep their own meaning", () => {
  for (const q of ["Gửi plan hiện tại cho PT xem", "gửi kế hoạch tập của tôi cho huấn luyện viên duyệt", "Hãy gửi lịch tập này đến PT để review", "gửi cho PT xem chương trình tập của tôi", "chia sẻ plan cho PT"]) {
    assert.equal(parseFitnessAgentIntent(q).kind, "SEND_PLAN_TO_PT_REVIEW", q);
  }
  // opposite direction / unrelated
  for (const q of ["PT gửi plan cho tôi xem", "PT đã gửi kế hoạch cho tôi chưa", "tôi muốn thuê PT", "tìm PT giảm mỡ"]) {
    assert.notEqual(parseFitnessAgentIntent(q).kind, "SEND_PLAN_TO_PT_REVIEW", q);
  }
  // a QUESTION about it must not start the mutation flow (speech-act gate)
  const advisory = parseFitnessAgentIntent("Gửi plan cho PT xem được không?");
  assert.equal(advisory.kind, null);
  assert.equal(advisory.advisory?.about, "SEND_PLAN_TO_PT_REVIEW");
});

// ── preview ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("AC02 preview: creates ONE pending confirmation with planId/version/PT/scope and sends NOTHING", async () => {
  const f = await fixture();
  try {
    const r = await ask(f);
    assert.ok(r);
    const block: any = r!.blocks[0];
    assert.equal(block.type, "ACTION_CONFIRMATION");
    assert.equal(block.kind, "SEND_PLAN_TO_PT_REVIEW");
    assert.equal(block.risk, "MEDIUM");
    assert.match(block.note, /không kèm chỉ số InBody/i, "states exactly what is shared");
    assert.match(block.note, /không tự duyệt thay PT/i);
    assert.equal(block.summary.programName, PROGRAM.name);
    assert.equal(block.summary.ptName, PT.name);
    const row = await prisma.fitnessAgentAction.findUniqueOrThrow({ where: { id: block.actionId } });
    assert.equal(row.status, "PENDING");
    assert.deepEqual({ ...(row.payload as any) }, { programId: PROGRAM.id, programVersion: 3, programName: PROGRAM.name, ptUserId: PT.ptUserId, ptName: PT.name });
    assert.equal(f.calls.submit.length, 0, "preview never calls the Plan Review API (no bypass of confirmation)");
  } finally { await f.cleanup(); }
});

test("AC03 asking twice while a card is pending reuses it (no pile of identical confirmations)", async () => {
  const f = await fixture();
  try {
    const a: any = (await ask(f))!.blocks[0];
    const b: any = (await ask(f))!.blocks[0];
    assert.equal(b.actionId, a.actionId);
    assert.equal(await prisma.fitnessAgentAction.count({ where: { userId: f.userId, kind: "SEND_PLAN_TO_PT_REVIEW" } }), 1);
  } finally { await f.cleanup(); }
});

test("AC04 no confirmation is created when it cannot be done safely (no plan / no contract / several PTs / contract lookup down)", async () => {
  const f = await fixture();
  try {
    tools.getCurrentProgramForReview = async () => null;
    let r = await ask(f);
    assert.deepEqual(r!.blocks, []);
    assert.match(r!.answer, /chưa có kế hoạch tập hiện tại/);

    tools.getCurrentProgramForReview = async () => PROGRAM as any;
    tools.getActivePtContracts = async () => [];
    r = await ask(f);
    assert.deepEqual(r!.blocks, []);
    assert.match(r!.answer, /chưa có hợp đồng PT còn hiệu lực/);

    tools.getActivePtContracts = async () => [PT, { ptUserId: "pt-user-2", name: "Lan Phạm" }];
    r = await ask(f);
    assert.deepEqual(r!.blocks, []);
    assert.match(r!.answer, /nhiều PT/, "never picks a PT on the user's behalf");

    tools.getActivePtContracts = async () => { throw Object.assign(new Error("down"), { status: 503 }); };
    r = await ask(f);
    assert.deepEqual(r!.blocks, []);
    assert.match(r!.answer, /chưa xác minh được hợp đồng PT/, "fails closed");

    assert.equal(await prisma.fitnessAgentAction.count({ where: { userId: f.userId } }), 0);
    assert.equal(f.calls.submit.length, 0);
  } finally { await f.cleanup(); }
});

// ── confirm ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("AC05 confirm: ONE API call with the action-derived idempotency key + the version the user saw; confirming again never re-sends", async () => {
  const f = await fixture();
  try {
    const card: any = (await ask(f))!.blocks[0];
    const done: any = await fitnessAgent.execute(f.identity, card.actionId, true);
    assert.equal(done.type, "ACTION_RESULT");
    assert.equal(done.ok, true);
    assert.match(done.message, /Đã gửi kế hoạch “Giảm mỡ 8 tuần” cho PT Minh Trần/);
    assert.deepEqual(f.calls.submit, [{ ptUserId: PT.ptUserId, programId: PROGRAM.id, expectedVersion: 3, idempotencyKey: `agent-action-${card.actionId}` }]);
    assert.equal((await prisma.fitnessAgentAction.findUniqueOrThrow({ where: { id: card.actionId } })).status, "COMPLETED");

    const again: any = await fitnessAgent.execute(f.identity, card.actionId, true); // double click / second tab
    assert.equal(again.ok, true);
    assert.equal(f.calls.submit.length, 1, "no duplicate send");
  } finally { await f.cleanup(); }
});

test("AC06 confirmation is explicit: execute without confirmed=true is refused and sends nothing", async () => {
  const f = await fixture();
  try {
    const card: any = (await ask(f))!.blocks[0];
    await assert.rejects(fitnessAgent.execute(f.identity, card.actionId, false as any), /Explicit confirmation required/);
    assert.equal(f.calls.submit.length, 0);
    assert.equal((await prisma.fitnessAgentAction.findUniqueOrThrow({ where: { id: card.actionId } })).status, "PENDING");
  } finally { await f.cleanup(); }
});

test("AC07 API failure is never reported as success: transient error -> clear failure, action stays PENDING, retry reuses the SAME key", async () => {
  const f = await fixture();
  try {
    const card: any = (await ask(f))!.blocks[0];
    tools.submitPlanReview = (async (_i: any, input: any) => { f.calls.submit.push(input); throw Object.assign(new Error("Domain service unavailable"), { status: 503 }); }) as any;
    const failed: any = await fitnessAgent.execute(f.identity, card.actionId, true);
    assert.equal(failed.ok, false);
    assert.doesNotMatch(failed.message, /Đã gửi/);
    assert.match(failed.message, /Chưa có gì được gửi/);
    assert.equal((await prisma.fitnessAgentAction.findUniqueOrThrow({ where: { id: card.actionId } })).status, "PENDING", "not recorded as COMPLETED");

    tools.submitPlanReview = (async (_i: any, input: any) => { f.calls.submit.push(input); return { request: { id: "req-9", status: "PENDING_REVIEW" }, replayed: true }; }) as any;
    const ok: any = await fitnessAgent.execute(f.identity, card.actionId, true);
    assert.equal(ok.ok, true);
    assert.match(ok.message, /đã được gửi cho PT Minh Trần trước đó/, "replay is reported honestly, not as a fresh send");
    assert.equal(f.calls.submit.length, 2);
    assert.equal(f.calls.submit[0].idempotencyKey, f.calls.submit[1].idempotencyKey, "retry carries the same idempotency key");
  } finally { await f.cleanup(); }
});

test("AC08 the plan changed after the preview (server 409) -> nothing sent, truthful message, not retryable", async () => {
  const f = await fixture();
  try {
    const card: any = (await ask(f))!.blocks[0];
    tools.submitPlanReview = (async () => { throw Object.assign(new Error("Kế hoạch đã thay đổi"), { status: 409 }); }) as any;
    const res: any = await fitnessAgent.execute(f.identity, card.actionId, true);
    assert.equal(res.ok, false);
    assert.match(res.message, /chưa gửi gì cả/);
    assert.doesNotMatch(res.message, /Đã gửi/);
  } finally { await f.cleanup(); }
});

test("AC09 contract ended between preview and confirm (server 403) -> nothing sent", async () => {
  const f = await fixture();
  try {
    const card: any = (await ask(f))!.blocks[0];
    tools.submitPlanReview = (async () => { throw Object.assign(new Error("no contract"), { status: 403 }); }) as any;
    const res: any = await fitnessAgent.execute(f.identity, card.actionId, true);
    assert.equal(res.ok, false);
    assert.match(res.message, /không còn hợp đồng PT hiệu lực/);
  } finally { await f.cleanup(); }
});

test("AC10 isolation: another user can never confirm someone else's card", async () => {
  const f = await fixture();
  try {
    const card: any = (await ask(f))!.blocks[0];
    await assert.rejects(fitnessAgent.execute({ userId: "someone-else" }, card.actionId, true), /Action not found/);
    assert.equal(f.calls.submit.length, 0);
  } finally { await f.cleanup(); }
});

test("AC11 an EXPIRED pending action can no longer be confirmed: 409, nothing is sent, the card stays unexecuted", async () => {
  const f = await fixture();
  try {
    const card: any = (await ask(f))!.blocks[0];
    await prisma.fitnessAgentAction.update({ where: { id: card.actionId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await assert.rejects(fitnessAgent.execute(f.identity, card.actionId, true), (e: any) => e.status === 409 && /expired/i.test(e.message));
    assert.equal(f.calls.submit.length, 0, "no Plan Review API call for an expired confirmation");
    assert.equal((await prisma.fitnessAgentAction.findUniqueOrThrow({ where: { id: card.actionId } })).status, "PENDING");
    // asking again creates a FRESH card (the expired one is not reused)
    const again: any = (await ask(f))!.blocks[0];
    assert.notEqual(again.actionId, card.actionId);
  } finally { await f.cleanup(); }
});
