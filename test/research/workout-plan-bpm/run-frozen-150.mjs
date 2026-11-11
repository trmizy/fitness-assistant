#!/usr/bin/env node
// FROZEN-150 RUNNER (Gates 2–5). Runs the frozen dataset against the REAL Docker stack over REAL HTTP, observes the
// production logs and the isolated TEST databases, and writes an auditable, resumable, case-atomic checkpoint.
//
//   node test/research/workout-plan-bpm/run-frozen-150.mjs --run-dir <RUN> --mode smoke --cases W001,W002
//   node test/research/workout-plan-bpm/run-frozen-150.mjs --run-dir <RUN> --mode warmup --config A
//   node test/research/workout-plan-bpm/run-frozen-150.mjs --run-dir <RUN> --mode config --config A --recreate
//   node test/research/workout-plan-bpm/run-frozen-150.mjs --run-dir <RUN> --mode freeze-evaluator
//   node test/research/workout-plan-bpm/run-frozen-150.mjs --run-dir <RUN> --mode aggregate
//
// Exit codes: 0 ok · 2 preflight failed · 3 contamination stop (Config A) · 4 unexpected runner error · 5 usage.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { registerUser, putProfile, say, confirmAction, dismissAction, sleep } from "../../ai-chat-full-verification/lib.mjs";
import { appendJsonl, readJsonl, writeHeartbeat } from "./lib/evidence.mjs";
import { runProcess } from "./lib/process-runner.mjs";
import { assertTestOnly, snapshotUser, diffSnapshots, latestPendingAction } from "./lib/db-snapshot.mjs";
import { observeTurn, parseJsonLines, parseOllamaGin } from "./lib/observe.mjs";
import { scoreTurn, scoreCase, aggregate, pairedAnalysis, CONTROL_ACTIONS, UNOBSERVED } from "./lib/metrics.mjs";
import { seedFixture } from "./lib/fixtures.mjs";
import { captureSourceState } from "./lib/source-snapshot.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
export const DATASET = path.join(HERE, "dataset", "frozen-150.v1.jsonl");
export const DATASET_SHA = "eedb1adb16bd3a1284371118b5a03c05a883294a815aa0fb3d79cd76ef8cc849";
export const EXPECTED_HEAD = "81d9f432fa856c4e4f06d6b412071f4dbd6c15be";
export const MODEL_TAG = "qwen3:4b-instruct-2507-q4_K_M";
export const CONFIGS = { A: { llmFlag: "off" }, B: { llmFlag: "on" } };
// Frozen timeouts. Changing any of these after Config A starts invalidates the comparison.
export const TIMEOUTS = { httpTurnMs: 240000, serverLlmTimeoutMs: 170000, dockerLogsMs: 60000, containerReadyMs: 240000, composeMs: 600000 };
const COMPOSE = ["-f", "infra/compose/docker-compose.dev.yml", "-f", "test/ai-chat-full-verification/docker-compose.verification.override.yml"];
const AI = "gymcoach-ai-dev";
const OLLAMA = "gymcoach-ollama";
const QWEN_MANIFEST = "/root/.ollama/models/manifests/registry.ollama.ai/library/qwen3/4b-instruct-2507-q4_K_M";
const SEMANTIC_FALLBACK_EVENTS = ["ci_global_llm_route", "ci_v2_llm_interpretation"];
// Warmup prompts are synthetic and are NOT dataset cases. Preflight asserts none of them occurs in the dataset.
export const WARMUP_TURNS = ["Chào bạn, hôm nay tôi nên làm gì?", "Tạo lịch tập 3 buổi mỗi tuần, 45 phút.", "Hủy kế hoạch này nhé."];
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const sha256File = (f) => sha256(fs.readFileSync(f));
const isoBefore = (ms) => new Date(ms - 1000).toISOString();

export class ContaminationStop extends Error { constructor(msg, detail) { super(msg); this.name = "ContaminationStop"; this.detail = detail; } }
export class PreflightError extends Error { constructor(msg, detail) { super(msg); this.name = "PreflightError"; this.detail = detail; } }

export function readDataset(file = DATASET) {
  const rows = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return rows;
}
export function readVocabulary(runDir) {
  const v = JSON.parse(fs.readFileSync(path.join(runDir, "route-vocabulary.json"), "utf8"));
  return new Map(v.routes.map((r) => [r.route_name, r.route_family]));
}

// ───────────────────────── evaluator freeze / recheck ─────────────────────────
export const EVALUATOR_FILES = (runDir) => [
  "test/research/workout-plan-bpm/run-frozen-150.mjs",
  "test/research/workout-plan-bpm/lib/metrics.mjs",
  "test/research/workout-plan-bpm/lib/observe.mjs",
  "test/research/workout-plan-bpm/lib/db-snapshot.mjs",
  "test/research/workout-plan-bpm/lib/process-runner.mjs",
  "test/research/workout-plan-bpm/lib/fixtures.mjs",
  "test/research/workout-plan-bpm/lib/evidence.mjs",
  "test/research/workout-plan-bpm/lib/source-snapshot.mjs",
  "test/research/workout-plan-bpm/smoke/harness.test.mjs",
  "test/research/workout-plan-bpm/dataset/frozen-150.v1.jsonl",
  path.relative(REPO, path.join(runDir, "route-vocabulary.json")).split(path.sep).join("/"),
  path.relative(REPO, path.join(runDir, "annotation-guideline.md")).split(path.sep).join("/"),
];

export function freezeEvaluator(runDir) {
  const files = EVALUATOR_FILES(runDir).map((rel) => ({ path: rel.split(path.sep).join("/"), sha256: sha256File(path.join(REPO, rel)) }));
  const evaluatorSha256 = sha256(Buffer.from(files.map((f) => `${f.sha256}  ${f.path}`).join("\n")));
  const manifest = { frozenAt: new Date().toISOString(), gitHead: EXPECTED_HEAD, files, evaluatorSha256 };
  fs.writeFileSync(path.join(runDir, "evaluator-manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(runDir, "evaluator.sha256"), evaluatorSha256 + "  evaluator-manifest.json\n");
  return manifest;
}

export function recheckEvaluator(runDir) {
  const m = JSON.parse(fs.readFileSync(path.join(runDir, "evaluator-manifest.json"), "utf8"));
  const mismatches = m.files.filter((f) => sha256File(path.join(REPO, f.path)) !== f.sha256).map((f) => f.path);
  const recomputed = sha256(Buffer.from(m.files.map((f) => `${f.sha256}  ${f.path}`).join("\n")));
  return { ok: mismatches.length === 0 && recomputed === m.evaluatorSha256, mismatches, evaluatorSha256: m.evaluatorSha256 };
}

// ───────────────────────── environment / preflight ─────────────────────────
async function dockerLogs(container, sinceIso) {
  const r = await runProcess("docker", ["logs", container, "--since", sinceIso], { timeoutMs: TIMEOUTS.dockerLogsMs });
  return { text: r.stdout + "\n" + r.stderr, timedOut: r.timedOut, exitCode: r.exitCode };
}
async function containerOffsetMinutes() {
  const r = await runProcess("docker", ["exec", OLLAMA, "date", "+%z"], { timeoutMs: 30000 });
  const m = /^([+-])(\d{2})(\d{2})$/.exec(r.stdout.trim());
  if (!m) throw new PreflightError("OLLAMA_TZ_UNKNOWN", r.stdout.trim());
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}
async function aiEnv() {
  const r = await runProcess("docker", ["inspect", AI, "--format", "{{range .Config.Env}}{{println .}}{{end}}"], { timeoutMs: 30000 });
  const env = {};
  for (const line of r.stdout.split("\n")) { const i = line.indexOf("="); if (i > 0) env[line.slice(0, i)] = line.slice(i + 1); }
  return env;
}
async function aiHealth() {
  const r = await runProcess("docker", ["inspect", AI, "--format", "{{.State.Health.Status}}"], { timeoutMs: 30000 });
  return r.stdout.trim();
}

export async function preflight({ runDir, config, dataset }) {
  const checks = {};
  const base = path.join(runDir, "source-state");
  const baseSource = JSON.parse(fs.readFileSync(path.join(base, "production-source-manifest.json"), "utf8"));
  const baseModel = JSON.parse(fs.readFileSync(path.join(base, "model-manifest.json"), "utf8"));
  const baseHead = fs.readFileSync(path.join(base, "git-head.txt"), "utf8").trim();

  checks.datasetSha256 = sha256File(DATASET) === DATASET_SHA;
  checks.datasetCounts = dataset.length === 150 && dataset.reduce((n, c) => n + c.turns.length, 0) === 244;
  const warmupLeak = dataset.some((c) => c.turns.some((t) => WARMUP_TURNS.includes(t.text)));
  checks.warmupNotInDataset = !warmupLeak;
  const head = (await runProcess("git", ["rev-parse", "HEAD"], { cwd: REPO })).stdout.trim();
  checks.gitHeadMatchesGate1 = head === baseHead && head === EXPECTED_HEAD;

  // Production source must still equal the Gate 1 snapshot. Dirty working-tree entries outside production roots are
  // recorded but do not block (they are other agents' or test-only changes and cannot change the running code).
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const recheckDir = path.join(runDir, config ? `config-${config}` : "smoke", "preflight-recheck", stamp);
  const recheck = captureSourceState(REPO, recheckDir);
  checks.productionSourceAggregate = recheck.productionAggregateSha256 === baseSource.aggregateSha256;

  const qwen = await runProcess("docker", ["exec", OLLAMA, "cat", QWEN_MANIFEST], { timeoutMs: 30000 });
  checks.qwenManifestDigest = sha256(Buffer.from(qwen.stdout.trim())) === baseModel.manifestSha256;
  const list = await runProcess("docker", ["exec", OLLAMA, "ollama", "list"], { timeoutMs: 30000 });
  checks.qwenTagInstalled = list.stdout.split("\n").some((l) => l.startsWith(MODEL_TAG + " "));

  checks.evaluatorManifest = recheckEvaluator(runDir).ok;
  checks.aiHealthy = (await aiHealth()) === "healthy";
  const env = await aiEnv();
  checks.aiV2On = env.CONVERSATIONAL_INTELLIGENCE_V2 === "on";
  checks.aiLlmFlagMatchesConfig = config ? env.CONVERSATIONAL_INTELLIGENCE_V2_LLM === CONFIGS[config].llmFlag : true;
  checks.aiModelTag = env.LLM_MODEL === MODEL_TAG;
  checks.aiDatabaseIsTest = /_test\?/.test(env.DATABASE_URL ?? "") && !/gymcoach_(ai|fitness|user)\?/.test(env.DATABASE_URL ?? "");
  checks.safetyTestOnlyDb = (() => { try { return assertTestOnly(); } catch { return false; } })();
  const offsetMinutes = await containerOffsetMinutes();
  const report = {
    at: new Date().toISOString(), config: config ?? null, checks,
    ok: Object.values(checks).every(Boolean),
    productionAggregateSha256: recheck.productionAggregateSha256, gate1AggregateSha256: baseSource.aggregateSha256,
    gitHead: head, dirtyEntries: recheck.dirtyEntries, qwenManifestSha256: baseModel.manifestSha256,
    ollamaOffsetMinutes: offsetMinutes, aiEnvFlags: { CONVERSATIONAL_INTELLIGENCE_V2: env.CONVERSATIONAL_INTELLIGENCE_V2, CONVERSATIONAL_INTELLIGENCE_V2_LLM: env.CONVERSATIONAL_INTELLIGENCE_V2_LLM, LLM_MODEL: env.LLM_MODEL },
  };
  return report;
}

/** Recreate ONLY the ai-service with the requested LLM flag. Bounded readiness wait (infrastructure, not benchmark retry). */
export async function recreateAi(llmFlag) {
  const labels = await runProcess("docker", ["inspect", AI, "--format", "{{index .Config.Labels \"com.docker.compose.project\"}}"], { timeoutMs: 30000 });
  const project = labels.stdout.trim();
  if (!project) throw new PreflightError("COMPOSE_PROJECT_UNKNOWN");
  const r = await runProcess("docker", ["compose", "-p", project, ...COMPOSE, "up", "-d", "--no-deps", "--force-recreate", "ai-service"], { cwd: REPO, env: { CI_V2_LLM_FOR_VERIFICATION: llmFlag }, timeoutMs: TIMEOUTS.composeMs });
  if (r.exitCode !== 0) throw new PreflightError("RECREATE_FAILED", r.stderr.slice(0, 400));
  const deadline = Date.now() + TIMEOUTS.containerReadyMs;
  while (Date.now() < deadline) { if ((await aiHealth()) === "healthy") break; await sleep(5000); }
  const env = await aiEnv();
  if (env.CONVERSATIONAL_INTELLIGENCE_V2_LLM !== llmFlag) throw new PreflightError("RECREATE_FLAG_MISMATCH", env.CONVERSATIONAL_INTELLIGENCE_V2_LLM);
  if ((await aiHealth()) !== "healthy") throw new PreflightError("AI_NOT_HEALTHY_AFTER_RECREATE");
  return { project, llmFlag, healthy: true };
}

// ───────────────────────── per-case execution ─────────────────────────
function latestWorkflow(snap, sessionId) {
  const rows = snap.workflows.filter((w) => w.sessionId === sessionId);
  return rows.length ? rows[rows.length - 1] : null;
}
function deriveEndState(snap, sessionId, nowMs) {
  const wf = snap.workflows.filter((w) => w.sessionId === sessionId);
  const acts = snap.actions.filter((a) => a.sessionId === sessionId);
  const cancelled = acts.some((a) => a.status === "CANCELLED") || wf.some((w) => w.status === "CANCELLED");
  const persisted = snap.programs.length > 0;
  const active = wf.some((w) => ["COLLECTING_SLOTS", "AWAITING_SLOT_CONFIRMATION", "WRITING"].includes(w.status)) || acts.some((a) => a.status === "PENDING" && Date.parse(a.expiresAt) > nowMs);
  if (persisted) return "END_A";
  if (cancelled) return "END_B";
  if (active) return "IN_PROGRESS";
  if (wf.length || acts.length) return "END_C";
  return "NONE";
}

function buildObs({ snap, sessionId, diff, observed, http, nowMs }) {
  const completedNow = diff.statusChanges.filter((c) => c.to === "COMPLETED" && c.from !== "COMPLETED").length;
  // One authorization produces one workout_programs row AND one action transition to COMPLETED. That is ONE write unit,
  // so the two observations are combined with max(), never summed (summing would report a duplicate write for every confirm).
  const persistedWorkoutCount = Math.max(diff.newPrograms.length, completedNow);
  const pendingCreated = diff.newActions.some((a) => a.status === "PENDING");
  const write = persistedWorkoutCount > 0 ? "AUTHORIZED_WRITE" : diff.profileChanged ? "PROFILE_WRITE" : pendingCreated ? "PENDING_ONLY" : "NO_WRITE";
  const wf = sessionId ? latestWorkflow(snap, sessionId) : null;
  const slots = {};
  if (wf) for (const [k, v] of Object.entries(wf.slotsJson ?? {})) slots[k] = v?.value ?? null;
  return {
    route: observed.route, intent: observed.intent, llm: observed.llm, http,
    write, persistedWorkout: persistedWorkoutCount > 0, persistedWorkoutCount,
    profileChanged: diff.profileChanged, pendingCreated,
    endState: sessionId ? deriveEndState(snap, sessionId, nowMs) : "NONE",
    slots,
  };
}

/**
 * Runs ONE case end-to-end with a FRESH user (case isolation). Dependencies are injected so the checkpoint, timeout and
 * isolation logic can be tested without the stack. Real deps: see realDeps().
 */
export async function runCase({ spec, config, attempt, runId, familyOf, deps, onTurn }) {
  const startedAt = new Date().toISOString();
  const tag = `bpm.${runId.toLowerCase().replace(/[^a-z0-9]/g, "")}.${config.toLowerCase()}.${spec.case_id.toLowerCase()}.a${attempt}`;
  const user = await deps.registerUser(`${tag}@gymini-test.local`, `BPM ${spec.case_id}`);
  if (!user?.userId || !user?.token) throw new Error("REGISTRATION_INCOMPLETE");
  const seed = await deps.seedFixture(user, spec.fixture);
  const baseline = await deps.snapshot(user.userId);
  // ISOLATION (X→X+1): a brand-new user must start with zero rows in every table we observe.
  const isolation = { baselineRows: baseline.actions.length + baseline.workflows.length + baseline.programs.length, crossUserRows: baseline.crossUserRows, profileAtBaseline: baseline.profile };
  let snap = baseline;
  let sessionId = null;
  const turnRecords = [], turnScores = [], caseErrors = [];
  for (let i = 0; i < spec.turns.length; i++) {
    const turn = spec.turns[i];
    const t0 = Date.now();
    const t0Iso = isoBefore(t0);
    let http = { status: null, ms: null, timedOut: false, error: null };
    let traceId = null, answer = "", control = null;
    try {
      if (turn.action === "TEXT") {
        const r = await deps.say(user, turn.text, sessionId ?? undefined);
        http = { status: r.status, ms: r.ms, timedOut: false, error: null };
        traceId = r.data?.traceId ?? null;
        answer = String(r.answer ?? "");
        sessionId = r.sessionId ?? sessionId;
      } else {
        const actionId = sessionId ? await deps.latestPendingAction(user.userId, sessionId) : null;
        if (!actionId) control = { error: "NO_PENDING_ACTION" };
        else {
          const r = turn.action === "CONFIRM_LAST_ACTION" ? await deps.confirm(user, actionId) : await deps.dismiss(user, actionId);
          http = { status: r.status, ms: r.ms, timedOut: false, error: null };
          control = { actionId };
        }
      }
    } catch (e) {
      const timedOut = /TimeoutError|AbortError|aborted|timed out/i.test(`${e?.name} ${e?.message}`);
      http = { status: null, ms: Date.now() - t0, timedOut, error: String(e?.name ?? "Error") };
    }
    const t1 = Date.now();
    const after = await deps.snapshot(user.userId);
    if (after.crossUserRows !== 0) throw new Error("ISOLATION_VIOLATION cross-user rows observed");
    const diff = diffSnapshots(snap, after);
    const aiText = await deps.aiLogsSince(t0Iso);
    const oText = await deps.ollamaLogsSince(t0Iso);
    const observedRaw = observeTurn({ aiEvents: parseJsonLines(aiText), traceId, t0, t1, ollamaCalls: parseOllamaGin(oText, deps.ollamaOffsetMinutes ?? 0) });
    const observed = CONTROL_ACTIONS.has(turn.action) ? { route: null, intent: null, llm: { called: false, resultReturned: false, noResult: false, accepted: false } } : observedRaw;
    const obs = buildObs({ snap: after, sessionId, diff, observed, http, nowMs: t1 });
    const scored = scoreTurn({ gold: turn.gold, action: turn.action, obs, familyOf });
    const noHttp = http.status === null || http.status >= 300 || http.timedOut;
    if (noHttp || control?.error) caseErrors.push({ turn_id: turn.turn_id, reason: control?.error ?? (http.timedOut ? "HTTP_TIMEOUT" : `HTTP_${http.status ?? http.error}`) });
    const record = {
      turn_id: turn.turn_id, action: turn.action, text: turn.text, t0Iso, t1Iso: new Date(t1).toISOString(),
      http, traceId, sessionId, answer: answer.slice(0, 2000), control,
      diff: { newActions: diff.newActions, statusChanges: diff.statusChanges, newPrograms: diff.newPrograms.length, profileChanged: diff.profileChanged, workflowsChanged: diff.workflowsChanged.length },
      observed: { route: observedRaw.route, intent: observedRaw.intent, write: obs.write, endState: obs.endState, slots: obs.slots },
      llm: observedRaw.llm, interpreter: observedRaw.interpreter, qwenChatCalls: observedRaw.qwenChatCalls, embedCalls: observedRaw.embedCalls,
      evidence: observedRaw.evidence, scored,
    };
    turnRecords.push(record);
    turnScores.push(scored);
    if (onTurn) onTurn(record);
    // CONTAMINATION GUARD (Config A only). Stop rule as specified by the protocol: Qwen must NOT be invoked at all.
    // Three independent observations, any one of which stops the run: the typed semantic-fallback events, and the
    // Ollama generation endpoint itself. The last one is the one that catches calls made by non-CI paths (the
    // orchestrator's UNKNOWN/RAG generation), which the CI event check alone cannot see.
    if (config === "A" && (observedRaw.llm.called || observedRaw.llm.resultReturned || observedRaw.interpreter.calls > 0 || observedRaw.qwenChatCalls > 0)) {
      throw new ContaminationStop(`Qwen invocation observed in Config A (case ${spec.case_id}, turn ${turn.turn_id})`, { caseId: spec.case_id, turnId: turn.turn_id, llm: observedRaw.llm, interpreter: observedRaw.interpreter, qwenChatCalls: observedRaw.qwenChatCalls, qwenChatLatencyMs: observedRaw.qwenChatLatencyMs });
    }
    snap = after;
  }
  const sc = scoreCase({ turns: turnScores, caseErrors });
  return {
    case_id: spec.case_id, category: spec.category, fixture: spec.fixture, config, attempt, status: "COMPLETED",
    userId: user.userId, startedAt, finishedAt: new Date().toISOString(), seed, isolation,
    caseErrors, turns: turnRecords, turnScores, caseCorrect: sc.caseCorrect, duplicateWriteInfo: sc,
    sessionId,
    nonSemanticQwenChatCalls: turnRecords.reduce((n, t) => n + (t.qwenChatCalls ?? 0), 0),
  };
}

/** A case that could not be completed (harness exception). Every gold turn is still counted, as incorrect. */
export function errorCaseRecord({ spec, config, attempt, reason, familyOf }) {
  const turnScores = spec.turns.map((t) => scoreTurn({ gold: t.gold, action: t.action, obs: { route: UNOBSERVED, write: "NO_WRITE", endState: UNOBSERVED, slots: {}, http: { status: null, timedOut: false } }, familyOf }));
  const sc = scoreCase({ turns: turnScores, caseErrors: [{ reason }] });
  return {
    case_id: spec.case_id, category: spec.category, fixture: spec.fixture, config, attempt, status: "ERROR", errorReason: reason,
    caseErrors: [{ reason }], turns: [], turnScores, caseCorrect: false, duplicateWriteInfo: sc, finishedAt: new Date().toISOString(), nonSemanticQwenChatCalls: 0,
  };
}

// ───────────────────────── real dependencies (TEST stack only) ─────────────────────────
export async function realDeps() {
  return {
    registerUser, say,
    confirm: confirmAction, dismiss: dismissAction,
    seedFixture: (u, f) => seedFixture(u, f, putProfile),
    snapshot: snapshotUser,
    latestPendingAction,
    aiLogsSince: async (iso) => (await dockerLogs(AI, iso)).text,
    ollamaLogsSince: async (iso) => (await dockerLogs(OLLAMA, iso)).text,
    ollamaOffsetMinutes: await containerOffsetMinutes(),
  };
}

// ───────────────────────── checkpointing ─────────────────────────
const ckFile = (runDir, config) => path.join(runDir, `config-${config}`, "checkpoint.jsonl");
const attemptsFile = (runDir, config) => path.join(runDir, `config-${config}`, "attempts.jsonl");
const casesDir = (runDir, config) => path.join(runDir, `config-${config}`, "cases");

export function loadState(runDir, config) {
  const ck = readJsonl(ckFile(runDir, config)).rows;
  const at = readJsonl(attemptsFile(runDir, config)).rows;
  const done = new Set(ck.map((r) => r.case_id));
  // An attempt is INTERRUPTED if STARTED has no later terminal row for that case (process died mid-case).
  const lastByCase = new Map();
  for (const r of at) lastByCase.set(r.case_id, r);
  const attemptCount = new Map();
  for (const r of at) if (r.status === "STARTED") attemptCount.set(r.case_id, Math.max(attemptCount.get(r.case_id) ?? 0, r.attempt));
  const interrupted = [...lastByCase.values()].filter((r) => r.status === "STARTED" && !done.has(r.case_id));
  return { done, attemptCount, interrupted };
}

export async function runConfig({ runDir, config, caseFilter, deps, familyOf, runId, dataset }) {
  const dir = path.join(runDir, `config-${config}`);
  fs.mkdirSync(casesDir(runDir, config), { recursive: true });
  const hb = (patch) => writeHeartbeat(path.join(runDir, "heartbeat.json"), { runId, config, pid: process.pid, ...patch });
  const pre = await preflight({ runDir, config, dataset });
  fs.writeFileSync(path.join(dir, "preflight.json"), JSON.stringify(pre, null, 2));
  if (!pre.ok) throw new PreflightError("PREFLIGHT_FAILED", Object.entries(pre.checks).filter(([, v]) => !v).map(([k]) => k));
  // Timeouts are frozen per config and must be identical across configs; B cannot change them after A ran.
  const contractPath = path.join(dir, "config-contract.json");
  const contract = { config, llmFlag: CONFIGS[config].llmFlag, model: MODEL_TAG, timeouts: TIMEOUTS, retries: 0, substitution: "none", promptOrRouteChanges: "none (production aggregate unchanged; see preflight)", datasetSha256: DATASET_SHA, productionAggregateSha256: pre.productionAggregateSha256, qwenManifestSha256: pre.qwenManifestSha256, gitHead: pre.gitHead, frozenAt: new Date().toISOString() };
  if (!fs.existsSync(contractPath)) fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2));
  const frozen = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  if (JSON.stringify(frozen.timeouts) !== JSON.stringify(TIMEOUTS)) throw new PreflightError("TIMEOUT_CHANGED_AFTER_FREEZE");

  const state = loadState(runDir, config);
  for (const r of state.interrupted) appendJsonl(attemptsFile(runDir, config), { ...r, status: "DISCARDED_INTERRUPTED", discardedAt: new Date().toISOString() });
  const todo = dataset.filter((c) => !state.done.has(c.case_id) && (!caseFilter || caseFilter.includes(c.case_id)));
  let completed = 0, timeouts = 0, errors = 0, lastCompletion = null;
  const counts = () => ({ casesTotal: dataset.length, casesCompleted: state.done.size + completed, timeouts, errors });
  hb({ stage: "config-run", ...counts(), currentCase: null, lastCompletionAt: lastCompletion, discardedInterrupted: state.interrupted.length });

  for (const spec of todo) {
    const attempt = (state.attemptCount.get(spec.case_id) ?? 0) + 1;
    appendJsonl(attemptsFile(runDir, config), { config, case_id: spec.case_id, attempt, status: "STARTED", at: new Date().toISOString() });
    hb({ stage: "case", currentCase: spec.case_id, currentAttempt: attempt, ...counts() });
    let rec;
    try {
      rec = await runCase({ spec, config, attempt, runId, familyOf, deps, onTurn: (t) => hb({ stage: "turn", currentCase: spec.case_id, currentTurn: t.turn_id, ...counts() }) });
    } catch (e) {
      if (e.name === "ContaminationStop") {
        appendJsonl(attemptsFile(runDir, config), { config, case_id: spec.case_id, attempt, status: "STOPPED_CONTAMINATION", at: new Date().toISOString(), detail: e.detail });
        hb({ stage: "STOPPED_CONTAMINATION", currentCase: spec.case_id, ...counts() });
        throw e;
      }
      rec = errorCaseRecord({ spec, config, attempt, reason: `${e.name ?? "Error"}: ${String(e.message).slice(0, 300)}`, familyOf });
    }
    const timedOutHere = rec.caseErrors.some((x) => x.reason === "HTTP_TIMEOUT");
    if (timedOutHere) timeouts++;
    if (rec.status === "ERROR" || rec.caseErrors.length) errors++;
    const file = path.join(casesDir(runDir, config), `${spec.case_id}.attempt${attempt}.json`);
    fs.writeFileSync(file, JSON.stringify(rec, null, 2));
    const fileSha = sha256File(file);
    appendJsonl(ckFile(runDir, config), { config, case_id: spec.case_id, category: spec.category, attempt, status: rec.status, caseCorrect: rec.caseCorrect, caseFile: path.relative(runDir, file).split(path.sep).join("/"), caseFileSha256: fileSha, completedAt: new Date().toISOString() });
    appendJsonl(attemptsFile(runDir, config), { config, case_id: spec.case_id, attempt, status: "COMPLETED", at: new Date().toISOString() });
    completed++;
    lastCompletion = new Date().toISOString();
    hb({ stage: "config-run", currentCase: null, lastCompletionAt: lastCompletion, ...counts() });
  }
  hb({ stage: "config-done", currentCase: null, lastCompletionAt: lastCompletion, ...counts() });
  return { config, completedThisRun: completed, timeouts, errors };
}

export async function runWarmup({ runDir, config, runId, familyOf, deps }) {
  const warm = { case_id: "WARMUP", category: "warmup", fixture: "F_MG_DAYS", turns: WARMUP_TURNS.map((text, i) => ({ turn_id: `W${i + 1}`, text, action: "TEXT", gold: { route: null, route_family: null, intent: null, write: "NO_WRITE", slots: {}, end_state: null } })) };
  const rec = await runCase({ spec: warm, config, attempt: 1, runId: `${runId}warm`, familyOf, deps: { ...deps }, onTurn: null });
  const out = path.join(runDir, "warmup", `config-${config}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ excludedFromMetrics: true, config, ...rec, caseCorrect: undefined, turnScores: undefined, duplicateWriteInfo: undefined }, null, 2));
  return { config, turns: rec.turns.length, ok: rec.turns.every((t) => t.http.status === 200) };
}

// ───────────────────────── aggregation (after runs) ─────────────────────────
export function loadCases(runDir, config) {
  const ck = readJsonl(ckFile(runDir, config)).rows;
  const latest = new Map();
  for (const r of ck) latest.set(r.case_id, r);
  return [...latest.values()].map((r) => {
    const rec = JSON.parse(fs.readFileSync(path.join(runDir, r.caseFile), "utf8"));
    const got = sha256File(path.join(runDir, r.caseFile));
    if (got !== r.caseFileSha256) throw new Error(`CASE_FILE_TAMPERED ${r.case_id}`);
    return rec;
  });
}

export function aggregateRun({ runDir }) {
  const out = { generatedAt: new Date().toISOString(), configs: {} };
  for (const config of ["A", "B"]) {
    if (!fs.existsSync(ckFile(runDir, config))) continue;
    const cases = loadCases(runDir, config);
    out.configs[config] = { ...aggregate(cases), casesAll: cases.map((c) => ({ case_id: c.case_id, category: c.category, status: c.status, caseCorrect: c.caseCorrect, duplicateWrite: c.duplicateWriteInfo.duplicateWrite })) };
  }
  if (out.configs.A && out.configs.B) {
    const a = loadCases(runDir, "A"), b = loadCases(runDir, "B");
    out.paired = pairedAnalysis(a, b);
  }
  fs.mkdirSync(path.join(runDir, "metrics"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "metrics", "aggregate.json"), JSON.stringify(out, null, 2));
  return out;
}

// ───────────────────────── CLI ─────────────────────────
function arg(name) { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; }
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  (async () => {
    const runDir = path.resolve(arg("run-dir") ?? "");
    const mode = arg("mode");
    const config = arg("config");
    if (!arg("run-dir") || !mode) { console.error("usage: --run-dir <RUN> --mode smoke|warmup|config|freeze-evaluator|aggregate [--config A|B] [--cases ...] [--recreate]"); process.exit(5); }
    const runId = path.basename(runDir);
    fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
    fs.writeFileSync(path.join(runDir, "logs", `runner-${mode}-${config ?? "none"}.pid`), String(process.pid));
    const familyOf = fs.existsSync(path.join(runDir, "route-vocabulary.json")) ? readVocabulary(runDir) : null;
    try {
      if (mode === "freeze-evaluator") { const m = freezeEvaluator(runDir); console.log(JSON.stringify({ evaluatorSha256: m.evaluatorSha256, files: m.files.length }, null, 2)); return; }
      if (mode === "aggregate") { const a = aggregateRun({ runDir }); console.log(JSON.stringify(Object.fromEntries(Object.entries(a.configs).map(([k, v]) => [k, { cases: v.cases, casesCorrect: v.casesCorrect, route: v.route, safety: v.safety }])), null, 2)); return; }
      if (!config || !CONFIGS[config]) throw new Error("--config A|B required");
      const dataset = readDataset();
      if (process.argv.includes("--recreate")) { const rc = await recreateAi(CONFIGS[config].llmFlag); console.log("recreated:", JSON.stringify(rc)); }
      const deps = await realDeps();
      if (mode === "warmup") { const w = await runWarmup({ runDir, config, runId, familyOf, deps }); console.log(JSON.stringify(w)); return; }
      if (mode === "smoke") {
        const ids = (arg("cases") ?? "W001,W002").split(",");
        const smokeDir = path.join(runDir, "smoke");
        fs.mkdirSync(smokeDir, { recursive: true });
        const pre = await preflight({ runDir, config, dataset });
        fs.writeFileSync(path.join(smokeDir, `preflight-${config}.json`), JSON.stringify(pre, null, 2));
        if (!pre.ok) throw new PreflightError("SMOKE_PREFLIGHT_FAILED", Object.entries(pre.checks).filter(([, v]) => !v).map(([k]) => k));
        const specs = ids.map((id) => dataset.find((c) => c.case_id === id));
        const out = [];
        for (const spec of specs) out.push(await runCase({ spec, config, attempt: 1, runId: `${runId}smoke`, familyOf, deps }));
        fs.writeFileSync(path.join(smokeDir, "smoke-cases.json"), JSON.stringify(out, null, 2));
        console.log(JSON.stringify(out.map((c) => ({ case_id: c.case_id, userId: c.userId, baselineRows: c.isolation.baselineRows, caseCorrect: c.caseCorrect, turns: c.turns.map((t) => ({ id: t.turn_id, http: t.http.status, route: t.observed.route, write: t.observed.write, end: t.observed.endState, llm: t.llm.called, traceFound: Boolean(t.traceId) })) })), null, 2));
        return;
      }
      if (mode === "config") {
        const r = await runConfig({ runDir, config, deps, familyOf, runId, dataset });
        console.log(JSON.stringify(r));
        return;
      }
      throw new Error(`unknown mode ${mode}`);
    } catch (e) {
      console.error(`${e.name}: ${e.message}`, e.detail ? JSON.stringify(e.detail) : "");
      process.exit(e.name === "PreflightError" ? 2 : e.name === "ContaminationStop" ? 3 : 4);
    }
  })();
}
