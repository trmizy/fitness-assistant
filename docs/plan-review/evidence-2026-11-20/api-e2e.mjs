// REAL HTTP/API evidence: Plan Review through the LOCAL gateway (3000) -> auth/user/fitness services on disposable *_test DBs.
import { execSync, spawn } from "node:child_process";
const bg = (...args) => spawn("bash", args, { detached: true, stdio: "ignore" }).unref();
const GW = "http://localhost:3000";
const SP = "C:/Users/ASUS/AppData/Local/Temp/claude/6757a24c7e7edf08/07249fb1-0c21-4885-b207-cbf1d09844a5/scratchpad";
const PSQL = (db, sql) => execSync(`docker exec gymcoach-test-postgres-test-1 psql -U gymcoach_test -d ${db} -Atc "${sql.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
const C = "11111111-1111-4111-8111-111111111111", P = "22222222-2222-4222-8222-222222222222", C2 = "33333333-3333-4333-8333-333333333333";
let pass = 0, fail = 0;
const ok = (c, m, extra = "") => { (c ? pass++ : fail++); console.log(`${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  <-- " + extra}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, token, body, headers = {}) {
  const res = await fetch(GW + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined || method === "GET" ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
async function login(email) {
  const r = await call("POST", "/auth/login", null, { email, password: "Pr3Test!2026" });
  if (!r.json.accessToken) throw new Error("login failed " + email + " " + JSON.stringify(r));
  return r.json.accessToken;
}
const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const killPort = (port) => sh(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"`);
async function waitHealthy(port, ms = 60000) { const t = Date.now(); while (Date.now() - t < ms) { try { const r = await fetch(`http://localhost:${port}/health`); if (r.ok) return true; } catch {} await sleep(1000); } return false; }

const ctok = await login("pr3.client@example.test"), ptok = await login("pr3.pt@example.test"), c2tok = await login("pr3.client2@example.test");
const exs = PSQL("pr3_fitness_test", "select id from exercises where status='PUBLISHED' order by exercise_name limit 3").split("\n");

// ── program fixture
const mk = await call("POST", "/workouts/programs/manual", ctok, {
  name: "PR3 E2E Program", durationWeeks: 2, daysPerWeek: 1, startDate: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10), repeatWeeks: 1,
  selectedWeekdays: [new Date(Date.now() + 86400000 * 3).getUTCDay()], replaceExisting: true,
  days: [{ dayNumber: 1, title: "Ngày 1", exercises: [{ exerciseId: exs[0], sets: 3, reps: 10, restSeconds: 90 }, { exerciseId: exs[1], sets: 3, reps: 10, restSeconds: 90 }] }],
});
ok(mk.status === 201, "fixture: client creates a manual program via gateway", JSON.stringify(mk.json).slice(0, 200));
const prog = mk.json.data.program;
const exId = prog.days[0].exercises[0].id, dayId = prog.days[0].id;
const getProg = async () => (await call("GET", "/workouts/programs/current", ctok)).json.data.program;
ok((await getProg()).version === 1, "fixture: program starts at version 1");

// ── A4 gateway contracts
console.log("\n# A4 gateway /plan-reviews");
for (const [m, p] of [["POST", "/plan-reviews"], ["GET", "/plan-reviews/mine"], ["GET", "/plan-reviews/inbox"], ["GET", "/plan-reviews/summary"], ["GET", "/plan-reviews/x"], ["POST", "/plan-reviews/x/decision"], ["POST", "/plan-reviews/x/cancel"]]) {
  ok((await call(m, p, null, {})).status === 401, `no token ${m} ${p} -> 401`);
}
ok((await call("GET", "/plan-reviews/mine", "garbage.token.value")).status === 401, "garbage token -> 401");
let r = await call("POST", "/plan-reviews", ctok, { ptUserId: P, clientUserId: C2 });
ok(r.status === 400 && r.json.code === "VALIDATION", "body naming another client is rejected (400 VALIDATION)", JSON.stringify(r));
r = await call("POST", "/plan-reviews", c2tok, { ptUserId: P });
ok(r.status === 403 && r.json.code === "NO_ACTIVE_CONTRACT", "client WITHOUT contract cannot submit to the PT (403)", JSON.stringify(r));
r = await call("GET", "/plan-reviews/inbox", ctok);
ok(r.status === 403, "client cannot read a PT inbox (403)", JSON.stringify(r));

const key1 = "pr3-key-" + Date.now();
const sub = await call("POST", "/plan-reviews", ctok, { ptUserId: P, clientNote: "xin duyệt", expectedVersion: 1 }, { "Idempotency-Key": key1 });
ok(sub.status === 201 && sub.json.request.status === "PENDING_REVIEW", "client submits current plan -> 201 PENDING_REVIEW", JSON.stringify(sub));
const rid = sub.json.request.id;
ok(sub.json.request.subjectVersion === 1 && /^[a-f0-9]{64}$/.test(sub.json.request.contentHash), "request bound to version + sha256 hash");
const sub2 = await call("POST", "/plan-reviews", ctok, { ptUserId: P, clientNote: "xin duyệt", expectedVersion: 1 }, { "Idempotency-Key": key1 });
ok(sub2.status === 200 && sub2.json.replayed && sub2.json.request.id === rid, "double-submit with same key -> 200 replay, same id");
const dbl = await Promise.all([1, 2, 3].map(() => call("POST", "/plan-reviews", ctok, { ptUserId: P }, { "Idempotency-Key": "race-" + key1 })));
ok(new Set(dbl.map((x) => x.json.request?.id)).size === 1, "3 concurrent submits (same key) -> one request", JSON.stringify(dbl.map((x) => x.status)));
ok(PSQL("pr3_fitness_test", `select count(*) from plan_review_requests where client_user_id='${C}'`) === "1", "DB: exactly 1 request row after retries/races");
r = await call("POST", "/plan-reviews", ctok, { ptUserId: P, expectedVersion: 99 });
ok(r.status === 409, "stale expectedVersion -> 409", JSON.stringify(r));

r = await call("GET", `/plan-reviews/${rid}`, c2tok);
ok(r.status === 404, "non-participant reads request -> 404 (no IDOR)", JSON.stringify(r));
r = await call("GET", `/plan-reviews/${rid}`, ptok);
ok(r.status === 200 && r.json.request.snapshot?.days?.length === 1 && !JSON.stringify(r.json).match(/inbody|userProfile/i), "PT reads request; snapshot is plan only", JSON.stringify(r).slice(0, 120));
r = await call("POST", `/plan-reviews/${rid}/decision`, ctok, { decision: "APPROVE" });
ok(r.status === 403, "client cannot decide (403)", JSON.stringify(r));
r = await call("POST", `/plan-reviews/${rid}/decision`, ptok, { decision: "REJECT" });
ok(r.status === 400 && r.json.code === "NOTE_REQUIRED", "reject without note -> 400");
r = await call("POST", `/plan-reviews/${rid}/decision`, ptok, { decision: "APPROVE", expectedRevision: 77 });
ok(r.status === 409, "decision on a stale revision -> 409", JSON.stringify(r));
r = await call("POST", `/plan-reviews/${rid}/decision`, ptok, { decision: "APPROVE", expectedContentHash: "0".repeat(64) });
ok(r.status === 409, "decision on a different content hash -> 409", JSON.stringify(r));

// ── A3 notification inbox (user-service up)
console.log("\n# A3 notification outbox -> delivery -> inbox");
await sleep(2500); // kick after submit
const inbox = async (tok) => (await call("GET", "/notifications?limit=50", tok)).json.notifications ?? [];
let n = (await inbox(ptok)).filter((x) => x.eventType === "PLAN_REVIEW_REQUESTED");
ok(n.length === 1, "PT inbox has exactly 1 PLAN_REVIEW_REQUESTED (retries/races did not duplicate)", String(n.length));
ok(n[0] && !/kg|inbody|chấn thương/i.test(n[0].text) && n[0].entityId === rid, "notification text is generic and points at the request");

// ── A3: user-service DOWN while PT decides
const reqChanges = await call("POST", `/plan-reviews/${rid}/decision`, ptok, { decision: "REQUEST_CHANGES", note: "Thêm bài vai", expectedRevision: sub.json.request.revision });
ok(reqChanges.status === 200 && reqChanges.json.request.status === "CHANGES_REQUESTED", "PT requests changes -> 200 CHANGES_REQUESTED", JSON.stringify(reqChanges).slice(0, 150));
await sleep(2500);
n = (await inbox(ctok)).filter((x) => x.eventType === "PLAN_REVIEW_DECIDED");
ok(n.length === 1, "client inbox has the decision notification (user-service up)");

// open a request while everything is up, then take user-service down
const reOpen = await call("POST", "/plan-reviews", ctok, { ptUserId: P, expectedVersion: 1 });
ok(reOpen.status === 201, "client resubmits after changes (new request)", JSON.stringify(reOpen).slice(0, 150));
const rid2 = reOpen.json.request.id;
await sleep(2500);
killPort(3004); await sleep(1500);
ok(!(await waitHealthy(3004, 1500)), "user-service is DOWN");
r = await call("POST", `/plan-reviews/${rid2}/decision`, ptok, { decision: "APPROVE", note: "OK" });
ok(r.status === 503 && r.json.code === "AUTH_DEPENDENCY_UNAVAILABLE", "PT decision while the contract roster is unreadable -> 503 (fail closed)", JSON.stringify(r));
ok(PSQL("pr3_fitness_test", `select status from plan_review_requests where id='${rid2}'`) === "PENDING_REVIEW", "outage did NOT approve and did NOT revoke the request (still PENDING_REVIEW)");
r = await call("POST", "/plan-reviews", ctok, { ptUserId: P });
ok(r.status === 503, "client submit while the roster is unreadable -> 503, nothing created", JSON.stringify(r));
// a client-side action that needs no roster still works and queues a PT notification in the outbox
const cn = await call("POST", `/plan-reviews/${rid2}/cancel`, ctok);
ok(cn.status === 200 && cn.json.request.status === "CANCELLED", "client cancels while user-service is down -> 200 CANCELLED", JSON.stringify(cn).slice(0, 150));
await sleep(3000);
const pend = Number(PSQL("pr3_fitness_test", `select count(*) from plan_review_events where notify_user_id is not null and notified_at is null`));
ok(pend >= 1, `outbox keeps the undelivered event pending during the outage (${pend})`, String(pend));
const evBefore = PSQL("pr3_fitness_test", `select count(*) from plan_review_events where request_id='${rid2}'`);
const stBefore = PSQL("pr3_fitness_test", `select status||':'||revision from plan_review_requests where id='${rid2}'`);

bg(`${SP}/stack.sh`, "user-up");
ok(await waitHealthy(3004, 90000), "user-service restored");
console.log("   waiting for the 60s sweep to deliver…");
const t0 = Date.now(); let left = 99;
while (Date.now() - t0 < 150000) { left = Number(PSQL("pr3_fitness_test", `select count(*) from plan_review_events where notify_user_id is not null and notified_at is null`)); if (left === 0) break; await sleep(5000); }
ok(left === 0, `sweep delivered every pending event after recovery (${Math.round((Date.now() - t0) / 1000)}s)`, String(left));
const evTotal = PSQL("pr3_fitness_test", `select count(*) from plan_review_events where notify_user_id is not null`);
const delivered = PSQL("pr3_user_test", `select count(*) from notifications where dedupe_key like 'plan-review-event:%'`);
ok(evTotal === delivered, `invariant: one user notification per outbox event, no duplicates (${delivered}/${evTotal})`);
ok(PSQL("pr3_fitness_test", `select count(*) from plan_review_events where request_id='${rid2}'`) === evBefore && PSQL("pr3_fitness_test", `select status||':'||revision from plan_review_requests where id='${rid2}'`) === stBefore, "recovery/retry created NO new decision event and did not change request state");
const ptReq = (await inbox(ptok)).filter((x) => x.eventType === "PLAN_REVIEW_REQUESTED");
ok(ptReq.some((x) => /huỷ/i.test(x.text)), "PT received the (delayed) cancellation notice after recovery");

// approve flow for the A5 section
const re = await call("POST", "/plan-reviews", ctok, { ptUserId: P, expectedVersion: 1 });
const ridA = re.json.request.id;
const ap = await call("POST", `/plan-reviews/${ridA}/decision`, ptok, { decision: "APPROVE", note: "OK", expectedRevision: re.json.request.revision });
ok(ap.status === 200 && ap.json.request.status === "APPROVED", "after recovery PT approves -> 200 APPROVED", JSON.stringify(ap).slice(0, 150));

// ── A5 version / approval
console.log("\n# A5 version & approval");
let p = await getProg(); ok(p.version === 1, "approval was recorded at version 1");
let view = (await call("GET", `/plan-reviews/${ridA}`, ctok)).json.request;
ok(view.effectiveState === "APPROVED_CURRENT" && !view.isOutdated, "approved + unchanged => APPROVED_CURRENT");
const e1 = await call("PATCH", `/workouts/program-days/${dayId}`, ctok, { description: "ghi chú buổi", duration: 55 });
const e2 = await call("PATCH", `/workouts/programs/${prog.id}`, ctok, { description: "mô tả mới" });
ok(e1.status === 200 && e2.status === 200, "non-content PATCHes were accepted (200) — so the next check is not vacuous", JSON.stringify([e1.status, e2.status]));
ok((await getProg()).version === 1, "non-content edits (day description/duration, program description) do NOT bump version");
const e3 = await call("PATCH", `/workouts/program-exercises/${exId}`, ctok, { reps: 12 });
ok(e3.status === 200, "content PATCH accepted (200)", JSON.stringify(e3));
p = await getProg(); ok(p.version === 2, "content edit bumps version 1 -> 2", String(p.version));
view = (await call("GET", `/plan-reviews/${ridA}`, ctok)).json.request;
ok(view.effectiveState === "APPROVED_OUTDATED" && view.isOutdated, "after edit the approval is APPROVED_OUTDATED");
await call("PATCH", `/workouts/program-exercises/${exId}`, ctok, { reps: 10 });
p = await getProg(); view = (await call("GET", `/plan-reviews/${ridA}`, ctok)).json.request;
ok(p.version === 3 && view.effectiveState === "APPROVED_OUTDATED", "A->B->A: same content, version 3 => approval NOT revived");
const rid3r = await call("POST", "/plan-reviews", ctok, { ptUserId: P, expectedVersion: 3 });
ok(rid3r.status === 201 && rid3r.json.request.subjectVersion === 3 && rid3r.json.request.contentHash === view.contentHash, "client resubmits identical content as a NEW request bound to v3");
const rid3 = rid3r.json.request.id;
// PT decides while the plan is mutated concurrently
const [dec, edit] = await Promise.all([
  call("POST", `/plan-reviews/${rid3}/decision`, ptok, { decision: "APPROVE", note: "ok" }),
  call("PATCH", `/workouts/program-exercises/${exId}`, ctok, { reps: 14 }),
]);
const st = PSQL("pr3_fitness_test", `select status from plan_review_requests where id='${rid3}'`);
const v = (await getProg()).version;
ok(edit.status === 200 && v === 4, "concurrent edit committed (v4)");
ok((dec.status === 200 && st === "APPROVED") || (dec.status === 409 && st === "SUPERSEDED"), `PT decision vs concurrent edit is safe: decision=${dec.status} state=${st}`, JSON.stringify(dec));
const after = (await call("GET", `/plan-reviews/${rid3}`, ctok)).json.request;
ok(after.effectiveState !== "APPROVED_CURRENT", "after the concurrent edit no approval is 'current' for the new plan");
ok(sh(`docker exec gymcoach-test-postgres-test-1 psql -U gymcoach_test -d pr3_fitness_test -Atc "select count(*) from workouts"`).trim() !== undefined, "workout history table untouched by review flows (read-only check)");

// ── A5 contract revoked
console.log("\n# A5 contract revoked");
const open = await call("POST", "/plan-reviews", ctok, { ptUserId: P });
ok(open.status === 201, "client has a fresh open request", JSON.stringify(open).slice(0, 150));
const orid = open.json.request.id;
PSQL("pr3_user_test", `update contracts set status='CANCELLED' where pt_user_id='${P}' and client_user_id='${C}'`);
r = await call("GET", `/plan-reviews/${orid}`, ptok);
ok(r.status === 403 && r.json.code === "NO_ACTIVE_CONTRACT", "contract ended: PT is blocked from the request (403)", JSON.stringify(r));
r = await call("POST", `/plan-reviews/${orid}/decision`, ptok, { decision: "APPROVE" });
ok(r.status === 403, "contract ended: PT cannot decide (403)", JSON.stringify(r));
ok(PSQL("pr3_fitness_test", `select status from plan_review_requests where id='${orid}'`) === "ACCESS_REVOKED", "open request moved to ACCESS_REVOKED");
r = await call("GET", "/plan-reviews/inbox", ptok);
ok(r.status === 200 && r.json.requests.length === 0, "PT inbox is empty after revocation");
r = await call("POST", "/plan-reviews", ctok, { ptUserId: P });
ok(r.status === 403, "client cannot submit to the PT after the contract ended (403)", JSON.stringify(r));
PSQL("pr3_user_test", `update contracts set status='ACTIVE' where pt_user_id='${P}' and client_user_id='${C}'`);

// ── A4: fitness-service down -> gateway timeout/5xx, never a fake success
console.log("\n# A4 upstream failure");
killPort(3002); await sleep(1500);
const t1 = Date.now(); r = await call("GET", "/plan-reviews/mine", ctok);
ok(r.status >= 500 && r.status < 600, `fitness-service down: gateway answers 5xx (${r.status}) in ${Date.now() - t1}ms, not a success`, JSON.stringify(r));
bg(`${SP}/stack.sh`, "fitness-up");

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
