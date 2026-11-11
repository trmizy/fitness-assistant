/**
 * Phase 3 Batch 4 — PT/PROGRAM recommendation revision. Real test DB for the `fitnessRecommendation`
 * row (target-resolution.ts reads it directly, same convention as the rest of this codebase); the
 * retrieval/scoring/narration pipeline itself is injected (`deps.build`) — stubbed here, proven for
 * real in the existing recommend-flow regression tests this batch did not touch.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { tryReviseRecommendation, type PtProgramRevisionDeps } from "../services/revision/pt-program-revision";

test.after(async () => { await prisma.$disconnect(); });

async function seedSession(userId: string) {
  return prisma.chatSession.create({ data: { userId, title: "revision pt/program" } });
}
async function seedRecommendation(userId: string, sessionId: string, type: "PT" | "PROGRAM", candidateIds: string[], excludeIds: string[] = []) {
  return prisma.fitnessRecommendation.create({
    data: {
      id: randomUUID(), userId, sessionId, type,
      contextSnapshot: { preferences: { goal: "MUSCLE_GAIN", days: [1, 3, 5], sessionMinutes: 60, budgetVnd: 1500000 }, excludeIds },
      candidateIds, scoringVersion: "v1", similarityVersion: "v1", evidenceIds: [], historicalJourneyIds: [],
      result: { type: type === "PT" ? "PT_RECOMMENDATIONS" : "PROGRAM_RECOMMENDATIONS", candidates: candidateIds.map((id) => ({ id })) },
    },
  });
}
const cleanup = async (userId: string, sessionId: string) => {
  await prisma.fitnessRecommendation.deleteMany({ where: { userId } });
  await prisma.chatSession.delete({ where: { id: sessionId } });
};

function stubDeps(buildResult: { answer: string; blocks: any[] } = { answer: "Đây là các lựa chọn phù hợp.", blocks: [{ type: "PT_RECOMMENDATIONS", candidates: [{ id: "pt-3" }, { id: "pt-4" }] }] }) {
  const calls: { excludeIds?: string[]; preferences?: any }[] = [];
  const deps: PtProgramRevisionDeps = {
    getUserFitnessContext: async () => ({ profile: { goal: "MUSCLE_GAIN" }, coach: {} }),
    build: async (_i, _s, _k, preferences, _c, excludeIds) => { calls.push({ excludeIds, preferences }); return buildResult; },
  };
  return { deps, calls };
}

test("T08: a message with no 'pt'/'chương trình' keyword but a budget refinement is NOT handled here (no ordinal+exclude, no PT keyword) — falls through", async () => {
  const userId = `u-${randomUUID()}`;
  const session = await seedSession(userId);
  await seedRecommendation(userId, session.id, "PT", ["pt-1", "pt-2"]);
  const { deps } = stubDeps();
  try {
    // "PT đầu tiên đắt quá, dưới 2 triệu thôi" contains "pt" -> handled by the EXISTING legacy
    // recommend-flow branch (already proven), not this module. This module only needs to step in for
    // turns the legacy parser's kind stays null for — verified by this returning null when neither an
    // exclude+ordinal nor a recognized constraint phrase is present in a PT-keyword-free message.
    const result = await tryReviseRecommendation("Người đó có vẻ ổn.", { userId } as any, session.id, deps);
    assert.equal(result, null);
  } finally { await cleanup(userId, session.id); }
});

test("T09: 'Không thích người thứ hai, còn ai khác?' excludes candidate #2 and reruns the real pipeline with excludeIds carried", async () => {
  const userId = `u-${randomUUID()}`;
  const session = await seedSession(userId);
  await seedRecommendation(userId, session.id, "PT", ["pt-1", "pt-2", "pt-3"]);
  const { deps, calls } = stubDeps();
  try {
    const result = await tryReviseRecommendation("Không thích người thứ hai, còn ai khác?", { userId } as any, session.id, deps);
    assert.ok(result, "must produce a revised answer");
    assert.match(result!.answer, /bỏ lựa chọn bạn không thích/);
    assert.deepEqual(calls[0].excludeIds, ["pt-2"], "the SECOND candidate id must be excluded, never guessed");
  } finally { await cleanup(userId, session.id); }
});

test("T10: an ordinal reference to a position beyond the candidate list is a clarification, never a hallucinated exclusion", async () => {
  const userId = `u-${randomUUID()}`;
  const session = await seedSession(userId);
  await seedRecommendation(userId, session.id, "PT", ["pt-1", "pt-2"]);
  const { deps, calls } = stubDeps();
  try {
    const result = await tryReviseRecommendation("Không thích người thứ năm.", { userId } as any, session.id, deps);
    assert.ok(result);
    assert.match(result!.answer, /chưa xác định được/);
    assert.equal(calls.length, 0, "the pipeline must never be re-run for an unresolved reference");
  } finally { await cleanup(userId, session.id); }
});

test("T11/T12 (PROGRAM): exclusion works identically for PROGRAM recommendations, same mechanism as PT", async () => {
  const userId = `u-${randomUUID()}`;
  const session = await seedSession(userId);
  await seedRecommendation(userId, session.id, "PROGRAM", ["prog-1", "prog-2"]);
  const { deps, calls } = stubDeps({ answer: "Đây là các lựa chọn phù hợp.", blocks: [{ type: "PROGRAM_RECOMMENDATIONS", candidates: [{ id: "prog-3" }] }] });
  try {
    const result = await tryReviseRecommendation("Không thích chương trình thứ nhất.", { userId } as any, session.id, deps);
    assert.ok(result);
    assert.deepEqual(calls[0].excludeIds, ["prog-1"]);
  } finally { await cleanup(userId, session.id); }
});

test("a constraint-only refinement (days changed) with no exclusion still reruns the pipeline, carrying forward any PRIOR exclusion", async () => {
  const userId = `u-${randomUUID()}`;
  const session = await seedSession(userId);
  await seedRecommendation(userId, session.id, "PT", ["pt-1", "pt-2"], ["pt-9"]); // a prior exclusion already on file
  const { deps, calls } = stubDeps();
  try {
    const result = await tryReviseRecommendation("Tôi tập được thứ 2, 4, 6 thôi.", { userId } as any, session.id, deps);
    assert.ok(result);
    assert.deepEqual(calls[0].excludeIds, ["pt-9"], "a prior exclusion must survive a constraint-only revision");
  } finally { await cleanup(userId, session.id); }
});

// Phase 3 Batch 5 defect (found by the unified-coach E2E suite, journey 4): a bare session-COUNT
// phrase ("4 buổi thôi") produced no constraint change at all — parseConstraintPhrase's own `days`
// extraction only recognizes explicit weekday mentions ("T2, T4, T6"), never a count. Fixed by
// deriving a days array from the previous recommendation's own days, truncated/extended to the count.
test("Batch 5 regression: a bare day-COUNT phrase ('4 buổi thôi') truncates the previous days array to 4, never silently doing nothing", async () => {
  const userId = `u-${randomUUID()}`;
  const session = await seedSession(userId);
  await seedRecommendation(userId, session.id, "PROGRAM", ["prog-1", "prog-2"]); // previous days: [1,3,5] (3 days)
  const { deps, calls } = stubDeps({ answer: "ok", blocks: [{ type: "PROGRAM_RECOMMENDATIONS", candidates: [] }] });
  try {
    const result = await tryReviseRecommendation("4 buổi thôi.", { userId } as any, session.id, deps);
    assert.ok(result, "must be recognized as a revision, not fall through to generic chat");
    assert.deepEqual(calls[0].preferences.days.length, 4, "the day COUNT must actually change what's searched");
  } finally { await cleanup(userId, session.id); }
});

test("a bare day-count phrase that happens to also contain a budget number ('dưới 2 triệu thôi') never misreads the budget digit as a session count", async () => {
  const userId = `u-${randomUUID()}`;
  const session = await seedSession(userId);
  await seedRecommendation(userId, session.id, "PT", ["pt-1", "pt-2"]);
  const { deps, calls } = stubDeps();
  try {
    const result = await tryReviseRecommendation("dưới 2 triệu thôi", { userId } as any, session.id, deps);
    assert.ok(result);
    assert.deepEqual(calls[0].preferences.days, [1, 3, 5], "days must stay exactly what they were — never truncated by a misread budget digit");
    assert.equal(calls[0].preferences.budgetVnd, 2000000);
  } finally { await cleanup(userId, session.id); }
});

test("safety: no recommendation exists for this session at all -> null, never a fabricated target", async () => {
  const userId = `u-${randomUUID()}`;
  const session = await seedSession(userId);
  const { deps, calls } = stubDeps();
  try {
    const result = await tryReviseRecommendation("Không thích người thứ hai.", { userId } as any, session.id, deps);
    assert.equal(result, null);
    assert.equal(calls.length, 0);
  } finally { await prisma.chatSession.delete({ where: { id: session.id } }); }
});

test("cross-user isolation: user B can never resolve or revise user A's recommendation", async () => {
  const userA = `u-a-${randomUUID()}`;
  const userB = `u-b-${randomUUID()}`;
  const sessionA = await seedSession(userA);
  await seedRecommendation(userA, sessionA.id, "PT", ["pt-1", "pt-2"]);
  const { deps, calls } = stubDeps();
  try {
    // userB, same sessionId string (pretend leaked/guessed) — target-resolution scopes by userId too.
    const result = await tryReviseRecommendation("Không thích người thứ hai.", { userId: userB } as any, sessionA.id, deps);
    assert.equal(result, null, "a different user's identity must never resolve to someone else's recommendation");
    assert.equal(calls.length, 0);
  } finally { await cleanup(userA, sessionA.id); }
});
