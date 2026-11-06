/**
 * Controlled DEV runner. The only executable LIVE branch is the Nova measured warmup, and the session admits it only
 * after every owner gate (signed config + Nova scope, clean pins, trust root/Ed25519, scoped OWNER_SIGNED ledger).
 */
import fs from "node:fs";
import path from "node:path";
import { createAnnotationPackets } from "../evaluation-kit/annotations";
import { reviewerExport, verifyReviewerExport } from "../evaluation-kit/reviewer-export";
import { digest } from "../evaluation-kit/identity";
import { outputLifecycle } from "../evaluation-kit/lifecycle";
import { verifyRawEvaluation } from "../ai-coach-dev/pipeline";
import { approvedConfigurationHash, estimatedCost, parseConfiguration, PilotError } from "./config";
import { calculatePilotPins, verifySessionPins } from "./pins";
import { converseInput, openPreparedEvaluationSession, redact, type EvaluationTransport, type LiveRehearsal } from "./session";
import { assertSeparate, atomicCreate, openJournal, realDirectory } from "./storage";
import { attemptIdentity, interleaveNovaWarmupRows } from "./design";
import { verifyClaimPilot } from "./claim-adapter";
import { ClaimAnalysisSchema } from "../ai-coach-claim-dev/pipeline";
import { projectClaimAnalysis } from "../ai-coach-claim-dev/projection";
import { createScriptedMantleTransport } from "./mantle-transport";
import { createScriptedNovaTransport, serializeNova } from "./nova-converse-transport";
import type { SessionConfig } from "./config";

export type PilotStage = "PREPARED" | "VALIDATED" | "PREVIEWED" | "EVALUATED" | "VERIFIED" | "PERSISTED";
export interface RunnerOptions {
  config: unknown; directory: string; transport?: EvaluationTransport; resume?: boolean;
  /** Must be disjoint from internal run data. Default is a sibling directory. */
  reviewerDirectory?: string;
  fixtureLedgerDirectory?: string; fixtureApprovalId?: string;
  onPreview?: (value: unknown) => void;
  /** FAKE-only fault probes, never a live authorization/provider bypass. */
  onStage?: (stage: PilotStage) => void;
  /** TEST FIXTURE ONLY (see session LiveRehearsal): never constructs the AWS client. */
  liveRehearsal?: LiveRehearsal;
  /** Two-phase Nova LIVE measurement phase: measure, persist measurement-report.json, close the phase, never infer. */
  measureOnly?: boolean;
}
function fakeTransport(claims: boolean, protocol?: SessionConfig["transportProtocol"]): EvaluationTransport {
  const output = JSON.stringify({ analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] }, claims: [], missingInformation: [], rationaleSummary: "Synthetic runner plumbing response; no scientific conclusion.", proposedAction: null }, sourceLinks: [], ...(claims ? { claimLinks: [] } : {}) });
  if (protocol === "MANTLE_MESSAGES") return createScriptedMantleTransport(output);
  if (protocol === "NOVA_CONVERSE_MEASURED") return createScriptedNovaTransport(output);
  const count = (input: Parameters<EvaluationTransport["count"]>[0]) => Math.ceil(Buffer.byteLength(JSON.stringify({ messages: input.messages, system: input.system }), "utf8") / 4);
  return { kind: "FAKE", async count(input) { return count(input); }, async invoke(input) { const inputTokens = count(input); return { $metadata: {}, output: { message: { role: "assistant", content: [{ text: output }] } }, usage: { inputTokens, outputTokens: 100, totalTokens: inputTokens + 100 }, metrics: { latencyMs: 0 }, stopReason: "end_turn" }; } };
}
export async function runControlledPilot(options: RunnerOptions) {
  const config = parseConfiguration(options.config);
  if (config.mode !== "FAKE" && config.transportProtocol !== "NOVA_CONVERSE_MEASURED") throw new PilotError("RUNNER_LIVE_LOCKED");
  const live = config.mode === "LIVE", rehearsal = !!options.liveRehearsal, awsCalls = live && !rehearsal;
  if (live && options.transport) throw new PilotError("LiveTransportCannotBeOverridden");
  if (!config.sources) throw new PilotError("PIN_SOURCES_REQUIRED");
  const reviewerDirectory = options.reviewerDirectory ?? path.resolve(options.directory) + "-reviewers";
  const reviewerSlots = config.reviewerMode === "OWNER_ONLY_EXPLORATORY" ? ["R1"] : ["R1", "R2"];
  assertSeparate(options.directory, reviewerDirectory);
  fs.mkdirSync(reviewerDirectory, { recursive: true }); realDirectory(reviewerDirectory);
  for (const slot of reviewerSlots) { fs.mkdirSync(path.join(reviewerDirectory, slot), { recursive: true }); realDirectory(path.join(reviewerDirectory, slot)); }
  const { preparation } = await calculatePilotPins(config.sources.workspaceRoot, config.sources.casesFile, config.design, config.sources, config.promptVersion);
  if (config.transportProtocol && (preparation.rows.length !== 8 || preparation.routed.length || new Set(preparation.rows.map(r => r.caseKey)).size !== 2)) throw new PilotError(config.transportProtocol === "MANTLE_MESSAGES" ? "MANTLE_WARMUP_CASES_REQUIRED" : "NOVA_WARMUP_CASES_REQUIRED");
  // Each measured preflight is billed: exactly one per unique prompt (4 = 2 cases x 2 arms; repeats reuse the measurement).
  if (config.transportProtocol === "NOVA_CONVERSE_MEASURED" && new Set(preparation.rows.map(r => r.promptHash)).size !== 4) throw new PilotError("NOVA_WARMUP_CASES_REQUIRED");
  if (config.novaScope) {
    // The prepared token-bearing payloads must be exactly the owner-approved set (checked before any session/ledger work).
    const prepared = new Set(preparation.rows.map(r => serializeNova(converseInput(config, r.prompt)).identity.tokenPayloadHash)), approved = new Set(config.novaScope.tokenPayloadHashes);
    if (prepared.size !== approved.size || [...prepared].some(h => !approved.has(h))) throw new PilotError("NOVA_PAYLOAD_NOT_APPROVED");
  }
  if (options.measureOnly && !live) throw new PilotError("MEASURE_ONLY_REQUIRES_TWO_PHASE_SCOPE");
  // Inference order only: V4/V4.1 Nova warmup interleaves case/arm by repeat (owner engineering decision); V1–V3 keep prepared order.
  // Preparation order, pins.promptHashes, measurements and attempt identities are unchanged.
  const scheduledRows = config.transportProtocol === "NOVA_CONVERSE_MEASURED" && (config.promptVersion === "CLAIM_PROMPT_V4" || config.promptVersion === "CLAIM_PROMPT_V4_1") ? interleaveNovaWarmupRows(preparation.rows) : preparation.rows;
  options.onStage?.("PREPARED");
  const verifiedPins = await verifySessionPins(config); options.onStage?.("VALIDATED");
  const transport = live ? undefined : options.transport ?? fakeTransport(config.outputContract === "CLAIM_MAP_V3", config.transportProtocol);
  const configHash = approvedConfigurationHash(config), session = await openPreparedEvaluationSession(config, options.directory, transport, { resume: options.resume, fixtureLedgerDirectory: options.fixtureLedgerDirectory, fixtureApprovalId: options.fixtureApprovalId, verifiedPins, liveRehearsal: options.liveRehearsal, measureOnly: options.measureOnly });
  let journal: ReturnType<typeof openJournal> | undefined;
  try {
    journal = openJournal(path.join(options.directory, "pilot.jsonl"), !options.resume);
    const schedule = scheduledRows.map((r) => ({ attemptKey: attemptIdentity({ caseKey: r.caseKey, arm: r.arm, policy: r.policy, repeatIndex: r.repeatIndex, configHash, promptHash: r.promptHash }), caseKey: r.caseKey, arm: r.arm, policy: r.policy, repeatIndex: r.repeatIndex, configHash, promptHash: r.promptHash }));
    const scheduleFile = path.join(options.directory, "schedule.json");
    if (fs.existsSync(scheduleFile)) { if (digest(JSON.parse(fs.readFileSync(scheduleFile, "utf8"))) !== digest(schedule)) throw new PilotError("SCHEDULE_INTEGRITY_FAILED"); }
    else atomicCreate(scheduleFile, schedule);
    const summaryFile = path.join(options.directory, "summary.json");
    if (options.resume && fs.existsSync(summaryFile)) {
      const prior = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
      const committed = journal.records.find((r) => (r as { event: string }).event === "PILOT_COMPLETED") as { summaryHash: string } | undefined;
      if (prior.configHash !== configHash || !committed || committed.summaryHash !== digest(prior)) throw new PilotError("SUMMARY_INTEGRITY_FAILED");
      for (const receipt of journal.records as { event: string; attemptKey?: string; fileHash?: string }[]) if (receipt.event === "POSTPROCESSED") {
        const answer = JSON.parse(fs.readFileSync(path.join(options.directory, "answer-" + receipt.attemptKey + ".json"), "utf8"));
        if (digest(answer) !== receipt.fileHash) throw new PilotError("RESULT_INTEGRITY_FAILED");
        for (const packet of answer.packets.reviewers) {
          if (!reviewerSlots.includes(packet.reviewerSlot)) continue;
          const exported = reviewerExport(packet);
          verifyReviewerExport(JSON.parse(fs.readFileSync(path.join(reviewerDirectory, packet.reviewerSlot, packet.body.instanceId + ".json"), "utf8")), exported.hash);
        }
      }
      return prior;
    }
    const counts = await session.previewTokenCounts(preparation.rows.map((r) => r.prompt));
    // Nova measured preflights are billed model calls: one per unique prompt, full input plus at most 1 output token.
    const measured = config.transportProtocol === "NOVA_CONVERSE_MEASURED" ? [...new Map(counts.map(c => [c.promptHash, c.inputTokens])).values()] : [];
    const tokenAuthority = awsCalls ? "AWS_REPORTED_USAGE" : rehearsal ? "REHEARSAL_FIXTURE_NOT_MODEL_TOKENS" : "FAKE_TEST_ONLY_NOT_MODEL_TOKENS";
    const measuredPreflight = measured.length ? { authority: tokenAuthority, calls: measured.length, inputTokens: measured.reduce((n, t) => n + t, 0), outputTokenCeiling: measured.length } : null;
    const inputCeiling = counts.reduce((n, r) => n + r.inputTokens, 0) + (measuredPreflight?.inputTokens ?? 0), outputCeiling = preparation.rows.length * config.parameters.maxTokens + (measuredPreflight?.outputTokenCeiling ?? 0);
    const tokenLengthControls = preparation.rows.filter((r) => r.arm === "LAYERED_CONTEXT_PLACEBO").map((row) => {
      const index = preparation.rows.indexOf(row), pairedIndex = preparation.rows.findIndex((r) => r.caseKey === row.caseKey && r.policy === row.policy && r.repeatIndex === row.repeatIndex && r.arm === "LAYERED_CONTEXT");
      return { caseKey: row.caseKey, authority: "FAKE_TEST_ONLY", contextTokens: counts[pairedIndex]?.inputTokens ?? null, paddedTokens: counts[index].inputTokens, delta: pairedIndex < 0 ? null : counts[index].inputTokens - counts[pairedIndex].inputTokens, modelTokenMatch: "NOT_EVALUATED" };
    });
    const preview = { mode: config.mode, configHash, approvalId: session.approvalId, target: session.target, pins: config.pins, inferenceCallsCeiling: preparation.rows.length, countApiCallsCeiling: new Set(config.pins.promptHashes).size,
      tokenAuthority, inputTokenCeiling: inputCeiling, outputTokenCeiling: outputCeiling, estimatedUsdCeiling: estimatedCost(config, inputCeiling, outputCeiling), approvedUsdCap: config.budget.maxEstimatedUsd,
      stopConditions: ["CALL_TOKEN_SPEND_CAP", "PIN_OR_APPROVAL_DRIFT", "UNKNOWN_USAGE", "FAILURE_THRESHOLD", "PERSISTENCE_OR_LOCK_FAILURE", "SAFETY_OUT_OF_DOMAIN_ROUTED"], tokenLengthControls,
      ...(measuredPreflight ? { measuredPreflight } : {}),
      countsByRow: counts.map((c, i) => ({ caseKey: preparation.rows[i].caseKey, arm: preparation.rows[i].arm, promptHash: c.promptHash, fakeInputTokens: awsCalls ? null : c.inputTokens, modelInputTokens: awsCalls ? c.inputTokens : null, contextSize: preparation.rows[i].contextSize })) };
    options.onPreview?.(preview);
    if (!fs.existsSync(path.join(options.directory, "preview.json"))) atomicCreate(path.join(options.directory, "preview.json"), preview);
    journal.append({ event: "PREVIEW", previewHash: digest(preview) }); options.onStage?.("PREVIEWED");
    if (preparation.rows.length > config.budget.maxCalls || inputCeiling > config.budget.maxInputTokens || outputCeiling > config.budget.maxOutputTokens || preview.estimatedUsdCeiling > config.budget.maxEstimatedUsd) throw new PilotError("PREVIEW_EXCEEDS_BUDGET");
    if (options.measureOnly) {
      // Durable stop between the phases: the ledger row closing the measurement phase is what the owner's inference
      // release must bind. No inference is reserved or sent here, and nothing here authorizes one.
      const phase = await session.completeMeasurementPhase(), byPrompt = new Map(preparation.rows.map((r) => [r.promptHash, r]));
      const report = { version: "nova-measurement-phase-report-v1", status: "MEASURED_AWAITING_OWNER_INFERENCE_RELEASE", mode: config.mode, configHash, approvalId: session.approvalId, approvalExpiresAt: phase.approvalExpiresAt,
        target: session.target, tokenAuthority, ledgerRecordHash: phase.ledgerRecordHash,
        measurements: [...new Set(config.pins.promptHashes)].map((h) => { const r = byPrompt.get(h)!, inputTokens = phase.counts[h];
          return { promptHash: h, caseKey: r.caseKey, arm: r.arm, tokenPayloadHash: serializeNova(converseInput(config, r.prompt)).identity.tokenPayloadHash, inputTokens, maxInputTokensPerCall: config.budget.maxInputTokensPerCall, withinCap: inputTokens <= config.budget.maxInputTokensPerCall }; }),
        inferencePlan: { inferenceCalls: preparation.rows.length, inputTokens: preparation.rows.reduce((n, r) => n + phase.counts[r.promptHash], 0), outputTokenCap: preparation.rows.length * config.parameters.maxTokens,
          estimatedUsdCeilingIncludingMeasurements: preview.estimatedUsdCeiling, approvedUsdCap: config.budget.maxEstimatedUsd },
        spent: { measureCalls: phase.state.countCalls, inferenceCalls: phase.state.inferenceCalls, inputTokens: phase.state.inputTokens, outputTokens: phase.state.outputTokens, estimatedUsd: phase.state.estimatedUsd },
        actualBedrockCalls: awsCalls ? phase.state.countCalls : 0, scientificPass: null, next: "OWNER_SIGNED_INFERENCE_RELEASE_REQUIRED_BEFORE_RESUME" };
      const reportFile = path.join(options.directory, "measurement-report.json");
      if (fs.existsSync(reportFile)) { if (digest(JSON.parse(fs.readFileSync(reportFile, "utf8"))) !== digest(report)) throw new PilotError("MEASUREMENT_REPORT_INTEGRITY_FAILED"); }
      else atomicCreate(reportFile, report);
      journal.append({ event: "MEASUREMENT_PHASE_COMPLETED", reportHash: digest(report), ledgerRecordHash: phase.ledgerRecordHash });
      return report;
    }
    const rawRecords = session.records() as { event: string; attemptKey?: string; [key: string]: unknown }[];
    const finished = new Map(rawRecords.filter((r) => r.event === "ATTEMPT_FINISHED").map((r) => [r.attemptKey!, r]));
    const pending = session.state().attemptKeys.filter((k) => !finished.has(k));
    if (pending.length) throw new PilotError("UNRESOLVED_RESERVATION_REQUIRES_OWNER_AUDIT", { count: pending.length });
    const outputs: { generated: boolean; blocked: boolean; failed: boolean; redacted: boolean }[] = [];
    // Every arm of the same case receives the same reviewer reference pool.
    // Otherwise an empty/full excerpt list would itself disclose the RAG arm.
    // This pool never enters generation and performs no extra retrieval/model call.
    const reviewerEvidence = new Map<string, { passages: typeof preparation.rows[number]["verificationContext"]["evidence"]["passages"] }>();
    for (const row of preparation.rows) {
      const entry = reviewerEvidence.get(row.caseKey) ?? { passages: [] };
      for (const p of row.verificationContext.evidence.passages) {
        const existing = entry.passages.find((s) => s.source.id === p.source.id);
        if (!existing) entry.passages.push({ ...p, excerpts: [...p.excerpts] });
        else for (const excerpt of p.excerpts) if (!existing.excerpts.some((e) => e.id === excerpt.id)) existing.excerpts.push(excerpt);
      }
      reviewerEvidence.set(row.caseKey, entry);
    }
    for (const e of reviewerEvidence.values()) { e.passages.sort((a,b) => a.source.id.localeCompare(b.source.id)); e.passages.forEach(p => p.excerpts.sort((a,b) => a.id.localeCompare(b.id))); }
    for (const row of scheduledRows) {
      const attemptKey = attemptIdentity({ caseKey: row.caseKey, arm: row.arm, policy: row.policy, repeatIndex: row.repeatIndex, configHash, promptHash: row.promptHash });
      const result = finished.get(attemptKey) ?? await session.evaluate(row.prompt, attemptKey);
      options.onStage?.("EVALUATED");
      const verification = row.claimContext ? verifyClaimPilot(row.claimContext, result.parsedCandidate, { parseError: result.parseError, providerError: result.providerError }) : verifyRawEvaluation(row.verificationContext, result.parsedCandidate);
      const generationStatus = result.providerError || result.parseError ? "FAILED" as const : "GENERATED" as const;
      const postGate = { decision: generationStatus === "FAILED" ? "FAILED" as const : verification.blocked ? "BLOCKED" as const : "ELIGIBLE" as const,
        structuredInvariant: generationStatus === "GENERATED" && !!verification.blockerScopes.structuredInvariant.length,
        narrowTextHeuristic: generationStatus === "GENERATED" && !!verification.blockerScopes.narrowTextHeuristic.length };
      const lifecycle = outputLifecycle(generationStatus, postGate.decision, result.parsedCandidate);
      options.onStage?.("VERIFIED");
      const file = path.join(options.directory, "answer-" + attemptKey + ".json");
      const packets = createAnnotationPackets({ question: row.verificationContext.input.question, facts: row.verificationContext.input.facts, evidence: reviewerEvidence.get(row.caseKey), candidate: result.parsedCandidate ?? result.rawText,
        redactionChanged: "representation" in result && (result.representation as { scoringDisposition?: string } | undefined)?.scoringDisposition === "REDACTED_NOT_SCORED" });
      if (fs.existsSync(file)) {
        const previous = JSON.parse(fs.readFileSync(file, "utf8"));
        if (previous.configHash !== configHash || previous.promptHash !== row.promptHash || digest(previous.verification) !== digest(redact(verification)) || previous.candidateHash !== digest(result.parsedCandidate)) throw new PilotError("RESULT_INTEGRITY_FAILED");
      } else {
        // Packet hashes are sealed AFTER sanitizing; never redact a sealed packet again.
        atomicCreate(file, { configHash, attemptKey, caseKey: row.caseKey, arm: row.arm, policy: row.policy, repeatIndex: row.repeatIndex, requestHash: row.requestHash, promptHash: row.promptHash, candidateHash: digest(result.parsedCandidate), generationStatus, postGate, lifecycle, raw: result,
          ...(row.claimContext ? { claimRepresentation: ClaimAnalysisSchema.safeParse(result.parsedCandidate).success ? projectClaimAnalysis(result.parsedCandidate) : null } : {}), verification: redact(verification), packets });
      }
      const stored = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const packet of stored.packets.reviewers) {
        const { instanceId: _newId, ...expectedBody } = packets.reviewers[0].body;
        const { instanceId: _storedId, ...storedBody } = packet.body;
        if (digest(storedBody) !== digest(expectedBody)) throw new PilotError("PacketRawOrCaseMismatch");
        if (!reviewerSlots.includes(packet.reviewerSlot)) continue;
        const exported = reviewerExport(packet), target = path.join(reviewerDirectory, packet.reviewerSlot, packet.body.instanceId + ".json");
        if (fs.existsSync(target)) verifyReviewerExport(JSON.parse(fs.readFileSync(target, "utf8")), exported.hash);
        else atomicCreate(target, exported.artifact);
      }
      journal.append({ event: "POSTPROCESSED", attemptKey, fileHash: digest(JSON.parse(fs.readFileSync(file, "utf8"))) }); options.onStage?.("PERSISTED");
      const generated = session.state().attemptKeys.includes(attemptKey);
      outputs.push({ generated, blocked: lifecycle.blocked, failed: lifecycle.failed,
        redacted: stored.packets.reviewers.some((p: { body: { representation?: { scoringDisposition: string } } }) => p.body.representation?.scoringDisposition === "REDACTED_NOT_SCORED") });
      if (session.state().stopped) break;
    }
    const state = session.state();
    const summary = { status: state.stopped ? "STOPPED" : awsCalls ? "LIVE_COMPLETED_REVIEW_ONLY" : rehearsal ? "LIVE_REHEARSAL_FIXTURE_COMPLETED_REVIEW_ONLY" : "FAKE_COMPLETED_REVIEW_ONLY", mode: config.mode, configHash, approvalId: session.approvalId, target: session.target,
      denominators: { scheduled: preparation.rows.length + preparation.routed.length, routedBeforeGeneration: preparation.routed.length, generationEligible: preparation.rows.length, inferenceAttempts: state.inferenceCalls, finishedOutputs: outputs.filter((o) => o.generated).length,
        recordedOutputs: outputs.length, validGenerated: outputs.filter((o) => !o.failed).length, failed: outputs.filter((o) => o.failed).length, redactedOutputs: outputs.filter((o) => o.redacted).length,
        parseOrProviderFailures: outputs.filter((o) => o.failed).length, postGateEligible: outputs.filter((o) => o.generated && !o.blocked && !o.failed).length, blocked: outputs.filter((o) => o.generated && o.blocked).length, notAttempted: preparation.rows.length - state.inferenceCalls },
      routed: preparation.routed, budget: state, rawCorrectness: null, postGateCorrectness: null, scientificPass: null,
      reviewAuthority: config.reviewerMode === "OWNER_ONLY_EXPLORATORY" ? "EXPLORATORY_OWNER_REVIEWED" : "PENDING_INDEPENDENT_REVIEW", actualBedrockCalls: awsCalls ? state.countCalls + state.inferenceCalls : 0, actualEmbeddingCalls: 0, actualVectorDbCalls: 0 };
    atomicCreate(summaryFile, summary); journal.append({ event: "PILOT_COMPLETED", summaryHash: digest(summary) });
    return summary;
  } catch (e) {
    try { journal?.append({ event: "PILOT_FAILED", code: e instanceof PilotError ? e.code : "PILOT_STAGE_FAILED" }); } catch { /* No additional provider calls after an unwriteable journal. */ }
    throw e;
  } finally { await session.close(); }
}
