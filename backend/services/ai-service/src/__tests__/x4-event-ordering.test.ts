/**
 * X4 event-ordering remediation (docs/conversational-intelligence-x4-event-ordering-fix.md).
 *
 * Independent, permanent regression for the two real edge-case failures Codex's resumed
 * independent verification reproduced (docs/codex-conversational-intelligence-final-closure-
 * signoff.md "Resumed Follow-up Evidence"), on top of the prior X4 follow-up fix
 * (x4-confirmation-followup.test.ts):
 *
 *  - Defect A (history truncation): `findLatestProfileConfirmation` fetched only the 5 most
 *    recent TERMINAL AgentWorkflowSession rows before filtering for a real profile proposal —
 *    six newer, unrelated terminal workflows could hide an older, genuinely completed profile
 *    confirmation. Fixed with a single DB-level query (no take/window truncation).
 *  - Defect B (wrong action timestamp): the merge compared FitnessAgentAction.createdAt (never
 *    changes after creation) instead of a real last-transition time, so a cancellation that
 *    happened AFTER a profile confirmation still looked older than it. Fixed by adding a real
 *    `updatedAt` column (Prisma `@updatedAt`, mirrors AgentWorkflowSession's own) and comparing
 *    that instead.
 *
 * This file does not modify or replace Codex's own evidence
 * (test/conversational-intelligence/results/codex-final-followup/*) — it is a separate,
 * independently-authored regression. Codex's own reproduction test
 * (src/__tests__/codex-x4-resolution-independent.test.ts) is run unmodified except for one
 * schema-consistency fixture fix (explicit `updatedAt` on a directly-inserted row — see that
 * file's own comment) required by Defect B's new column; no assertion in it was changed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent } from "../services/fitness-agent.service";
import { workflowStateRepository } from "../agent-workflow/workflow-state.repository";

test.after(async () => { await prisma.$disconnect(); });

const identity = (userId: string) => ({ userId, authorizationHeader: "Bearer test" });
const newSession = (userId: string) => prisma.chatSession.create({ data: { userId, title: "x4 ordering" } });
const cleanup = async (userId: string, sessionId: string) => {
  await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
  await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
  await prisma.chatSession.delete({ where: { id: sessionId } });
};
const ago = (ms: number) => new Date(Date.now() - ms);
const future = () => new Date(Date.now() + 600000);
const seedAction = (userId: string, sessionId: string, status: string, expiresAt: Date, createdAt: Date, updatedAt: Date = createdAt) =>
  prisma.fitnessAgentAction.create({ data: { userId, sessionId, recommendationId: null, kind: "CREATE_WORKOUT_PLAN", risk: "MEDIUM", payload: { weeklySchedule: [] }, status, expiresAt, createdAt, updatedAt } });
const seedProfileWorkflow = (userId: string, sessionId: string, status: string, updatedAt: Date) =>
  prisma.agentWorkflowSession.create({
    data: { userId, sessionId, workflowType: "UPDATE_GOAL", status, pendingProfileUpdate: [{ slotKey: "goal", profileField: "goal", oldValue: "MUSCLE_GAIN", newValue: "WEIGHT_LOSS" }] as any, expiresAt: future(), updatedAt, createdAt: new Date(updatedAt.getTime() - 60000) },
  });
// pendingProfileUpdate is deliberately OMITTED (never set to an explicit `null`): real production code
// (workflowStateRepository.create()) never writes this field for a bare slot-collection workflow either, leaving
// it a genuine SQL NULL. An explicit `pendingProfileUpdate: null` in a Prisma create() instead stores a JSON
// "null" literal (verified: `pending_profile_update IS NULL` is FALSE for that row) — a different, unrealistic
// on-disk state no real bare workflow ever has, which would wrongly defeat findLatestProfileConfirmation's
// `{ not: Prisma.DbNull }` filter in this fixture alone (not a production bug — production never sets it at all).
const seedBareWorkflow = (userId: string, sessionId: string, updatedAt: Date) =>
  prisma.agentWorkflowSession.create({ data: { userId, sessionId, workflowType: "CREATE_WORKOUT_PLAN", status: "CANCELLED", expiresAt: future(), updatedAt, createdAt: new Date(updatedAt.getTime() - 60000) } });

// ───────────────────────── Defect A: history truncation ─────────────────────────
test("X4 ordering — Defect A: 6 newer unrelated terminal workflows must not hide an older completed profile confirmation", async () => {
  const userId = `x4o-a-${randomUUID()}`; const s = await newSession(userId);
  await seedProfileWorkflow(userId, s.id, "COMPLETED", ago(600000)); // the real, older, relevant confirmation
  for (let i = 1; i <= 6; i++) await seedBareWorkflow(userId, s.id, ago(600000 - i * 1000)); // 6 newer, irrelevant, terminal
  try {
    const found = await workflowStateRepository.findLatestProfileConfirmation(userId, s.id);
    assert.ok(found, "the relevant older completed profile confirmation must still be found");
    assert.equal(found!.status, "COMPLETED");
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /^Rồi/, "the legitimate completed confirmation must remain discoverable and truthfully reported");
  } finally { await cleanup(userId, s.id); }
});

test("X4 ordering — Defect A: more than 5 unrelated terminal workflows total, real DB-level query, no take/window truncation", async () => {
  const userId = `x4o-a2-${randomUUID()}`; const s = await newSession(userId);
  for (let i = 1; i <= 8; i++) await seedBareWorkflow(userId, s.id, ago(i * 1000)); // 8 unrelated terminal rows, none relevant
  await seedProfileWorkflow(userId, s.id, "CANCELLED", ago(9000)); // the one relevant row, older than all 8
  try {
    const found = await workflowStateRepository.findLatestProfileConfirmation(userId, s.id);
    assert.ok(found, "must still find the one relevant row among 8 unrelated newer ones");
    assert.equal(found!.status, "CANCELLED");
  } finally { await cleanup(userId, s.id); }
});

// ───────────────────────── Defect B: wrong action timestamp ─────────────────────────
test("X4 ordering — Defect B: an action cancelled via the REAL dismissDraft path AFTER a profile confirmation is recognized as newer", async () => {
  const userId = `x4o-b-${randomUUID()}`; const s = await newSession(userId);
  const action = await seedAction(userId, s.id, "PENDING", future(), ago(1200000)); // created long ago, still open
  await seedProfileWorkflow(userId, s.id, "COMPLETED", ago(600000)); // profile confirmed in between
  const before = await prisma.fitnessAgentAction.count({ where: { userId } });
  const dismissResult = await fitnessAgent.dismissDraft(identity(userId), action.id); // the REAL cancellation path, now (newest event)
  assert.match((dismissResult as any).message, /Đã bỏ qua/);
  try {
    const after = await prisma.fitnessAgentAction.findUnique({ where: { id: action.id } });
    assert.equal(after!.status, "CANCELLED");
    assert.ok(after!.updatedAt.getTime() > after!.createdAt.getTime(), "updatedAt must reflect the real cancellation, not the original creation time");
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /đã được bỏ qua/, "the real, newer cancellation must govern — not the older completed profile confirmation");
    assert.equal(await prisma.fitnessAgentAction.count({ where: { userId } }), before, "no unauthorized/extra action row created by dismissing");
  } finally { await cleanup(userId, s.id); }
});

test("X4 ordering — reverse of Defect B: a newer completed profile confirmation is not shadowed by an older cancelled action", async () => {
  const userId = `x4o-b2-${randomUUID()}`; const s = await newSession(userId);
  await seedAction(userId, s.id, "CANCELLED", future(), ago(1200000), ago(1200000)); // cancelled long ago (createdAt===updatedAt, a real terminal-at-creation row)
  await seedProfileWorkflow(userId, s.id, "COMPLETED", ago(60000)); // confirmed much more recently
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /^Rồi/, "the newer completed profile confirmation must govern");
  } finally { await cleanup(userId, s.id); }
});

// ───────────────────────── Additional regression required by the mandate ─────────────────────────
test("X4 ordering — closely-spaced/equal timestamps: deterministic, still grounded in real timestamps (never fabricated)", async () => {
  const userId = `x4o-tie-${randomUUID()}`; const s = await newSession(userId);
  const t = ago(60000);
  await seedAction(userId, s.id, "CANCELLED", future(), t, t);
  await seedProfileWorkflow(userId, s.id, "COMPLETED", t); // exact tie
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    // deterministic tie-break (profile workflow wins on >=) — documented, not a guess: the answer must be ONE of
    // the two truthful, DB-grounded options, never a fabricated success and never the old "NONE" false denial.
    assert.ok(/^Rồi/.test(r!.answer) || /đã được bỏ qua/.test(r!.answer), r!.answer);
    assert.doesNotMatch(r!.answer, /Chưa có thay đổi nào được lưu/i);
  } finally { await cleanup(userId, s.id); }
});

test("X4 ordering — multiple action AND workflow events in one session: only the truly latest relevant event governs", async () => {
  const userId = `x4o-multi-${randomUUID()}`; const s = await newSession(userId);
  await seedAction(userId, s.id, "COMPLETED", future(), ago(900000), ago(900000));
  await seedProfileWorkflow(userId, s.id, "COMPLETED", ago(600000));
  await seedAction(userId, s.id, "CANCELLED", future(), ago(300000), ago(300000)); // a SECOND, newer action row
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /đã được bỏ qua/, "the newest action row (CANCELLED) governs over both older events");
  } finally { await cleanup(userId, s.id); }
});

test("X4 ordering — cross-user/session isolation still holds after the ordering fix", async () => {
  const a = `x4o-cu-a-${randomUUID()}`; const b = `x4o-cu-b-${randomUUID()}`;
  const sa = await newSession(a); const sb = await newSession(b);
  for (let i = 1; i <= 6; i++) await seedBareWorkflow(a, sa.id, ago(i * 1000));
  await seedProfileWorkflow(a, sa.id, "COMPLETED", ago(7000));
  try {
    assert.equal(await workflowStateRepository.findLatestProfileConfirmation(b, sb.id), null, "user B sees none of user A's history");
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(b), sb.id);
    assert.match(r!.answer, /Chưa có thay đổi nào được lưu/);
  } finally { await cleanup(a, sa.id); await cleanup(b, sb.id); }
});

// ───────────────────────── Golden A-D (mandate) ─────────────────────────
test("Golden A: profile confirmed, then 6 unrelated terminal workflows, then asked if the earlier update was saved — still discoverable", async () => {
  const userId = `x4o-golden-a-${randomUUID()}`; const s = await newSession(userId);
  await seedProfileWorkflow(userId, s.id, "COMPLETED", ago(500000));
  for (let i = 1; i <= 6; i++) await seedBareWorkflow(userId, s.id, ago(500000 - i * 1000));
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /^Rồi/);
  } finally { await cleanup(userId, s.id); }
});

test("Golden B: action created, profile confirmed, action cancelled via the real path afterwards — cancellation recognized as newer", async () => {
  const userId = `x4o-golden-b-${randomUUID()}`; const s = await newSession(userId);
  const action = await seedAction(userId, s.id, "PENDING", future(), ago(900000));
  await seedProfileWorkflow(userId, s.id, "COMPLETED", ago(300000));
  await fitnessAgent.dismissDraft(identity(userId), action.id);
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /đã được bỏ qua/);
  } finally { await cleanup(userId, s.id); }
});

test("Golden C: reversed order — a newer completed profile confirmation is not shadowed by an older cancelled action", async () => {
  const userId = `x4o-golden-c-${randomUUID()}`; const s = await newSession(userId);
  await seedAction(userId, s.id, "CANCELLED", future(), ago(900000), ago(900000));
  await seedProfileWorkflow(userId, s.id, "COMPLETED", ago(60000));
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /^Rồi/);
  } finally { await cleanup(userId, s.id); }
});

test("Golden D: repeated confirmation/status questions — no duplicate write, no false success, no false denial", async () => {
  const userId = `x4o-golden-d-${randomUUID()}`; const s = await newSession(userId);
  await seedProfileWorkflow(userId, s.id, "COMPLETED", ago(60000));
  try {
    const r1 = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    const r2 = await fitnessAgent.tryConfirmationBoundary("Xác nhận cập nhật.", identity(userId), s.id);
    const r3 = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    for (const r of [r1, r2, r3]) { assert.doesNotMatch(r!.answer, /Chưa có thay đổi nào được lưu/i); assert.deepEqual(r!.blocks, []); }
    assert.equal(await prisma.agentWorkflowSession.count({ where: { userId } }), 1, "no duplicate workflow/write from repeated questions");
  } finally { await cleanup(userId, s.id); }
});

// ───────────────────────── Codex's final-audit finding: action selection ordered by createdAt, not updatedAt ─────────────────────────
// docs/codex-full-conversational-intelligence-audit.md "X4 Confirmation Truthfulness": tryConfirmationBoundary's
// own FitnessAgentAction query used `orderBy: { createdAt: "desc" }` and then read `actions[0]` as "the latest" —
// correct ONLY when creation order and last-update order agree. Action A (created earlier, updated/cancelled
// LATER) vs Action B (created LATER, but its own completion event happened EARLIER) is the case where they
// diverge: by createdAt, B ranks first (wrong — the merge then reports B's COMPLETED as truth); by updatedAt, A
// correctly ranks first (A's cancellation really is the newest real event). This is Codex's exact "Case C".
test("X4 ordering — Codex final-audit Case C: action selection must follow updatedAt (latest EVENT), not createdAt (newest-created ROW)", async () => {
  const userId = `x4o-codexc-${randomUUID()}`; const s = await newSession(userId);
  // Action A: created first (ago 10min), but its cancellation (updatedAt) happens LAST (ago 1min) — the newest real event.
  await seedAction(userId, s.id, "CANCELLED", future(), ago(600000), ago(60000));
  // Action B: created SECOND (ago 5min — newer createdAt than A), but completed EARLIER (ago 3min) than A's cancellation.
  await seedAction(userId, s.id, "COMPLETED", future(), ago(300000), ago(180000));
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /đã được bỏ qua/, "Action A's newer cancellation (the real latest event) must govern, not Action B's newer-created-but-older-completed row");
  } finally { await cleanup(userId, s.id); }
});

test("X4 ordering — Case C reversed: a later-created but earlier-completed action must not be shadowed by an earlier-created, later-cancelled one reporting success", async () => {
  const userId = `x4o-codexc2-${randomUUID()}`; const s = await newSession(userId);
  // Action A: created first (ago 10min), cancelled EARLY (ago 8min) — its own last event is OLDER.
  await seedAction(userId, s.id, "CANCELLED", future(), ago(600000), ago(480000));
  // Action B: created SECOND (ago 5min), completed LATER (ago 1min) — the real newest event overall.
  await seedAction(userId, s.id, "COMPLETED", future(), ago(300000), ago(60000));
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /^Rồi/, "Action B's newer completion (the real latest event) must govern");
  } finally { await cleanup(userId, s.id); }
});

// ───────────────────────── Codex final sign-off finding: X4-T10 (take:10 window hides a live PENDING action) ─────────────────────────
// docs/codex-conversational-intelligence-final-signoff.md "New Blocking Finding: X4-T10": tryConfirmationBoundary's
// FitnessAgentAction query added `take: 10` (orderBy updatedAt desc) as part of the prior event-ordering fix. A
// still-live PENDING action ranked 11th by updatedAt (older than 10 newer terminal rows) was silently excluded from
// the fetched set, so deriveConfirmationState's "any live PENDING wins" scan never saw it at all — not a
// precedence bug, a visibility bug. The fix replaces the single windowed query with two targeted, semantically-
// scoped queries (see fitness-agent.service.ts): one for ANY live PENDING/EXECUTING row (no window needed — the
// WHERE clause itself bounds the result to the small live subset), and only when that is empty, a single
// `findFirst` (inherently take:1, never truncating) for the latest terminal event. No arbitrary `take: N` window
// determines correctness anymore.
test("X4-T10 — Codex final sign-off: a live PENDING action ranked 11th by updatedAt must still be detected (exact reproduction)", async () => {
  const userId = `x4t10-exact-${randomUUID()}`; const s = await newSession(userId);
  await seedAction(userId, s.id, "PENDING", future(), ago(900000)); // the one live pending row — OLDEST updatedAt of all 11
  for (let i = 1; i <= 10; i++) await seedAction(userId, s.id, "COMPLETED", future(), ago(900000 - i * 10000), ago(900000 - i * 10000)); // 10 newer COMPLETED rows
  try {
    assert.equal(await prisma.fitnessAgentAction.count({ where: { userId } }), 11, "setup sanity: 11 rows total");
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /Chưa — mình chưa lưu gì cả/, "the live pending confirmation must still be truthfully reported, not hidden behind 10 newer terminal rows");
  } finally { await cleanup(userId, s.id); }
});

test("X4-T10 — beyond ten: a live PENDING action must still be detected behind 25 newer terminal rows", async () => {
  const userId = `x4t10-25-${randomUUID()}`; const s = await newSession(userId);
  await seedAction(userId, s.id, "PENDING", future(), ago(2000000));
  for (let i = 1; i <= 25; i++) await seedAction(userId, s.id, "COMPLETED", future(), ago(2000000 - i * 10000), ago(2000000 - i * 10000));
  try {
    assert.equal(await prisma.fitnessAgentAction.count({ where: { userId } }), 26);
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /Chưa — mình chưa lưu gì cả/, "no number of newer terminal rows may hide a live pending action");
  } finally { await cleanup(userId, s.id); }
});

test("X4-T10 — reverse: no live pending action among many terminal rows; the latest terminal lifecycle event is used", async () => {
  const userId = `x4t10-reverse-${randomUUID()}`; const s = await newSession(userId);
  for (let i = 1; i <= 15; i++) await seedAction(userId, s.id, "COMPLETED", future(), ago(2000000 - i * 10000), ago(2000000 - i * 10000));
  // the single newest row overall (smallest ago) is CANCELLED — must govern over the 14 older COMPLETED rows
  await seedAction(userId, s.id, "CANCELLED", future(), ago(10000), ago(10000));
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /đã được bỏ qua/, "the latest terminal event (CANCELLED) must govern regardless of how many older terminal rows exist");
  } finally { await cleanup(userId, s.id); }
});

test("X4-T10 — EXECUTING precedence: an older in-flight EXECUTING action remains authoritative behind many newer terminal rows", async () => {
  const userId = `x4t10-executing-${randomUUID()}`; const s = await newSession(userId);
  await seedAction(userId, s.id, "EXECUTING", future(), ago(900000));
  for (let i = 1; i <= 12; i++) await seedAction(userId, s.id, "COMPLETED", future(), ago(900000 - i * 10000), ago(900000 - i * 10000));
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /đang được lưu/, "an in-flight EXECUTING action must remain authoritative, not be hidden behind newer terminal rows");
  } finally { await cleanup(userId, s.id); }
});

test("X4-T10 — expired-by-time PENDING must not be treated as live even when it is the only/most-recent row", async () => {
  const userId = `x4t10-expired-${randomUUID()}`; const s = await newSession(userId);
  await seedAction(userId, s.id, "PENDING", ago(60000), ago(120000)); // expiresAt in the past — stale, never confirmed
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(userId), s.id);
    assert.match(r!.answer, /đã hết hạn/, "a persisted-PENDING-but-time-expired row must be reported as expired, never as live");
  } finally { await cleanup(userId, s.id); }
});

test("X4-T10 — cross-user/session isolation: a foreign user's live pending action (behind 10 terminal rows of their own) never affects another user's answer", async () => {
  const a = `x4t10-cu-a-${randomUUID()}`; const b = `x4t10-cu-b-${randomUUID()}`;
  const sa = await newSession(a); const sb = await newSession(b);
  await seedAction(a, sa.id, "PENDING", future(), ago(900000));
  for (let i = 1; i <= 10; i++) await seedAction(a, sa.id, "COMPLETED", future(), ago(900000 - i * 10000), ago(900000 - i * 10000));
  try {
    const r = await fitnessAgent.tryConfirmationBoundary("Đã lưu thành công chưa?", identity(b), sb.id);
    assert.match(r!.answer, /Chưa có thay đổi nào được lưu/, "user B's own empty session must never see user A's pending action");
  } finally { await cleanup(a, sa.id); await cleanup(b, sb.id); }
});
