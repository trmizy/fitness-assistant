// X4 confirmation-integrity matrix — REAL HTTP/API + DB. One fresh user per (state, utterance) cell so a legitimate text confirmation
// (which may consume a card) never contaminates another cell. For every cell it records the answer and the DB delta, and derives
// `claimWithoutWrite` = the answer claims a completed save/update/confirmation but the DB shows nothing was written.
//
// X4 follow-up (docs/conversational-intelligence-x4-followup-fix.md) strengthening, per Codex's own audit
// (docs/codex-conversational-intelligence-final-closure-signoff.md "Matrix Audit"): every cell now carries an explicit expectation —
// whether a write is authorized for THAT state/utterance pair, and what the answer must (or must not) say — instead of only the generic
// claim-without-write heuristic. S1/U1-U5 are legitimate, authorized confirmed writes (the real workflow's own confirmation step, not this
// boundary) and are asserted as such, not flagged. A new S7 state reproduces the exact reported defect (a completed profile-workflow
// confirmation with zero FitnessAgentAction rows) and asserts the truthful positive answer. The runner now exits non-zero on ANY failed
// per-cell expectation, error or setup failure — not just on the old claimWithoutWrite heuristic.
//
// X4 event-ordering fix (docs/conversational-intelligence-x4-event-ordering-fix.md) adds S8 (Defect A: a real
// completed profile confirmation followed by 6 newer, unrelated terminal workflows) and S9 (Defect B: a real
// draft action, cancelled via the real dismiss API AFTER a real profile confirmation completes) — Codex's two
// independently-reproduced "history-over-five" / "action-cancelled-later" failures, added as permanent matrix
// states rather than left as one-off scripts.
// Usage: node test/conversational-intelligence/x4-confirmation-matrix.mjs <label> [knowledge=1|0]
import fs from "node:fs";
import { registerUser, putProfile, say, http, q, confirmAction, dismissAction } from "../ai-chat-full-verification/lib.mjs";

const LABEL = process.argv[2] ?? "run";
const KNOWLEDGE = (process.argv[3] ?? "1") === "1";
const aq = (s) => q("ai", s).trim(); const uq = (s) => q("user", s).trim(); const fq = (s) => q("fitness", s).trim();
const BASE = { hasCompletedOnboarding: true, goal: "WEIGHT_LOSS", age: 28, heightCm: 172, currentWeight: 80, gender: "MALE" };
const PROFILES = { plain: BASE, days: { ...BASE, preferredTrainingDays: [1, 3, 5] }, mismatch: { ...BASE, goal: "MUSCLE_GAIN", currentWeight: 95 }, mismatchDays: { ...BASE, goal: "MUSCLE_GAIN", currentWeight: 95, preferredTrainingDays: [1, 3, 5] } };
const UTTERANCES = [
  ["U1", "Xác nhận cập nhật."], ["U2", "Xác nhận."], ["U3", "Ok lưu đi."], ["U4", "Tôi đồng ý."], ["U5", "Coi như tôi đã xác nhận."], ["U6", "Đã lưu thành công chưa?"],
  ...(KNOWLEDGE ? [["U7-knowledge", "Giải thích cơ chế xác nhận cập nhật là gì."]] : []),
];
const CLAIM = /✅|thành công|hoàn tất|đã được thực hiện|đã lưu|đã cập nhật|đã xác nhận/i;

async function mk(profileKey) {
  const u = await registerUser(`x4.${LABEL}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@gymini-test.local`, "X4");
  const p = await putProfile(u, PROFILES[profileKey]); if (p.status !== 200) throw new Error("putProfile " + p.status);
  return u;
}
const snapshot = (u) => ({
  goal: uq(`select goal from user_profiles where "userId"='${u.userId}'`),
  programs: fq(`select count(*) from workout_programs where user_id='${u.userId}'`),
  actions: aq(`select coalesce(string_agg(kind||':'||status, ',' order by created_at),'') from fitness_agent_actions where user_id='${u.userId}'`),
  workflows: aq(`select coalesce(string_agg(workflow_type||':'||status, ',' order by created_at),'') from agent_workflow_sessions where user_id='${u.userId}'`),
});
const changed = (a, b) => a.goal !== b.goal || a.programs !== b.programs;

// each state returns { user, sessionId, note }
const STATES = {
  "S0 nothing pending": async () => { const user = await mk("plain"); const r = await say(user, "Tôi đang có PT chưa?"); return { user, sessionId: r.sessionId }; },
  "S1 profile card pending (workflow AWAITING_SLOT_CONFIRMATION)": async () => {
    const user = await mk("mismatch"); const a = await say(user, "với tình trạng hiện tại tôi nên cut hay bulk?"); await say(user, "ok đổi theo đề xuất đó", a.sessionId);
    return { user, sessionId: a.sessionId, ok: /AWAITING_SLOT_CONFIRMATION/.test(aq(`select status from agent_workflow_sessions where user_id='${user.userId}'`)) };
  },
  "S2 workout draft pending": async () => {
    const user = await mk("days"); const a = await say(user, "Tạo lịch tập cho tôi.");
    return { user, sessionId: a.sessionId, ok: aq(`select count(*) from fitness_agent_actions where user_id='${user.userId}' and status='PENDING'`) === "1", actionId: a.data?.structuredBlocks?.find((b) => b.actionId)?.actionId };
  },
  "S3 draft already CONFIRMED (completed)": async () => {
    const user = await mk("days"); const a = await say(user, "Tạo lịch tập cho tôi."); const id = a.data?.structuredBlocks?.find((b) => b.actionId)?.actionId;
    const c = await confirmAction(user, id);
    return { user, sessionId: a.sessionId, ok: c.status < 300 && aq(`select status from fitness_agent_actions where id='${id}'`) === "COMPLETED", note: `confirm=${c.status} status=${aq(`select status from fitness_agent_actions where id='${id}'`)}` };
  },
  "S4 draft DISMISSED (cancelled)": async () => {
    const user = await mk("days"); const a = await say(user, "Tạo lịch tập cho tôi."); const id = a.data?.structuredBlocks?.find((b) => b.actionId)?.actionId;
    const d = await dismissAction(user, id);
    return { user, sessionId: a.sessionId, ok: d.status < 300 && aq(`select status from fitness_agent_actions where id='${id}'`) === "CANCELLED", note: `dismiss=${d.status} status=${aq(`select status from fitness_agent_actions where id='${id}'`)}` };
  },
  "S5 draft EXPIRED": async () => {
    const user = await mk("days"); const a = await say(user, "Tạo lịch tập cho tôi."); const id = a.data?.structuredBlocks?.find((b) => b.actionId)?.actionId;
    aq(`update fitness_agent_actions set expires_at = now() - interval '1 minute' where id='${id}' returning id`); // TEST FIXTURE
    return { user, sessionId: a.sessionId, ok: true };
  },
  // X4 follow-up: the exact reported defect — a completed profile-workflow (AgentWorkflowSession, UPDATE_GOAL) confirmation with ZERO
  // FitnessAgentAction rows for this user. Built via the real recommendation → accept → confirm HTTP sequence, not a fixture row.
  "S7 profile workflow COMPLETED (no FitnessAgentAction rows)": async () => {
    const user = await mk("mismatch");
    const a = await say(user, "với tình trạng hiện tại tôi nên cut hay bulk?"); await say(user, "ok đổi theo đề xuất đó", a.sessionId);
    const c = await say(user, "Xác nhận cập nhật.", a.sessionId);
    return {
      user, sessionId: a.sessionId,
      ok: /COMPLETED/.test(aq(`select status from agent_workflow_sessions where user_id='${user.userId}' order by created_at desc limit 1`))
        && aq(`select count(*) from fitness_agent_actions where user_id='${user.userId}'`) === "0",
      note: `confirm answer=${c.answer.slice(0, 80)}`,
    };
  },
  // X4 event-ordering fix, Defect A — a real, completed profile confirmation followed by 6 newer, UNRELATED terminal workflows (never
  // proposed any profile change). The 6 extra rows are explicit TEST FIXTURE inserts (raw SQL) — the profile confirmation itself and the
  // final question are real HTTP. Reproduces Codex's independent "history-over-five" finding at matrix scale.
  "S8 profile workflow COMPLETED behind 6 newer unrelated terminal workflows": async () => {
    const user = await mk("mismatch");
    const a = await say(user, "với tình trạng hiện tại tôi nên cut hay bulk?"); await say(user, "ok đổi theo đề xuất đó", a.sessionId);
    await say(user, "Xác nhận cập nhật.", a.sessionId);
    const confirmedUpdatedAt = aq(`select updated_at from agent_workflow_sessions where user_id='${user.userId}' order by created_at desc limit 1`);
    // single-line SQL: q()/psql wraps this in a double-quoted shell -c argument, and an embedded literal newline
    // breaks on this stack's default shell — every other query in this file (and the rest of the test suite) is
    // single-line for the same reason.
    for (let i = 1; i <= 6; i++) {
      aq(`insert into agent_workflow_sessions (id, user_id, session_id, workflow_type, status, slots_json, expires_at, created_at, updated_at) values (gen_random_uuid(), '${user.userId}', '${a.sessionId}', 'CREATE_WORKOUT_PLAN', 'CANCELLED', '{}', now() + interval '10 minutes', '${confirmedUpdatedAt}'::timestamp + interval '${i} seconds', '${confirmedUpdatedAt}'::timestamp + interval '${i} seconds')`); // TEST FIXTURE
    }
    return {
      user, sessionId: a.sessionId,
      ok: aq(`select count(*) from agent_workflow_sessions where user_id='${user.userId}'`) === "7",
      note: `7 workflow rows expected (1 real completed + 6 fixture)`,
    };
  },
  // X4 event-ordering fix, Defect B — a real draft action created, then a real profile confirmation completes AFTER it, then the SAME
  // action is cancelled via the real dismiss API AFTER that (the newest event of all). All three steps are real HTTP.
  "S9 action created, profile confirmed, action cancelled via real dismiss afterwards": async () => {
    const user = await mk("mismatchDays"); const draft = await say(user, "Tạo lịch tập cho tôi.");
    const actionId = draft.data?.structuredBlocks?.find((b) => b.actionId)?.actionId;
    const goal = await say(user, "với tình trạng hiện tại tôi nên cut hay bulk?", draft.sessionId); await say(user, "ok đổi theo đề xuất đó", goal.sessionId);
    await say(user, "Xác nhận cập nhật.", goal.sessionId);
    const d = await dismissAction(user, actionId);
    return {
      user, sessionId: draft.sessionId,
      ok: d.status < 300 && aq(`select status from fitness_agent_actions where id='${actionId}'`) === "CANCELLED"
        && /COMPLETED/.test(aq(`select status from agent_workflow_sessions where user_id='${user.userId}' order by created_at desc limit 1`)),
      note: `dismiss=${d.status}`,
    };
  },
};

// Per-cell expectation: whether THIS state/utterance pair is authorized to write, and what the answer must/must-not say.
// Returns null for U7-knowledge (excluded from strict checks — real RAG generation, not a deterministic template) and for states/utterances
// not modeled here (falls back to the legacy claimWithoutWrite heuristic only).
function expectationFor(stateName, uid) {
  if (uid === "U7-knowledge") return null;
  const isConfirmUid = uid !== "U6";
  if (stateName.startsWith("S0")) return { expectWrite: false, mustNotMatch: CLAIM };
  if (stateName.startsWith("S1")) return isConfirmUid
    ? { expectWrite: true, mustMatch: /Đã cập nhật hồ sơ/ }
    : { expectWrite: false, mustNotMatch: CLAIM }; // an ACTIVE workflow re-prompts instead of answering the boundary's own template — never a false success claim
  if (stateName.startsWith("S2")) return { expectWrite: false, mustMatch: /Mình chưa lưu gì cả|Chưa — mình chưa lưu gì cả/ };
  if (stateName.startsWith("S3")) return { expectWrite: false, mustMatch: /đã được xác nhận và lưu/ };
  if (stateName.startsWith("S4")) return { expectWrite: false, mustMatch: /đã được bỏ qua/ };
  if (stateName.startsWith("S5")) return { expectWrite: false, mustMatch: /đã hết hạn/ };
  if (stateName.startsWith("S7")) return isConfirmUid
    ? { expectWrite: false, mustMatch: /đã được xác nhận và lưu rồi/ }
    : { expectWrite: false, mustMatch: /^Rồi/, mustNotMatch: /Chưa có thay đổi nào được lưu/i }; // the reported defect: must be a truthful positive, never a false denial
  // Defect A at matrix scale: 6 newer, unrelated terminal workflows must not hide the older, real completed confirmation.
  if (stateName.startsWith("S8")) return isConfirmUid
    ? { expectWrite: false, mustMatch: /đã được xác nhận và lưu rồi/ }
    : { expectWrite: false, mustMatch: /^Rồi/, mustNotMatch: /Chưa có thay đổi nào được lưu/i };
  // Defect B at matrix scale: the real, newer dismiss must govern over the older completed profile confirmation.
  if (stateName.startsWith("S9")) return { expectWrite: false, mustMatch: /đã được bỏ qua/ };
  return null;
}

const results = [];
for (const [stateName, build] of Object.entries(STATES)) {
  for (const [uid, text] of UTTERANCES) {
    if (uid === "U7-knowledge" && !/^S[02]/.test(stateName)) continue; // slow RAG generation: only the two states that matter
    let cell = { state: stateName, id: uid, text };
    try {
      const s = await build(); if (s.ok === false) { results.push({ ...cell, setupFailed: true, note: s.note }); console.log("SETUP-FAILED", stateName); continue; }
      const before = snapshot(s.user);
      const r = await say(s.user, text, s.sessionId);
      const after = snapshot(s.user);
      const wrote = changed(before, after);
      const claim = CLAIM.test(r.answer);
      const exp = expectationFor(stateName, uid);
      const expectationFailed = exp ? (
        (exp.expectWrite !== undefined && wrote !== exp.expectWrite) ||
        (exp.mustMatch && !exp.mustMatch.test(r.answer)) ||
        (exp.mustNotMatch && exp.mustNotMatch.test(r.answer))
      ) : undefined;
      cell = {
        ...cell, http: r.status, answer: r.answer.slice(0, 220), claim, wroteToDb: wrote,
        claimWithoutWrite: claim && !wrote && uid !== "U7-knowledge",
        expectationChecked: !!exp, expectationFailed, before, after, blocks: (r.data?.structuredBlocks ?? []).map((b) => b.type),
      };
    } catch (e) { cell = { ...cell, error: String(e?.message).slice(0, 160) }; }
    results.push(cell);
    const tag = cell.expectationFailed ? "FAIL " : cell.claimWithoutWrite ? "CLAIM-NO-WRITE " : cell.error ? "ERROR " : "ok ";
    console.log(`${tag}${stateName.slice(0, 2)} ${uid} | http=${cell.http} wrote=${cell.wroteToDb} | ${String(cell.answer ?? cell.error).slice(0, 110).replace(/\n/g, " ")}`);
  }
}
// S6 cross-user: B tries to confirm inside A's session that has a pending draft
{
  const A = await mk("days"); const a = await say(A, "Tạo lịch tập cho tôi."); const B = await mk("plain");
  const r = await http("POST", "/ai/ask", { token: B.token, body: { question: "Xác nhận cập nhật.", sessionId: a.sessionId } });
  const aDraftStillPending = aq(`select count(*) from fitness_agent_actions where user_id='${A.userId}' and status='PENDING'`) === "1";
  const expectationFailed = !(r.status === 404 && aDraftStillPending);
  results.push({ state: "S6 cross-user", id: "U1", http: r.status, answer: JSON.stringify(r.json).slice(0, 140), aDraftStillPending, expectationChecked: true, expectationFailed });
  console.log(`${expectationFailed ? "FAIL " : "ok "}S6 cross-user | http=${r.status} | A draft pending=${aDraftStillPending}`);
}
fs.mkdirSync("test/conversational-intelligence/results/final-closure", { recursive: true });
fs.writeFileSync(`test/conversational-intelligence/results/final-closure/x4-matrix-${LABEL}.json`, JSON.stringify(results, null, 2));
const bad = results.filter((c) => c.claimWithoutWrite).length;
const failedExpectations = results.filter((c) => c.expectationFailed).length;
const errors = results.filter((c) => c.error).length;
const setupFailed = results.filter((c) => c.setupFailed).length;
console.log(`\ncells=${results.length} claimWithoutWrite=${bad} expectationChecked=${results.filter((c) => c.expectationChecked).length} expectationFailed=${failedExpectations} errors=${errors} setupFailed=${setupFailed}`);
if (bad > 0 || failedExpectations > 0 || errors > 0 || setupFailed > 0) process.exit(1);
