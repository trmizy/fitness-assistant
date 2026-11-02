/** Controlled DEV runner. There is deliberately NO executable LIVE branch. */
import fs from "node:fs";
import path from "node:path";
import { createAnnotationPackets } from "../evaluation-kit/annotations";
import { digest } from "../evaluation-kit/identity";
import { verifyRawEvaluation } from "../ai-coach-dev/pipeline";
import { approvedConfigurationHash, estimatedCost, parseConfiguration, PilotError } from "./config";
import { calculatePilotPins, verifySessionPins } from "./pins";
import { openEvaluationSession, redact, type EvaluationTransport } from "./session";
import { atomicCreate, openJournal } from "./storage";
import { attemptIdentity } from "./design";

export type PilotStage = "PREPARED" | "VALIDATED" | "PREVIEWED" | "EVALUATED" | "VERIFIED" | "PERSISTED";
export interface RunnerOptions {
  config: unknown; directory: string; transport?: EvaluationTransport; resume?: boolean;
  fixtureLedgerDirectory?: string; fixtureApprovalId?: string;
  onPreview?: (value: unknown) => void;
  /** FAKE-only fault probes, never a live authorization/provider bypass. */
  onStage?: (stage: PilotStage) => void;
}
function fakeTransport(): EvaluationTransport {
  const output = JSON.stringify({ analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] }, claims: [], missingInformation: [], rationaleSummary: "Synthetic runner plumbing response; no scientific conclusion.", proposedAction: null }, sourceLinks: [] });
  const count = (input: Parameters<EvaluationTransport["count"]>[0]) => Math.ceil(Buffer.byteLength(JSON.stringify({ messages: input.messages, system: input.system }), "utf8") / 4);
  return { kind: "FAKE", async count(input) { return count(input); }, async invoke(input) { const inputTokens = count(input); return { $metadata: {}, output: { message: { role: "assistant", content: [{ text: output }] } }, usage: { inputTokens, outputTokens: 100, totalTokens: inputTokens + 100 }, metrics: { latencyMs: 0 }, stopReason: "end_turn" }; } };
}
export async function runControlledPilot(options: RunnerOptions) {
  const config = parseConfiguration(options.config);
  if (config.mode !== "FAKE") throw new PilotError("RUNNER_LIVE_LOCKED");
  if (!config.sources) throw new PilotError("PIN_SOURCES_REQUIRED");
  const { preparation } = await calculatePilotPins(config.sources.workspaceRoot, config.sources.casesFile, config.design);
  options.onStage?.("PREPARED");
  const verifiedPins = await verifySessionPins(config); options.onStage?.("VALIDATED");
  const configHash = approvedConfigurationHash(config), session = openEvaluationSession(config, options.directory, options.transport ?? fakeTransport(), { resume: options.resume, fixtureLedgerDirectory: options.fixtureLedgerDirectory, fixtureApprovalId: options.fixtureApprovalId, verifiedPins });
  let journal: ReturnType<typeof openJournal> | undefined;
  try {
    journal = openJournal(path.join(options.directory, "pilot.jsonl"), !options.resume);
    const schedule = preparation.rows.map((r) => ({ attemptKey: attemptIdentity({ caseKey: r.caseKey, arm: r.arm, policy: r.policy, repeatIndex: r.repeatIndex, configHash, promptHash: r.promptHash }), caseKey: r.caseKey, arm: r.arm, policy: r.policy, repeatIndex: r.repeatIndex, configHash, promptHash: r.promptHash }));
    const scheduleFile = path.join(options.directory, "schedule.json");
    if (fs.existsSync(scheduleFile)) { if (digest(JSON.parse(fs.readFileSync(scheduleFile, "utf8"))) !== digest(schedule)) throw new PilotError("SCHEDULE_INTEGRITY_FAILED"); }
    else atomicCreate(scheduleFile, schedule);
    const summaryFile = path.join(options.directory, "summary.json");
    if (options.resume && fs.existsSync(summaryFile)) {
      const prior = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
      const committed = journal.records.find((r) => (r as { event: string }).event === "PILOT_COMPLETED") as { summaryHash: string } | undefined;
      if (prior.configHash !== configHash || !committed || committed.summaryHash !== digest(prior)) throw new PilotError("SUMMARY_INTEGRITY_FAILED");
      return prior;
    }
    const counts = await session.previewTokenCounts(preparation.rows.map((r) => r.prompt));
    const inputCeiling = counts.reduce((n, r) => n + r.inputTokens, 0), outputCeiling = preparation.rows.length * config.parameters.maxTokens;
    const tokenLengthControls = preparation.rows.filter((r) => r.arm === "LAYERED_CONTEXT_PLACEBO").map((row) => {
      const index = preparation.rows.indexOf(row), pairedIndex = preparation.rows.findIndex((r) => r.caseKey === row.caseKey && r.policy === row.policy && r.repeatIndex === row.repeatIndex && r.arm === "LAYERED_CONTEXT");
      return { caseKey: row.caseKey, authority: "FAKE_TEST_ONLY", contextTokens: counts[pairedIndex]?.inputTokens ?? null, paddedTokens: counts[index].inputTokens, delta: pairedIndex < 0 ? null : counts[index].inputTokens - counts[pairedIndex].inputTokens, modelTokenMatch: "NOT_EVALUATED" };
    });
    const preview = { mode: "FAKE", configHash, approvalId: session.approvalId, target: session.target, pins: config.pins, inferenceCallsCeiling: preparation.rows.length, countApiCallsCeiling: new Set(config.pins.promptHashes).size,
      tokenAuthority: "FAKE_TEST_ONLY_NOT_MODEL_TOKENS", inputTokenCeiling: inputCeiling, outputTokenCeiling: outputCeiling, estimatedUsdCeiling: estimatedCost(config, inputCeiling, outputCeiling), approvedUsdCap: config.budget.maxEstimatedUsd,
      stopConditions: ["CALL_TOKEN_SPEND_CAP", "PIN_OR_APPROVAL_DRIFT", "UNKNOWN_USAGE", "FAILURE_THRESHOLD", "PERSISTENCE_OR_LOCK_FAILURE", "SAFETY_OUT_OF_DOMAIN_ROUTED"], tokenLengthControls,
      countsByRow: counts.map((c, i) => ({ caseKey: preparation.rows[i].caseKey, arm: preparation.rows[i].arm, promptHash: c.promptHash, fakeInputTokens: c.inputTokens, modelInputTokens: null, contextSize: preparation.rows[i].contextSize })) };
    options.onPreview?.(preview);
    if (!fs.existsSync(path.join(options.directory, "preview.json"))) atomicCreate(path.join(options.directory, "preview.json"), preview);
    journal.append({ event: "PREVIEW", previewHash: digest(preview) }); options.onStage?.("PREVIEWED");
    if (preparation.rows.length > config.budget.maxCalls || inputCeiling > config.budget.maxInputTokens || outputCeiling > config.budget.maxOutputTokens || preview.estimatedUsdCeiling > config.budget.maxEstimatedUsd) throw new PilotError("PREVIEW_EXCEEDS_BUDGET");
    const rawRecords = session.records() as { event: string; attemptKey?: string; [key: string]: unknown }[];
    const finished = new Map(rawRecords.filter((r) => r.event === "ATTEMPT_FINISHED").map((r) => [r.attemptKey!, r]));
    const pending = session.state().attemptKeys.filter((k) => !finished.has(k));
    if (pending.length) throw new PilotError("UNRESOLVED_RESERVATION_REQUIRES_OWNER_AUDIT", { count: pending.length });
    const outputs: { generated: boolean; blocked: boolean; failed: boolean }[] = [];
    for (const row of preparation.rows) {
      const attemptKey = attemptIdentity({ caseKey: row.caseKey, arm: row.arm, policy: row.policy, repeatIndex: row.repeatIndex, configHash, promptHash: row.promptHash });
      const result = finished.get(attemptKey) ?? await session.evaluate(row.prompt, attemptKey);
      options.onStage?.("EVALUATED");
      const verification = verifyRawEvaluation(row.verificationContext, result.parsedCandidate);
      options.onStage?.("VERIFIED");
      const file = path.join(options.directory, "answer-" + attemptKey + ".json");
      if (fs.existsSync(file)) {
        const previous = JSON.parse(fs.readFileSync(file, "utf8"));
        if (previous.configHash !== configHash || previous.promptHash !== row.promptHash || digest(previous.verification) !== digest(redact(verification)) || previous.candidateHash !== digest(result.parsedCandidate)) throw new PilotError("RESULT_INTEGRITY_FAILED");
      } else {
        const packets = createAnnotationPackets({ question: row.verificationContext.input.question, facts: row.verificationContext.input.facts, evidence: row.verificationContext.evidence, candidate: result.parsedCandidate ?? result.rawText });
        atomicCreate(file, redact({ configHash, attemptKey, caseKey: row.caseKey, arm: row.arm, policy: row.policy, repeatIndex: row.repeatIndex, requestHash: row.requestHash, promptHash: row.promptHash, candidateHash: digest(result.parsedCandidate), raw: result, verification, packets }));
      }
      journal.append({ event: "POSTPROCESSED", attemptKey, fileHash: digest(JSON.parse(fs.readFileSync(file, "utf8"))) }); options.onStage?.("PERSISTED");
      const generated = session.state().attemptKeys.includes(attemptKey);
      const failed = !!result.providerError || !!result.parseError;
      outputs.push({ generated, blocked: !failed && verification.blocked, failed });
      if (session.state().stopped) break;
    }
    const state = session.state();
    const summary = { status: state.stopped ? "STOPPED" : "FAKE_COMPLETED_REVIEW_ONLY", mode: "FAKE", configHash, approvalId: session.approvalId, target: session.target,
      denominators: { scheduled: preparation.rows.length + preparation.routed.length, routedBeforeGeneration: preparation.routed.length, generationEligible: preparation.rows.length, inferenceAttempts: state.inferenceCalls, finishedOutputs: outputs.filter((o) => o.generated).length,
        recordedOutputs: outputs.length, validGenerated: outputs.filter((o) => !o.failed).length, failed: outputs.filter((o) => o.failed).length,
        parseOrProviderFailures: outputs.filter((o) => o.failed).length, postGateEligible: outputs.filter((o) => o.generated && !o.blocked && !o.failed).length, blocked: outputs.filter((o) => o.generated && o.blocked).length, notAttempted: preparation.rows.length - state.inferenceCalls },
      routed: preparation.routed, budget: state, rawCorrectness: null, postGateCorrectness: null, scientificPass: null, actualBedrockCalls: 0, actualEmbeddingCalls: 0, actualVectorDbCalls: 0 };
    atomicCreate(summaryFile, summary); journal.append({ event: "PILOT_COMPLETED", summaryHash: digest(summary) });
    return summary;
  } catch (e) {
    try { journal?.append({ event: "PILOT_FAILED", code: e instanceof PilotError ? e.code : "PILOT_STAGE_FAILED" }); } catch { /* No additional provider calls after an unwriteable journal. */ }
    throw e;
  } finally { await session.close(); }
}
