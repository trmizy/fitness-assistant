// REAL HTTP/API verification of PT Copilot step 2 (drafted proposals + PT approval) through the real chain gateway -> ai-service ->
// fitness-service -> user-service on the ISOLATED test DBs, with direct DB reads for the effects. Re-uses the accounts/fixtures of
// probe-pt-copilot.mjs (PROBE_STAMP): ACTIVE contracts and schedules are TEST FIXTURES seeded there; here the contract is also ended through
// the user DB to prove the relationship is re-verified at approval time. Nothing is sent to a client by design: the probe checks that.
// Usage (repo root): GATEWAY_URL=http://localhost:13000 PROBE_STAMP=<stamp> node test/ai-chat-full-verification/probe-pt-copilot-proposals.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { http, say, confirmAction } from "./lib.mjs";

const stamp = process.env.PROBE_STAMP;
if (!stamp) throw new Error("PROBE_STAMP required (the stamp of probe-pt-copilot.mjs fixtures)");
const root = process.cwd();
const cache = JSON.parse(fs.readFileSync(path.join(root, ".tmp-stack", `pt-probe-${stamp}.json`), "utf8"));
const login = async (u) => { const r = await http("POST", "/auth/login", { body: { email: u.email, password: "TestPass#12345" } }); return { ...u, token: r.json.accessToken }; };
const pt = await login(cache.pt), otherPt = await login(cache.pt2), risk = await login(cache.risk);

const sql = (db, q) => execFileSync("docker", ["exec", "gymcoach-test-postgres-test-1", "psql", "-U", "gymcoach_test", "-d", db, "-tAc", q], { encoding: "utf8" }).trim();
const fit = (q) => sql("gymcoach_fitness_test", q);
const usr = (q) => sql("gymcoach_user_test", q);
const rawAudits = (action) => Number(fit(`select count(*) from coach_client_action_audits where pt_user_id='${pt.userId}' and client_user_id='${risk.userId}' and action='${action}'`));
const base0 = {};
const audits = (action) => rawAudits(action) - (base0[action] ?? 0);
const clientRows = () => [fit(`select count(*) from workout_schedules where user_id='${risk.userId}'`), fit(`select count(*) from nutrition_programs where user_id='${risk.userId}'`), fit(`select count(*) from workout_programs where user_id='${risk.userId}'`)].join("/");

const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 230) : ""}`); };
const blockOf = (r) => (r.raw?.data?.structuredBlocks ?? r.raw?.structuredBlocks ?? []).find((b) => b?.kind === "PT_CLIENT_ACTION_PROPOSAL") ?? null;
const ask = (q) => say(pt, q);

for (const a of ["AI_PROPOSAL_APPROVED", "AI_PROPOSAL_DISMISSED"]) base0[a] = rawAudits(a); // counts relative to the start so the probe is re-runnable
const baseline = clientRows();

// 1 ── a proposal is drafted for a client of THIS PT
const r1 = await ask("Đề xuất cách xử lý cho client risk");
const b1 = blockOf(r1);
check("1a. a drafted proposal card is returned for the slipping client (kind PT_CLIENT_ACTION_PROPOSAL)", !!b1, String(r1.answer).slice(0, 120));
check("1b. it cites the real evidence (1/5 sessions) and contains a message draft", !!b1 && /1\/5 buổi/.test(JSON.stringify(b1.summary)) && b1.summary.proposals.some((p) => p.type === "MESSAGE_DRAFT"));
check("1c. the draft never contains the client's email or id", !!b1 && !JSON.stringify(b1.summary.proposals).includes(risk.email) && !JSON.stringify(b1.summary.proposals).includes(risk.userId));
check("1d. nothing was recorded or changed by merely asking (no approval/dismissal audit, client data unchanged)", audits("AI_PROPOSAL_APPROVED") === 0 && audits("AI_PROPOSAL_DISMISSED") === 0 && clientRows() === baseline, clientRows());

// 2 ── nobody else can approve it
const id = b1?.actionId;
const byOtherPt = await confirmAction(otherPt, id);
const byClient = await confirmAction(risk, id);
check("2. another PT and the client themself cannot approve this proposal (action not found for them)", byOtherPt.status === 404 && byClient.status === 404, `${byOtherPt.status}/${byClient.status}`);
check("2b. and they left no audit trace", audits("AI_PROPOSAL_APPROVED") === 0);

// 3 ── the PT approves: audited, still nothing sent/changed
const ok = await confirmAction(pt, id);
const res = ok.json?.data?.block;
check("3a. the PT's approval is acknowledged and shows the draft text", /Đã ghi nhận bạn duyệt/.test(String(res?.message)) && (res?.steps ?? []).some((s) => String(s).startsWith("[Tin nhắn]")), String(res?.message).slice(0, 140));
check("3b. exactly ONE audit row AI_PROPOSAL_APPROVED, flagged sentToClient=false / clientDataChanged=false", audits("AI_PROPOSAL_APPROVED") === 1 && fit(`select metadata->>'sentToClient' || '/' || (metadata->>'clientDataChanged') from coach_client_action_audits where action='AI_PROPOSAL_APPROVED' and pt_user_id='${pt.userId}' and client_user_id='${risk.userId}' order by created_at desc limit 1`) === "false/false");
check("3c. the client's own data is unchanged by the approval (schedules/programs/nutrition rows)", clientRows() === baseline, clientRows());
const again = await confirmAction(pt, id);
check("3d. a repeated confirm does not record a second approval", audits("AI_PROPOSAL_APPROVED") === 1 && again.status < 300);

// 4 ── dismissal is audited
const b4 = blockOf(await ask("Soạn đề xuất xử lý cho client risk"));
const dis = await http("POST", `/ai/agent/actions/${b4.actionId}/dismiss`, { token: pt.token, body: {} });
check("4. dismissing a proposal is audited and approves nothing", /Đã bỏ qua đề xuất/.test(JSON.stringify(dis.json)) && audits("AI_PROPOSAL_DISMISSED") === 1 && audits("AI_PROPOSAL_APPROVED") === 1, JSON.stringify(dis.json).slice(0, 100));

// 5 ── the relationship ends between drafting and approving -> refused server-side
const b5 = blockOf(await ask("Đề xuất cách xử lý cho client risk"));
usr(`update contracts set status='CANCELLED' where pt_user_id='${pt.userId}' and client_user_id='${risk.userId}' and status='ACTIVE'`);
let end;
try {
  end = await confirmAction(pt, b5.actionId);
} finally {
  usr(`update contracts set status='ACTIVE' where pt_user_id='${pt.userId}' and client_user_id='${risk.userId}' and status='CANCELLED'`);
}
const endRes = end.json?.data?.block;
check("5a. a contract that ended after the draft is refused at approval (re-verified server-side) and the draft text is withheld", /không còn quan hệ huấn luyện đang hiệu lực/.test(String(endRes?.message)) && (endRes?.steps ?? []).length === 0, String(endRes?.message).slice(0, 120));
check("5b. no approval was recorded for it", audits("AI_PROPOSAL_APPROVED") === 1);

// 6 ── names outside the roster are never drafted for
const r6 = await ask("Đề xuất cách xử lý cho client Hoàng");
check("6. an unknown name gets no proposal card and no leak", !blockOf(r6) && /không thấy client nào trong danh sách của bạn khớp/.test(String(r6.answer)));

// 7 ── another PT cannot even ask for this PT's client
const r7 = await say(otherPt, "Đề xuất cách xử lý cho client risk");
check("7. another PT (no active clients) gets no proposal for someone else's client", !blockOf(r7) && !String(r7.answer).includes(risk.email), String(r7.answer).slice(0, 100));

fs.writeFileSync("test/ai-chat-full-verification/results/probe-pt-copilot-proposals.json", JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
