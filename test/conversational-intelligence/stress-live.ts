/**
 * CI-V2 live routing STRESS harness — REAL HTTP/API through the Docker gateway, isolated users, EXPLICIT state.
 *
 * Why this exists: an earlier bulk run reported "flaky" live routes (pure classifyGlobal correct, live sometimes wrong). The harness that
 * produced those numbers never verified that the conversation state it *declared* (e.g. "FIND_PT waiting for budget") actually existed on
 * the server, and it matched a request to its log line by log ORDER. This harness removes both weaknesses:
 *
 *   1. every case builds its state through real turns and then ASSERTS the state from the database (workflow row / stored proposal /
 *      pending draft). A case whose precondition is not met is reported as PRECONDITION_FAILED — never scored as a routing pass/fail;
 *   2. every request is joined to its server-side trace by `correlationId` (the traceId the API returns), and the trace must carry the
 *      same userId + sessionId that made the request (attribution check);
 *   3. for each trace, the deterministic route the server logged is compared with the PURE classifyGlobal() evaluated on the context the
 *      server says it saw. Any difference is a real live-vs-pure disagreement (must be 0);
 *   4. the context the server saw is compared with the DB-verified precondition (context freshness).
 *
 * Modes: sequential (one case at a time), sessionChain (one session, many dependent turns), interleaved (many isolated sessions in flight
 * at once, several rounds, seeded shuffle). Profile variants make the fixture dependence explicit: A = no preferredTrainingDays (workflows
 * wait for slots), B = preferredTrainingDays [1,3,5] (profile pre-fills the days slot, so e.g. a workout request produces a draft at once).
 *
 * Usage: node node_modules/tsx/dist/cli.mjs test/conversational-intelligence/stress-live.ts <label> [modes=sequential,chain,interleaved] [rounds=2]
 * Writes test/conversational-intelligence/results/stress-<label>.json ; exit code 1 on any attribution / disagreement / context defect.
 */
import fs from "node:fs";
import { execSync } from "node:child_process";
import { registerUser, putProfile, say, q, sleep } from "../ai-chat-full-verification/lib.mjs";
import { classifyGlobal, type GlobalContext } from "../../backend/services/ai-service/src/conversational-intelligence/global/router";

const LABEL = process.argv[2] ?? "run";
const MODES = (process.argv[3] ?? "sequential,chain,interleaved").split(",");
const ROUNDS = Number(process.argv[4] ?? 2);
const AI_CONTAINER = "gymcoach-ai-dev";
const started = new Date(Date.now() - 5000).toISOString();

const BASE_PROFILE = { hasCompletedOnboarding: true, goal: "WEIGHT_LOSS", age: 28, heightCm: 172, currentWeight: 80, gender: "MALE" };
const PROFILES = { A: { ...BASE_PROFILE }, B: { ...BASE_PROFILE, preferredTrainingDays: [1, 3, 5] }, C: { ...BASE_PROFILE, goal: "MUSCLE_GAIN", currentWeight: 95 } } as const; // C: stored goal differs from the BMI-based recommendation, so a real proposal is stored
type ProfileKey = keyof typeof PROFILES;

// seeded PRNG so the interleaving order is reproducible
let seed = 20260927;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const shuffle = <T,>(a: T[]) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };

interface User { email: string; token: string; userId: string }
interface State { wf?: { type: string; slot?: string }; proposal?: boolean; draft?: boolean }

async function newUser(profile: ProfileKey): Promise<User> {
  const u = await registerUser(`stress.${LABEL}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@gymini-test.local`, "Stress");
  const p = await putProfile(u, PROFILES[profile]);
  if (p.status !== 200) throw new Error(`putProfile failed ${p.status} ${JSON.stringify(p.json).slice(0, 160)}`);
  return u;
}

const FILLERS: Record<string, string[]> = { FIND_PT: ["T2 T4 T6"], CREATE_WORKOUT_PLAN: [], CREATE_NUTRITION_PLAN: [], FIND_TRAINING_PROGRAM: ["T2 T4 T6"], CREATE_ROADMAP: [] };
const START_TEXT: Record<string, string> = { FIND_PT: "Tìm PT cho tôi.", CREATE_WORKOUT_PLAN: "Tạo lịch tập cho tôi.", CREATE_NUTRITION_PLAN: "Tạo thực đơn cho tôi.", FIND_TRAINING_PROGRAM: "Tìm chương trình tập cho tôi.", CREATE_ROADMAP: "Tạo lộ trình cho tôi." };

/** build the requested state through REAL turns; returns the session id */
async function buildState(u: User, s: State): Promise<string | undefined> {
  let sessionId: string | undefined;
  if (s.wf) {
    let r = await say(u, START_TEXT[s.wf.type]); sessionId = r.sessionId;
    for (const f of FILLERS[s.wf.type] ?? []) r = await say(u, f, sessionId);
  } else if (s.proposal) {
    sessionId = (await say(u, "với tình trạng hiện tại tôi nên cut hay bulk?")).sessionId;
  } else if (s.draft) {
    sessionId = (await say(u, START_TEXT.CREATE_WORKOUT_PLAN)).sessionId;
  }
  return sessionId;
}

interface Observed { wf: { type: string; status: string; slot: string } | null; proposal: boolean; draft: boolean }
function observeDb(userId: string, sessionId: string | undefined): Observed {
  if (!sessionId) return { wf: null, proposal: false, draft: false };
  const row = q("ai", `select workflow_type||'|'||status||'|'||coalesce(expected_slot,'') from agent_workflow_sessions where user_id='${userId}' and session_id='${sessionId}' and status not in ('COMPLETED','CANCELLED','EXPIRED') order by created_at desc limit 1`).trim();
  const proposal = q("ai", `select count(*) from agent_workflow_sessions where user_id='${userId}' and session_id='${sessionId}' and status='COLLECTING_SLOTS' and slots_json->'__ci'->'proposal' is not null`).trim() !== "0";
  const draft = q("ai", `select count(*) from fitness_agent_actions where user_id='${userId}' and session_id='${sessionId}' and status='PENDING' and expires_at > now()`).trim() !== "0";
  const [type, status, slot] = row ? row.split("|") : [];
  return { wf: row ? { type, status, slot } : null, proposal, draft };
}
const preconditionMet = (want: State, got: Observed) =>
  (want.wf ? Boolean(got.wf && got.wf.type === want.wf.type && got.wf.status === "COLLECTING_SLOTS" && (!want.wf.slot || got.wf.slot === want.wf.slot)) : !got.wf || Boolean(want.proposal))
  && (want.proposal ? got.proposal : true) && (want.draft ? got.draft : true);

// ── server-side trace index, joined by correlationId ──
interface Trace { correlationId?: string; userId?: string; sessionId?: string; route?: string; topic?: string; workflow?: string; activeWorkflow?: string; workflowStatus?: string; expectedSlot?: string; proposalStored?: boolean; pendingDraft?: boolean; deterministicRoute?: string; llmCalled?: boolean; llmAccepted?: string | null; reason?: string }
function loadTraces() {
  const raw = execSync(`docker logs ${AI_CONTAINER} --since ${started} 2>&1`, { encoding: "utf8", maxBuffer: 400_000_000 });
  const traces = new Map<string, Trace>(); const llm = new Map<string, any>(); const trans = new Map<string, any>();
  for (const line of raw.split("\n")) {
    if (!line.includes("ci_global_trace") && !line.includes("ci_global_llm_route") && !line.includes("ci_turn_transition")) continue;
    let j: any; try { j = JSON.parse(line); } catch { continue; }
    if (!j.correlationId) continue;
    if (j.msg === "ci_global_trace") traces.set(j.correlationId, j);
    else if (j.msg === "ci_global_llm_route") llm.set(j.correlationId, j);
    else if (j.msg === "ci_turn_transition") trans.set(j.correlationId, j);
  }
  return { traces, llm, trans };
}

interface Sent { id: string; mode: string; profile: ProfileKey; text: string; user: User; sessionId?: string; want: State; observed: Observed; ok: boolean; correlationId?: string; status: number; expectedRoute?: string; latencyMs: number; answer?: string; answerMatch?: RegExp; answerMustNot?: RegExp }
const sent: Sent[] = [];
const preconditionFailures: any[] = [];

async function runCase(id: string, mode: string, profile: ProfileKey, want: State, text: string, expectedRoute?: string, sc?: Scenario): Promise<Sent | null> {
  const user = await newUser(profile);
  const sessionId = await buildState(user, want);
  const observed = observeDb(user.userId, sessionId);
  if (!preconditionMet(want, observed)) { preconditionFailures.push({ id, mode, profile, want, observed }); return null; }
  return { id, mode, profile, text, user, sessionId, want, observed, ok: true, status: 0, latencyMs: 0, expectedRoute, answerMatch: sc?.answerMatch, answerMustNot: sc?.answerMustNot };
}
async function fire(c: Sent) {
  const t0 = Date.now();
  const r = await say(c.user, c.text, c.sessionId);
  c.answer = r.answer; c.status = r.status; c.latencyMs = Date.now() - t0; c.correlationId = r.data?.traceId; c.sessionId = c.sessionId ?? r.sessionId;
}

// ── scenarios: deterministic utterances (no RAG generation) ──
interface Scenario { id: string; profile: ProfileKey; want: State; text: string; expected: string; answerMatch?: RegExp; answerMustNot?: RegExp }
const SCENARIOS: Scenario[] = [
  { id: "slot-budget", profile: "A", want: { wf: { type: "FIND_PT", slot: "budgetVnd" } }, text: "3 triệu", expected: "SLOT_ANSWER" },
  { id: "slot-budget-decimal", profile: "A", want: { wf: { type: "FIND_PT", slot: "budgetVnd" } }, text: "1.5 triệu thôi", expected: "SLOT_ANSWER" },
  { id: "correction-days", profile: "A", want: { wf: { type: "CREATE_WORKOUT_PLAN", slot: "daysPerWeek" } }, text: "à khoan, tôi nói nhầm, phải là 3 buổi", expected: "CORRECTION" },
  { id: "correction-budget", profile: "A", want: { wf: { type: "FIND_PT", slot: "budgetVnd" } }, text: "nhầm rồi, ngân sách của tôi là 1 triệu thôi", expected: "CORRECTION" },
  { id: "switch-workflow", profile: "A", want: { wf: { type: "FIND_PT", slot: "budgetVnd" } }, text: "Thôi khoan tìm PT, tạo thực đơn cho tôi trước đi", expected: "SWITCH_WORKFLOW" },
  { id: "cancel-bare", profile: "A", want: { wf: { type: "CREATE_WORKOUT_PLAN", slot: "daysPerWeek" } }, text: "thôi", expected: "CANCEL" },
  { id: "read-in-workflow", profile: "A", want: { wf: { type: "FIND_PT", slot: "budgetVnd" } }, text: "Macro hiện tại của tôi bao nhiêu?", expected: "READ_STATE" },
  { id: "read-pt-nostate", profile: "A", want: {}, text: "Tôi đang có PT chưa?", expected: "READ_STATE" },
  { id: "read-height-nostate", profile: "A", want: {}, text: "Tôi cao bao nhiêu?", expected: "READ_STATE" },
  { id: "recommend-goal-nostate", profile: "A", want: {}, text: "với tình trạng hiện tại tôi nên cut hay bulk?", expected: "RECOMMEND" },
  { id: "proposal-accept", profile: "C", want: { proposal: true }, text: "ok đổi theo đề xuất đó", expected: "REFERENCE" },
  // the SAME declared states under profile B: the profile pre-fills the days slot, so the declared state does not exist → must be reported as PRECONDITION_FAILED, never scored as a routing result
  { id: "fixture-dependence:correction-days@B", profile: "B", want: { wf: { type: "CREATE_WORKOUT_PLAN", slot: "daysPerWeek" } }, text: "à khoan, tôi nói nhầm, phải là 3 buổi", expected: "CORRECTION" },
  { id: "fixture-dependence:switch@B", profile: "B", want: { wf: { type: "FIND_PT", slot: "budgetVnd" } }, text: "Thôi khoan tìm PT, tạo thực đơn cho tôi trước đi", expected: "SWITCH_WORKFLOW" },
  // profile B pre-fills the training days, so the workout request yields a PENDING DRAFT (no workflow row): a revision of that draft
  { id: "draft-revision-correction", profile: "B", want: { draft: true }, text: "sai rồi, phải là 5 buổi mỗi tuần", expected: "CORRECTION", answerMatch: /5 buổi/, answerMustNot: /Đây chỉ là gợi ý/ },
  { id: "draft-revision-correction-2", profile: "B", want: { draft: true }, text: "à khoan, tôi nói nhầm, phải là 3 buổi", expected: "CORRECTION", answerMatch: /3 buổi/, answerMustNot: /Đây chỉ là gợi ý/ },
];

function ctxOf(t: Trace): GlobalContext {
  return { active: t.workflowStatus === "COLLECTING_SLOTS" && t.activeWorkflow ? { wf: t.activeWorkflow, slot: t.expectedSlot ?? null } : null, proposal: Boolean(t.proposalStored), draft: Boolean(t.pendingDraft) } as GlobalContext;
}

const chainReport: any[] = [];
async function sessionChain() {
  // one session, dependent turns; after EVERY turn the DB state must equal what the previous turn should have left
  const user = await newUser("A");
  const steps: { text: string; expectRoute: string; expectWf: string | null; expectSlot?: string; expectTransition: string }[] = [
    { text: "Tìm PT cho tôi.", expectRoute: "START_WORKFLOW", expectWf: "FIND_PT", expectSlot: "days", expectTransition: "started" },
    { text: "T2 T4 T6", expectRoute: "SLOT_ANSWER", expectWf: "FIND_PT", expectSlot: "budgetVnd", expectTransition: "advanced" },
    { text: "Macro hiện tại của tôi bao nhiêu?", expectRoute: "READ_STATE", expectWf: "FIND_PT", expectSlot: "budgetVnd", expectTransition: "unchanged" },
    // the correction supplies the LAST missing slot (budget), so the workflow legitimately completes and ends
    { text: "nhầm rồi, ngân sách của tôi là 1 triệu thôi", expectRoute: "CORRECTION", expectWf: null, expectTransition: "ended" },
  ];
  let sessionId: string | undefined;
  for (const st of steps) {
    const r = await say(user, st.text, sessionId); sessionId = sessionId ?? r.sessionId;
    chainReport.push({ text: st.text, expectRoute: st.expectRoute, expectWf: st.expectWf, expectSlot: st.expectSlot, expectTransition: st.expectTransition, correlationId: r.data?.traceId, status: r.status, db: observeDb(user.userId, sessionId), userId: user.userId, sessionId });
  }
}

async function main() {
  if (MODES.includes("sequential")) {
    for (const sc of SCENARIOS) {
      const c = await runCase(sc.id, "sequential", sc.profile, sc.want, sc.text, sc.expected, sc);
      if (c) { await fire(c); sent.push(c); }
      process.stdout.write(c ? "." : "P");
    }
  }
  if (MODES.includes("chain")) { await sessionChain(); process.stdout.write("c"); }
  if (MODES.includes("interleaved")) {
    for (let round = 1; round <= ROUNDS; round++) {
      const ready: Sent[] = [];
      for (const sc of shuffle(SCENARIOS)) { const c = await runCase(`${sc.id}#r${round}`, "interleaved", sc.profile, sc.want, sc.text, sc.expected, sc); if (c) ready.push(c); else process.stdout.write("P"); }
      // all sessions are fully built and verified; now fire every utterance at once (one in-flight request per user)
      await Promise.all(shuffle(ready).map((c) => fire(c)));
      sent.push(...ready); process.stdout.write("i");
    }
  }
  await sleep(1500);
  const { traces, llm, trans } = loadTraces();

  const details: any[] = []; const totals = { sent: sent.length, preconditionFailed: preconditionFailures.length, noCorrelationId: 0, traceMissing: 0, attributionMismatch: 0, contextStale: 0, liveVsPureDisagreement: 0, routeMatchesExpected: 0, routeDiffersFromExpected: 0, llmCalled: 0, http5xx: 0, unsafeMisroute: 0, outcomeChecked: 0, outcomeWrong: 0 };
  for (const c of sent) {
    const d: any = { id: c.id, mode: c.mode, profile: c.profile, text: c.text, expected: c.expectedRoute, status: c.status };
    if (c.status >= 500) totals.http5xx++;
    if (!c.correlationId) { totals.noCorrelationId++; d.problem = "no correlationId in response"; details.push(d); continue; }
    const t = traces.get(c.correlationId);
    if (!t) { totals.traceMissing++; d.problem = "no ci_global_trace for correlationId"; d.correlationId = c.correlationId; details.push(d); continue; }
    d.correlationId = c.correlationId; d.route = t.route; d.topic = t.topic; d.deterministicRoute = t.deterministicRoute; d.llmCalled = t.llmCalled; d.llmAccepted = t.llmAccepted;
    d.serverSawWorkflow = t.activeWorkflow ? `${t.activeWorkflow}/${t.workflowStatus}/${t.expectedSlot ?? ""}` : null; d.serverSawProposal = t.proposalStored; d.serverSawPendingDraft = t.pendingDraft;
    d.transition = trans.get(c.correlationId)?.workflowTransition; d.llmRouteLog = llm.get(c.correlationId)?.llmRoute;
    if (t.userId !== c.user.userId || t.sessionId !== c.sessionId) { totals.attributionMismatch++; d.problem = `attribution: trace ${t.userId}/${t.sessionId} vs request ${c.user.userId}/${c.sessionId}`; }
    // context freshness: what the server saw must equal the DB-verified precondition
    const sawWf = t.activeWorkflow && t.workflowStatus === "COLLECTING_SLOTS" ? { type: t.activeWorkflow, slot: t.expectedSlot } : null;
    const wantWf = c.observed.wf;
    if (Boolean(sawWf) !== Boolean(wantWf) || (sawWf && wantWf && (sawWf.type !== wantWf.type || sawWf.slot !== wantWf.slot))) { totals.contextStale++; d.problem = (d.problem ?? "") + " context differs from DB-verified state"; }
    // live vs pure: same input the server logged → same deterministic route
    const pure = classifyGlobal(c.text, ctxOf(t));
    // the pure evaluation is done WITHOUT the draft flag when the deployed build predates it; compare on the route the server logged
    if (t.deterministicRoute !== undefined && pure.route !== t.deterministicRoute) { totals.liveVsPureDisagreement++; d.problem = (d.problem ?? "") + ` live deterministic ${t.deterministicRoute} != pure ${pure.route} for the context the server logged`; d.pure = pure.route; }
    if (t.llmCalled) totals.llmCalled++;
    if (c.answerMatch || c.answerMustNot) { totals.outcomeChecked++; const okOut = (!c.answerMatch || c.answerMatch.test(c.answer ?? "")) && (!c.answerMustNot || !c.answerMustNot.test(c.answer ?? "")); d.outcomeOk = okOut; d.answerHead = (c.answer ?? "").slice(0, 110); if (!okOut) { totals.outcomeWrong++; d.problem = (d.problem ?? "") + " outcome: draft not revised as asked"; } }
    if (c.expectedRoute) { if (t.route === c.expectedRoute) totals.routeMatchesExpected++; else { totals.routeDiffersFromExpected++; d.routeDiffersFromExpected = true; } }
    if (["READ_STATE", "RECOMMEND", "KNOWLEDGE_QA"].includes(c.expectedRoute ?? "") && ["WRITE_ACTION"].includes(t.route ?? "")) totals.unsafeMisroute++;
    details.push(d);
  }
  // session chain verification (state after each turn, joined by correlationId)
  const chain = chainReport.map((s) => {
    const t = traces.get(s.correlationId); const wfOk = s.expectWf === null ? !s.db.wf : Boolean(s.db.wf && s.db.wf.type === s.expectWf && (!s.expectSlot || s.db.wf.slot === s.expectSlot));
    return { text: s.text, expectRoute: s.expectRoute, gotRoute: t?.route ?? null, routeOk: t?.route === s.expectRoute, workflowStateOk: wfOk, transitionOk: trans.get(s.correlationId)?.workflowTransition === s.expectTransition, dbWorkflow: s.db.wf, attributionOk: !t || (t.userId === s.userId && t.sessionId === s.sessionId), transition: trans.get(s.correlationId)?.workflowTransition };
  });
  const out = { label: LABEL, modes: MODES, rounds: ROUNDS, llmFallbackEnv: execSync(`docker exec ${AI_CONTAINER} printenv CONVERSATIONAL_INTELLIGENCE_V2_LLM`, { encoding: "utf8" }).trim(), totals, preconditionFailures, chain, details };
  fs.mkdirSync("test/conversational-intelligence/results", { recursive: true });
  fs.writeFileSync(`test/conversational-intelligence/results/stress-${LABEL}.json`, JSON.stringify(out, null, 2));
  console.log("\n" + JSON.stringify({ label: LABEL, llmFallbackEnv: out.llmFallbackEnv, totals, chainOk: chain.every((c) => c.routeOk && c.workflowStateOk && c.attributionOk && c.transitionOk) }, null, 2));
  for (const d of details.filter((x) => x.problem || x.routeDiffersFromExpected)) console.log(" -", d.id, "|", d.text, "| route:", d.route, "| expected:", d.expected, "| saw:", d.serverSawWorkflow ?? "none", "draft:", d.serverSawPendingDraft, "|", d.problem ?? "");
  for (const p of preconditionFailures) console.log(" PRECONDITION_FAILED", p.id, JSON.stringify(p.want), "actual:", JSON.stringify(p.observed));
  for (const c of chain.filter((x) => !x.routeOk || !x.workflowStateOk || !x.attributionOk || !x.transitionOk)) console.log(" CHAIN", JSON.stringify(c));
  const bad = totals.attributionMismatch + totals.liveVsPureDisagreement + totals.contextStale + totals.noCorrelationId + totals.traceMissing + totals.http5xx + totals.unsafeMisroute + totals.outcomeWrong;
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
