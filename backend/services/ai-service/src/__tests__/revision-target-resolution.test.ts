/**
 * Phase 3 Batch 4 — target-resolution priority ladder (brief §9), real test DB.
 *
 * NOTE on how this is actually used: during implementation, the PT/PROGRAM revision module
 * (pt-program-revision.ts) was found to need a MORE PRECISE check than this generic ladder — an
 * unrelated pending WORKOUT/NUTRITION draft must never block a clearly PT/PROGRAM-signaled revision
 * (proven by the cross-domain route-parity test), so that module queries the latest PT/PROGRAM
 * fitnessRecommendation directly instead of going through tier-1 first. This module remains the
 * tested, documented general-purpose priority ladder the brief specifies (useful for a future
 * cross-domain "ambiguous target" clarification layer) — see docs/ai-product/
 * phase3-batch4-conversational-revision.md for the full reasoning.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { resolveRevisionTarget } from "../services/revision/target-resolution";

test.after(async () => { await prisma.$disconnect(); });
const newSession = async (userId: string) => prisma.chatSession.create({ data: { userId, title: "target resolution" } });

test("T05 (no signal at all): no pending draft, no recommendation -> UNKNOWN, never guessed", async () => {
  const userId = `u-${randomUUID()}`;
  const session = await newSession(userId);
  try {
    const target = await resolveRevisionTarget({ userId } as any, session.id);
    assert.deepEqual(target, { class: "UNKNOWN" });
  } finally { await prisma.chatSession.delete({ where: { id: session.id } }); }
});

test("tier 1: a pending CREATE_WORKOUT_PLAN draft resolves to WORKOUT_DRAFT with its real actionId", async () => {
  const userId = `u-${randomUUID()}`;
  const session = await newSession(userId);
  const action = await prisma.fitnessAgentAction.create({ data: { userId, sessionId: session.id, kind: "CREATE_WORKOUT_PLAN", risk: "MEDIUM", payload: {}, expiresAt: new Date(Date.now() + 60000) } });
  try {
    const target = await resolveRevisionTarget({ userId } as any, session.id);
    assert.deepEqual(target, { class: "WORKOUT_DRAFT", actionId: action.id });
  } finally { await prisma.fitnessAgentAction.deleteMany({ where: { userId } }); await prisma.chatSession.delete({ where: { id: session.id } }); }
});

test("tier 1 takes priority over tier 2: a pending NUTRITION draft wins even when a PT recommendation also exists", async () => {
  const userId = `u-${randomUUID()}`;
  const session = await newSession(userId);
  await prisma.fitnessRecommendation.create({ data: { id: randomUUID(), userId, sessionId: session.id, type: "PT", contextSnapshot: {}, candidateIds: ["pt-1"], scoringVersion: "v1", similarityVersion: "v1", evidenceIds: [], historicalJourneyIds: [], result: {} } });
  const action = await prisma.fitnessAgentAction.create({ data: { userId, sessionId: session.id, kind: "CREATE_NUTRITION_PLAN", risk: "MEDIUM", payload: {}, expiresAt: new Date(Date.now() + 60000) } });
  try {
    const target = await resolveRevisionTarget({ userId } as any, session.id);
    assert.deepEqual(target, { class: "NUTRITION_DRAFT", actionId: action.id });
  } finally { await prisma.fitnessAgentAction.deleteMany({ where: { userId } }); await prisma.fitnessRecommendation.deleteMany({ where: { userId } }); await prisma.chatSession.delete({ where: { id: session.id } }); }
});

test("tier 2: the latest PT/PROGRAM recommendation resolves with its real candidateIds when no draft is pending", async () => {
  const userId = `u-${randomUUID()}`;
  const session = await newSession(userId);
  const rec = await prisma.fitnessRecommendation.create({ data: { id: randomUUID(), userId, sessionId: session.id, type: "PROGRAM", contextSnapshot: {}, candidateIds: ["prog-1", "prog-2"], scoringVersion: "v1", similarityVersion: "v1", evidenceIds: [], historicalJourneyIds: [], result: {} } });
  try {
    const target = await resolveRevisionTarget({ userId } as any, session.id);
    assert.deepEqual(target, { class: "PROGRAM_RECOMMENDATION", recommendationId: rec.id, candidateIds: ["prog-1", "prog-2"] });
  } finally { await prisma.fitnessRecommendation.deleteMany({ where: { userId } }); await prisma.chatSession.delete({ where: { id: session.id } }); }
});

test("an EXPIRED draft is never resolved as the current target", async () => {
  const userId = `u-${randomUUID()}`;
  const session = await newSession(userId);
  await prisma.fitnessAgentAction.create({ data: { userId, sessionId: session.id, kind: "CREATE_WORKOUT_PLAN", risk: "MEDIUM", payload: {}, expiresAt: new Date(Date.now() - 1000) } });
  try {
    const target = await resolveRevisionTarget({ userId } as any, session.id);
    assert.deepEqual(target, { class: "UNKNOWN" });
  } finally { await prisma.fitnessAgentAction.deleteMany({ where: { userId } }); await prisma.chatSession.delete({ where: { id: session.id } }); }
});

test("cross-user isolation: resolution is always scoped to the caller's own identity, never another user's draft/recommendation", async () => {
  const userA = `u-a-${randomUUID()}`;
  const userB = `u-b-${randomUUID()}`;
  const sessionA = await newSession(userA);
  await prisma.fitnessAgentAction.create({ data: { userId: userA, sessionId: sessionA.id, kind: "CREATE_WORKOUT_PLAN", risk: "MEDIUM", payload: {}, expiresAt: new Date(Date.now() + 60000) } });
  try {
    const target = await resolveRevisionTarget({ userId: userB } as any, sessionA.id);
    assert.deepEqual(target, { class: "UNKNOWN" });
  } finally { await prisma.fitnessAgentAction.deleteMany({ where: { userId: userA } }); await prisma.chatSession.delete({ where: { id: sessionA.id } }); }
});
