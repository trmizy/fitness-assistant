/**
 * MOBILE_BACKEND_GAPS.md GAP-17 — FIND_TRAINING_PROGRAM with no experience level on file.
 *
 * fitness-service's program search refuses without UserProfile.experienceLevel (422 "Provide
 * goal, training days and experience level"), and the workflow used to collect only goal +
 * days — so such a client answered both and then hit a generic error. The workflow now asks
 * for the level too, and because fitness-service reads the REAL profile, the answer is a
 * PROFILE_FACT that goes through the usual PROFILE_UPDATE_CONFIRMATION before the search runs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";
import { parseExperienceLevel } from "../agent-workflow/slot-values";

const original = {
  getUserFitnessContext: fitnessAgentDeps.tools.getUserFitnessContext,
  findTrainingPrograms: fitnessAgentDeps.tools.findTrainingPrograms,
  getScientificEvidence: fitnessAgentDeps.tools.getScientificEvidence,
  updateProfileFields: fitnessAgentDeps.tools.updateProfileFields,
};

test.afterEach(() => {
  Object.assign(fitnessAgentDeps.tools, original);
});
test.after(async () => {
  await prisma.$disconnect();
});

test("parseExperienceLevel: Vietnamese levels, and never reads 'mỗi buổi' as 'mới tập'", () => {
  assert.deepEqual(parseExperienceLevel("mới tập"), { ok: true, value: "BEGINNER" });
  assert.deepEqual(parseExperienceLevel("Trung bình"), { ok: true, value: "INTERMEDIATE" });
  assert.deepEqual(parseExperienceLevel("nâng cao"), { ok: true, value: "ADVANCED" });
  assert.equal(parseExperienceLevel("mỗi buổi 60 phút").ok, false);
});

test("FIND_TRAINING_PROGRAM (real DB): no experience on file → asks for it, confirms the profile write, then searches", async () => {
  let experience: string | null = null;
  fitnessAgentDeps.tools.getUserFitnessContext = async () =>
    ({
      profile: {
        goal: null, experience, experienceLevel: experience, days: [], sessionMinutes: 60, budgetVnd: null,
        reviewRequired: false, injuries: [], equipment: [], goalIntent: null,
      },
      coach: { training_summary: {}, nutrition_summary: {} },
    }) as any;
  const written: Array<Record<string, unknown>> = [];
  fitnessAgentDeps.tools.updateProfileFields = async (_identity: any, fields: any) => {
    written.push(fields);
    if (fields.experienceLevel) experience = fields.experienceLevel;
    return {} as any;
  };
  let searched = null as any;
  fitnessAgentDeps.tools.findTrainingPrograms = async (_identity: any, preferences: any) => {
    searched = preferences;
    return {
      programs: [{ id: "prog-exp", name: "Program", goal: preferences.goal, daysPerWeek: 2, durationWeeks: 8, estimatedMinutes: 60,
        experienceLevel: "BEGINNER", focusMuscles: [], fingerprint: "fp-prog-exp", dataOrigin: "REAL", days: [] }],
      warnings: [],
    } as any;
  };
  fitnessAgentDeps.tools.getScientificEvidence = () => [] as any;

  const userId = `agent-workflow-program-exp-${randomUUID()}`;
  const session = await prisma.chatSession.create({ data: { userId, title: "Program experience test" } });
  const identity = { userId } as any;
  try {
    const r1 = await fitnessAgent.tryTurn("tôi tự tập, gợi ý chương trình", identity, session.id);
    assert.equal(r1!.blocks[0].type, "WORKFLOW_MISSING_DATA");
    assert.ok((r1!.blocks[0] as any).missing.includes("trình độ tập"), "experience must be listed as missing");

    await fitnessAgent.tryTurn("tăng cơ", identity, session.id);
    const r3 = await fitnessAgent.tryTurn("T3 T5", identity, session.id);
    assert.equal(r3!.blocks[0].type, "WORKFLOW_MISSING_DATA", "goal + days known, experience still missing — must ask, not search");
    assert.equal(searched, null);
    assert.deepEqual((r3!.blocks[0] as any).known.find((k: any) => k.label === "mục tiêu tập luyện")?.value, "Tăng cơ",
      "known summary shows Vietnamese, not the raw enum");

    const r4 = await fitnessAgent.tryTurn("mới tập", identity, session.id);
    const confirm = r4!.blocks[0] as any;
    assert.equal(confirm.type, "PROFILE_UPDATE_CONFIRMATION", "a profile fact is never written without confirmation");
    assert.deepEqual(confirm.changes, [{ field: "experienceLevel", oldValue: null, newValue: "BEGINNER" }]);
    assert.equal(written.length, 0);

    const r5 = await fitnessAgent.tryTurn("Xác nhận cập nhật", identity, session.id);
    assert.deepEqual(written, [{ experienceLevel: "BEGINNER" }]);
    // (re-read through a cast: the earlier `assert.equal(searched, null)` narrowed it to never)
    const seen = searched as { goal?: string; days?: number[] } | null;
    assert.ok(seen, "after confirmation the real program search runs");
    assert.equal(seen.goal, "MUSCLE_GAIN");
    assert.deepEqual(seen.days, [2, 4]);
    assert.equal(r5!.blocks.some((b: any) => b.type === "PROGRAM_RECOMMENDATIONS"), true);
  } finally {
    await prisma.fitnessRecommendation.deleteMany({ where: { userId } });
    await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  }
});
