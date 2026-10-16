/**
 * X4 follow-up — post-confirmation truthfulness (docs/conversational-intelligence-x4-followup-fix.md).
 *
 * Independent, permanent regression for the gap Codex reported in
 * docs/codex-conversational-intelligence-final-closure-signoff.md: a completed profile-workflow
 * confirmation (AgentWorkflowSession, e.g. UPDATE_GOAL) was invisible to tryConfirmationBoundary,
 * which used to derive state exclusively from FitnessAgentAction rows. This file does NOT modify
 * or replace Codex's own evidence (test/conversational-intelligence/results/codex-final-closure/
 * profile-confirmation-followup.json, produced by codex-final-confirmation-followup.mjs) — it is a
 * separate, independently-authored regression covering the same defect plus the surrounding
 * precedence/ownership rules the fix must also satisfy.
 *
 * Two levels:
 *  1. Pure-function tests of mergeConfirmationState — the precedence rule in isolation, no I/O.
 *  2. BACKEND INTEGRATION — real test DB, real fitnessAgent.tryConfirmationBoundary, real
 *     AgentWorkflowSession / FitnessAgentAction fixture rows (direct SQL-equivalent Prisma writes,
 *     not a full conversational turn — consistent with x4-confirmation-matrix.mjs's own "TEST
 *     FIXTURE" convention for constructing a specific historical state deterministically).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent } from "../services/fitness-agent.service";
import { mergeConfirmationState } from "../services/confirmation-boundary";

test.after(async () => { await prisma.$disconnect(); });

// ───────────────────────── 1. mergeConfirmationState — pure, no I/O ─────────────────────────
test("X4 follow-up — mergeConfirmationState: an open/in-flight action always wins outright, regardless of any profile-workflow history", () => {
  const now = new Date();
  assert.equal(mergeConfirmationState("PENDING", now, { status: "COMPLETED", updatedAt: new Date(now.getTime() + 60000) }), "PENDING");
  assert.equal(mergeConfirmationState("EXECUTING", now, { status: "CANCELLED", updatedAt: new Date(now.getTime() + 60000) }), "EXECUTING");
});

test("X4 follow-up — mergeConfirmationState: no action history at all surfaces the profile-workflow's own outcome (the reported bug)", () => {
  const t = new Date();
  assert.equal(mergeConfirmationState("NONE", null, { status: "COMPLETED", updatedAt: t }), "COMPLETED");
  assert.equal(mergeConfirmationState("NONE", null, { status: "CANCELLED", updatedAt: t }), "CANCELLED");
  assert.equal(mergeConfirmationState("NONE", null, { status: "EXPIRED", updatedAt: t }), "EXPIRED");
  assert.equal(mergeConfirmationState("NONE", null, null), "NONE");
});

test("X4 follow-up — mergeConfirmationState: recency precedence — the chronologically newer event wins in BOTH directions", () => {
  const older = new Date("2026-01-01T00:00:00Z"); const newer = new Date("2026-01-01T00:10:00Z");
  // an older completed profile workflow must not shadow a newer cancelled action
  assert.equal(mergeConfirmationState("CANCELLED", newer, { status: "COMPLETED", updatedAt: older }), "CANCELLED");
  // an older completed action must not shadow a newer cancelled profile workflow
  assert.equal(mergeConfirmationState("COMPLETED", older, { status: "CANCELLED", updatedAt: newer }), "CANCELLED");
  // an older cancelled action must not shadow a newer completed profile workflow
  assert.equal(mergeConfirmationState("CANCELLED", older, { status: "COMPLETED", updatedAt: newer }), "COMPLETED");
});

// ───────────────────────── 2. BACKEND INTEGRATION — real test DB, real service ─────────────────────────
const identity = (userId: string) => ({ userId, authorizationHeader: "Bearer test" });
const newSession = (userId: string) => prisma.chatSession.create({ data: { userId, title: "x4 followup" } });
const cleanup = async (userId: string, sessionId: string) => {
  await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
  await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
  await prisma.chatSession.delete({ where: { id: sessionId } });
};
// X4 event-ordering fix (docs/conversational-intelligence-x4-event-ordering-fix.md): FitnessAgentAction gained a
// real `updatedAt` column (Defect B). Passed explicitly here (= createdAt) so a row directly inserted at a given
// terminal status is schema-consistent — a genuinely-just-created row always has updatedAt === createdAt; without
// this, Prisma's `@updatedAt` would default it to the actual wall-clock time of THIS fixture's own create() call,
// not the synthetic backdated `createdAt` a precedence test intends.
const seedAction = (userId: string, sessionId: string, status: string, expiresAt: Date, createdAt: Date) =>
  prisma.fitnessAgentAction.create({ data: { userId, sessionId, recommendationId: null, kind: "CREATE_WORKOUT_PLAN", risk: "MEDIUM", payload: { weeklySchedule: [] }, status, expiresAt, createdAt, updatedAt: createdAt } });
const seedProfileWorkflow = (userId: string, sessionId: string, status: string, updatedAt: Date) =>
  prisma.agentWorkflowSession.create({
    data: {
      userId, sessionId, workflowType: "UPDATE_GOAL", status,
      pendingProfileUpdate: [{ slotKey: "goal", profileField: "goal", oldValue: "MUSCLE_GAIN", newValue: "WEIGHT_LOSS" }] as any,
      expiresAt: new Date(Date.now() + 600000), updatedAt,
    },
  });
// a workflow that was cancelled/expired while still just COLLECTING_SLOTS — never proposed a profile
// change, so it must carry NO signal for this boundary (see findLatestProfileConfirmation's own doc).
const seedBareWorkflow = (userId: string, sessionId: string, status: string, updatedAt: Date) =>
  prisma.agentWorkflowSession.create({ data: { userId, sessionId, workflowType: "CREATE_WORKOUT_PLAN", status, expiresAt: new Date(Date.now() + 600000), updatedAt } });

const ago = (ms: number) => new Date(Date.now() - ms);
const future = () => new Date(Date.now() + 600000);

test("X4-1 no history: STATUS question is answered honestly as nothing pending/saved", async () => {
  const userId = `x4f-1-${randomUUID()}`; const s = await newSession(userId);
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /Chưa có thay đổi nào được lưu/);
  } finally { await cleanup(userId, s.id); }
});

test("X4-2 pending unconfirmed action: still defers to the real card, unaffected by the profile-workflow merge", async () => {
  const userId = `x4f-2-${randomUUID()}`; const s = await newSession(userId);
  await seedAction(userId, s.id, "PENDING", future(), new Date());
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /Chưa — mình chưa lưu gì cả/);
  } finally { await cleanup(userId, s.id); }
});

test("X4-3 completed FitnessAgentAction (no profile workflow at all): truthful positive answer, as before", async () => {
  const userId = `x4f-3-${randomUUID()}`; const s = await newSession(userId);
  await seedAction(userId, s.id, "COMPLETED", future(), new Date());
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /^Rồi/);
  } finally { await cleanup(userId, s.id); }
});

test("X4-4 completed UPDATE_GOAL profile workflow, zero FitnessAgentAction rows: the reported defect — must now be truthful", async () => {
  const userId = `x4f-4-${randomUUID()}`; const s = await newSession(userId);
  await seedProfileWorkflow(userId, s.id, "COMPLETED", new Date());
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /^Rồi/, "must report the completed profile confirmation, not NONE");
    assert.doesNotMatch(r!.answer, /Chưa có thay đổi nào được lưu/i);
  } finally { await cleanup(userId, s.id); }
});

test("X4-5 cancelled action: honest CANCELLED answer", async () => {
  const userId = `x4f-5-${randomUUID()}`; const s = await newSession(userId);
  await seedAction(userId, s.id, "CANCELLED", future(), new Date());
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /đã được bỏ qua/);
  } finally { await cleanup(userId, s.id); }
});

test("X4-6 expired action: honest EXPIRED answer", async () => {
  const userId = `x4f-6-${randomUUID()}`; const s = await newSession(userId);
  await seedAction(userId, s.id, "PENDING", ago(60000), ago(120000));
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /đã hết hạn/);
  } finally { await cleanup(userId, s.id); }
});

test("X4-7a precedence: an OLDER completed profile workflow must not shadow a NEWER cancelled action", async () => {
  const userId = `x4f-7a-${randomUUID()}`; const s = await newSession(userId);
  await seedProfileWorkflow(userId, s.id, "COMPLETED", ago(600000));
  await seedAction(userId, s.id, "CANCELLED", future(), ago(60000));
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /đã được bỏ qua/, "the newer cancelled action must govern, not the older completed profile write");
  } finally { await cleanup(userId, s.id); }
});

test("X4-7b precedence: an OLDER cancelled action must not shadow a NEWER completed profile workflow", async () => {
  const userId = `x4f-7b-${randomUUID()}`; const s = await newSession(userId);
  await seedAction(userId, s.id, "CANCELLED", future(), ago(600000));
  await seedProfileWorkflow(userId, s.id, "COMPLETED", ago(60000));
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /^Rồi/, "the newer completed profile write must govern, not the older cancelled action");
  } finally { await cleanup(userId, s.id); }
});

test("X4-8 pending draft, no saved program: same honest PENDING answer; a bare abandoned slot-collection workflow carries no signal", async () => {
  const userId = `x4f-8-${randomUUID()}`; const s = await newSession(userId);
  await seedBareWorkflow(userId, s.id, "EXPIRED", ago(1000)); // abandoned before proposing anything — must be ignored
  await seedAction(userId, s.id, "PENDING", future(), new Date());
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /Chưa — mình chưa lưu gì cả/);
  } finally { await cleanup(userId, s.id); }
});

test("X4-9 cross-user: user B's own (empty) session never sees user A's completed profile workflow", async () => {
  const a = `x4f-9a-${randomUUID()}`; const b = `x4f-9b-${randomUUID()}`;
  const sa = await newSession(a); const sb = await newSession(b);
  await seedProfileWorkflow(a, sa.id, "COMPLETED", new Date());
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(b), sb.id);
    assert.match(r!.answer, /Chưa có thay đổi nào được lưu/, "must not leak user A's completed profile write into user B's answer");
  } finally { await cleanup(a, sa.id); await cleanup(b, sb.id); }
});

test("X4-10 repeated CONFIRM after a completed profile workflow: truthful 'already saved', not a false NONE — and no write", async () => {
  const userId = `x4f-10-${randomUUID()}`; const s = await newSession(userId);
  await seedProfileWorkflow(userId, s.id, "COMPLETED", new Date());
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Xác nhận cập nhật.", identity(userId), s.id);
    assert.match(r!.answer, /đã được xác nhận và lưu rồi/);
    assert.deepEqual(r!.blocks, [], "read-only — no execution block");
    assert.equal(await prisma.agentWorkflowSession.count({ where: { userId, status: "COMPLETED" } }), 1, "no second workflow, no re-write");
  } finally { await cleanup(userId, s.id); }
});

test("X4-11 knowledge question about the confirmation mechanism: never intercepted, even with a completed profile workflow in history", async () => {
  const userId = `x4f-11-${randomUUID()}`; const s = await newSession(userId);
  await seedProfileWorkflow(userId, s.id, "COMPLETED", new Date());
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Giải thích cơ chế xác nhận cập nhật là gì.", identity(userId), s.id);
    assert.equal(r, null, "a knowledge question must fall through to normal chat, unaffected by any profile-workflow history");
  } finally { await cleanup(userId, s.id); }
});
