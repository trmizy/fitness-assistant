/**
 * Codex's two independent probes (X1, X2) — converted into passing REGRESSION tests after the fixes. Originally each asserted the defect
 * ("CONFIRMED_DEFECT"); they now assert the corrected behaviour. BACKEND INTEGRATION (real test DB, stubbed tools/model).
 *  X1: only an error raised by the PROFILE READ is a profile condition — a downstream food-substitution 503 stays a real error, flag ON or OFF.
 *  X2: untrusted model text (an invalid topic, a non-JSON answer, a schema-violating answer) never reaches diagnostics.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";
import { prisma } from "../repositories/conversation.repository";
import { logger } from "@gym-coach/shared";
import { llmService } from "../services/llm.service";
import { llmRoute, REJECTED_TOPIC_MARKER } from "../conversational-intelligence/global/llm-route";

for (const flag of ["off", "on"] as const) {
  test(`X1 regression (CI-V2 ${flag}): a substitution-service 503 is NOT reported as a profile outage — it stays a real error`, async () => {
    const original = fitnessAgentDeps.tools.substituteMealItem;
    const extract = fitnessAgentDeps.extractFoodSubstitutionIntent;
    const previous = process.env.CONVERSATIONAL_INTELLIGENCE_V2;
    process.env.CONVERSATIONAL_INTELLIGENCE_V2 = flag;
    const userId = `codex-boundary-${flag}-${randomUUID()}`;
    const session = await prisma.chatSession.create({ data: { userId, title: "Codex boundary regression" } });
    let invoked = false;
    fitnessAgentDeps.extractFoodSubstitutionIntent = async () => ({ isFoodSubstitutionRequest: true, currentFoodMention: "chicken", desiredFoodMention: "salmon", mealHint: null });
    fitnessAgentDeps.tools.substituteMealItem = async () => { invoked = true; throw Object.assign(new Error("Domain service unavailable"), { status: 503 }); };
    try {
      await assert.rejects(() => fitnessAgent.tryTurn("tôi muốn ăn cá hồi thay ức gà", { userId }, session.id), (e: any) => e.status === 503 && /Domain service unavailable/.test(e.message) && !/hồ sơ/.test(e.message));
      assert.equal(invoked, true, "the substitution tool really was the thing that failed");
    } finally {
      fitnessAgentDeps.tools.substituteMealItem = original;
      fitnessAgentDeps.extractFoodSubstitutionIntent = extract;
      if (previous === undefined) delete process.env.CONVERSATIONAL_INTELLIGENCE_V2; else process.env.CONVERSATIONAL_INTELLIGENCE_V2 = previous;
      await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
      await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
      await prisma.chatSession.delete({ where: { id: session.id } });
    }
  });
}

test("X2 regression: a rejected free-text model topic is logged as a constant marker, never as the model's text", async () => {
  const originalCall = llmService.callLLM;
  const saved = { info: logger.info, warn: logger.warn, error: logger.error };
  const lines: any[] = [];
  const secret = "SYNTHETIC_PRIVATE_PROFILE_HEIGHT_181_WEIGHT_90";
  llmService.callLLM = async () => ({ answer: JSON.stringify({ route: "READ_STATE", topic: secret }) } as any);
  for (const level of ["info", "warn", "error"] as const) (logger as any)[level] = (obj: any, msg: string) => { lines.push({ level, ...(typeof obj === "object" ? obj : { obj }), msg }); };
  try {
    const route = await llmRoute("synthetic unknown utterance", {}, "codex-synthetic", "codex-log-probe");
    assert.equal(route, null, "still rejected for routing");
    const rec = lines.find((l) => l.msg === "ci_global_llm_route");
    assert.equal(rec?.llmTopic, REJECTED_TOPIC_MARKER);
    assert.equal(rec?.correlationId, "codex-log-probe", "correlation intact");
    assert.equal(rec?.accepted, false, "accepted/rejected diagnostics intact");
    assert.ok(!JSON.stringify(lines).includes(secret), "the untrusted text appears nowhere in diagnostics");
  } finally { llmService.callLLM = originalCall; Object.assign(logger, saved); }
});

test("X2 regression: enumerated topics are still logged; non-JSON and schema-violating model output never leak into error logs", async () => {
  const originalCall = llmService.callLLM;
  const saved = { info: logger.info, warn: logger.warn, error: logger.error };
  const lines: any[] = [];
  const secret = "SYNTHETIC_PRIVATE_TOKEN_abc123_HEIGHT_181";
  for (const level of ["info", "warn", "error"] as const) (logger as any)[level] = (obj: any, msg: string) => { lines.push({ level, ...(typeof obj === "object" ? obj : { obj }), msg }); };
  try {
    llmService.callLLM = async () => ({ answer: JSON.stringify({ route: "RECOMMEND", topic: "SESSIONS" }) } as any);
    await llmRoute("với tình trạng hiện tại tôi nên tập mấy buổi một tuần", {}, "codex-synthetic", "corr-allowed");
    assert.equal(lines.find((l) => l.msg === "ci_global_llm_route" && l.correlationId === "corr-allowed")?.llmTopic, "SESSIONS");
    lines.length = 0;
    for (const answer of [`{"route":"READ_STATE","topic":"PT_STATUS" ${secret}`, `{"route":"${secret}","topic":"GOAL"}`, `not json at all ${secret}`, `{"route": "OTHER", "note": "${secret}"} ${secret}`]) {
      llmService.callLLM = async () => ({ answer } as any);
      const r = await llmRoute("synthetic unknown utterance", {}, "codex-synthetic", "corr-garbage");
      assert.equal(r, null);
    }
    assert.ok(lines.some((l) => l.level === "warn" || l.level === "error"), "failures are still diagnosable (logged)");
    assert.ok(!JSON.stringify(lines).includes(secret), "no arbitrary model text in any log line");
    assert.ok(lines.filter((l) => l.level !== "info").every((l) => typeof l.err !== "string" || l.err.startsWith("redacted:")), "error detail is a redacted kind marker");
  } finally { llmService.callLLM = originalCall; Object.assign(logger, saved); }
});
