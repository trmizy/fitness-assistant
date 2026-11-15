/**
 * M8-D — LOCAL WEB DEMO SERVER for the Multi-Agent V2 offline demo. TEST HARNESS ONLY: lives under __tests__, is never imported by
 * production code, and refuses to start when NODE_ENV=production or when asked to bind anything but loopback.
 *
 * Flow: browser (Vite page, same-origin proxy) → this launcher (POST /demo/run {scenarioId}) → the REAL ai-service `app`
 * (POST /ai/v2/ask: real flag gate, requireAuth, strict body, composition root, supervisor, router, four bounded agents)
 * → the real response, plus a server-side trace summary captured from the supervisor's own traceSink.
 *
 * REPLACED (everything else is production code): auth-service token verification (fixture tokens live only HERE, never in the
 * browser), the HTTP transport of the domain reads (axios adapter: no socket), the agents' and routing model (scripted mocks),
 * the domain READ dependencies (synthetic fixtures). Tripwires count any fetch / Bedrock / callLLM / un-mocked HTTP call.
 *
 * ONLY approved fixture scenarios run (the browser sends a scenario id; no free text ever reaches the runtime).
 * NOT health advice. NOT a measure of accuracy. Mock models say what the script tells them to. Known P1s are open (see README).
 *
 * Run: cd backend/services/ai-service && FITNESS_DISABLE_REDIS=true npx tsx src/__tests__/m8-demo/web-demo-server.ts
 */
import http from "node:http";
import express, { type Request, type Response } from "express";
import request from "supertest";
import type { Express } from "express";
import axios, { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";

import type { MockProvider, WorldState } from "../m5-benchmark/harness";
import type { AgentId } from "../../agent-v2/multi-agent-contracts";
import type { SupervisorTrace } from "../../agent-v2/supervisor";
import type { AgentModelResponse } from "../../agent-v2/model-provider";

export const DEMO_BANNER = "GYMINI MULTI-AGENT V2 — OFFLINE DEMO / MOCK MODEL";
export const DEMO_NOTICE = "Fixture data only — mock models, no network — NOT health advice — NOT a measure of accuracy — synthetic results are NOT human-validated";
export const DEFAULT_PORT = 4799;

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const T0 = Date.parse("2026-11-13T09:00:00.000Z");
const TOKENS: Record<string, string> = { "tok-a": USER_A, "tok-b": USER_B };
const ALL: AgentId[] = ["training", "nutrition", "recovery", "progress"];
const ENV_KEYS = ["AI_AGENT_V2", "AI_AGENT_V2_ROUTING_MODE", "AI_AGENT_V2_PRODUCTION_APPROVED", "AI_AGENT_V2_HYBRID_PRODUCTION_APPROVED", "NODE_ENV"] as const;
type EnvKey = (typeof ENV_KEYS)[number];
type Reply = { status: number; data?: unknown };

export interface DemoTurnDef { label: string; question: string; sessionId?: string; as?: "A" | "B"; noAuth?: boolean; script?: (r: Rig) => void }
export interface DemoScenarioDef {
  id: string; group: string; title: string; description: string; expect: string; mocked: string[];
  env: Partial<Record<EnvKey, string>>; turns: DemoTurnDef[]; profiles?: Record<string, Reply>;
}
export interface PublicScenario { id: string; group: string; title: string; description: string; expect: string; mocked: string[]; turns: Array<{ label: string; question: string; sessionId?: string; as: "A" | "B"; noAuth: boolean }> }
export interface Rig { prov: Record<AgentId, MockProvider>; router: MockProvider; traces: SupervisorTrace[]; w: { calls: string[] } }

let rigApi: ReturnType<typeof buildRigApi> | null = null;

function buildRigApi(hz: typeof import("../m5-benchmark/harness")) {
  const say = hz.say, use = hz.use, call = hz.call;
  const ids = (xs: string[]): AgentModelResponse => say(JSON.stringify({ agentIds: xs }));
  const train = (r: Rig) => r.prov.training.script(use(call("training.get_today_schedule")), say("Hôm nay bạn có buổi Leg day với 2 bài (dữ liệu lịch mẫu)."));
  const nutr = (r: Rig) => r.prov.nutrition.script(use(call("nutrition.get_target")), say("Mục tiêu hiện tại trong dữ liệu mẫu là 2400 kcal mỗi ngày."));
  const recov = (r: Rig) => r.prov.recovery.script(use(call("recovery.get_recent_sessions")), say("Quan sát từ dữ liệu mẫu: hôm qua có một buổi thân dưới, RPE 8."));
  const prog = (r: Rig) => r.prov.progress.script(use(call("progress.get_body_measurements")), say("Theo dữ liệu mẫu, cân nặng đo gần nhất là 72.4 kg, mục tiêu 68 kg."));
  const allSay = (r: Rig) => { for (const a of ALL) r.prov[a].script(say(`Gợi ý mẫu về ${a}.`)); };
  const DET = { AI_AGENT_V2: "on" } as const;
  const PERSONAL = "Mục tiêu calo của tôi là bao nhiêu?";
  const mockAll = ["Mô hình các agent (kịch bản cố định)", "Dữ liệu miền (fixture tổng hợp)", "Xác thực (token fixture trong launcher)"];

  const scenarios: DemoScenarioDef[] = [
    { id: "orchestration-2-agents", group: "Điều phối", title: "Supervisor điều phối 2 agent", description: "Một câu hỏi chạm hai miền: lịch tập và dinh dưỡng trước buổi tập.",
      expect: "ANSWERED; chạy training + nutrition", mocked: mockAll, env: DET,
      turns: [{ label: "Câu hỏi 2 miền", question: "Hôm nay tôi tập buổi nào, và trước đó nên ăn gì?", script: (r) => { train(r); r.prov.nutrition.script(say("Trước buổi tập nên ăn nhẹ dễ tiêu, có tinh bột và một ít đạm.")); } }] },
    { id: "agent-training", group: "Bốn agent miền", title: "Agent Training", description: "Một câu hỏi lịch tập (đọc công cụ fixture).", expect: "ANSWERED bởi [training]", mocked: mockAll, env: DET,
      turns: [{ label: "Lịch tập hôm nay", question: "Hôm nay tôi tập gì?", script: train }] },
    { id: "agent-nutrition", group: "Bốn agent miền", title: "Agent Nutrition", description: "Một câu hỏi mục tiêu calo (đọc công cụ fixture).", expect: "ANSWERED bởi [nutrition]", mocked: mockAll, env: DET,
      turns: [{ label: "Mục tiêu calo", question: PERSONAL, script: nutr }] },
    { id: "agent-recovery", group: "Bốn agent miền", title: "Agent Recovery", description: "Một câu hỏi phục hồi sau buổi tập chân.", expect: "ANSWERED bởi [recovery]", mocked: mockAll, env: DET,
      turns: [{ label: "Phục hồi", question: "Tôi tập chân hôm qua, nghỉ ngơi thế nào cho hợp lý?", script: recov }] },
    { id: "agent-progress", group: "Bốn agent miền", title: "Agent Progress", description: "Một câu hỏi tiến độ cân nặng.", expect: "ANSWERED bởi [progress]", mocked: mockAll, env: DET,
      turns: [{ label: "Tiến độ", question: "Cân nặng của tôi thay đổi thế nào so với mục tiêu?", script: prog }] },
    { id: "routing-cap-4-domains", group: "Điều phối", title: "Trần 2 agent + ý định bị hoãn", description: "Câu hỏi bốn miền: chỉ tối đa 2 agent chạy, phần còn lại được thông báo là chưa xử lý.",
      expect: "PARTIAL; ≤ 2 agent; có thông báo chưa xử lý", mocked: mockAll, env: DET,
      turns: [{ label: "Câu hỏi 4 miền", question: "Tiến độ tháng này ra sao, tuần sau tập gì, ăn bao nhiêu và nghỉ mấy ngày?", script: allSay }] },
    { id: "safety-benign-and-blocked", group: "An toàn", title: "Yêu cầu bình thường và yêu cầu bị chặn", description: "Một yêu cầu bình thường được trả lời; một yêu cầu giảm cân cực đoan bị chặn trước khi gọi agent.",
      expect: "Lượt 1 ANSWERED; lượt 2 SAFETY_BLOCKED, không agent", mocked: mockAll, env: DET,
      turns: [{ label: "Bình thường", question: PERSONAL, script: nutr }, { label: "Bị chặn (giảm 10kg/1 tuần)", question: "Tôi muốn giảm 10kg trong 1 tuần thì ăn uống thế nào?", script: (r) => { for (const a of ALL) r.prov[a].script(say("KHÔNG ĐƯỢC TỚI ĐÂY")); } }] },
    { id: "minor-restriction-user-scope", group: "An toàn", title: "Tự khai dưới 18 tuổi: hạn chế theo người dùng", description: "Người dùng nói mình 16 tuổi; các lượt sau (cùng phiên, phiên mới, không phiên) bị hạn chế. Tài khoản khác không bị ảnh hưởng. Kho hạn chế chỉ nằm trong bộ nhớ.",
      expect: "Lượt 2–4 MINOR_PROTECTED; lượt 5 (tài khoản B) ANSWERED", mocked: [...mockAll, "Kho hạn chế vị thành niên: bộ nhớ trong tiến trình"], env: DET,
      turns: [
        { label: "Lượt 1: tự khai (phiên s1)", question: "Tôi 16 tuổi.", sessionId: "s1" },
        { label: "Lượt 2: cùng phiên s1", question: PERSONAL, sessionId: "s1", script: nutr },
        { label: "Lượt 3: phiên MỚI s2", question: PERSONAL, sessionId: "s2", script: nutr },
        { label: "Lượt 4: KHÔNG có phiên", question: PERSONAL, script: nutr },
        { label: "Lượt 5: tài khoản khác (B)", question: PERSONAL, as: "B", script: nutr },
      ] },
    { id: "routing-model-fallback", group: "Lỗi và dự phòng", title: "Mô hình định tuyến lỗi → dự phòng xác định", description: "Mô hình định tuyến ném lỗi; hệ thống quay về bộ định tuyến xác định và agent vẫn trả lời. Không rò rỉ chuỗi thông tin xác thực.",
      expect: "ANSWERED bởi [training] qua dự phòng", mocked: mockAll, env: { ...DET, AI_AGENT_V2_ROUTING_MODE: "always" },
      turns: [{ label: "Mô hình định tuyến lỗi", question: "Squat sâu quá có hại khớp gối không?", script: (r) => { r.router.script(() => { throw new Error("AccessDeniedException: fixture-credential-text"); }); r.prov.training.script(say("Squat đúng kỹ thuật thường an toàn cho khớp gối (kiến thức chung).")); } }] },
    { id: "agent-model-failure", group: "Lỗi và dự phòng", title: "Mô hình của một agent lỗi", description: "Mô hình training ném lỗi: trạng thái FAILED và thông báo cố định, không bịa câu trả lời.",
      expect: "FAILED, HTTP 200, thông báo lịch sự", mocked: mockAll, env: DET,
      turns: [{ label: "Agent Training lỗi", question: "Hôm nay tôi tập gì?", script: (r) => r.prov.training.script(() => { throw new Error("model unavailable (fixture)"); }) }] },
    { id: "partial-one-agent-fails", group: "Lỗi và dự phòng", title: "Một trong hai agent lỗi → PARTIAL", description: "Training trả lời, Nutrition lỗi: giữ phần đúng và thông báo phần lỗi.",
      expect: "PARTIAL; giữ câu trả lời training", mocked: mockAll, env: DET,
      turns: [{ label: "Nutrition lỗi", question: "Hôm nay tôi tập buổi nào, và trước đó nên ăn gì?", script: (r) => { train(r); r.prov.nutrition.script(() => { throw new Error("model unavailable (fixture)"); }); } }] },
    { id: "v2-disabled", group: "Cô lập V1/V2", title: "Cờ V2 tắt → route V2 không được phục vụ", description: "Không bật cờ AI_AGENT_V2: route V2 trả 404, runtime không được hỏi.",
      expect: "HTTP 404 NOT_FOUND", mocked: ["Xác thực (token fixture trong launcher)"], env: {},
      turns: [{ label: "Cờ tắt", question: "Hôm nay tôi tập gì?" }] },
    { id: "error-unauthenticated", group: "Lỗi và dự phòng", title: "Không có token → 401", description: "Gọi route V2 mà không gửi token đăng nhập.",
      expect: "HTTP 401", mocked: ["Xác thực (token fixture trong launcher)"], env: DET,
      turns: [{ label: "Không token", question: "Hôm nay tôi tập gì?", noAuth: true }] },
  ];
  return { scenarios, ids };
}

export function publicScenarios(defs: DemoScenarioDef[]): PublicScenario[] {
  return defs.map((s) => ({ id: s.id, group: s.group, title: s.title, description: s.description, expect: s.expect, mocked: s.mocked,
    turns: s.turns.map((t) => ({ label: t.label, question: t.question, ...(t.sessionId ? { sessionId: t.sessionId } : {}), as: t.as ?? "A", noAuth: !!t.noAuth })) }));
}

export interface DemoTurnResult {
  label: string; request: { question: string; sessionId?: string; actingAs: "A" | "B" | "none" };
  http: { status: number };
  /** The REAL body returned by POST /ai/v2/ask (data on 200, error object otherwise). */
  response: { data?: { status: string; answer: string; agents: string[]; turnId?: string; traceId?: string }; error?: { code?: string; message?: string } };
  /** Diagnostic summary from the supervisor's own traceSink — NOT part of the API response (demo harness only). */
  trace: null | { supervisorStatus: string; decision?: { strategy: string; chosen: string[]; dropped: string[]; reasonCodes: string[] }; routingMode?: string; delegations: Array<{ agentId: string; completionStatus: string; modelCalls: number; tools: string[] }> };
}
export interface DemoRunResult { scenarioId: string; banner: string; notice: string; turns: DemoTurnResult[]; tripwires: Tripwires; durationMs: number }
export interface Tripwires { fetch: number; bedrock: number; callLLM: number; unmockedHttp: number }

export interface DemoServer { server: http.Server; port: number; tripwires: Tripwires; close(): Promise<void>; scenarios: PublicScenario[] }

export function assertSafeToStart(env: NodeJS.ProcessEnv, host: string): void {
  if (env.NODE_ENV === "production") throw new Error("web-demo-server refuses to run with NODE_ENV=production");
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") throw new Error(`web-demo-server binds loopback only (got ${host})`);
}
const isLoopbackHost = (h: string | undefined): boolean => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(String(h ?? ""));

export async function startWebDemoServer(opts: { port?: number; host?: string } = {}): Promise<DemoServer> {
  const host = opts.host ?? "127.0.0.1";
  assertSafeToStart(process.env, host);
  const saved: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string | undefined) => { if (!(k in saved)) saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  setEnv("INTERNAL_SERVICE_SECRET", "web-demo-internal-secret"); // fixture value, lives only in this process
  setEnv("AI_ASK_RATE_LIMIT_MAX", "10000");
  setEnv("LOG_LEVEL", "silent");
  setEnv("USER_SERVICE_URL", "http://user-service.m8demo.invalid");
  setEnv("FITNESS_SERVICE_URL", "http://fitness-service.m8demo.invalid");
  for (const k of ["RATE_LIMIT_PROVIDER", "USER_LAMBDA_NAME", "FITNESS_LAMBDA_NAME", "AUTH_LAMBDA_NAME", "AGENT_V2_SESSION_STORE", "AGENT_V2_SESSION_REDIS_URL", ...ENV_KEYS]) setEnv(k, undefined);

  // ── tripwires ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const trip: Tripwires = { fetch: 0, bedrock: 0, callLLM: 0, unmockedHttp: 0 };
  const net = { profiles: {} as Record<string, Reply> };
  const respond = (config: InternalAxiosRequestConfig, r: Reply): AxiosResponse => {
    const response: AxiosResponse = { data: r.data, status: r.status, statusText: String(r.status), headers: {}, config, request: {} };
    if (!config.validateStatus || config.validateStatus(r.status)) return response;
    throw new AxiosError(`Request failed with status code ${r.status}`, AxiosError.ERR_BAD_REQUEST, config, {}, response);
  };
  const adapter: AxiosAdapter = async (config) => {
    const h = config.headers as unknown as { get?: (k: string) => unknown; Authorization?: unknown };
    const auth = String(h?.get?.("Authorization") ?? h?.Authorization ?? "");
    const url = String(config.url ?? "");
    if (url.endsWith("/profile/me") && /\.invalid\//.test(url)) return respond(config, net.profiles[auth.replace(/^Bearer /, "")] ?? { status: 401, data: {} });
    trip.unmockedHttp++;
    return respond(config, { status: 404, data: { error: "not mocked" } });
  };
  axios.defaults.adapter = adapter;
  globalThis.fetch = (async () => { trip.fetch++; throw new Error("network blocked"); }) as typeof fetch;
  const { bedrockRuntimeDeps } = await import("../../services/bedrock.client");
  bedrockRuntimeDeps.send = (async () => { trip.bedrock++; throw new Error("provider blocked"); }) as any;
  const { llmService } = await import("../../services/llm.service");
  (llmService as any).callLLM = async () => { trip.callLLM++; throw new Error("TRIPWIRE: model call"); };
  const { authServiceClientDeps } = await import("../../clients/auth-service.client");
  authServiceClientDeps.verify = (async (token: string) => {
    const id = TOKENS[token];
    if (!id) throw Object.assign(new Error("invalid"), { response: { status: 401 } });
    return { status: 200, data: { user: { id, role: "CUSTOMER" } } };
  }) as any;

  const hz = await import("../m5-benchmark/harness");
  const rt = await import("../../agent-v2-integration/multi-agent-runtime");
  const sc = await import("../../agent-v2/session-context");
  const mr = await import("../../agent-v2/minor-restriction");
  const { default: app } = (await import("../../app")) as { default: Express };
  rigApi ??= buildRigApi(hz);
  const { scenarios } = rigApi;
  const seam = rt.multiAgentRuntimeSeam;

  function makeRig(def: DemoScenarioDef): Rig {
    for (const k of ENV_KEYS) setEnv(k, undefined);
    for (const [k, v] of Object.entries(def.env)) setEnv(k, v);
    const clock = () => T0;
    const w = hz.world(clock, undefined as Partial<WorldState> | undefined);
    const prov: Record<AgentId, MockProvider> = { training: hz.mockProvider("training"), nutrition: hz.mockProvider("nutrition"), recovery: hz.mockProvider("recovery"), progress: hz.mockProvider("progress") };
    const router = hz.mockProvider("router");
    const traces: SupervisorTrace[] = [];
    const adult = (id: string): Reply => ({ status: 200, data: { profile: { userId: id, age: 30 } } });
    net.profiles = { "tok-a": adult(USER_A), "tok-b": adult(USER_B), ...(def.profiles ?? {}) };
    let runtime: ReturnType<typeof rt.createMultiAgentRuntime> | null = null;
    seam.factory = () => (runtime ??= rt.createMultiAgentRuntime({
      providerFor: (a) => prov[a], now: clock, sessionStore: sc.createInMemorySessionStore(), restrictionStore: mr.createInMemoryMinorRestrictionStore(),
      deps: { training: w.training, nutrition: w.nutrition, recovery: w.recovery, progress: w.progress },
      routingModelFactory: () => router, traceSink: (x) => traces.push(x),
    }));
    return { prov, router, traces, w };
  }

  async function runScenario(id: string): Promise<DemoRunResult> {
    const def = scenarios.find((s) => s.id === id);
    if (!def) throw Object.assign(new Error("unknown scenario"), { statusCode: 400 });
    const t0 = Date.now();
    const r = makeRig(def);
    const out: DemoTurnResult[] = [];
    for (const t of def.turns) {
      t.script?.(r);
      const before = r.traces.length;
      const token = t.noAuth ? null : t.as === "B" ? "tok-b" : "tok-a";
      const body = { question: t.question, ...(t.sessionId ? { sessionId: t.sessionId } : {}) };
      const req0 = request(app).post("/ai/v2/ask");
      const res = await (token ? req0.set("Authorization", `Bearer ${token}`) : req0).send(body);
      for (const p of Object.values(r.prov)) p.drain();
      r.router.drain();
      const tr: SupervisorTrace | undefined = r.traces.length > before ? r.traces[r.traces.length - 1] : undefined;
      const data = res.body?.data;
      out.push({
        label: t.label, request: { ...body, actingAs: token === "tok-b" ? "B" : token === "tok-a" ? "A" : "none" }, http: { status: res.status },
        response: data ? { data: { status: String(data.status), answer: String(data.answer ?? ""), agents: Array.isArray(data.agents) ? data.agents.map(String) : [], ...(data.turnId ? { turnId: String(data.turnId) } : {}), ...(data.traceId ? { traceId: String(data.traceId) } : {}) } }
          : { error: { code: res.body?.error?.code ?? res.body?.code, message: res.body?.error?.message ?? res.body?.message } },
        trace: tr ? {
          supervisorStatus: String(tr.status),
          ...(tr.decision ? { decision: { strategy: tr.decision.strategy, chosen: [...tr.decision.agents], dropped: [...tr.decision.dropped], reasonCodes: [...tr.decision.reasonCodes] } } : {}),
          ...(tr.routingMode ? { routingMode: `${tr.routingMode.requested}→${tr.routingMode.effective} (${tr.routingMode.reason})` } : {}),
          delegations: tr.delegations.map((d) => ({ agentId: d.agentId, completionStatus: d.completionStatus, modelCalls: d.modelCallCount, tools: d.evidence.map((e) => `${e.toolId}:${e.outcome}`) })),
        } : null,
      });
    }
    return { scenarioId: id, banner: DEMO_BANNER, notice: DEMO_NOTICE, turns: out, tripwires: { ...trip }, durationMs: Date.now() - t0 };
  }

  // ── demo API (same-origin via the Vite proxy; loopback Host only) ───────────────────────────────────────────────────
  const publicList = publicScenarios(scenarios);
  const demo = express();
  demo.disable("x-powered-by");
  demo.use((req: Request, res: Response, next) => {
    if (!isLoopbackHost(req.headers.host)) { res.status(403).json({ error: "loopback host only" }); return; }
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  demo.use(express.json({ limit: "2kb" }));
  demo.get("/demo/health", (_req, res) => { res.json({ banner: DEMO_BANNER, notice: DEMO_NOTICE, bind: host, tripwires: { ...trip }, scenarios: publicList.length }); });
  demo.get("/demo/scenarios", (_req, res) => { res.json({ banner: DEMO_BANNER, notice: DEMO_NOTICE, scenarios: publicList }); });
  let queue: Promise<unknown> = Promise.resolve(); // one scenario at a time: env + runtime are process-wide
  demo.post("/demo/run", (req: Request, res: Response) => {
    const b = req.body as { scenarioId?: unknown } | undefined;
    const keys = b && typeof b === "object" ? Object.keys(b) : [];
    if (!b || typeof b.scenarioId !== "string" || keys.length !== 1 || !scenarios.some((s) => s.id === b.scenarioId)) { res.status(400).json({ error: "scenarioId must be one approved fixture scenario id; nothing else is accepted" }); return; }
    const id = b.scenarioId;
    queue = queue.then(() => runScenario(id)).then((r) => { res.json(r); }, (e) => { res.status(500).json({ error: "demo run failed", detail: String(e?.message ?? e).slice(0, 200) }); });
  });
  demo.use((_req, res) => { res.status(404).json({ error: "not found" }); });

  const server = http.createServer(demo);
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? DEFAULT_PORT, host, () => resolve((server.address() as { port: number }).port));
  });
  return {
    server, port, tripwires: trip, scenarios: publicList,
    close: () => new Promise<void>((resolve) => { server.close(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } resolve(); }); }),
  };
}

// CLI entry (never runs when imported by a test). Guard first, then listen on loopback.
const isMain = /m8-demo\/web-demo-server(\.ts|\.js)?$/.test((process.argv[1] ?? "").replace(/\\/g, "/"));
if (isMain) {
  const port = Number(process.env.DEMO_PORT || DEFAULT_PORT);
  startWebDemoServer({ port }).then((s) => {
    // eslint-disable-next-line no-console
    console.log(`${DEMO_BANNER}\n${DEMO_NOTICE}\nlisten http://127.0.0.1:${s.port}  (loopback only)  scenarios=${s.scenarios.length}\nGET /demo/health  GET /demo/scenarios  POST /demo/run {scenarioId}`);
  }).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
