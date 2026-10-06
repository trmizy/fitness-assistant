/**
 * PT budget is OPTIONAL for agent candidate search. The AI Coach resolves an explicit "không giới hạn" (no budget cap) answer to an
 * absent budgetVnd; user-service used to REQUIRE it (422), which the chat surfaced as HTTP 500 for the exact wording the assistant
 * itself suggests (found by the full chat verification, docs/ai-chat-multi-agent-full-verification.md).
 * Real user test DB; goal and days stay REQUIRED.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { agenticFitnessService } from "../services/agentic-fitness.service";
import { prisma } from "../repositories/profile.repository";

const url = process.env.DATABASE_URL ?? "";
const skip = /(_test|postgres-test)/i.test(url) ? false : "Set DATABASE_URL to a *_test database";

test("candidates(): no budget is accepted (no cap) and returns a valid (possibly empty) result instead of throwing", { skip }, async () => {
  const userId = `optbudget-${randomUUID()}`;
  await prisma.userProfile.create({ data: { userId, goal: "WEIGHT_LOSS", experienceLevel: "BEGINNER", age: 30, gender: "MALE", heightCm: 175, currentWeight: 80 } as any });
  try {
    const result = await agenticFitnessService.candidates(userId, { goal: "WEIGHT_LOSS", days: [1, 3], sessionMinutes: 60, demo: false });
    assert.ok(Array.isArray(result.candidates));
    assert.equal(result.preferences.budgetVnd, undefined, "no fake budget was injected");
  } finally { await prisma.userProfile.deleteMany({ where: { userId } }); }
});

test("candidates(): goal and training days are still required (422)", { skip }, async () => {
  const userId = `optbudget-${randomUUID()}`;
  await prisma.userProfile.create({ data: { userId, experienceLevel: "BEGINNER" } as any });
  try {
    await assert.rejects(() => agenticFitnessService.candidates(userId, { days: [1], sessionMinutes: 60, demo: false }), (e: any) => e.status === 422);
    await assert.rejects(() => agenticFitnessService.candidates(userId, { goal: "WEIGHT_LOSS", sessionMinutes: 60, demo: false }), (e: any) => e.status === 422);
  } finally { await prisma.userProfile.deleteMany({ where: { userId } }); }
});
