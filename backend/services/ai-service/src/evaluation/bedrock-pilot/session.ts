/** DEV-only transport. LIVE also requires installed owner trust and verified inputs. */
import fs from "node:fs";
import path from "node:path";
import { ConverseCommand, CountTokensCommand, type ConverseCommandInput, type ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { BEDROCK_REGION, bedrockRuntimeDeps, buildConverseTextInput, parseConverseText } from "../../services/bedrock.client";
import { AnalysisEnvelopeSchema, type Prompt } from "../ai-coach-dev/pipeline";
import { ClaimAnalysisSchema, completeClaimEnvelopeV4, type ClaimEnvelopeDerivation } from "../ai-coach-claim-dev/pipeline";
import { canonical, digest } from "../evaluation-kit/identity";
import { protect, redact } from "../evaluation-kit/representation";
export { redact } from "../evaluation-kit/representation";
import { approvedConfigurationHash, assertCurrentAuthorization, estimatedCost, NOVA_TWO_PHASE, parseConfiguration, PilotError, type SessionConfig } from "./config";
import { approvalFromTrust, assertIssuedLedger, assertNovaLedgerScope, inferenceReleaseFile, installedApproval, installedTrust, issueFixtureLedger, MEASUREMENT_PHASE_EVENT, measurementPhaseRecord, openBudgetLedger, parseTrust, verifyInferenceRelease, type InferenceRelease } from "./ledger";
import { createLiveNovaTransport, createNovaRuntimeClient, novaRuntimeSend, type NovaSend } from "./nova-live-transport";
import { atomicCreate, openJournal } from "./storage";
import { assertVerifiedPins, type VerifiedPins } from "./pins";
import type { MantleWireIdentity } from "./mantle-transport";
import { serializeNova, type NovaWireIdentity } from "./nova-converse-transport";
import { assertCurrentInferenceRelease, dispatchWithInferenceRelease } from "./inference-release-deadline";
import type { NovaHttpAuthorization, NovaHttpSessionBinding } from "./nova-http-boundary";
import { assertNoObservedClockRollback } from "./nova-clock";
import { resolveNovaCredentials, consumeNovaCredentials, type NovaCredentialFixture, type NovaCredentialReceipt, type NovaStaticCredentials } from "./nova-credentials";
export { approvedConfigurationHash, SessionConfigSchema, type SessionConfig } from "./config";

type WireIdentity = MantleWireIdentity | NovaWireIdentity;
export interface EvaluationTransport {
  kind: "FAKE" | "LIVE";
  protocol?: "MANTLE_MESSAGES" | "NOVA_CONVERSE_MEASURED";
  /** The count is itself a billed model call (Nova measured preflight); its spend is reserved and reconciled. */
  billedCount?: boolean;
  count(input: ConverseCommandInput, signal: AbortSignal, authorization?: NovaHttpAuthorization): Promise<number | { inputTokens: number; providerResponse: unknown; wire: WireIdentity; billedUsage?: { inputTokens: number; outputTokens: number } }>;
  invoke(input: ConverseCommandInput, signal: AbortSignal, authorization?: NovaHttpAuthorization): Promise<ConverseCommandOutput & { providerResponse?: unknown; wire?: WireIdentity }>;
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
/**
 * TEST FIXTURE ONLY. Drives the complete Nova LIVE gate sequence with a fixture trust root, a FAKE_TEST_ONLY ledger
 * issue and a fixture send (optionally an actual SDK with an in-memory handler). A rehearsal never resolves real
 * credentials or accepts an OWNER_SIGNED ledger; fixture and real owner authorities cannot be combined.
 */
export interface LiveRehearsal { trust: unknown; send: NovaSend; credentialFixture?: NovaCredentialFixture; resolvedSend?: (credentials: NovaStaticCredentials, binding: NovaHttpSessionBinding) => NovaSend }
/** measureOnly: two-phase Nova LIVE measurement phase (4 billed measurements, then a durable stop; never inference). */
export interface SessionOptions { resume?: boolean; fixtureLedgerDirectory?: string; fixtureApprovalId?: string; verifiedPins?: VerifiedPins; liveRehearsal?: LiveRehearsal; measureOnly?: boolean; preparedCredentials?: NovaCredentialReceipt }
/** The exact Converse input the session sends for a prompt (shared with the runner's payload-approval check). */
export function converseInput(config: SessionConfig, prompt: Prompt) {
  const input = buildConverseTextInput({ system: prompt.system, userText: prompt.user, modelId: inferenceTarget(config).identifier, maxTokens: config.parameters.maxTokens, temperature: config.parameters.temperature });
  if (config.parameters.topP !== undefined) input.inferenceConfig!.topP = config.parameters.topP;
  return input;
}
function admission(value: unknown, fake: EvaluationTransport | undefined, options: SessionOptions) {
  const config = parseConfiguration(value), configHash = approvedConfigurationHash(config), target = inferenceTarget(config);
  const nova = config.transportProtocol === "NOVA_CONVERSE_MEASURED", rehearsal = options.liveRehearsal;
  if (config.mode === "FAKE" && (!fake || fake.kind !== "FAKE")) throw new PilotError("FakeTransportRequired");
  if (config.mode === "LIVE" && fake) throw new PilotError("LiveTransportCannotBeOverridden");
  if (rehearsal && (config.mode !== "LIVE" || !nova || typeof rehearsal.send !== "function")) throw new PilotError("REHEARSAL_SCOPE_INVALID");
  if (config.mode === "FAKE") {
    if ((config.transportProtocol ?? null) !== (fake?.protocol ?? null)) throw new PilotError(config.transportProtocol === "NOVA_CONVERSE_MEASURED" || fake?.protocol === "NOVA_CONVERSE_MEASURED" ? "NOVA_TRANSPORT_REQUIRED" : "MANTLE_TRANSPORT_REQUIRED");
    if (!!fake?.billedCount !== (config.transportProtocol === "NOVA_CONVERSE_MEASURED")) throw new PilotError("BILLED_COUNT_DECLARATION_MISMATCH");
  }
  // Owner gates, in order, before anything is claimed or sent: signed configuration incl. Nova scope (parseConfiguration),
  // pinned payload/clean checkout, trust root + Ed25519 signature, then the issued ledger and its explicit scope (read-only).
  if (config.mode === "LIVE" || options.verifiedPins) assertVerifiedPins(config, options.verifiedPins);
  const currentApproval = () => rehearsal ? approvalFromTrust(config, rehearsal.trust) : installedApproval(config);
  const liveAuthority = rehearsal ? "FAKE_TEST_ONLY" as const : "OWNER_SIGNED" as const;
  const approval = config.mode === "LIVE" ? currentApproval() : null;
  // Two-phase Nova LIVE. The first run must be measure-only; inference only resumes with an owner-signed release that
  // binds this approval, configuration and the recorded measurement phase. Checked before the ledger is claimed or resumed.
  const twoPhase = config.novaScope?.phases === NOVA_TWO_PHASE, inferencePhase = twoPhase && !options.measureOnly;
  if (options.measureOnly && !twoPhase) throw new PilotError("MEASURE_ONLY_REQUIRES_TWO_PHASE_SCOPE");
  if (twoPhase && !options.resume && !options.measureOnly) throw new PilotError("TWO_PHASE_STARTS_WITH_MEASURE_ONLY");
  if (approval && nova) {
    // Only a two-phase resume may continue an already-claimed issue (same binding and scope; openBudgetLedger then
    // requires the same run directory). One-shot LIVE keeps the unused-issue requirement unchanged.
    const issued = assertIssuedLedger({ directory: approval.directory, approvalId: approval.approval.approvalId, approvalHash: digest(approval.approval), configHash, authority: liveAuthority, allowClaimed: twoPhase && !!options.resume });
    assertNovaLedgerScope(issued, config);
  }
  const currentTrust = () => rehearsal ? parseTrust(rehearsal.trust) : installedTrust();
  const releaseFor = (a: NonNullable<typeof approval>): InferenceRelease => {
    const measurement = measurementPhaseRecord(a.directory, a.approval.approvalId);
    if (!measurement) throw new PilotError("MEASUREMENT_PHASE_INCOMPLETE");
    const file = inferenceReleaseFile(a.directory, a.approval.approvalId);
    if (!fs.existsSync(file)) throw new PilotError("INFERENCE_RELEASE_REQUIRED");
    if (fs.lstatSync(file).isSymbolicLink()) throw new PilotError("INFERENCE_RELEASE_INVALID");
    let value: unknown; try { value = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new PilotError("INFERENCE_RELEASE_INVALID"); }
    return verifyInferenceRelease({ release: value, trust: currentTrust(), approval: a.approval, configHash, measurement });
  };
  const release: InferenceRelease | null = inferencePhase && approval ? releaseFor(approval) : null;
  if (inferencePhase && !release) throw new PilotError("INFERENCE_RELEASE_REQUIRED");
  return { config, configHash, target, nova, rehearsal, currentApproval, liveAuthority, approval, twoPhase, inferencePhase, release };
}
const credentialBinding = (a: ReturnType<typeof admission>) => digest({ configHash: a.configHash, approvalHash: digest(a.approval?.approval),
  directory: a.approval?.directory, profile: a.config.novaScope?.awsProfile, inferencePhase: a.inferencePhase, releaseHash: a.release ? digest(a.release) : null });
/** Upper bound of one phase's execution: every call in the phase at its full timeout, plus fixed slack. */
export const NOVA_PHASE_SLACK_MS = 5 * 60 * 1000;
const phaseWindowMs = (a: ReturnType<typeof admission>, options: SessionOptions) => {
  const s = a.config.novaScope!, calls = options.measureOnly ? s.measureCalls : a.inferencePhase ? s.inferenceCalls : s.measureCalls + s.inferenceCalls;
  return calls * a.config.parameters.timeoutMs + NOVA_PHASE_SLACK_MS;
};
const rollbackEvidence = (a: ReturnType<typeof admission>, directory: string) => a.approval ? [
  path.join(a.approval.directory, a.approval.approval.approvalId + ".jsonl"),
  ...(a.inferencePhase ? [inferenceReleaseFile(a.approval.directory, a.approval.approval.approvalId)] : []),
  ...["manifest.json", "results.jsonl", "pilot.jsonl"].map((f) => path.join(directory, f)),
] : [];
/** Async credential phase BEFORE any claim/reservation. All authority/issued-ledger checks are read-only here. */
export async function openPreparedEvaluationSession(value: unknown, directory: string, fake?: EvaluationTransport, options: SessionOptions = {}) {
  const parsed = parseConfiguration(value);
  if (parsed.mode !== "LIVE" || parsed.transportProtocol !== "NOVA_CONVERSE_MEASURED" || (options.liveRehearsal && !options.liveRehearsal.credentialFixture)) return openEvaluationSession(value, directory, fake, options);
  const a = admission(value, fake, options);
  if (!a.approval || !a.nova || (a.rehearsal && !a.rehearsal.credentialFixture)) return openEvaluationSession(value, directory, fake, options);
  const assertAuthority = () => {
    assertCurrentAuthorization(a.config);
    const current = a.currentApproval();
    if (!current || current.directory !== a.approval!.directory || digest(current.approval) !== digest(a.approval!.approval)) throw new PilotError("APPROVAL_AUTHORITY_CHANGED");
    if (a.inferencePhase) assertCurrentInferenceRelease(a.release);
  };
  // A clock earlier than files this approval already produced must not judge expiry (cross-process rollback tripwire).
  // Real owner authority only: TEST FIXTURE rehearsals drive synthetic clocks against real file times by design.
  if (!a.rehearsal) assertNoObservedClockRollback(rollbackEvidence(a, directory));
  const preparedCredentials = await resolveNovaCredentials({ profile: a.config.novaScope!.awsProfile, binding: credentialBinding(a),
    validUntil: a.release?.expiresAt ?? a.approval.approval.expiresAt, assertAuthority, phaseWindowMs: phaseWindowMs(a, options),
    expiryCategory: a.inferencePhase ? "INFERENCE_RELEASE_EXPIRED" : "LiveNotApproved" }, a.rehearsal?.credentialFixture);
  // Pins, signature, release and issued ledger are rechecked after provider IO and again before claim.
  assertVerifiedPins(a.config, options.verifiedPins); assertAuthority();
  return openEvaluationSession(value, directory, fake, { ...options, preparedCredentials });
}
export function openEvaluationSession(value: unknown, directory: string, fake?: EvaluationTransport, options: SessionOptions = {}) {
  const a = admission(value, fake, options);
  const { config, configHash, target, nova, rehearsal, currentApproval, liveAuthority, approval, twoPhase, inferencePhase, release } = a;
  const outputSchema = config.outputContract === "CLAIM_MAP_V3" ? ClaimAnalysisSchema : AnalysisEnvelopeSchema;
  const credentials = approval && nova && (!rehearsal || rehearsal.credentialFixture) ? consumeNovaCredentials(options.preparedCredentials, credentialBinding(a), !!rehearsal) : null;
  const ledgerDirectory = approval?.directory ?? options.fixtureLedgerDirectory ?? path.join(path.dirname(path.resolve(directory)), "fixture-ledger");
  const approvalId = approval?.approval.approvalId ?? options.fixtureApprovalId ?? "fake-" + digest(path.resolve(directory));
  const approvalHash = approval ? digest(approval.approval) : digest({ authority: "FAKE_TEST_ONLY", approvalId, configHash });
  if (config.mode === "FAKE" && !options.resume && !fs.existsSync(path.join(ledgerDirectory, approvalId + ".jsonl"))) issueFixtureLedger(ledgerDirectory, approvalId, configHash, approvalHash);
  if (approval && nova && !rehearsal) assertNoObservedClockRollback(rollbackEvidence(a, directory));
  const ledger = openBudgetLedger({ directory: ledgerDirectory, approvalId, approvalHash, configHash, runDirectory: directory, mode: config.mode, resume: !!options.resume, liveAuthority });
  if (twoPhase) {
    const s = ledger.state();
    // An unresolved billed measurement (reserved, never recorded) must not be re-sent on resume.
    const unresolved = s.countCalls !== Object.keys(s.counts).length;
    // The release must still describe the ledger as it is now, under the lock: same closing row and same counts.
    const drifted = !!release && (measurementPhaseRecord(ledgerDirectory, approvalId)?.hash !== release.measurementRecordHash || canonical(s.counts) !== canonical(release.measuredCounts));
    if (unresolved || drifted) { ledger.close(); throw new PilotError(unresolved ? "UNRESOLVED_MEASUREMENT_REQUIRES_OWNER_AUDIT" : "INFERENCE_RELEASE_MEASUREMENT_MISMATCH"); }
  }
  // Every gate has passed and the ledger is claimed: only now is a LIVE IO built. The real client exists only without a rehearsal.
  const httpBinding: NovaHttpSessionBinding | null = approval && nova ? Object.freeze({
    approvalId, approvalHash, configHash, ledgerDirectory, approvalExpiresAt: approval.approval.expiresAt,
    inferenceReleaseExpiresAt: release?.expiresAt ?? null,
    scope: options.measureOnly ? "MEASURE_ONLY" : inferencePhase ? "INFERENCE_ONLY" : "ONE_SHOT",
  }) : null;
  let transport: EvaluationTransport;
  try { transport = fake ?? (nova ? createLiveNovaTransport(rehearsal ? (credentials && rehearsal.resolvedSend ? rehearsal.resolvedSend(credentials.credentials, httpBinding!) : rehearsal.send) : novaRuntimeSend(createNovaRuntimeClient(config.novaScope!.awsProfile, credentials!.credentials), httpBinding!)) : liveTransport()); }
  catch (error) { ledger.close(); throw error; }
  let journal: ReturnType<typeof openJournal>;
  try {
    if (!options.resume) {
      fs.mkdirSync(directory);
      atomicCreate(path.join(directory, "manifest.json"), redact({ version: "bedrock-evaluation-v2", createdAt: new Date().toISOString(), mode: config.mode, approvalId, configHash, target, config, ...(rehearsal ? { rehearsal: "TEST_FIXTURE_NO_AWS_CALL" } : {}) }));
    } else {
      const m = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
      if (m.configHash !== configHash || m.approvalId !== approvalId || digest(m.target) !== digest(target)) throw new PilotError("RESUME_MANIFEST_MISMATCH");
    }
    journal = openJournal(path.join(directory, "results.jsonl"), !options.resume);
  } catch (e) { ledger.close(); throw e; }
  let chain: Promise<unknown> = Promise.resolve(), closed = false, fatal = false;
  const append = (record: unknown) => { try { journal.append(redact({ target, approvalId, configHash, ...record as object })); } catch (e) { fatal = true; throw e; } };
  const save = (patch: Partial<ReturnType<typeof ledger.state>>, event: string) => ledger.save({ ...ledger.state(), ...patch }, event);
  try { if (credentials) append({ event: "CREDENTIALS_PRE_RESOLVED", provider: "EXPLICIT_PROFILE_STS_ONCE", expiresAt: credentials.credentials.expiration.toISOString() }); }
  catch (error) { ledger.close(); throw error; }
  const authorize = () => {
    if (closed || fatal || ledger.state().stopped) throw new PilotError("BudgetStopped");
    credentials?.assertCurrent();
    assertCurrentAuthorization(config);
    if (config.mode === "LIVE" || options.verifiedPins) assertVerifiedPins(config, options.verifiedPins);
    if (config.mode === "LIVE") { const current = currentApproval(); if (current.directory !== ledgerDirectory || digest(current.approval) !== approvalHash) throw new PilotError("APPROVAL_AUTHORITY_CHANGED"); }
    // Pins/approval checks can cross the separately signed release's earlier expiry.
    if (inferencePhase) assertCurrentInferenceRelease(release);
  };
  const inputFor = (prompt: Prompt) => {
    const hash = digest({ system: prompt.system, user: prompt.user });
    if (!config.pins.promptHashes.includes(hash)) throw new PilotError("PromptNotFrozen");
    const input = converseInput(config, prompt);
    // Only the exact owner-approved token-bearing payloads may be sent.
    if (config.novaScope && !config.novaScope.tokenPayloadHashes.includes(serializeNova(input).identity.tokenPayloadHash)) throw new PilotError("NOVA_PAYLOAD_NOT_APPROVED");
    return { hash, input };
  };
  const dispatchAuthorized = <T>(dispatch: () => T): T => {
    // Reservations/persistence can outlive the approval after the earlier, expensive pins check.
    assertCurrentAuthorization(config);
    return inferencePhase ? dispatchWithInferenceRelease(release, dispatch) : dispatch();
  };
  const httpAuthorization = (phase: NovaHttpAuthorization["phase"], hash: string, input: ConverseCommandInput, ordinal: number, key: string): NovaHttpAuthorization | undefined => {
    if (!httpBinding) return undefined; // Historical FAKE/other transports keep their existing seam.
    const wire = serializeNova(input);
    const issued = { binding: httpBinding, phase, reservationOrdinal: ordinal, reservationId: `${phase}:${ordinal}:${key}`,
      promptHash: hash, tokenPayloadHash: wire.identity.tokenPayloadHash,
      requestHash: phase === "MEASURE" ? wire.identity.measureRequestHash : wire.identity.inferenceRequestHash };
    return Object.freeze({ ...issued,
      assertCurrent: (request: NovaHttpAuthorization) => {
        if (digest(issued) !== digest({ binding: request.binding, phase: request.phase, reservationOrdinal: request.reservationOrdinal,
          reservationId: request.reservationId, promptHash: request.promptHash, tokenPayloadHash: request.tokenPayloadHash, requestHash: request.requestHash })) throw new PilotError("NOVA_HTTP_AUTHORIZATION_MISMATCH");
        const s = ledger.state();
        if (closed || fatal || s.stopped) throw new PilotError("BudgetStopped");
        credentials?.assertCurrent();
        if ((phase === "MEASURE" && (s.countCalls !== ordinal || s.counts[hash] !== undefined)) ||
            (phase === "INFERENCE" && (s.inferenceCalls !== ordinal || s.attemptKeys[ordinal - 1] !== key))) throw new PilotError("NOVA_HTTP_RESERVATION_MISMATCH");
        assertCurrentAuthorization(config);
        const current = currentApproval();
        if (!current || current.directory !== ledgerDirectory || digest(current.approval) !== approvalHash) throw new PilotError("APPROVAL_AUTHORITY_CHANGED");
        if (inferencePhase) assertCurrentInferenceRelease(release);
      },
    });
  };
  async function count(prompt: Prompt) {
    authorize(); const { hash, input } = inputFor(prompt); const state = ledger.state();
    if (state.counts[hash] !== undefined) return state.counts[hash];
    // The inference phase only reuses the measurements the owner released; it never measures again.
    if (inferencePhase) throw new PilotError("MEASUREMENT_AFTER_RELEASE_FORBIDDEN");
    if (state.countCalls >= (config.novaScope?.measureCalls ?? config.budget.maxCalls)) throw new PilotError("CountApiBudgetStopped");
    // A billed measured preflight sends the full prompt before its size is known: reserve the per-call input cap
    // plus its 1 output token durably first, then reconcile to AWS-reported usage (which may exceed the reservation).
    const billed = !!transport.billedCount, reserveIn = config.budget.maxInputTokensPerCall, reserveOut = 1;
    if (billed && (state.inputTokens + reserveIn > config.budget.maxInputTokens || state.outputTokens + reserveOut > config.budget.maxOutputTokens || estimatedCost(config, state.inputTokens + reserveIn, state.outputTokens + reserveOut) > config.budget.maxEstimatedUsd)) {
      save({ stopped: true }, "MEASURE_BUDGET_REJECTED"); append({ event: "TOKEN_PREFLIGHT_FAILED", promptHash: hash, category: "MEASURE_BUDGET_REJECTED" }); throw new PilotError("TokenPreflightFailed");
    }
    save({ countCalls: state.countCalls + 1, ...(billed ? { inputTokens: state.inputTokens + reserveIn, outputTokens: state.outputTokens + reserveOut, estimatedUsd: estimatedCost(config, state.inputTokens + reserveIn, state.outputTokens + reserveOut) } : {}) }, billed ? "MEASURE_RESERVED" : "COUNT_RESERVED");
    let countResponse: ReturnType<typeof protect> | undefined, countWire: unknown;
    try {
      const authority = httpAuthorization("MEASURE", hash, input, state.countCalls + 1, hash);
      const response = await deadline(config.parameters.timeoutMs, (signal) => dispatchAuthorized(() => transport.count(input, signal, authority)));
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
    authorize();
    if (twoPhase && options.measureOnly) throw new PilotError("MEASURE_ONLY_SESSION");
    if (twoPhase && (!release || Date.parse(release.expiresAt) <= Date.now())) throw new PilotError(release ? "INFERENCE_RELEASE_EXPIRED" : "INFERENCE_RELEASE_REQUIRED");
    const { hash, input } = inputFor(prompt), before = ledger.state();
    const key = attemptKey ?? "attempt-" + (before.attempts + 1);
    if (before.attemptKeys.includes(key)) throw new PilotError("ATTEMPT_ALREADY_RESERVED");
    if (config.mode === "LIVE" && config.pins.promptHashes.some((h) => before.counts[h] === undefined)) throw new PilotError("BatchTokenPreflightRequired");
    if (before.failures >= config.budget.maxFailures || before.attempts >= Math.min(config.budget.maxCalls, config.novaScope?.inferenceCalls ?? Infinity)) throw new PilotError("BudgetStopped");
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
    let providerResponse: ReturnType<typeof protect> | undefined, wire: unknown, structuralDerivation: ClaimEnvelopeDerivation | null = null;
    const inferenceStarted = Date.now();
    try {
      const authority = httpAuthorization("INFERENCE", hash, input, s.inferenceCalls + 1, key);
      const response = await deadline(config.parameters.timeoutMs, (signal) => dispatchAuthorized(() => transport.invoke(input, signal, authority)));
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
          // V4/V4.1 only: with empty model-facing allowlists the model writes `analysis` alone; the empty link arrays are
          // server-derived and recorded below. rawText stays exactly as returned; every other shape is judged as produced.
          if (!parseError && (config.promptVersion === "CLAIM_PROMPT_V4" || config.promptVersion === "CLAIM_PROMPT_V4_1")) { const completed = completeClaimEnvelopeV4(prompt.user, parsedCandidate); parsedCandidate = completed.candidate; structuralDerivation = completed.derivation; }
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
      ...(structuralDerivation ? { structuralDerivation } : {}),
      estimatedUsd: reconciled ? estimatedCost(config, inputTokens!, outputTokens!) : null, conservativeReservationRetained: !reconciled };
    append(result); return result;
  }
  return { configHash, target, approvalId, records: () => structuredClone(journal.records), state: () => ledger.state(),
    previewTokenCounts(prompts: Prompt[]) { const next = chain.then(async () => { const receipts = []; for (const prompt of prompts) receipts.push({ promptHash: inputFor(prompt).hash, inputTokens: await count(prompt), target }); return receipts; }); chain = next.catch(() => undefined); return next; },
    evaluate(prompt: Prompt, attemptKey?: string) { const next = chain.then(() => attempt(prompt, attemptKey)); chain = next.catch(() => undefined); return next; },
    /** Two-phase measure-only: durably close the measurement phase in the ledger (idempotent) after all prompts are measured. */
    completeMeasurementPhase() {
      const next = chain.then(async () => {
        authorize();
        if (!twoPhase || !options.measureOnly) throw new PilotError("MEASURE_ONLY_SESSION_REQUIRED");
        const s = ledger.state(), unique = [...new Set(config.pins.promptHashes)];
        if (s.attempts !== 0 || s.inferenceCalls !== 0 || s.countCalls !== unique.length || Object.keys(s.counts).length !== unique.length || unique.some((h) => s.counts[h] === undefined)) throw new PilotError("MEASUREMENT_PHASE_INCOMPLETE");
        const existing = measurementPhaseRecord(ledgerDirectory, approvalId);
        const ledgerRecordHash = existing && canonical(existing.state) === canonical(s) ? existing.hash : save(s, MEASUREMENT_PHASE_EVENT);
        append({ event: MEASUREMENT_PHASE_EVENT, ledgerRecordHash, counts: s.counts });
        return { ledgerRecordHash, counts: s.counts, state: s, approvalId, approvalExpiresAt: approval?.approval.expiresAt ?? null };
      });
      chain = next.catch(() => undefined); return next;
    },
    inferenceRelease: () => release ? { releasedBy: release.releasedBy, expiresAt: release.expiresAt, measurementRecordHash: release.measurementRecordHash } : null,
    async close() { await chain; if (!closed) { closed = true; ledger.close(); } },
  };
}
