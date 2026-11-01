/** DEV-only transport. LIVE also requires installed owner trust and verified inputs. */
import fs from "node:fs";
import path from "node:path";
import { ConverseCommand, CountTokensCommand, type ConverseCommandInput, type ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { BEDROCK_REGION, bedrockRuntimeDeps, buildConverseTextInput, parseConverseText } from "../../services/bedrock.client";
import { AnalysisEnvelopeSchema, type Prompt } from "../ai-coach-dev/pipeline";
import { digest } from "../evaluation-kit/identity";
import { approvedConfigurationHash, assertCurrentAuthorization, estimatedCost, parseConfiguration, PilotError, type SessionConfig } from "./config";
import { installedApproval, issueFixtureLedger, openBudgetLedger } from "./ledger";
import { atomicCreate, openJournal } from "./storage";
import { assertVerifiedPins, type VerifiedPins } from "./pins";
export { approvedConfigurationHash, SessionConfigSchema, type SessionConfig } from "./config";

export interface EvaluationTransport {
  kind: "FAKE" | "LIVE";
  count(input: ConverseCommandInput, signal: AbortSignal): Promise<number>;
  invoke(input: ConverseCommandInput, signal: AbortSignal): Promise<ConverseCommandOutput>;
}
export function inferenceTarget(c: SessionConfig) {
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
export function redact(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED]").replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]").replace(/((?:api[_-]?key|secret(?:accesskey)?|sessiontoken|password)\s*["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[REDACTED]");
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /credential|api.?key|secret|password|sessiontoken/i.test(k) ? "[REDACTED]" : redact(v)]));
  return value;
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
  if (config.mode === "FAKE" && (!fake || fake.kind !== "FAKE")) throw new PilotError("FakeTransportRequired");
  if (config.mode === "LIVE" && fake) throw new PilotError("LiveTransportCannotBeOverridden");
  if (config.mode === "LIVE" || options.verifiedPins) assertVerifiedPins(config, options.verifiedPins);
  const approval = config.mode === "LIVE" ? installedApproval(config) : null;
  const ledgerDirectory = approval?.directory ?? options.fixtureLedgerDirectory ?? path.join(path.dirname(path.resolve(directory)), "fixture-ledger");
  const approvalId = approval?.approval.approvalId ?? options.fixtureApprovalId ?? "fake-" + digest(path.resolve(directory));
  const approvalHash = approval ? digest(approval.approval) : digest({ authority: "FAKE_TEST_ONLY", approvalId, configHash });
  if (config.mode === "FAKE" && !options.resume && !fs.existsSync(path.join(ledgerDirectory, approvalId + ".jsonl"))) issueFixtureLedger(ledgerDirectory, approvalId, configHash, approvalHash);
  const ledger = openBudgetLedger({ directory: ledgerDirectory, approvalId, approvalHash, configHash, runDirectory: directory, mode: config.mode, resume: !!options.resume });
  const transport = fake ?? liveTransport();
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
    save({ countCalls: state.countCalls + 1 }, "COUNT_RESERVED");
    try {
      const tokens = await deadline(config.parameters.timeoutMs, (signal) => transport.count(input, signal));
      if (!Number.isInteger(tokens) || tokens < 0 || tokens > config.budget.maxInputTokensPerCall) throw new PilotError("InputTokenPreflightFailed");
      authorize(); save({ counts: { ...ledger.state().counts, [hash]: tokens } }, "COUNT_RECORDED");
      append({ event: "TOKEN_PREFLIGHT", promptHash: hash, inputTokens: tokens, inferenceCalls: 0 }); return tokens;
    } catch (e) { save({ stopped: true, failures: ledger.state().failures + 1 }, "COUNT_FAILED"); append({ event: "TOKEN_PREFLIGHT_FAILED", promptHash: hash, category: category(e) }); throw new PilotError("TokenPreflightFailed"); }
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
      return { event: "ATTEMPT_FINISHED", attemptKey: key, promptHash: hash, rawText: null, parsedCandidate: null, parseError: null, providerError: "BUDGET_REJECTED", inputTokens: null, outputTokens: null, latencyMs: Date.now() - started, inferenceLatencyMs: null, countLatencyMs, stopReason: null, estimatedUsd: null, target, conservativeReservationRetained: false };
    }
    append({ event: "ATTEMPT_STARTED", attemptKey: key, promptHash: hash });
    // Durable reservation precedes ANY inference; no refund for an unknown outcome.
    save({ attempts: s.attempts + 1, inferenceCalls: s.inferenceCalls + 1, inputTokens: s.inputTokens + inputCount, outputTokens: s.outputTokens + cap, estimatedUsd: estimatedCost(config, s.inputTokens + inputCount, s.outputTokens + cap), attemptKeys: [...s.attemptKeys, key] }, "INFERENCE_RESERVED");
    append({ event: "INFERENCE_RESERVED", attemptKey: key, promptHash: hash, inputTokens: inputCount, outputTokenCap: cap });
    let rawText: string | null = null, parsedCandidate: unknown = null, parseError: string | null = null, providerError: string | null = null, stopReason: string | null = null;
    let inputTokens: number | null = null, outputTokens: number | null = null, reconciled = false;
    const inferenceStarted = Date.now();
    try {
      const response = await deadline(config.parameters.timeoutMs, (signal) => transport.invoke(input, signal));
      rawText = (response.output?.message?.content ?? []).map((b) => "text" in b ? b.text ?? "" : "").join("");
      stopReason = response.stopReason ?? null; inputTokens = response.usage?.inputTokens ?? null; outputTokens = response.usage?.outputTokens ?? null;
      // First durable response copy. Later verification/summary failures retain it.
      append({ event: "RAW_RESPONSE", attemptKey: key, promptHash: hash, rawText, rawTextHash: digest(rawText), inputTokens, outputTokens, stopReason });
      if (inputTokens !== inputCount || !Number.isInteger(outputTokens) || outputTokens! < 0 || outputTokens! > cap) { save({ stopped: true }, "USAGE_MISMATCH"); providerError = "USAGE_MISMATCH_OR_UNKNOWN"; }
      else {
        const latest = ledger.state(); save({ outputTokens: latest.outputTokens - cap + outputTokens!, estimatedUsd: estimatedCost(config, latest.inputTokens, latest.outputTokens - cap + outputTokens!) }, "USAGE_RECONCILED"); reconciled = true;
        try { parseConverseText(response); } catch { providerError = "MODEL_REFUSAL"; }
        if (!providerError) { try { parsedCandidate = JSON.parse(rawText); } catch { parseError = "INVALID_JSON"; }
          if (!parseError && !AnalysisEnvelopeSchema.safeParse(parsedCandidate).success) parseError = "SCHEMA_INVALID";
        }
      }
    } catch (e) { if (fatal) throw e; providerError = category(e); }
    if (providerError || parseError) { const failures = ledger.state().failures + 1; save({ failures, stopped: ledger.state().stopped || failures >= config.budget.maxFailures }, "ATTEMPT_FAILED"); }
    const result = { event: "ATTEMPT_FINISHED", executionMode: config.mode, attemptKey: key, promptHash: hash, rawText, rawTextHash: rawText === null ? null : digest(rawText), parsedCandidate, parseError, providerError, inputTokens, outputTokens,
      latencyMs: Date.now() - started, countLatencyMs, inferenceLatencyMs: Date.now() - inferenceStarted, stopReason, target,
      estimatedUsd: reconciled ? estimatedCost(config, inputTokens!, outputTokens!) : null, conservativeReservationRetained: !reconciled };
    append(result); return result;
  }
  return { configHash, target, approvalId, records: () => structuredClone(journal.records), state: () => ledger.state(),
    previewTokenCounts(prompts: Prompt[]) { const next = chain.then(async () => { const receipts = []; for (const prompt of prompts) receipts.push({ promptHash: inputFor(prompt).hash, inputTokens: await count(prompt), target }); return receipts; }); chain = next.catch(() => undefined); return next; },
    evaluate(prompt: Prompt, attemptKey?: string) { const next = chain.then(() => attempt(prompt, attemptKey)); chain = next.catch(() => undefined); return next; },
    async close() { await chain; if (!closed) { closed = true; ledger.close(); } },
  };
}
