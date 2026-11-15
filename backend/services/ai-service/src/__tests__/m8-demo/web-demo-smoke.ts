/**
 * M8-D smoke harness for the local web demo API. Starts the launcher on an ephemeral loopback port, runs EVERY approved fixture
 * scenario through POST /demo/run (which drives the REAL POST /ai/v2/ask), asserts the expected statuses, the rejection of anything
 * that is not an approved scenario id, the loopback Host rule and that no outbound call happened (tripwires = 0).
 * Evidence label: TEST FIXTURE / BACKEND INTEGRATION (mock models, synthetic data, no network). Not a measure of accuracy.
 *
 * Run: cd backend/services/ai-service && FITNESS_DISABLE_REDIS=true npx tsx src/__tests__/m8-demo/web-demo-smoke.ts
 */
import http from "node:http";
import { assertSafeToStart, startWebDemoServer, type DemoRunResult } from "./web-demo-server";

function call(port: number, method: string, path: string, body?: unknown, hostHeader?: string): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, method, path, headers: { ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}), ...(hostHeader ? { Host: hostHeader } : {}) } }, (res) => {
      let buf = ""; res.on("data", (c) => (buf += c)); res.on("end", () => { let json: any = null; try { json = buf ? JSON.parse(buf) : null; } catch { /* keep null */ } resolve({ status: res.statusCode ?? 0, json }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}

export interface SmokeCheck { ok: boolean; text: string }
export async function runWebDemoSmoke(): Promise<{ ok: boolean; checks: SmokeCheck[]; runs: Record<string, DemoRunResult> }> {
  const checks: SmokeCheck[] = [];
  const check = (text: string, ok: boolean) => { checks.push({ ok, text }); };
  const s = await startWebDemoServer({ port: 0 });
  const runs: Record<string, DemoRunResult> = {};
  try {
    // launcher guards
    check("refuses NODE_ENV=production", (() => { try { assertSafeToStart({ NODE_ENV: "production" } as NodeJS.ProcessEnv, "127.0.0.1"); return false; } catch { return true; } })());
    check("refuses a non-loopback bind", (() => { try { assertSafeToStart({} as NodeJS.ProcessEnv, "0.0.0.0"); return false; } catch { return true; } })());
    check("server is bound to loopback", (s.server.address() as { address: string }).address === "127.0.0.1");

    const list = await call(s.port, "GET", "/demo/scenarios");
    check("GET /demo/scenarios → 200 with banner and 13 scenarios, no tokens/secrets in the body", list.status === 200 && list.json?.banner === "GYMINI MULTI-AGENT V2 — OFFLINE DEMO / MOCK MODEL" && list.json.scenarios.length === 13 && !/tok-a|tok-b|secret/i.test(JSON.stringify(list.json)));
    check("non-loopback Host header → 403 (DNS-rebinding guard)", (await call(s.port, "GET", "/demo/health", undefined, "evil.example.com")).status === 403);
    check("unapproved scenario id → 400", (await call(s.port, "POST", "/demo/run", { scenarioId: "free-text" })).status === 400);
    check("free text / extra keys are not accepted → 400", (await call(s.port, "POST", "/demo/run", { scenarioId: "agent-training", question: "tuỳ ý" })).status === 400 && (await call(s.port, "POST", "/demo/run", { question: "tuỳ ý" })).status === 400);
    check("unknown route → 404", (await call(s.port, "GET", "/ai/v2/ask")).status === 404 && (await call(s.port, "POST", "/ai/v2/ask", { question: "x" })).status === 404);

    const ids: string[] = list.json.scenarios.map((x: { id: string }) => x.id);
    for (const id of ids) { const r = await call(s.port, "POST", "/demo/run", { scenarioId: id }); if (r.status === 200) runs[id] = r.json as DemoRunResult; else check(`run ${id} → 200`, false); }
    const st = (id: string, i: number) => runs[id]?.turns[i]?.response.data?.status;
    const ag = (id: string, i: number) => (runs[id]?.turns[i]?.response.data?.agents ?? []).slice().sort().join(",");
    const code = (id: string, i: number) => runs[id]?.turns[i]?.http.status;

    check("orchestration: ANSWERED by nutrition+training; routing decision recorded in trace", st("orchestration-2-agents", 0) === "ANSWERED" && ag("orchestration-2-agents", 0) === "nutrition,training" && runs["orchestration-2-agents"].turns[0].trace?.decision?.chosen.length === 2);
    for (const a of ["training", "nutrition", "recovery", "progress"]) check(`agent ${a}: ANSWERED by exactly [${a}] (response agents)`, st(`agent-${a}`, 0) === "ANSWERED" && ag(`agent-${a}`, 0) === a);
    const cap = runs["routing-cap-4-domains"]?.turns[0];
    check("routing cap: PARTIAL, ≤ 2 executed agents, dropped recorded, deferred text in the real answer", cap?.response.data?.status === "PARTIAL" && (cap.response.data.agents.length >= 1 && cap.response.data.agents.length <= 2) && (cap.trace?.decision?.dropped.length ?? 0) >= 1 && /chưa được xử lý trong lượt này/.test(cap.response.data.answer));
    check("safety: benign ANSWERED; unsafe request SAFETY_BLOCKED with 0 executed agents", st("safety-benign-and-blocked", 0) === "ANSWERED" && st("safety-benign-and-blocked", 1) === "SAFETY_BLOCKED" && ag("safety-benign-and-blocked", 1) === "");
    check("minor: statement accepted; same session, NEW session and NO session → MINOR_PROTECTED with 0 agents; other account ANSWERED", [1, 2, 3].every((i) => st("minor-restriction-user-scope", i) === "MINOR_PROTECTED" && ag("minor-restriction-user-scope", i) === "") && st("minor-restriction-user-scope", 4) === "ANSWERED" && code("minor-restriction-user-scope", 0) === 200);
    check("routing-model failure → fallback: ANSWERED by [training]; no credential text in the response or trace", st("routing-model-fallback", 0) === "ANSWERED" && ag("routing-model-fallback", 0) === "training" && !/AccessDenied|fixture-credential/.test(JSON.stringify(runs["routing-model-fallback"])));
    check("agent model failure → HTTP 200, FAILED, fixed polite message", code("agent-model-failure", 0) === 200 && st("agent-model-failure", 0) === "FAILED" && /chưa trả lời được/.test(runs["agent-model-failure"].turns[0].response.data?.answer ?? ""));
    check("one of two agents fails → PARTIAL, the working agent's answer is kept", st("partial-one-agent-fails", 0) === "PARTIAL" && /Leg day/.test(runs["partial-one-agent-fails"].turns[0].response.data?.answer ?? ""));
    check("flag off → HTTP 404 and no runtime trace", code("v2-disabled", 0) === 404 && runs["v2-disabled"].turns[0].trace === null);
    check("no token → HTTP 401", code("error-unauthenticated", 0) === 401);
    check("every response with data carries a string turnId and traceId exactly as the real route returned them", Object.values(runs).every((r) => r.turns.every((t) => !t.response.data || (typeof t.response.data.turnId === "string" && typeof t.response.data.traceId === "string"))));
    const t = (await call(s.port, "GET", "/demo/health")).json?.tripwires;
    check("outbound tripwires are all 0 after every scenario (fetch, Bedrock, callLLM, un-mocked HTTP)", t && t.fetch === 0 && t.bedrock === 0 && t.callLLM === 0 && t.unmockedHttp === 0);
  } finally { await s.close(); }
  return { ok: checks.every((c) => c.ok), checks, runs };
}

if (/m8-demo\/web-demo-smoke(\.ts|\.js)?$/.test((process.argv[1] ?? "").replace(/\\/g, "/"))) {
  runWebDemoSmoke().then((r) => {
    for (const c of r.checks) process.stdout.write(`[${c.ok ? "PASS" : "FAIL"}] ${c.text}\n`);
    process.stdout.write(`\nRESULT: ${r.checks.filter((c) => c.ok).length}/${r.checks.length} checks ${r.ok ? "PASS" : "FAIL"}\n`);
    setTimeout(() => process.exit(r.ok ? 0 : 1), 50);
  }, (e) => { console.error("SMOKE CRASHED:", e); process.exit(2); });
}
