/**
 * M9.3-T1 — the LOCAL DEV LAUNCHER used by the browser run (coach-dev-server.ts), exercised over HTTP (supertest against its own
 * loopback server). CONTROLLER INTEGRATION / TEST FIXTURE: real ai-service app + real bridge + real V2 runtime over mocks; fake auth,
 * model, data, store, history and V1 stub. No DB / Redis / AWS / Bedrock / network. Not a browser test.
 * Run: FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/m9-coach-harness/coach-dev-harness.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { startCoachDevServer, assertSafeToStart, ACCOUNTS, type CoachDevServer } from "./coach-dev-server";

let s: CoachDevServer;
const A = ACCOUNTS[0], B = ACCOUNTS[1], M = ACCOUNTS[2];
test.before(async () => { s = await startCoachDevServer({ port: 0 }); });
test.after(async () => { await s.close(); });

const api = () => request(s.server);
const login = async (a = A) => (await api().post("/auth/login").send({ email: a.email, password: a.password })).body as { accessToken: string; refreshToken: string; user: { id: string } };
const ask = (token: string | null, body: object) => { const r = api().post("/ai/ask"); return (token ? r.set("Authorization", `Bearer ${token}`) : r).send(body); };
const optin = (token: string, enabled: boolean) => api().post("/__dev/coach-v2/optin").set("Authorization", `Bearer ${token}`).send({ enabled });
let n = 0;
const id = () => `h-${++n}-00000001`;
const scenario = (sid: string) => s.scenarios.find((x) => x.id === sid)!;

test("DL-1 safety rails: refuses production and any non-loopback bind; the bridge is ON but V2 is reachable by NOBODY until a user opts in", async () => {
  assert.throws(() => assertSafeToStart({ NODE_ENV: "production" } as NodeJS.ProcessEnv, "127.0.0.1"), /production/);
  assert.throws(() => assertSafeToStart({} as NodeJS.ProcessEnv, "0.0.0.0"), /loopback/);
  assert.doesNotThrow(() => assertSafeToStart({} as NodeJS.ProcessEnv, "127.0.0.1"));
  assert.equal(s.optedIn.size, 0);
  assert.equal((s.server.address() as { address: string }).address, "127.0.0.1");
  const t = await login();
  const free = await ask(t.accessToken, { question: "Cho mình hỏi về việc tăng cơ?", clientRequestId: id() });
  assert.equal(free.status, 200); assert.equal(free.body.data.modelUsed, "v1-launcher-stub"); assert.equal(free.body.data.engine, undefined, "V1 reply carries no V2 fields");
  assert.equal(s.fakes.store.recs.size, 0, "V2 never started: no idempotency claim");
});

test("DL-2 fake auth: wrong password / no token / forged token → 401; fixture tokens exist only in this process", async () => {
  assert.equal((await api().post("/auth/login").send({ email: A.email, password: "wrong" })).status, 401);
  assert.equal((await ask(null, { question: "Hôm nay tôi tập gì?", clientRequestId: id() })).status, 401);
  assert.equal((await ask("forged", { question: "Hôm nay tôi tập gì?", clientRequestId: id() })).status, 401);
  assert.equal((await api().post("/__dev/coach-v2/optin").send({ enabled: true })).status, 401, "the opt-in endpoint needs a verified user");
  assert.equal((await api().get("/__dev/coach-v2/scenarios")).status, 401);
  const v = await api().post("/auth/verify").set("Authorization", `Bearer ${(await login()).accessToken}`).send({});
  assert.equal(v.status, 200); assert.equal(v.body.user.id, A.id);
});

test("DL-3 opt-in is server-side and strict: body must be exactly { enabled: boolean }; default OFF; V1 SSE keeps working", async () => {
  const t = (await login()).accessToken;
  assert.equal((await api().get("/__dev/coach-v2/optin").set("Authorization", `Bearer ${t}`)).body.enabled, false);
  for (const bad of [{}, { enabled: "yes" }, { enabled: true, userId: B.id }]) assert.equal((await api().post("/__dev/coach-v2/optin").set("Authorization", `Bearer ${t}`).send(bad)).status, 400, JSON.stringify(bad));
  const sse = await api().post("/ai/ask/stream").set("Authorization", `Bearer ${t}`).send({ question: "Xin chào", clientRequestId: id() });
  assert.equal(sse.status, 200); assert.match(sse.headers["content-type"], /text\/event-stream/);
  assert.match(sse.text, /"type":"status"/); assert.match(sse.text, /"type":"token"/); assert.match(sse.text, /"type":"done"/);
});

test("DL-4 opted in: only the approved scenarios are accepted (free text → 400 at the launcher), each approved scenario is served by the REAL V2 runtime", async () => {
  const t = (await login()).accessToken;
  assert.equal((await optin(t, true)).body.enabled, true);
  const runs0 = s.counters.v2Runs();
  const free = await ask(t, { question: "Cho mình hỏi về việc tăng cơ?", clientRequestId: id() });
  assert.equal(free.status, 400); assert.equal(free.body.error.code, "VALIDATION_ERROR");
  assert.equal(s.counters.v2Runs(), runs0, "free text never reached the runtime");
  const expectStatus: Record<string, [string, string[]]> = {
    training: ["ANSWERED", ["training"]], nutrition: ["ANSWERED", ["nutrition"]], recovery: ["ANSWERED", ["recovery"]], progress: ["ANSWERED", ["progress"]],
    "two-agents": ["ANSWERED", ["nutrition", "training"]], "partial-cap": ["PARTIAL", ["nutrition", "training"]], safety: ["SAFETY_BLOCKED", []], "agent-failure": ["FAILED", ["training"]],
  };
  for (const sc of s.scenarios) {
    const r = await ask(t, { question: sc.question, clientRequestId: id() });
    assert.equal(r.status, 200, sc.id);
    const [status, agents] = expectStatus[sc.id];
    assert.equal(r.body.data.engine, "multi-agent-v2", `${sc.id} was served by V2 (not the V1 stub)`);
    assert.equal(r.body.data.v2.status, status, sc.id);
    assert.deepEqual([...r.body.data.v2.agents].sort(), [...agents].sort(), sc.id);
    assert.ok(r.body.data.answer.length > 0, sc.id);
  }
  assert.equal(s.counters.v2Runs(), runs0 + s.scenarios.length, "one supervisor turn per scenario");
  assert.equal((await optin(t, false)).body.enabled, false);
  const back = await ask(t, { question: "Cho mình hỏi về việc tăng cơ?", clientRequestId: id() });
  assert.equal(back.body.data.modelUsed, "v1-launcher-stub", "after opting out, free text is V1 again");
});

test("DL-5 minor account: the same approved question gets MINOR_PROTECTED — no agent, no V1 fallback, nothing saved to history", async () => {
  const t = (await login(M)).accessToken;
  await optin(t, true);
  const v1 = s.counters.v1Ask, turns = s.fakes.history.turns.length;
  const r = await ask(t, { question: scenario("nutrition").question, clientRequestId: id() });
  assert.equal(r.status, 200); assert.equal(r.body.data.v2.status, "MINOR_PROTECTED"); assert.equal(r.body.data.v2.kind, "blocked"); assert.deepEqual(r.body.data.v2.agents, []);
  assert.equal(s.counters.v1Ask, v1); assert.equal(s.fakes.history.turns.length, turns);
  await optin(t, false);
});

test("DL-6 duplicate / concurrent duplicate over HTTP: V2 runs once for one action; conflicting reuse of the id is refused; users never share", async () => {
  const ta = (await login(A)).accessToken, tb = (await login(B)).accessToken;
  await optin(ta, true); await optin(tb, true);
  const key = id(); const q = scenario("training").question; const runs0 = s.counters.v2Runs();
  const burst = await Promise.all([1, 2, 3].map(() => ask(ta, { question: q, clientRequestId: key })));
  assert.equal(s.counters.v2Runs(), runs0 + 1, "three simultaneous identical requests → ONE supervisor turn");
  for (const r of burst) assert.ok([200, 409].includes(r.status), String(r.status));
  assert.ok(burst.some((r) => r.status === 200));
  const again = await ask(ta, { question: q, clientRequestId: key });
  assert.equal(again.status, 200); assert.equal(again.body.data.v2.replayed, true); assert.equal(s.counters.v2Runs(), runs0 + 1);
  const conflict = await ask(ta, { question: scenario("nutrition").question, clientRequestId: key });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, "IDEMPOTENCY_KEY_CONFLICT");
  const other = await ask(tb, { question: q, clientRequestId: key });
  assert.equal(other.status, 200); assert.equal(other.body.data.v2.replayed, false, "the same key under another user is its own action");
  assert.equal(s.counters.v2Runs(), runs0 + 2);
  await optin(ta, false); await optin(tb, false);
});

test("DL-7 V2 history shows up through the REAL session endpoints (sidebar + messages) and is isolated per user", async () => {
  const ta = (await login(A)).accessToken, tb = (await login(B)).accessToken;
  await optin(ta, true);
  const r = await ask(ta, { question: scenario("recovery").question, clientRequestId: id() });
  const sid = r.body.data.sessionId as string;
  assert.ok(sid);
  const list = await api().get("/ai/sessions").set("Authorization", `Bearer ${ta}`);
  assert.equal(list.status, 200); assert.ok(list.body.data.sessions.some((x: { id: string }) => x.id === sid));
  const msgs = await api().get(`/ai/sessions/${sid}/messages`).set("Authorization", `Bearer ${ta}`);
  assert.equal(msgs.status, 200); assert.equal(msgs.body.data.messages.length, 1); assert.equal(msgs.body.data.messages[0].question, scenario("recovery").question);
  assert.equal((await api().get(`/ai/sessions/${sid}/messages`).set("Authorization", `Bearer ${tb}`)).status, 403, "another user cannot read it");
  assert.ok(!(await api().get("/ai/sessions").set("Authorization", `Bearer ${tb}`)).body.data.sessions.some((x: { id: string }) => x.id === sid));
  await optin(ta, false);
});

test("DL-8 nothing left the process: tripwires are zero; un-mocked gateway paths are recorded, never forwarded", async () => {
  const t = (await login()).accessToken;
  await api().get("/users/me").set("Authorization", `Bearer ${t}`);
  assert.ok(s.unmocked.includes("GET /users/me"));
  assert.deepEqual(s.tripwires, { fetch: 0, bedrock: 0, callLLM: 0, unmockedHttp: 0 });
  const h = await api().get("/__dev/coach-v2/health");
  assert.equal(h.status, 200); assert.deepEqual(h.body.tripwires, { fetch: 0, bedrock: 0, callLLM: 0, unmockedHttp: 0 });
});

const chaos = (token: string, mode: string | null) => api().post("/__dev/coach-v2/chaos").set("Authorization", `Bearer ${token}`).send({ mode });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("DL-9 chaos controls reproduce REAL bridge situations: a lost response is replayed on retry; a held turn answers its retry with a real 409 OPERATION_IN_PROGRESS, then replays", async () => {
  const t = (await login(A)).accessToken;
  await optin(t, true);
  assert.equal((await chaos(t, "bogus" as never)).status, 400);
  // 1. response lost after V2 completed → retry with the SAME id gets the stored result, V2 does not run again
  const runs0 = s.counters.v2Runs(); const k1 = id(); const q = scenario("training").question;
  assert.equal((await chaos(t, "drop-response")).status, 200);
  await assert.rejects(ask(t, { question: q, clientRequestId: k1 }));
  assert.equal(s.counters.v2Runs(), runs0 + 1, "V2 ran once even though the client never saw the answer");
  const retry = await ask(t, { question: q, clientRequestId: k1 });
  assert.equal(retry.status, 200); assert.equal(retry.body.data.v2.replayed, true); assert.equal(s.counters.v2Runs(), runs0 + 1);
  // 2. turn held in flight, client connection dropped: the retry hits the REAL in-progress guard
  const k2 = id();
  assert.equal((await chaos(t, "hold-then-drop")).status, 200);
  await assert.rejects(ask(t, { question: q, clientRequestId: k2 }));
  const inFlight = await ask(t, { question: q, clientRequestId: k2 });
  assert.equal(inFlight.status, 409); assert.equal(inFlight.body.error.code, "OPERATION_IN_PROGRESS"); assert.ok(inFlight.headers["retry-after"]);
  await api().post("/__dev/coach-v2/release").set("Authorization", `Bearer ${t}`).send({});
  let done = { status: 0 } as { status: number; body?: any };
  for (let i = 0; i < 40 && done.status !== 200; i++) { await sleep(50); done = await ask(t, { question: q, clientRequestId: k2 }); }
  assert.equal(done.status, 200); assert.equal(done.body.data.v2.replayed, true);
  assert.equal(s.counters.v2Runs(), runs0 + 2, "the held turn ran exactly once");
  await optin(t, false);
});

test("DL-10 history reload metadata: a persisted V2 turn comes back with the V2 engine marker + the real supervisor trace id; a V1 turn does not; nothing beyond that is stored or invented", async () => {
  const fs = await import("node:fs"); const path = await import("node:path");
  const t = (await login(A)).accessToken;
  await optin(t, true);
  const live = await ask(t, { question: scenario("progress").question, clientRequestId: id() });
  assert.equal(live.body.data.v2.status, "ANSWERED");
  const sid = live.body.data.sessionId as string;
  await optin(t, false);
  const v1 = await ask(t, { question: "Cho mình hỏi về việc tăng cơ?", clientRequestId: id() }); // new conversation, V1 stub
  const rows = (await api().get(`/ai/sessions/${sid}/messages`).set("Authorization", `Bearer ${t}`)).body.data.messages as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].modelUsed, "multi-agent-v2"); assert.equal(rows[0].traceId, live.body.data.v2.traceId, "the trace id of the live reply is what history keeps");
  for (const notStored of ["agents", "executedAgents", "status", "kind", "v2", "engine", "turnId", "block"]) assert.ok(!(notStored in rows[0]), `history has no ${notStored} column — it must not be invented`);
  const v1rows = (await api().get(`/ai/sessions/${v1.body.data.sessionId}/messages`).set("Authorization", `Bearer ${t}`)).body.data.messages as Array<Record<string, unknown>>;
  assert.notEqual(v1rows[0].modelUsed, "multi-agent-v2");
  // blocked / partial / failed turns are not persisted at all (policy), so they can never come back as a restored badge
  await optin(t, true);
  const turnsBefore = s.fakes.history.turns.length;
  for (const sc of ["safety", "partial-cap", "agent-failure"]) await ask(t, { question: scenario(sc).question, clientRequestId: id() });
  assert.equal(s.fakes.history.turns.length, turnsBefore, "blocked / partial / failed turns were not written");
  // the frontend constant is the backend marker
  const { V2_ENGINE_MARKER } = await import("../../services/coach-v2-continuity");
  const fe = fs.readFileSync(path.resolve(__dirname, "../../../../../../frontend/web/src/app/services/coachV2Response.ts"), "utf8");
  assert.match(fe, new RegExp(`COACH_V2_ENGINE_MARKER = "${V2_ENGINE_MARKER}"`));
  await optin(t, false);
});
