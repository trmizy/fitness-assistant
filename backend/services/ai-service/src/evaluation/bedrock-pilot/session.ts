/** DEV-only transport. LIVE also requires installed owner trust and verified inputs. */
import fs from "node:fs";
import path from "node:path";
import { ConverseCommand, CountTokensCommand, type ConverseCommandInput, type ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { BEDROCK_REGION, bedrockRuntimeDeps, buildConverseTextInput, parseConverseText } from "../../services/bedrock.client";
import { AnalysisEnvelopeSchema, type Prompt } from "../ai-coach-dev/pipeline";
import { ClaimAnalysisSchema } from "../ai-coach-claim-dev/pipeline";
import { digest } from "../evaluation-kit/identity";
import { protect, redact } from "../evaluation-kit/representation";
export { redact } from "../evaluation-kit/representation";
import { approvedConfigurationHash, assertCurrentAuthorization, estimatedCost, parseConfiguration, PilotError, type SessionConfig } from "./config";
import { assertIssuedLedger, installedApproval, issueFixtureLedger, openBudgetLedger } from "./ledger";
import { createLiveNovaTransport, NOVA_LIVE_EXECUTION_LOCKED } from "./nova-live-transport";
import { atomicCreate, openJournal } from "./storage";
import { assertVerifiedPins, type VerifiedPins } from "./pins";
import type { MantleWireIdentity } from "./mantle-transport";
import type { NovaWireIdentity } from "./nova-converse-transport";
export { approvedConfigurationHash, SessionConfigSchema, type SessionConfig } from "./config";

type WireIdentity = MantleWireIdentity | NovaWireIdentity;
export interface EvaluationTransport {
  kind: "FAKE" | "LIVE";
  protocol?: "MANTLE_MESSAGES" | "NOVA_CONVERSE_MEASURED";
  /** The count is itself a billed model call (Nova measured preflight); its spend is reserved and reconciled. */
  billedCount?: boolean;
  count(input: ConverseCommandInput, signal: AbortSignal): Promise<number | { inputTokens: number; providerResponse: unknown; wire: WireIdentity; billedUsage?: { inputTokens: number; outputTokens: number } }>;
  invoke(input: ConverseCommandInput, signal: AbortSignal): Promise<ConverseCommandOutput & { providerResponse?: unknown; wire?: WireIdentity }>;
}
export function inferenceTarget(c: SessionConfig) {
  if (c.transportProtocol === "MANTLE_MESSAGES" || c.transportProtocol === "NOVA_CONVERSE_MEASURED") {
    // Nova LIVE is locked in the session AFTER the owner gates (see openEvaluationSession), never before them.
    if (c.mode !== "FAKE" && c.transportProtocol === "MANTLE_MESSAGES") throw new PilotError("MANTLE_LIVE_LOCKED");
    return { identifier: c.modelId, foundationModelId: c.modelId, kind: c.transportProtocol, region: c.region, pricingVersion: c.pricing.version };
  }
  if (c.mode === "LIVE" && (c.modelId !== "amazon.nova-pro-v1:0" || c.outputContract === "CLAIM_MAP_V3")) throw new PilotError("CLAIM_PILOT_LIVE_NOT_READY");
  if (c.region !== BEDROCK_REGION && c.mode === "LIVE") throw new PilotError("ClientRegionMismatch");
  // CountTokens documents foundation model IDs/ARNs, not arbitrary profiles.
  // Never count against a base ID while Converse routes to a profile.
  if (c.mode === "LIVE" && c.inferenceProfile) throw new PilotError("COUNT_TOKENS_PROFILE_UNSUPPORTED");
  return { identifier: c.inferenceProfile ?? c.modelId, foundationModelId: c.modelId, kind: c.inferenceProfile ? "INFERENCE_PROFILE" : "FOUNDATION_MODEL", region: c.region, pricingVersion: c.pricing.version };
}
function liveTransport(): EvaluationTransport {
  return { kind: "LIVE",
    async count(input, abortSignal) {
      const command = new CountTokensCommand({ modelId: input.modelId, input: { converse: { messages: input.messages, system: input.system } } });
      const response = await bedrockRuntimeDeps.send(command as unknown as Parameters<typeof bedrockRuntimeDeps.send>[0], { abortSignal, maxAttempts: 1 }) as { inputTokens?: number };
      if (!Number.isInteger(response.inputTokens) || response.inputTokens! < 0) throw new PilotError("TokenCountUnavailable");
      return response.inputTokens!;
    },
    async invoke(input, abortSignal) { return await bedrockRuntimeDeps.send(new ConverseCommand(input), { abortSignal, maxAttempts: 1 }) as ConverseCommandOutput; },
  };
}
function category(error: unknown): string {
  if (error instanceof PilotError) return error.code;
  const name = error instanceof Error ? error.name : "";
  return /Throttl/.test(name) ? "THROTTLED" : /AccessDenied|UnrecognizedClient/.test(name) ? "AUTHORIZATION" : /Validation/.test(name) ? "REQUEST_VALIDATION" : /Timeout|Abort/.test(name) ? "TIMEOUT" : "PROVIDER_ERROR";
}
async function deadline<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController(); let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([work(controller.signal), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); const e = new Error("Deadline"); e.name = "TimeoutError"; reject(e); }, ms); })]); }
  finally { clearTimeout(timer); }
}
export interface SessionOptions { resume?: boolean; fixtureLedgerDirectory?: string; fixtureApprovalId?: string; verifiedPins?: VerifiedPins }
export function openEvaluationSession(value: unknown, directory: string, fake?: EvaluationTransport, options: SessionOptions = {}) {
  const config = parseConfiguration(value), configHash = approvedConfigurationHash(config), target = inferenceTarget(config);
  const outputSchema = config.outputContract === "CLAIM_MAP_V3" ? ClaimAnalysisSchema : AnalysisEnvelopeSchema;
  if (config.mode === "FAKE" && (!fake || fake.kind !== "FAKE")) throw new PilotError("FakeTransportRequired");
  if (config.mode === "LIVE" && fake) throw new PilotError("LiveTransportCannotBeOverridden");
  if (config.mode === "FAKE") {
    if ((config.transportProtocol ?? null) !== (fake?.protocol ?? null)) throw new PilotError(config.transportProtocol === "NOVA_CONVERSE_MEASURED" || fake?.protocol === "NOVA_CONVERSE_MEASURED" ? "NOVA_TRANSPORT_REQUIRED" : "MANTLE_TRANSPORT_REQUIRED");
    if (!!fake?.billedCount !== (config.transportProtocol === "NOVA_CONVERSE_MEASURED")) throw new PilotError("BILLED_COUNT_DECLARATION_MISMATCH");
  }
  // Owner gates, in order, before anything is claimed or sent: signed configuration (parseConfiguration),
  // pinned payload/clean checkout, installed trust root + signature, then the owner-issued ledger (read-only).
  if (config.mode === "LIVE" || options.verifiedPins) assertVerifiedPins(config, options.verifiedPins);
  const approval = config.mode === "LIVE" ? installedApproval(config) : null;
  if (approval && config.transportProtocol === "NOVA_CONVERSE_MEASURED") {
    assertIssuedLedger({ directory: approval.directory, approvalId: approval.approval.approvalId, approvalHash: digest(approval.approval), configHash });
    // Execution lock: all gates passed, nothing claimed, no credentials resolved, no request sent.
    if (NOVA_LIVE_EXECUTION_LOCKED) throw new PilotError("NOVA_LIVE_LOCKED");
  }
  const ledgerDirectory = approval?.directory ?? options.fixtureLedgerDirectory ?? path.join(path.dirname(path.resolve(directory)), "fixture-ledger");
  const approvalId = approval?.approval.approvalId ?? options.fixtureApprovalId ?? "fake-" + digest(path.resolve(directory));
  const approvalHash = approval ? digest(approval.approval) : digest({ authority: "FAKE_TEST_ONLY", approvalId, configHash });
  if (config.mode === "FAKE" && !options.resume && !fs.existsSync(path.join(ledgerDirectory, approvalId + ".jsonl"))) issueFixtureLedger(ledgerDirectory, approvalId, configHash, approvalHash);
  const ledger = openBudgetLedger({ directory: ledgerDirectory, approvalId, approvalHash, configHash, runDirectory: directory, mode: config.mode, resume: !!options.resume });
  const transport = fake ?? (config.transportProtocol === "NOVA_CONVERSE_MEASURED" ? createLiveNovaTransport() : liveTransport());
  let journal: ReturnType<typeof openJournal>;
  try {
    if (!options.resume) {
      fs.mkdirSync(directory);
      atomicCreate(path.join(directory, "manifest.json"), redact({ version: "bedrock-evaluation-v2", createdAt: new Date().toISOString(), mode: config.mode, approvalId, configHash, target, config }));
    } else {
      const m = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
      if (m.configHash !== configHash || m.approvalId !== approvalId || digest(m.target) !== digest(target)) throw new PilotError("RESUME_MANIFEST_MISMATCH");
    }
    journal = openJournal(path.join(directory, "results.jsonl"), !options.resume);
  } catch (e) { ledger.close(); throw e; }
  let chain: Promise<unknown> = Promise.resolve(), closed = false, fatal = false;
  const append = (record: unknown) => { try { journal.append(redact({ target, approvalId, configHash, ...record as object })); } catch (e) { fatal = true; throw e; } };
  const save = (patch: Partial<ReturnType<typeof ledger.state>>, event: string) => ledger.save({ ...ledger.state(), ...patch }, event);
  const authorize = () => {
    if (closed || fatal || ledger.state().stopped) throw new PilotError("BudgetStopped");
    assertCurrentAuthorization(config);
    if (config.mode === "LIVE" || options.verifiedPins) assertVerifiedPins(config, options.verifiedPins);
    if (config.mode === "LIVE") { const current = installedApproval(config); if (current.directory !== ledgerDirectory || digest(current.approval) !== approvalHash) throw new PilotError("APPROVAL_AUTHORITY_CHANGED"); }
  };
  const inputFor = (prompt: Prompt) => {
    const hash = digest({ system: prompt.system, user: prompt.user });
    if (!config.pins.promptHashes.includes(hash)) throw new PilotError("PromptNotFrozen");
    const input = buildConverseTextInput({ system: prompt.system, userText: prompt.user, modelId: target.identifier, maxTokens: config.parameters.maxTokens, temperature: config.parameters.temperature });
    if (config.parameters.topP !== undefined) input.inferenceConfig!.topP = config.parameters.topP;
    return { hash, input };
  };
  async function count(prompt: Prompt) {
    authorize(); const { hash, input } = inputFor(prompt); const state = ledger.state();
    if (state.counts[hash] !== undefined) return state.counts[hash];
    if (state.countCalls >= config.budget.maxCalls) throw new PilotError("CountApiBudgetStopped");
    // A billed measured preflight sends the full prompt before its size is known: reserve the per-call input cap
    // plus its 1 output token durably first, then reconcile to AWS-reported usage (which may exceed the reservation).
    const billed = !!transport.billedCount, reserveIn = config.budget.maxInputTokensPerCall, reserveOut = 1;
    if (billed && (state.inputTokens + reserveIn > config.budget.maxInputTokens || state.outputTokens + reserveOut > config.budget.maxOutputTokens || estimatedCost(config, state.inputTokens + reserveIn, state.outputTokens + reserveOut) > config.budget.maxEstimatedUsd)) {
      save({ stopped: true }, "MEASURE_BUDGET_REJECTED"); append({ event: "TOKEN_PREFLIGHT_FAILED", promptHash: hash, category: "MEASURE_BUDGET_REJECTED" }); throw new PilotError("TokenPreflightFailed");
    }
    save({ countCalls: state.countCalls + 1, ...(billed ? { inputTokens: state.inputTokens + reserveIn, outputTokens: state.outputTokens + reserveOut, estimatedUsd: estimatedCost(config, state.inputTokens + reserveIn, state.outputTokens + reserveOut) } : {}) }, billed ? "MEASURE_RESERVED" : "COUNT_RESERVED");
    let countResponse: ReturnType<typeof protect> | undefined, countWire: unknown;
    try {
      const response = await deadline(config.parameters.timeoutMs, (signal) => transport.count(input, signal));
      const tokens = typeof response === "number" ? response : response.inputTokens;
      if (typeof response !== "number") {
        countResponse = protect(response.providerResponse); countWire = response.wire;
        append({ event: "COUNT_RESPONSE", promptHash: hash, providerResponse: countResponse, wire: countWire });
      }
      if (billed) {
        const u = typeof response === "number" ? undefined : response.billedUsage;
        if (!u || !Number.isInteger(u.inputTokens) || u.inputTokens < 0 || u.inputTokens !== tokens || !Number.isInteger(u.outputTokens) || u.outputTokens < 0 || u.outputTokens > reserveOut) throw new PilotError("MEASURE_USAGE_UNKNOWN", { unknownUsage: true });
        const latest = ledger.state(), inputTokens = latest.inputTokens - reserveIn + u.inputTokens, outputTokens = latest.outputTokens - reserveOut + u.outputTokens;
        save({ inputTokens, outputTokens, estimatedUsd: estimatedCost(config, inputTokens, outputTokens) }, "MEASURE_RECONCILED");
        append({ event: "MEASURE_BILLED", promptHash: hash, inputTokens: u.inputTokens, outputTokens: u.outputTokens });
      }
      if (!Number.isInteger(tokens) || tokens < 0 || tokens > config.budget.maxInputTokensPerCall) throw new PilotError("InputTokenPreflightFailed");
      authorize(); save({ counts: { ...ledger.state().counts, [hash]: tokens } }, "COUNT_RECORDED");
      append({ event: "TOKEN_PREFLIGHT", promptHash: hash, inputTokens: tokens, inferenceCalls: 0,
        ...(countResponse ? { providerResponse: countResponse, wire: countWire } : {}) }); return tokens;
    } catch (e) { save({ stopped: true, failures: ledger.state().failures + 1 }, "COUNT_FAILED"); append({ event: "TOKEN_PREFLIGHT_FAILED", promptHash: hash, category: category(e),
      ...(countResponse ? { providerResponse: countResponse, wire: countWire } : !!transport.protocol && e instanceof PilotError ? { providerResponse: protect(e.details.providerResponse ?? null), wire: e.details.wire ?? null } : {}) }); throw new PilotError("TokenPreflightFailed"); }
  }
  async function attempt(prompt: Prompt, attemptKey?: string) {
    authorize(); const { hash, input } = inputFor(prompt), before = ledger.state();
    const key = attemptKey ?? "attempt-" + (before.attempts + 1);
    if (before.attemptKeys.includes(key)) throw new PilotError("ATTEMPT_ALREADY_RESERVED");
    if (config.mode === "LIVE" && config.pins.promptHashes.some((h) => before.counts[h] === undefined)) throw new PilotError("BatchTokenPreflightRequired");
    if (before.failures >= config.budget.maxFailures || before.attempts >= config.budget.maxCalls) throw new PilotError("BudgetStopped");
    const started = Date.now(), countStarted = Date.now();
    const inputCount = await count(prompt), countLatencyMs = Date.now() - countStarted;
    authorize(); const s = ledger.state(), cap = config.parameters.maxTokens;
    if (s.inputTokens + inputCount > config.budget.maxInputTokens || s.outputTokens + cap > config.budget.maxOutputTokens || estimatedCost(config, s.inputTokens + inputCount, s.outputTokens + cap) > config.budget.maxEstimatedUsd) {
      save({ stopped: true }, "BUDGET_REJECTED"); append({ event: "REJECTED", reason: "BUDGET_REJECTED", attemptKey: key, promptHash: hash });
      const rejected = { event: "ATTEMPT_FINISHED", attemptKey: key, promptHash: hash, rawText: null, parsedCandidate: null, parseError: null, providerError: "BUDGET_REJECTED", inputTokens: null, outputTokens: null, latencyMs: Date.now() - started, inferenceLatencyMs: null, countLatencyMs, stopReason: null, estimatedUsd: null, target, conservativeReservationRetained: false };
      append(rejected); return rejected;
    }
    append({ event: "ATTEMPT_STARTED", attemptKey: key, promptHash: hash });
    // Durable reservation precedes ANY inference; no refund for an unknown outcome.
    save({ attempts: s.attempts + 1, inferenceCalls: s.inferenceCalls + 1, inputTokens: s.inputTokens + inputCount, outputTokens: s.outputTokens + cap, estimatedUsd: estimatedCost(config, s.inputTokens + inputCount, s.outputTokens + cap), attemptKeys: [...s.attemptKeys, key] }, "INFERENCE_RESERVED");
    append({ event: "INFERENCE_RESERVED", attemptKey: key, promptHash: hash, inputTokens: inputCount, outputTokenCap: cap });
    let rawText: string | null = null, parsedCandidate: unknown = null, parseError: string | null = null, providerError: string | null = null, stopReason: string | null = null;
    let inputTokens: number | null = null, outputTokens: number | null = null, reconciled = false;
    let providerResponse: ReturnType<typeof protect> | undefined, wire: unknown;
    const inferenceStarted = Date.now();
    try {
      const response = await deadline(config.parameters.timeoutMs, (signal) => transport.invoke(input, signal));
      if (transport.protocol) { providerResponse = protect(response.providerResponse ?? null); wire = response.wire; }
      rawText = (response.output?.message?.content ?? []).map((b) => "text" in b ? b.text ?? "" : "").join("");
      stopReason = response.stopReason ?? null; inputTokens = response.usage?.inputTokens ?? null; outputTokens = response.usage?.outputTokens ?? null;
      // First durable response copy. Later verification/summary failures retain it.
      const safeText = protect(rawText);
      append({ event: "RAW_RESPONSE", attemptKey: key, promptHash: hash, rawText: safeText.value, rawTextHash: safeText.receipt.storedHash, representation: safeText.receipt, inputTokens, outputTokens, stopReason,
        ...(providerResponse ? { providerResponse, wire } : {}) });
      if (inputTokens !== inputCount || !Number.isInteger(outputTokens) || outputTokens! < 0 || outputTokens! > cap) { save({ stopped: true }, "USAGE_MISMATCH"); providerError = "USAGE_MISMATCH_OR_UNKNOWN"; }
      else {
        const latest = ledger.state(); save({ outputTokens: latest.outputTokens - cap + outputTokens!, estimatedUsd: estimatedCost(config, latest.inputTokens, latest.outputTokens - cap + outputTokens!) }, "USAGE_RECONCILED"); reconciled = true;
        try { parseConverseText(response); } catch { providerError = "MODEL_REFUSAL"; }
        if (!providerError) { try { parsedCandidate = JSON.parse(rawText); } catch { parseError = "INVALID_JSON"; }
          if (!parseError && !outputSchema.safeParse(parsedCandidate).success) parseError = "SCHEMA_INVALID";
        }
      }
    } catch (e) { if (fatal) throw e; providerError = category(e);
      if (!!transport.protocol && e instanceof PilotError) {
        providerResponse = protect(e.details.providerResponse ?? null); wire = e.details.wire ?? null;
        append({ event: "PROVIDER_RESPONSE_REJECTED", attemptKey: key, providerResponse, wire, category: providerError });
        if (e.details.unknownUsage === true) save({ stopped: true }, "USAGE_UNKNOWN");
      }
    }
    const safeText = protect(rawText), safeCandidate = protect(parsedCandidate);
    if (!providerError && !parseError && !outputSchema.safeParse(safeCandidate.value).success) parseError = "REDACTION_SCHEMA_CHANGED";
    if (providerError || parseError) { const failures = ledger.state().failures + 1; save({ failures, stopped: ledger.state().stopped || failures >= config.budget.maxFailures }, "ATTEMPT_FAILED"); }
    const representation = { version: "redacted-canonical-v1", rawText: safeText.receipt, candidate: safeCandidate.receipt,
      scoringDisposition: safeText.receipt.changed || safeCandidate.receipt.changed ? "REDACTED_NOT_SCORED" : "UNCHANGED" };
    const result = { event: "ATTEMPT_FINISHED", executionMode: config.mode, attemptKey: key, promptHash: hash, rawText: safeText.value as string | null, rawTextHash: rawText === null ? null : safeText.receipt.storedHash, parsedCandidate: safeCandidate.value, representation, parseError, providerError, inputTokens, outputTokens,
      latencyMs: Date.now() - started, countLatencyMs, inferenceLatencyMs: Date.now() - inferenceStarted, stopReason, target,
      ...(providerResponse ? { providerResponse, wire } : {}),
      estimatedUsd: reconciled ? estimatedCost(config, inputTokens!, outputTokens!) : null, conservativeReservationRetained: !reconciled };
    append(result); return result;
  }
  return { configHash, target, approvalId, records: () => structuredClone(journal.records), state: () => ledger.state(),
    previewTokenCounts(prompts: Prompt[]) { const next = chain.then(async () => { const receipts = []; for (const prompt of prompts) receipts.push({ promptHash: inputFor(prompt).hash, inputTokens: await count(prompt), target }); return receipts; }); chain = next.catch(() => undefined); return next; },
    evaluate(prompt: Prompt, attemptKey?: string) { const next = chain.then(() => attempt(prompt, attemptKey)); chain = next.catch(() => undefined); return next; },
    async close() { await chain; if (!closed) { closed = true; ledger.close(); } },
  };
}
