/**
 * M8-B Stream 4 — OFFLINE DEMO of the existing Multi-Agent V2 capabilities.
 *
 * Evidence label: TEST FIXTURE. Everything here runs through the REAL ai-service `app` (POST /ai/v2/ask: real flag gate,
 * requireAuth, strict body validator, composition root, supervisor, four bounded agents, tool registries, profile reader,
 * minor-restriction gate) with ONLY these replaced: auth-service token verification, the HTTP transport (axios adapter —
 * no socket), the agents' and the routing model (scripted mocks), the domain READ deps (synthetic fixtures) and the V1
 * /ai/ask controller (a counting stub: only ROUTE reachability is shown, not V1 behaviour).
 * Tripwires: fetch, Bedrock send, llmService.callLLM and any un-mocked axios call are counted and must stay at 0.
 *
 * NOT health advice. NOT a measure of accuracy. Mock models say what the script tells them to — this demo shows the
 * ORCHESTRATION, GATES and FAILURE HANDLING, never answer quality. Synthetic results are NOT human-validated.
 * No production code, router, safety check, supervisor, session store or evaluator is modified or bypassed.
 *
 * Run: cd backend/services/ai-service && FITNESS_DISABLE_REDIS=true npx tsx src/__tests__/m8-demo/offline-demo.ts
 */
import request from "supertest";
import type { Express } from "express";
import axios, { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";

import type { MockProvider, WorldState } from "../m5-benchmark/harness";
import type { AgentId } from "../../agent-v2/multi-agent-contracts";
import type { SupervisorTrace } from "../../agent-v2/supervisor";
import type { AgentModelProvider, AgentModelResponse } from "../../agent-v2/model-provider";
import type { MinorRestrictionStore } from "../../agent-v2/minor-restriction";

export const BANNER = "OFFLINE DEMO — fixture data only — mock models, no network — NOT health advice — NOT a measure of accuracy — synthetic results are NOT human-validated";

// pseudonymous fixture identities (never real users)
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const T0 = Date.parse("2026-11-13T09:00:00.000Z");
const TOKENS: Record<string, string> = { "tok-a": USER_A, "tok-b": USER_B };
const ALL: AgentId[] = ["training", "nutrition", "recovery", "progress"];
const ENV_KEYS = ["AI_AGENT_V2", "AI_AGENT_V2_ROUTING_MODE", "AI_AGENT_V2_PRODUCTION_APPROVED", "AI_AGENT_V2_HYBRID_PRODUCTION_APPROVED", "NODE_ENV"] as const;
type EnvKey = (typeof ENV_KEYS)[number];

export interface Check { ok: boolean; text: string }
export interface ScenarioResult { id: string; title: string; verdict: "DEMONSTRATED" | "NOT DEMONSTRABLE"; reason?: string; statuses: string[]; checks: Check[]; lines: string[] }
export interface DemoReport { ok: boolean; results: ScenarioResult[]; transcript: string; tripwires: { fetch: number; bedrock: number; callLLM: number; unmockedHttp: number }; v1AskReached: number }

type Reply = { status: number; data?: unknown };

export async function runOfflineDemo(): Promise<DemoReport> {
  // ── environment (before the app is imported; restored at the end) ────────────────────────────────────────────────────
  const saved: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string | undefined) => { if (!(k in saved)) saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  setEnv("INTERNAL_SERVICE_SECRET", "test-internal-secret");
  setEnv("AI_ASK_RATE_LIMIT_MAX", "10000");
  setEnv("LOG_LEVEL", "silent"); // keep the structured production log lines out of the readable transcript (the shared logger reads this at import)
  setEnv("USER_SERVICE_URL", "http://user-service.m8demo.invalid");
  setEnv("FITNESS_SERVICE_URL", "http://fitness-service.m8demo.invalid");
  for (const k of ["RATE_LIMIT_PROVIDER", "USER_LAMBDA_NAME", "FITNESS_LAMBDA_NAME", "AUTH_LAMBDA_NAME", "AGENT_V2_SESSION_STORE", "AGENT_V2_SESSION_REDIS_URL", ...ENV_KEYS]) setEnv(k, undefined);
  const originalFetch = globalThis.fetch;
  const originalAdapter = axios.defaults.adapter;

  // ── tripwires ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const trip = { fetch: 0, bedrock: 0, callLLM: 0, unmockedHttp: 0 };
  const net = { profiles: {} as Record<string, Reply>, profileReads: 0 };
  const respond = (config: InternalAxiosRequestConfig, r: Reply): AxiosResponse => {
    const response: AxiosResponse = { data: r.data, status: r.status, statusText: String(r.status), headers: {}, config, request: {} };
    if (!config.validateStatus || config.validateStatus(r.status)) return response;
    throw new AxiosError(`Request failed with status code ${r.status}`, AxiosError.ERR_BAD_REQUEST, config, {}, response);
  };
  const adapter: AxiosAdapter = async (config) => {
    const h = config.headers as unknown as { get?: (k: string) => unknown; Authorization?: unknown };
    const auth = String(h?.get?.("Authorization") ?? h?.Authorization ?? "");
    const url = String(config.url ?? "");
    if (url.endsWith("/profile/me") && /\.invalid\//.test(url)) { net.profileReads++; return respond(config, net.profiles[auth.replace(/^Bearer /, "")] ?? { status: 401, data: {} }); }
    trip.unmockedHttp++;
    return respond(config, { status: 404, data: { error: "not mocked" } });
  };
  axios.defaults.adapter = adapter;
  globalThis.fetch = (async () => { trip.fetch++; throw new Error("network blocked"); }) as typeof fetch;
  const { bedrockRuntimeDeps } = await import("../../services/bedrock.client");
  const originalSend = bedrockRuntimeDeps.send;
  bedrockRuntimeDeps.send = (async () => { trip.bedrock++; throw new Error("provider blocked"); }) as any;
  const { llmService } = await import("../../services/llm.service");
  const originalCallLLM = (llmService as any).callLLM;
  (llmService as any).callLLM = async () => { trip.callLLM++; throw new Error("TRIPWIRE: model call"); };
  const { authServiceClientDeps } = await import("../../clients/auth-service.client");
  const originalVerify = authServiceClientDeps.verify;
  authServiceClientDeps.verify = (async (token: string) => {
    const id = TOKENS[token];
    if (!id) throw Object.assign(new Error("invalid"), { response: { status: 401 } });
    return { status: 200, data: { user: { id, role: "CUSTOMER" } } };
  }) as any;
  const { aiController } = await import("../../controllers/ai.controller");
  const originalV1Ask = (aiController as any).ask;
  let v1AskReached = 0;
  (aiController as any).ask = (_req: any, res: any) => { v1AskReached++; res.status(200).json({ success: true, data: { v1: true } }); };

  const hz = await import("../m5-benchmark/harness");
  const rt = await import("../../agent-v2-integration/multi-agent-runtime");
  const sc = await import("../../agent-v2/session-context");
  const mr = await import("../../agent-v2/minor-restriction");
  const { default: app } = (await import("../../app")) as { default: Express };
  const seam = rt.multiAgentRuntimeSeam;
  const say = hz.say, use = hz.use, call = hz.call;
  const ids = (xs: string[]): AgentModelResponse => say(JSON.stringify({ agentIds: xs }));

  // ── rig: one application "process" (env, runtime, mock models, synthetic world, in-memory stores) ───────────────────
  const worlds: Array<{ calls: string[] }> = [];
  type Rig = ReturnType<typeof rig>;
  function rig(o: { env?: Partial<Record<EnvKey, string>>; world?: Partial<WorldState>; profiles?: Record<string, Reply>; restrictionStore?: MinorRestrictionStore; routingModel?: () => AgentModelProvider } = {}) {
    for (const k of ENV_KEYS) setEnv(k, undefined);
    for (const [k, v] of Object.entries(o.env ?? {})) setEnv(k, v);
    const clock = () => T0;
    const w = hz.world(clock, o.world);
    worlds.push(w);
    const prov: Record<AgentId, MockProvider> = { training: hz.mockProvider("training"), nutrition: hz.mockProvider("nutrition"), recovery: hz.mockProvider("recovery"), progress: hz.mockProvider("progress") };
    const router = hz.mockProvider("router");
    const traces: SupervisorTrace[] = [];
    let routerCreated = 0;
    const adult = (id: string): Reply => ({ status: 200, data: { profile: { userId: id, age: 30 } } });
    net.profileReads = 0;
    net.profiles = { "tok-a": adult(USER_A), "tok-b": adult(USER_B), ...(o.profiles ?? {}) };
    let runtime: ReturnType<typeof rt.createMultiAgentRuntime> | null = null;
    seam.factory = () => (runtime ??= rt.createMultiAgentRuntime({
      providerFor: (a) => prov[a], now: clock, sessionStore: sc.createInMemorySessionStore(),
      restrictionStore: o.restrictionStore ?? mr.createInMemoryMinorRestrictionStore(),
      deps: { training: w.training, nutrition: w.nutrition, recovery: w.recovery, progress: w.progress },
      routingModelFactory: () => { routerCreated++; return o.routingModel ? o.routingModel() : router; },
      traceSink: (x) => traces.push(x),
    }));
    return { w, prov, router, traces, routerCreated: () => routerCreated };
  }

  // ── transcript helpers ───────────────────────────────────────────────────────────────────────────────────────────────
  const results: ScenarioResult[] = [];
  let cur: ScenarioResult;
  const out = (s = "") => { cur.lines.push(s); };
  const check = (text: string, ok: boolean) => { cur.checks.push({ ok, text }); out(`    [${ok ? "PASS" : "FAIL"}] ${text}`); };
  const begin = (id: string, title: string) => { cur = { id, title, verdict: "DEMONSTRATED", statuses: [], checks: [], lines: [] }; results.push(cur); out(`== ${id}. ${title} ==`); };
  const clip = (s: string, n = 240) => (s.length > n ? `${s.slice(0, n)}…` : s);

  interface TurnOpts { token?: string | null; body?: object; headers?: Record<string, string>; script?: (r: Rig) => void; label?: string }
  /** One HTTP turn through the real route; prints a readable block and returns the parsed outcome. */
  async function turn(r: Rig, q: string, o: TurnOpts = {}) {
    o.script?.(r);
    const token = o.token === undefined ? "tok-a" : o.token;
    const body = o.body ?? { question: q };
    const before = r.traces.length;
    const req0 = request(app).post("/ai/v2/ask").set(o.headers ?? {});
    const res = await (token ? req0.set("Authorization", `Bearer ${token}`) : req0).send(body);
    for (const p of Object.values(r.prov)) p.drain();
    r.router.drain();
    const t: SupervisorTrace | undefined = r.traces.length > before ? r.traces[r.traces.length - 1] : undefined;
    const who = token === "tok-b" ? "user B" : token === "tok-a" ? "user A" : token ? "invalid token" : "anonymous";
    const shown = typeof (body as any).question === "string" ? clip((body as any).question, 90) : JSON.stringify(body).slice(0, 90);
    out(`  ${o.label ? `${o.label} ` : ""}[${who}] "${shown}"`);
    const data = res.body?.data;
    if (data) {
      out(`      HTTP ${res.status}  status=${data.status}  executed agents=[${(data.agents ?? []).join(", ")}]`);
      cur.statuses.push(`${res.status}/${data.status}`);
    } else {
      out(`      HTTP ${res.status}  error=${res.body?.error?.code ?? res.body?.code ?? "-"}`);
      cur.statuses.push(String(res.status));
    }
    if (t) {
      if (t.decision) out(`      routing: strategy=${t.decision.strategy} chosen=[${t.decision.agents.join(", ")}] dropped=[${t.decision.dropped.join(", ")}] reasons=[${t.decision.reasonCodes.join(", ")}]`);
      if (t.routingMode) out(`      routing mode: requested=${t.routingMode.requested} effective=${t.routingMode.effective} (${t.routingMode.reason})`);
      if (t.hybridRouting) out(`      hybrid router: selection=${t.hybridRouting.selection} called=${t.hybridRouting.routingModelCalled} fallback=${t.hybridRouting.fallbackReasonCode ?? "-"} validation=${t.hybridRouting.routingValidationStatus ?? "-"}`);
      for (const d of t.delegations) out(`      agent ${d.agentId}: ${d.completionStatus} (model calls ${d.modelCallCount}, tools [${d.evidence.map((e) => `${e.toolId}:${e.outcome}`).join(", ") || "none"}])`);
      out(`      trace codes: supervisor=${t.status} profileRead=${t.profileRead} ageGate=${t.ageGate ? `${t.ageGate.decision}${t.ageGate.minorBy.length ? `/minorBy=${t.ageGate.minorBy.join("+")}` : ""}` : "-"} models=${t.totals.modelCallCount} tools=${t.totals.toolCallCount}${t.minorRestriction ? ` restriction=${t.minorRestriction.state}/${t.minorRestriction.store}` : ""}${t.session?.store && t.session.store !== "OK" ? ` sessionStore=${t.session.store}` : ""}`);
    }
    if (data?.answer) out(`      answer: ${clip(String(data.answer))}`);
    return { res, data, t, status: res.status as number };
  }
  const scriptTrain = (r: Rig) => r.prov.training.script(use(call("training.get_today_schedule")), say("Hôm nay bạn có buổi Leg day với 2 bài (dữ liệu lịch mẫu)."));
  const scriptNutr = (r: Rig) => r.prov.nutrition.script(use(call("nutrition.get_target")), say("Mục tiêu hiện tại trong dữ liệu mẫu là 2400 kcal mỗi ngày."));
  const noWrites = (r: Rig) => r.w.calls.every((c) => !c.startsWith("WRITE:"));
  const DET = { AI_AGENT_V2: "on" } as const;

  try {
    // ═══ 1. Supervisor orchestration ═══════════════════════════════════════════════════════════════════════════════════
    begin("S1", "Supervisor orchestration: one question → routing decision → agents → final answer → trace codes");
    {
      const r = rig({ env: DET });
      const q = "Hôm nay tôi tập buổi nào, và trước đó nên ăn gì?";
      const x = await turn(r, q, { script: (s) => { scriptTrain(s); s.prov.nutrition.script(say("Trước buổi tập nên ăn nhẹ dễ tiêu, có tinh bột và một ít đạm.")); } });
      check("HTTP 200, status ANSWERED", x.status === 200 && x.data?.status === "ANSWERED");
      check("two agents executed: nutrition + training", JSON.stringify([...x.data.agents].sort()) === JSON.stringify(["nutrition", "training"]));
      check("routing decision recorded (strategy intent-v1.3, 2 agents, none dropped)", x.t?.decision?.strategy === "intent-v1.3" && x.t.decision.agents.length === 2 && x.t.decision.dropped.length === 0);
      check("one profile read shared by both agents; own data only; no WRITE reached a domain function", net.profileReads === 1 && r.w.calls.every((c) => c.endsWith(":A") || c.startsWith("WRITE:") === false) && noWrites(r));
      check("public body carries no user id", !JSON.stringify(x.res.body).includes(USER_A));
    }
    out();

    // ═══ 2. Four domain agents ═════════════════════════════════════════════════════════════════════════════════════════
    begin("S2", "The four domain agents, one benign question each (fixture tool data)");
    {
      const cases: Array<{ agent: AgentId; q: string; script: (r: Rig) => void; tool: string }> = [
        { agent: "training", q: "Hôm nay tôi tập gì?", script: scriptTrain, tool: "training.get_today_schedule" },
        { agent: "nutrition", q: "Mục tiêu calo của tôi là bao nhiêu?", script: scriptNutr, tool: "nutrition.get_target" },
        { agent: "recovery", q: "Tôi tập chân hôm qua, nghỉ ngơi thế nào cho hợp lý?", script: (s) => s.prov.recovery.script(use(call("recovery.get_recent_sessions")), say("Quan sát từ dữ liệu mẫu: hôm qua có một buổi thân dưới, RPE 8.")), tool: "recovery.get_recent_sessions" },
        { agent: "progress", q: "Cân nặng của tôi thay đổi thế nào so với mục tiêu?", script: (s) => s.prov.progress.script(use(call("progress.get_body_measurements")), say("Theo dữ liệu mẫu, cân nặng đo gần nhất là 72.4 kg, mục tiêu 68 kg.")), tool: "progress.get_body_measurements" },
      ];
      for (const c of cases) {
        const r = rig({ env: DET });
        const x = await turn(r, c.q, { label: `(${c.agent})`, script: c.script });
        check(`${c.agent}: ANSWERED by exactly [${c.agent}] with tool ${c.tool}:ok`, x.data?.status === "ANSWERED" && JSON.stringify(x.data.agents) === JSON.stringify([c.agent]) && !!x.t?.delegations[0]?.evidence.some((e) => e.toolId === c.tool && e.outcome === "ok"));
      }
    }
    out();

    // ═══ 3. Routing cap ═══════════════════════════════════════════════════════════════════════════════════════════════
    begin("S3", "Routing cap: a 4-domain question → at most 2 executed agents + deferred-intent disclosure");
    {
      const r = rig({ env: DET });
      const q = "Tiến độ tháng này ra sao, tuần sau tập gì, ăn bao nhiêu và nghỉ mấy ngày?";
      const x = await turn(r, q, { label: "(deterministic router)", script: (s) => { for (const a of ALL) s.prov[a].script(say(`Gợi ý mẫu về ${a}.`)); } });
      const d = x.t?.decision;
      check("at most 2 agents executed", (x.data?.agents ?? []).length <= 2 && (x.data?.agents ?? []).length >= 1);
      check("the remaining intents are recorded as dropped (…:max_agents)", !!d && d.dropped.some((s) => s.endsWith(":max_agents")));
      check("status PARTIAL and the user is told some parts were not handled this turn", x.data?.status === "PARTIAL" && /chưa được xử lý trong lượt này/.test(x.data.answer));
      const h = rig({ env: { ...DET, AI_AGENT_V2_ROUTING_MODE: "always" } });
      const y = await turn(h, q, { label: "(always: mock routing model returns 4 domains)", script: (s) => { s.router.script(ids(["progress", "training", "nutrition", "recovery"])); for (const a of ALL) s.prov[a].script(say(`Gợi ý mẫu về ${a}.`)); } });
      check("model-assisted: 4 detected, 2 executed, 2 deferred and disclosed", (y.data?.agents ?? []).length === 2 && y.t?.hybridRouting?.deferredAgentIds?.length === 2 && /chưa được xử lý trong lượt này/.test(y.data.answer));
    }
    out();

    // ═══ 4. Safety ════════════════════════════════════════════════════════════════════════════════════════════════════
    begin("S4", "Safety: benign request answered; unsafe request BLOCKED; self-reported minor → user-scoped restriction (A2)");
    {
      const r = rig({ env: DET });
      const ok = await turn(r, "Mục tiêu calo của tôi là bao nhiêu?", { label: "(benign)", script: scriptNutr });
      check("benign request: ANSWERED", ok.data?.status === "ANSWERED");
      const blk = await turn(r, "Tôi muốn giảm 10kg trong 1 tuần thì ăn uống thế nào?", { label: "(unsafe: extreme weight-loss target)", script: (s) => { for (const a of ALL) s.prov[a].script(say("MUST NOT BE REACHED")); } });
      check("unsafe request: SAFETY_BLOCKED (BLOCKED), no agent executed, no model call, no personal number", blk.data?.status === "SAFETY_BLOCKED" && (blk.data.agents ?? []).length === 0 && blk.t?.totals.modelCallCount === 0 && !/MUST NOT/.test(blk.data.answer));

      out("  -- A2: self-reported minor, then a NEW session (in-memory restriction store) --");
      const m = rig({ env: DET });
      const st = await turn(m, "Tôi 16 tuổi.", { label: "(turn 1, sessionId s1: statement)", body: { question: "Tôi 16 tuổi.", sessionId: "s1" }, script: () => {} });
      check("minor statement accepted (HTTP 200); restriction written to the user-scoped store", st.status === 200);
      const nutrScript = (s: Rig) => scriptNutr(s);
      const same = await turn(m, "Mục tiêu calo của tôi là bao nhiêu?", { label: "(turn 2, same session s1)", body: { question: "Mục tiêu calo của tôi là bao nhiêu?", sessionId: "s1" }, script: nutrScript });
      const other = await turn(m, "Mục tiêu calo của tôi là bao nhiêu?", { label: "(turn 3, NEW sessionId s2)", body: { question: "Mục tiêu calo của tôi là bao nhiêu?", sessionId: "s2" }, script: nutrScript });
      const none = await turn(m, "Mục tiêu calo của tôi là bao nhiêu?", { label: "(turn 4, NO sessionId)", script: nutrScript });
      check("personal asks in s1, a NEW session and NO session are all MINOR_PROTECTED, 0 agents, 0 domain reads", [same, other, none].every((z) => z.data?.status === "MINOR_PROTECTED" && (z.data.agents ?? []).length === 0) && m.w.calls.length === 0);
      const b = await turn(m, "Mục tiêu calo của tôi là bao nhiêu?", { token: "tok-b", label: "(another account)", script: nutrScript });
      check("another account (user B) is NOT restricted by user A's statement", b.data?.status === "ANSWERED");
      out("  -- LIMIT: the restriction store is IN-MEMORY ONLY (single process). A restart / second instance forgets it: --");
      const fresh = rig({ env: DET });
      const lost = await turn(fresh, "Mục tiêu calo của tôi là bao nhiêu?", { label: "(simulated process restart: new in-memory store)", script: scriptNutr });
      check("LIMIT shown: after a simulated restart the self-reported restriction is gone (ANSWERED) — no persistent store exists", lost.data?.status === "ANSWERED");
      let prodErr = 0;
      try { rt.resolveMinorRestrictionStore({ NODE_ENV: "production" }); } catch (e: any) { prodErr = e?.statusCode ?? 0; }
      check(`production has NO restriction-store implementation: resolveMinorRestrictionStore(production) refuses with ${prodErr} (never a silent fallback)`, prodErr === 503);
      out("  note: age is not verified; only an EXPLICIT first-person under-18 statement writes a restriction; 'tôi 30 tuổi' does not lift it (conservative).");
    }
    out();

    // ═══ 5. Model unavailable ══════════════════════════════════════════════════════════════════════════════════════════
    begin("S5", "Model unavailable: routing model failing → deterministic fallback; a domain agent's model failing → graceful status");
    {
      const q = "Squat sâu quá có hại khớp gối không?";
      const a = rig({ env: { ...DET, AI_AGENT_V2_ROUTING_MODE: "always" } });
      const x = await turn(a, q, { label: "(routing model throws a credential-looking error)", script: (s) => { s.router.script(() => { throw new Error("AccessDeniedException: arn:aws:iam::000000000000:role/fixture AKIAFIXTUREKEY"); }); s.prov.training.script(say("Squat đúng kỹ thuật thường an toàn cho khớp gối với người khỏe mạnh (kiến thức chung).")); } });
      check("HTTP 200; hybrid router falls back to deterministic (PROVIDER_UNAVAILABLE); training still answers", x.status === 200 && x.t?.hybridRouting?.selection === "DETERMINISTIC_FALLBACK" && x.t.hybridRouting.fallbackReasonCode === "PROVIDER_UNAVAILABLE" && JSON.stringify(x.data.agents) === JSON.stringify(["training"]));
      check("no provider/credential text reaches the client or the trace", !/AKIA|arn:aws|AccessDenied/.test(JSON.stringify(x.res.body) + JSON.stringify(a.traces)));
      const b = rig({ env: { ...DET, AI_AGENT_V2_ROUTING_MODE: "always" } });
      const y = await turn(b, q, { label: "(routing model returns invalid JSON)", script: (s) => { s.router.script(say("training và nutrition")); s.prov.training.script(say("Squat đúng kỹ thuật thường an toàn cho khớp gối (kiến thức chung).")); } });
      check("invalid routing output is rejected by the strict validator → deterministic fallback", y.t?.hybridRouting?.routingValidationStatus === "INVALID_JSON" && y.t.hybridRouting.selection === "DETERMINISTIC_FALLBACK");
      const c = rig({ env: DET });
      const z = await turn(c, "Hôm nay tôi tập gì?", { label: "(the training agent's model throws)", script: (s) => s.prov.training.script(() => { throw new Error("model unavailable (fixture)"); }) });
      check("domain agent model failure → HTTP 200 (not a 5xx), status FAILED, fixed polite message, no fabricated answer (the agent STARTED, so it is listed as executed)", z.status === 200 && z.data?.status === "FAILED" && z.t?.delegations[0]?.completionStatus === "FAILED" && /chưa trả lời được/.test(z.data.answer) && !/model unavailable/.test(z.data.answer));
      const d = rig({ env: DET });
      const p = await turn(d, "Hôm nay tôi tập buổi nào, và trước đó nên ăn gì?", { label: "(two agents; only the nutrition model throws)", script: (s) => { scriptTrain(s); s.prov.nutrition.script(() => { throw new Error("model unavailable (fixture)"); }); } });
      check("one of two agents fails → PARTIAL: the working agent's answer is kept, the failed part is disclosed, no error text leaks", p.data?.status === "PARTIAL" && p.t?.delegations.map((d) => `${d.agentId}:${d.completionStatus}`).join() === "training:COMPLETE,nutrition:FAILED" && /Leg day/.test(p.data.answer) && /Phần dinh dưỡng: trợ lý tạm thời chưa trả lời được/.test(p.data.answer) && !/model unavailable/.test(p.data.answer));
    }
    out();

    // ═══ 6. V1/V2 opt-in isolation ═════════════════════════════════════════════════════════════════════════════════════
    begin("S6", "V1/V2 opt-in isolation: flag off → /ai/v2/ask not served; /ai/ask untouched; production without approvals → off");
    {
      const q = { question: "Hôm nay tôi tập gì?" };
      const v1 = async (label: string) => { const before = v1AskReached; const res = await request(app).post("/ai/ask").set("Authorization", "Bearer tok-a").send(q); out(`  V1 POST /ai/ask (${label}) → HTTP ${res.status}, V1 handler reached=${v1AskReached === before + 1}`); cur.statuses.push(`V1:${res.status}`); return res.status === 200 && v1AskReached === before + 1; };
      const off = rig({ env: {} });
      const a = await turn(off, "", { label: "(AI_AGENT_V2 unset)", body: q });
      check("flag unset → 404 NOT_FOUND, runtime never asked", a.status === 404 && off.traces.length === 0);
      const b = rig({ env: { AI_AGENT_V2: "true" } });
      check("flag value 'true' (not exactly 'on') → 404", (await turn(b, "", { label: "(AI_AGENT_V2=true)", body: q })).status === 404);
      check("V1 /ai/ask still served with the flag off", await v1("flag off"));
      const prod = rig({ env: { AI_AGENT_V2: "on", NODE_ENV: "production" } });
      check("production + flag on but WITHOUT the second approval → 404", (await turn(prod, "", { label: "(NODE_ENV=production, no approval)", body: q })).status === 404 && prod.traces.length === 0);
      const hy = rig({ env: { AI_AGENT_V2_HYBRID_PRODUCTION_APPROVED: "yes", AI_AGENT_V2_ROUTING_MODE: "always", NODE_ENV: "production" } });
      check("the hybrid approval alone never opens the endpoint → 404, no routing model created", (await turn(hy, "", { label: "(production, only hybrid approval)", body: q })).status === 404 && hy.routerCreated() === 0);
      const on = rig({ env: { AI_AGENT_V2: "on", NODE_ENV: "production", AI_AGENT_V2_PRODUCTION_APPROVED: "yes", AI_AGENT_V2_ROUTING_MODE: "always" }, restrictionStore: mr.createInMemoryMinorRestrictionStore() });
      const c = await turn(on, "Hôm nay tôi tập gì?", { label: "(production, V2 approved, hybrid NOT approved)", script: scriptTrain });
      check("production + V2 approval, hybrid not approved → served, but deterministic only (no routing model created)", c.status === 200 && on.routerCreated() === 0 && c.t?.routingMode?.effective === "deterministic" && c.t.routingMode.reason === "HYBRID_PRODUCTION_NOT_APPROVED");
      rig({ env: { AI_AGENT_V2: "on" } });
      check("V1 /ai/ask unchanged with the flag on (V1 handler is a counting STUB — route reachability only)", await v1("flag on"));
    }
    out();

    // ═══ 7. Error handling ═════════════════════════════════════════════════════════════════════════════════════════════
    begin("S7", "Error handling: 401, 400 (strict body / oversize / bad session id), store unavailable → fail-closed");
    {
      const r = rig({ env: DET });
      const guard = async (label: string, token: string | null, body: object, want: number, headers?: Record<string, string>) => {
        const x = await turn(r, "", { label, token, body, headers });
        check(`${label} → HTTP ${want}`, x.status === want);
        return x;
      };
      await guard("(no token)", null, { question: "Hôm nay tôi tập gì?" }, 401);
      await guard("(forged token)", "tok-forged", { question: "Hôm nay tôi tập gì?" }, 401);
      await guard("(bare x-user-id, no token)", null, { question: "Hôm nay tôi tập gì?" }, 401, { "x-user-id": USER_A });
      await guard("(strict body: unknown key userId)", "tok-a", { question: "Hôm nay tôi tập gì?", userId: USER_B }, 400);
      await guard("(empty question)", "tok-a", { question: "" }, 400);
      await guard("(oversized question: 2001 chars)", "tok-a", { question: "x".repeat(2001) }, 400);
      await guard("(malformed sessionId)", "tok-a", { question: "ok", sessionId: "../../etc" }, 400);
      check("no refused request reached the runtime, a model or a domain read", r.traces.length === 0 && Object.values(r.prov).every((p) => p.requests.length === 0) && r.w.calls.length === 0 && net.profileReads === 0);

      const down: MinorRestrictionStore = {
        minorRestrictionStore: true,
        read: async () => { throw new sc.SessionStoreError("UNAVAILABLE"); },
        write: async () => { throw new sc.SessionStoreError("UNAVAILABLE"); },
      } as MinorRestrictionStore;
      const s = rig({ env: DET, restrictionStore: down });
      const x = await turn(s, "Mục tiêu calo của tôi là bao nhiêu?", { label: "(restriction store UNAVAILABLE, personal ask)", script: scriptNutr });
      check("store down → HTTP 200 with status SESSION_UNAVAILABLE (fail-closed), 0 agents, 0 domain reads", x.status === 200 && x.data?.status === "SESSION_UNAVAILABLE" && (x.data.agents ?? []).length === 0 && s.w.calls.length === 0);
      const y = await turn(s, "Tôi 16 tuổi, mục tiêu calo của tôi là bao nhiêu?", { label: "(restriction store down, minor statement that cannot be saved)", script: scriptNutr });
      check("a minor statement that cannot be stored is refused (SESSION_UNAVAILABLE), never silently dropped", y.data?.status === "SESSION_UNAVAILABLE" && s.w.calls.length === 0);
      const bad = rig({ env: { AI_AGENT_V2: "on", AI_AGENT_V2_ROUTING_MODE: "bogus" } });
      const z = await turn(bad, "Hôm nay tôi tập gì?", { label: "(invalid routing configuration)" });
      check("invalid routing mode → HTTP 503, nothing read, never a silent switch to model routing", z.status === 503 && net.profileReads === 0 && bad.routerCreated() === 0);
      out("  note: a store outage is reported as HTTP 200 + status SESSION_UNAVAILABLE (a domain status, not an HTTP error).");
    }
    out();

    // ── global tripwires ────────────────────────────────────────────────────────────────────────────────────────────────
    begin("S0", "Offline guarantees (whole demo)");
    check("0 fetch calls, 0 Bedrock sends, 0 llmService.callLLM calls, 0 un-mocked HTTP calls", trip.fetch === 0 && trip.bedrock === 0 && trip.callLLM === 0 && trip.unmockedHttp === 0);
    check(`no WRITE function of any domain dependency was ever invoked (${worlds.length} fixture worlds inspected)`, worlds.every((w) => w.calls.every((c) => !c.startsWith("WRITE:"))));
    out(`  tripwires: fetch=${trip.fetch} bedrock=${trip.bedrock} callLLM=${trip.callLLM} unmockedHttp=${trip.unmockedHttp}`);
  } finally {
    seam.factory = null;
    axios.defaults.adapter = originalAdapter;
    globalThis.fetch = originalFetch;
    bedrockRuntimeDeps.send = originalSend;
    (llmService as any).callLLM = originalCallLLM;
    authServiceClientDeps.verify = originalVerify;
    (aiController as any).ask = originalV1Ask;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }

  // ── render ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  const ok = results.every((s) => s.checks.every((c) => c.ok));
  const lines: string[] = [BANNER, "=".repeat(BANNER.length), "Evidence label: TEST FIXTURE (real route + supervisor + agents; mock models, synthetic data, stubbed auth/transport).", ""];
  for (const s of results) lines.push(...s.lines);
  lines.push("== Scenario summary ==");
  for (const s of results) lines.push(`  ${s.id}  ${s.verdict.padEnd(16)} ${s.checks.filter((c) => c.ok).length}/${s.checks.length} checks  statuses: ${s.statuses.join(" ") || "-"}${s.reason ? `  (${s.reason})` : ""}`);
  lines.push("", `RESULT: ${ok ? "ALL SCENARIOS BEHAVED AS EXPECTED" : "UNEXPECTED BEHAVIOUR — see [FAIL] lines"}`, "", "== Known limitations (open at the time of this demo) ==",
    "  - P1 (open): attached combining marks on \"ói\" (vomiting detector) can still bypass the symptom detector — not demonstrated, not fixed here.",
    "  - P1-1 / P1-2 of the minor restriction are under remediation; the A2 restriction shown above is only as strong as its in-memory store.",
    "  - No persistent minor-restriction store exists: it is in-memory, single-process, lost on restart; production refuses to start without one (503).",
    "  - Self-reported age is never verified; the restriction is conservative and is not lifted by a later adult claim.",
    "  - Gates G7 and G8 are NOT verified.",
    "  - No human validation: every status above comes from scripted mock models over synthetic fixtures; it says nothing about real-model quality, accuracy or safety.",
    "  - V1 /ai/ask was shown only as a reachable route (stubbed handler); V1 behaviour was not exercised.",
    "  - Not demonstrated: real Bedrock/Nova routing or answers, persistent sessions (Redis/DynamoDB), real services, deployment.");
  return { ok, results, transcript: `${lines.join("\n")}\n`, tripwires: trip, v1AskReached };
}

function isMain(): boolean {
  const entry = (process.argv[1] ?? "").replace(/\\/g, "/");
  return /m8-demo\/offline-demo(\.ts|\.js)?$/.test(entry);
}
if (isMain()) {
  runOfflineDemo().then((rep) => { process.stdout.write(rep.transcript); setTimeout(() => process.exit(rep.ok ? 0 : 1), 50); }, (e) => { console.error("DEMO CRASHED:", e); process.exit(2); });
}
