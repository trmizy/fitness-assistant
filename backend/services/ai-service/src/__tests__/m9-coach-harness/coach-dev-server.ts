/**
 * M9.3-T1 — LOCAL DEV LAUNCHER for trying Multi-Agent V2 from the EXISTING AI Coach page. TEST HARNESS ONLY: lives under __tests__,
 * is never imported by production code, refuses NODE_ENV=production and any non-loopback bind.
 *
 * What runs for real (production code): the ai-service `app` — requireAuth, the shared ask rate limiter, AskRequestSchema validation,
 * bindRequestIdentity, the bridge middleware (M9.2-T3), the continuity layer, createCoachV2Executor and, through the composition
 * root, the Supervisor, deterministic Router (intent-v1.3), four bounded agents, tool registries and the profile reader.
 *
 * What is replaced (and only here, never in production paths): token verification (fixture accounts + fixture JWT-shaped tokens that
 * live only in this process), the HTTP transport of the domain reads (axios adapter, no socket), the agents' models (scripted mocks),
 * the domain READ data (synthetic fixtures), the idempotency store and the history repository (in-memory fakes), and the V1 controller
 * (a clearly labelled STUB so V1-served replies are visibly not real V1 — no model, no DB). Tripwires count any fetch / Bedrock /
 * callLLM / un-mocked HTTP call. A tiny fake gateway in front of the app serves /auth/* for the browser and the DEV opt-in endpoints.
 *
 * Server-side authorization (the browser cannot widen it): V2 is reachable only for a user the LAUNCHER has opted in (bridge allowlist
 * = that set; default empty → everyone on V1); while a user is opted in, only the approved read-only synthetic questions are accepted
 * on POST /ai/ask — anything else is refused here, so free text never reaches the V2 runtime.
 *
 * Run: cd backend/services/ai-service && FITNESS_DISABLE_REDIS=true npx tsx src/__tests__/m9-coach-harness/coach-dev-server.ts
 */
import http from "node:http";
import { randomUUID } from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import axios, { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";

import type { MockProvider } from "../m5-benchmark/harness";
import type { AgentId } from "../../agent-v2/multi-agent-contracts";
import type { SupervisorTrace } from "../../agent-v2/supervisor";
import { fakeStore, fakeHistory } from "../coach-continuity-fakes";

export const BANNER = "GYMINI AI COACH × MULTI-AGENT V2 — LOCAL DEV LAUNCHER / MOCK MODEL";
export const NOTICE = "Fixture data only — mock models, mock auth, no network — NOT health advice — not a measure of accuracy";
export const DEFAULT_PORT = 4801;

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const USER_M = "33333333-3333-4333-8333-333333333333";
const T0 = Date.parse("2026-11-13T09:00:00.000Z");
const ALL: AgentId[] = ["training", "nutrition", "recovery", "progress"];

interface Account { id: string; email: string; password: string; token: string; refresh: string; first: string; age: number }
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
// JWT-SHAPED fixture token ("alg":"none", year-2100 exp): lets the frontend's expiry check treat it as fresh. Not a credential for anything.
const fixtureJwt = (sub: string) => `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub, exp: 4102444800 })}.fixture`;
export const ACCOUNTS: Account[] = [
  { id: USER_A, email: "v2dev-a@example.invalid", password: "fixture-password-a", token: fixtureJwt(USER_A), refresh: "fixture-refresh-a", first: "Dev A", age: 30 },
  { id: USER_B, email: "v2dev-b@example.invalid", password: "fixture-password-b", token: fixtureJwt(USER_B), refresh: "fixture-refresh-b", first: "Dev B", age: 30 },
  { id: USER_M, email: "v2dev-minor@example.invalid", password: "fixture-password-m", token: fixtureJwt(USER_M), refresh: "fixture-refresh-m", first: "Dev Minor", age: 16 },
];
const byToken = new Map(ACCOUNTS.map((a) => [a.token, a]));
const bearerOf = (req: Request): string => String(req.headers.authorization ?? "").replace(/^Bearer /, "");

export interface Tripwires { fetch: number; bedrock: number; callLLM: number; unmockedHttp: number }
export interface ApprovedScenario { id: string; title: string; question: string; expect: string }
interface ScenarioDef extends ApprovedScenario { script: (r: Rig) => void }
interface Rig { prov: Record<AgentId, MockProvider> }

export interface CoachDevServer {
  server: http.Server; port: number; tripwires: Tripwires;
  counters: { v1Ask: number; v1Stream: number; v2Runs: () => number };
  unmocked: string[]; optedIn: Set<string>;
  scenarios: ApprovedScenario[];
  fakes: { store: ReturnType<typeof fakeStore>; history: ReturnType<typeof fakeHistory> };
  close(): Promise<void>;
}

export function assertSafeToStart(env: NodeJS.ProcessEnv, host: string): void {
  if (env.NODE_ENV === "production") throw new Error("coach-dev-server refuses to run with NODE_ENV=production");
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") throw new Error(`coach-dev-server binds loopback only (got ${host})`);
}
const isLoopbackHost = (h: string | undefined): boolean => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(String(h ?? ""));

export async function startCoachDevServer(opts: { port?: number; host?: string } = {}): Promise<CoachDevServer> {
  const host = opts.host ?? "127.0.0.1";
  assertSafeToStart(process.env, host);
  const saved: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string | undefined) => { if (!(k in saved)) saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  setEnv("INTERNAL_SERVICE_SECRET", "coach-dev-internal-secret"); // fixture value, this process only
  setEnv("AI_ASK_RATE_LIMIT_MAX", "10000");
  setEnv("LOG_LEVEL", "silent");
  setEnv("USER_SERVICE_URL", "http://user-service.m93.invalid");
  setEnv("FITNESS_SERVICE_URL", "http://fitness-service.m93.invalid");
  for (const k of ["RATE_LIMIT_PROVIDER", "USER_LAMBDA_NAME", "FITNESS_LAMBDA_NAME", "AUTH_LAMBDA_NAME", "AGENT_V2_SESSION_STORE", "AGENT_V2_SESSION_REDIS_URL", "AI_AGENT_V2_ROUTING_MODE", "AI_AGENT_V2_PRODUCTION_APPROVED", "AI_COACH_V2_BRIDGE_PRODUCTION_APPROVED", "AI_COACH_V2_BRIDGE_USERS", "NODE_ENV"]) setEnv(k, undefined);
  setEnv("AI_AGENT_V2", "on");
  setEnv("AI_COACH_V2_BRIDGE", "on"); // the bridge is ON in this process; WHO may use V2 is the launcher's opt-in set (empty by default)

  // DEV chaos controls (launcher only): make a REAL bridge situation reproducible in the browser — a lost response (retry must replay) and
  // a turn held in flight while its retry arrives (real 409 OPERATION_IN_PROGRESS). Consumed once; opted-in users only.
  let chaos: null | "drop-response" | "hold-then-drop" = null;
  let holdGate: Promise<void> | null = null;
  let releaseHold: (() => void) | null = null;

  // ── tripwires + transport ───────────────────────────────────────────────────────────────────────────────────────────────
  const trip: Tripwires = { fetch: 0, bedrock: 0, callLLM: 0, unmockedHttp: 0 };
  const respond = (config: InternalAxiosRequestConfig, status: number, data: unknown): AxiosResponse => {
    const response: AxiosResponse = { data, status, statusText: String(status), headers: {}, config, request: {} };
    if (!config.validateStatus || config.validateStatus(status)) return response;
    throw new AxiosError(`Request failed with status code ${status}`, AxiosError.ERR_BAD_REQUEST, config, {}, response);
  };
  const adapter: AxiosAdapter = async (config) => {
    const h = config.headers as unknown as { get?: (k: string) => unknown; Authorization?: unknown };
    const auth = String(h?.get?.("Authorization") ?? h?.Authorization ?? "");
    const url = String(config.url ?? "");
    if (url.endsWith("/profile/me") && /\.invalid\//.test(url)) {
      const acct = byToken.get(auth.replace(/^Bearer /, ""));
      return respond(config, acct ? 200 : 401, acct ? { profile: { userId: acct.id, age: acct.age } } : {});
    }
    trip.unmockedHttp++;
    return respond(config, 404, { error: "not mocked" });
  };
  axios.defaults.adapter = adapter;
  globalThis.fetch = (async () => { trip.fetch++; throw new Error("network blocked"); }) as typeof fetch;
  const { bedrockRuntimeDeps } = await import("../../services/bedrock.client");
  bedrockRuntimeDeps.send = (async () => { trip.bedrock++; throw new Error("provider blocked"); }) as any;
  const { llmService } = await import("../../services/llm.service");
  (llmService as any).callLLM = async () => { trip.callLLM++; throw new Error("TRIPWIRE: model call"); };
  const { authServiceClientDeps } = await import("../../clients/auth-service.client");
  authServiceClientDeps.verify = (async (token: string) => {
    const a = byToken.get(token);
    if (!a) throw Object.assign(new Error("invalid"), { response: { status: 401 } });
    return { status: 200, data: { user: { id: a.id, role: "CUSTOMER" } } };
  }) as any;

  // ── fakes: idempotency store + history; V1 stub ─────────────────────────────────────────────────────────────────────────
  const store = fakeStore();
  const history = fakeHistory();
  const meta = new Map<string, { createdAt: string; lastMessageAt: string; title: string }>(); // session dates for the history sidebar
  const nowIso = () => new Date().toISOString();
  // record session dates for BOTH V1-stub and V2-created sessions (the V2 history write goes through this same port)
  const origCreateSession = history.history.createSession.bind(history.history);
  history.history.createSession = async (d) => { meta.set(d.id, { createdAt: nowIso(), lastMessageAt: nowIso(), title: d.title }); return origCreateSession(d); };
  const origTouch = history.history.touchSession.bind(history.history);
  history.history.touchSession = async (id) => { const m = meta.get(id); if (m) m.lastMessageAt = nowIso(); return origTouch(id); };
  const counters = { v1Ask: 0, v1Stream: 0, v2Runs: () => traces.length };
  const traces: SupervisorTrace[] = [];

  const v1Reply = async (req: Request) => {
    const acct = byToken.get(bearerOf(req))!;
    const body = req.body as { question: string; sessionId?: string; clientRequestId?: string };
    let sessionId = body.sessionId;
    const prior = body.clientRequestId ? await history.history.findTurnByClientRequestId(acct.id, body.clientRequestId) : null;
    if (prior) return { sessionId: prior.sessionId as string, conversationId: prior.id, answer: (prior as any).answer as string, question: body.question };
    if (!sessionId) { sessionId = randomUUID(); await history.history.createSession({ id: sessionId, userId: acct.id, title: body.question.trim().slice(0, 60) }); }
    const base = `[Launcher DEV — câu trả lời V1 GIẢ LẬP, không phải V1 thật] Bạn hỏi: “${body.question.trim().slice(0, 120)}”.`;
    // layout probe for the browser run: a question containing "trả lời dài" gets a long stub reply with a long unbroken token and a list
    const NL = String.fromCharCode(10);
    const longTail = Array.from({ length: 14 }, (_, i) => `Ý ${i + 1}: đây là một đoạn văn dài giả lập dùng để kiểm tra việc xuống dòng và cuộn của khung chat trên màn hình điện thoại hẹp.`).join(NL);
    const answer = /trả lời dài/i.test(body.question) ? `${base}${NL}${NL}${longTail}${NL}${NL}https://example.invalid/${"đường-dẫn-rất-dài-không-có-khoảng-trắng-".repeat(6)}` : base;
    await history.history.createTurn({
      userId: acct.id, sessionId, clientRequestId: body.clientRequestId ?? `v1-${randomUUID()}`, question: body.question, answer, modelUsed: "v1-launcher-stub" as never, responseTime: 0,
      promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, usedFallback: false, usedDeterministicFallback: false, warningCount: 0,
    } as never);
    const m = meta.get(sessionId); if (m) m.lastMessageAt = nowIso();
    return { sessionId, conversationId: randomUUID(), answer, question: body.question };
  };
  // V1 controller stubs — captured by ai.routes at import, exactly as the existing HTTP tests do; they only COUNT and answer a labelled stub
  const { aiController } = await import("../../controllers/ai.controller");
  (aiController as any).ask = (req: Request, res: Response, next: NextFunction) => {
    counters.v1Ask++;
    v1Reply(req).then((r) => res.status(200).json({ success: true, data: { ...r, modelUsed: "v1-launcher-stub", structuredBlocks: [], evidenceUsed: [] } }), next);
  };
  (aiController as any).askStream = (req: Request, res: Response) => {
    counters.v1Stream++;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8"); res.setHeader("Cache-Control", "no-cache, no-transform"); res.flushHeaders();
    const send = (type: string, payload?: object) => res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
    send("status", { message: "Đang chuẩn bị câu trả lời (V1 giả lập)..." });
    v1Reply(req).then(async (r) => {
      for (let i = 0; i < r.answer.length; i += 24) { send("token", { content: r.answer.slice(i, i + 24) }); await new Promise((ok) => setTimeout(ok, 15)); }
      send("done", { structuredBlocks: [], conversationId: r.conversationId, sessionId: r.sessionId, evidenceUsed: [], adjustmentReasons: [], safetyNotes: [] });
      res.end();
    }, () => { send("error", { message: "An unexpected error occurred. Please try again." }); res.end(); });
  };
  // session sidebar: serve from the in-memory history instead of the DB (the real session controller still runs)
  const { conversationRepository } = await import("../../repositories/conversation.repository");
  const sess = (id: string) => { const s = history.sessions.get(id); const m = meta.get(id); return s ? { id, userId: s.userId, title: s.title ?? m?.title ?? "Cuộc trò chuyện", lastMessageAt: m?.lastMessageAt ?? nowIso(), archivedAt: s.archivedAt, createdAt: m?.createdAt ?? nowIso(), updatedAt: m?.lastMessageAt ?? nowIso() } : null; };
  (conversationRepository as any).findSessionsByUser = async (userId: string) => [...history.sessions.values()].filter((s) => s.userId === userId && !s.archivedAt).map((s) => sess(s.id)).sort((a, b) => String(b!.lastMessageAt).localeCompare(String(a!.lastMessageAt)));
  (conversationRepository as any).findSessionById = async (id: string) => sess(id);
  (conversationRepository as any).findSessionMessages = async (userId: string, sessionId: string) =>
    history.turns.filter((t) => t.userId === userId && t.sessionId === sessionId).map((t) => ({ ...t, createdAt: nowIso() })); // full rows, like the real findSessionMessages (modelUsed / traceId included)
  (conversationRepository as any).archiveSession = async (id: string) => { const s = history.sessions.get(id); if (s) s.archivedAt = new Date(); return sess(id); };

  // ── the real app + the V2 runtime over mocks ────────────────────────────────────────────────────────────────────────────
  const hz = await import("../m5-benchmark/harness");
  const rt = await import("../../agent-v2-integration/multi-agent-runtime");
  const sc = await import("../../agent-v2/session-context");
  const mr = await import("../../agent-v2/minor-restriction");
  const { default: app } = (await import("../../app")) as { default: express.Express };
  const { coachBridgeSeam } = await import("../../services/coach-bridge.middleware");
  const { say, use, call } = hz;
  const clock = () => T0;
  const world = hz.world(clock, undefined);
  const prov: Record<AgentId, MockProvider> = { training: hz.mockProvider("training"), nutrition: hz.mockProvider("nutrition"), recovery: hz.mockProvider("recovery"), progress: hz.mockProvider("progress") };
  let runtime: ReturnType<typeof rt.createMultiAgentRuntime> | null = null;
  rt.multiAgentRuntimeSeam.factory = () => (runtime ??= rt.createMultiAgentRuntime({
    providerFor: (a) => ({ modelId: prov[a].modelId, supportsCancellation: false, converse: async (r) => { if (holdGate) await holdGate; return prov[a].converse(r); } }), now: clock, sessionStore: sc.createInMemorySessionStore(), restrictionStore: mr.createInMemoryMinorRestrictionStore(),
    deps: { training: world.training, nutrition: world.nutrition, recovery: world.recovery, progress: world.progress },
    traceSink: (x) => traces.push(x),
  }));

  const train = (r: Rig) => r.prov.training.script(use(call("training.get_today_schedule")), say("Hôm nay bạn có buổi Leg day với 2 bài (dữ liệu lịch mẫu)."));
  const nutr = (r: Rig) => r.prov.nutrition.script(use(call("nutrition.get_target")), say("Mục tiêu hiện tại trong dữ liệu mẫu là 2400 kcal mỗi ngày."));
  const defs: ScenarioDef[] = [
    { id: "training", title: "Lịch tập hôm nay", question: "Hôm nay tôi tập gì?", expect: "ANSWERED bởi [training]", script: train },
    { id: "nutrition", title: "Mục tiêu calo", question: "Mục tiêu calo của tôi là bao nhiêu?", expect: "ANSWERED bởi [nutrition]; tài khoản dưới 18 tuổi → MINOR_PROTECTED", script: nutr },
    { id: "recovery", title: "Phục hồi", question: "Tôi tập chân hôm qua, nghỉ ngơi thế nào cho hợp lý?", expect: "ANSWERED bởi [recovery]",
      script: (r) => r.prov.recovery.script(use(call("recovery.get_recent_sessions")), say("Quan sát từ dữ liệu mẫu: hôm qua có một buổi thân dưới, RPE 8.")) },
    { id: "progress", title: "Tiến độ cân nặng", question: "Cân nặng của tôi thay đổi thế nào so với mục tiêu?", expect: "ANSWERED bởi [progress]",
      script: (r) => r.prov.progress.script(use(call("progress.get_body_measurements")), say("Theo dữ liệu mẫu, cân nặng đo gần nhất là 72.4 kg, mục tiêu 68 kg.")) },
    { id: "two-agents", title: "Hai agent (lịch + ăn)", question: "Hôm nay tôi tập buổi nào, và trước đó nên ăn gì?", expect: "ANSWERED bởi [nutrition, training]",
      script: (r) => { train(r); r.prov.nutrition.script(say("Trước buổi tập nên ăn nhẹ dễ tiêu, có tinh bột và một ít đạm.")); } },
    { id: "partial-cap", title: "Ba miền → PARTIAL (trần 2 agent)", question: "Tôi tập chân hôm qua và hơi mệt, hôm nay nên tập gì và ăn gì?", expect: "PARTIAL; ≤ 2 agent; thông báo phần chưa xử lý",
      script: (r) => { train(r); r.prov.nutrition.script(say("Trước buổi tập nên ăn nhẹ có tinh bột và một ít đạm.")); } },
    { id: "safety", title: "Yêu cầu giảm cân cực đoan → bị chặn", question: "Làm sao giảm 10kg trong 1 tuần?", expect: "SAFETY_BLOCKED, không agent, không về V1",
      script: (r) => { for (const a of ALL) r.prov[a].script(say("KHÔNG ĐƯỢC TỚI ĐÂY")); } },
    { id: "agent-failure", title: "Mô hình agent lỗi → FAILED", question: "Lịch tập hôm nay của tôi thế nào?", expect: "FAILED (thông báo cố định), không bịa câu trả lời, không về V1",
      script: (r) => r.prov.training.script(() => { throw new Error("model unavailable (fixture)"); }) },
  ];
  const approved: ApprovedScenario[] = defs.map(({ id, title, question, expect }) => ({ id, title, question, expect }));
  const byQuestion = new Map(defs.map((d) => [d.question, d]));
  const rig: Rig = { prov };
  const inflight = new Map<string, number>(); // scripts are queued once per scenario while any request for it is in flight (duplicates never re-script)

  const optedIn = new Set<string>();
  coachBridgeSeam.ports = { idempotency: store.store, history: history.history };
  coachBridgeSeam.overrides = { userAllowed: (userId: string) => optedIn.has(userId) };
  const unmocked: string[] = [];

  // ── fake gateway in front of the real app ───────────────────────────────────────────────────────────────────────────────
  const gw = express();
  gw.disable("x-powered-by");
  gw.use((req, res, next) => {
    if (!isLoopbackHost(req.headers.host)) { res.status(403).json({ error: "loopback host only" }); return; }
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  gw.use(express.json({ limit: "8kb" }));
  const userOf = (req: Request): Account | null => byToken.get(bearerOf(req)) ?? null;
  const userJson = (a: Account) => ({ id: a.id, email: a.email, firstName: a.first, lastName: "(fixture)", role: "CUSTOMER", isActive: true, isPT: false });
  gw.post("/auth/login", (req, res) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    const a = ACCOUNTS.find((x) => x.email === email && x.password === password);
    if (!a) { res.status(401).json({ message: "invalid credentials" }); return; }
    res.json({ accessToken: a.token, refreshToken: a.refresh, user: userJson(a) });
  });
  gw.post("/auth/refresh", (req, res) => {
    const rtok = String((req.body ?? {}).refreshToken ?? "");
    const a = ACCOUNTS.find((x) => x.refresh === rtok);
    if (!a) { res.status(401).json({ message: "invalid refresh token" }); return; }
    res.json({ accessToken: a.token, refreshToken: a.refresh });
  });
  gw.post("/auth/verify", (req, res) => { const a = userOf(req); if (!a) { res.status(401).json({ message: "unauthorized" }); return; } res.json({ valid: true, user: userJson(a) }); });
  gw.post("/auth/logout", (_req, res) => { res.json({ success: true }); });

  // DEV opt-in (server-side, per verified user; the launcher is the only authority) ------------------------------------------------
  gw.get("/__dev/coach-v2/health", (_req, res) => { res.json({ banner: BANNER, notice: NOTICE, tripwires: { ...trip }, v1Ask: counters.v1Ask, v1Stream: counters.v1Stream, v2Runs: traces.length, unmocked }); });
  gw.get("/__dev/coach-v2/optin", (req, res) => { const a = userOf(req); if (!a) { res.status(401).json({ error: "unauthorized" }); return; } res.json({ enabled: optedIn.has(a.id) }); });
  gw.post("/__dev/coach-v2/optin", (req, res) => {
    const a = userOf(req); if (!a) { res.status(401).json({ error: "unauthorized" }); return; }
    const b = req.body as { enabled?: unknown } | undefined;
    if (!b || typeof b.enabled !== "boolean" || Object.keys(b).length !== 1) { res.status(400).json({ error: "body must be exactly { enabled: boolean }" }); return; }
    if (b.enabled) optedIn.add(a.id); else optedIn.delete(a.id);
    res.json({ enabled: optedIn.has(a.id) });
  });
  gw.post("/__dev/coach-v2/chaos", (req, res) => {
    if (!userOf(req)) { res.status(401).json({ error: "unauthorized" }); return; }
    const m = (req.body as { mode?: unknown } | undefined)?.mode;
    if (m !== "drop-response" && m !== "hold-then-drop" && m !== null) { res.status(400).json({ error: "mode must be drop-response | hold-then-drop | null" }); return; }
    chaos = m; res.json({ chaos });
  });
  gw.post("/__dev/coach-v2/release", (req, res) => { if (!userOf(req)) { res.status(401).json({ error: "unauthorized" }); return; } releaseHold?.(); res.json({ released: true }); });
  gw.get("/__dev/coach-v2/scenarios", (req, res) => { if (!userOf(req)) { res.status(401).json({ error: "unauthorized" }); return; } res.json({ banner: BANNER, scenarios: approved }); });

  // While opted in, POST /ai/ask accepts only approved synthetic questions (free text never reaches V2); scripts the mock models for it.
  gw.post("/ai/ask", (req, res, next) => {
    const a = userOf(req);
    if (!a || !optedIn.has(a.id)) { next(); return; }
    const q = (req.body as { question?: unknown } | undefined)?.question;
    const def = typeof q === "string" ? byQuestion.get(q.trim()) : undefined;
    if (!def) { res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "DEV V2: chỉ các kịch bản read-only đã duyệt được chấp nhận khi V2 bật." } }); return; }
    if (chaos) {
      const mode = chaos; chaos = null;
      if (mode === "drop-response") { (res as any).end = () => { res.socket?.destroy(); return res; }; }
      else {
        holdGate = new Promise<void>((r) => { releaseHold = () => { holdGate = null; r(); }; });
        setTimeout(() => req.socket.destroy(), 300);
        setTimeout(() => releaseHold?.(), 9000);
      }
    }
    const n = inflight.get(def.id) ?? 0;
    if (n === 0) def.script(rig);
    inflight.set(def.id, n + 1);
    res.on("close", () => {
      const left = (inflight.get(def.id) ?? 1) - 1;
      inflight.set(def.id, left);
      if (left === 0) for (const p of Object.values(prov)) p.drain();
    });
    next();
  });
  // Generic EMPTY fixtures the shell/layout of the existing page asks for on load (no user data, no business logic): they let the real
  // AI Coach route render in the browser. Everything else stays un-mocked (404) and is recorded.
  const emptyFixtures: Record<string, (a: Account, req: Request) => unknown> = {
    "GET /profile/me": (a) => ({ profile: { userId: a.id, firstName: a.first, age: a.age, hasCompletedOnboarding: true } }),
    "GET /notifications": () => ({ notifications: [], total: 0 }),
    "GET /notifications/unread-count": () => ({ count: 0, unreadCount: 0 }),
    "GET /inbody": () => ({ entries: [] }),
    "GET /workouts": () => ({ workouts: [] }),
    "GET /workouts/programs/current": () => ({ program: null }),
    "GET /workouts/schedules": () => ({ schedules: [] }),
    "POST /api/translate": (_a, req) => ({ translatedText: String((req.body as { text?: unknown })?.text ?? "") }),
  };
  gw.use((req, res, next) => {
    const fx = emptyFixtures[`${req.method} ${req.path}`];
    if (!fx) { next(); return; }
    const a = userOf(req);
    if (!a) { res.status(401).json({ message: "unauthorized" }); return; }
    res.json(fx(a, req));
  });
  gw.use((req, res, next) => {
    if (req.path.startsWith("/ai/")) { next(); return; }
    if (req.path.startsWith("/__dev/")) { res.status(404).json({ error: "not found" }); return; }
    unmocked.push(`${req.method} ${req.path}`);
    res.status(404).json({ success: false, message: "not mocked by the coach dev launcher" });
  });
  gw.use(app); // the REAL ai-service app (/ai/*)

  const server = http.createServer(gw);
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? DEFAULT_PORT, host, () => resolve((server.address() as { port: number }).port));
  });
  return {
    server, port, tripwires: trip, counters, unmocked, optedIn, scenarios: approved, fakes: { store, history },
    close: () => new Promise<void>((resolve) => { server.close(() => { rt.multiAgentRuntimeSeam.factory = null; coachBridgeSeam.ports = null; coachBridgeSeam.overrides = {}; for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } resolve(); }); }),
  };
}

// CLI entry (never runs when imported by a test)
const isMain = /m9-coach-harness\/coach-dev-server(\.ts|\.js)?$/.test((process.argv[1] ?? "").replace(/\\/g, "/"));
if (isMain) {
  const port = Number(process.env.COACH_DEV_PORT || DEFAULT_PORT);
  startCoachDevServer({ port }).then((s) => {
    // eslint-disable-next-line no-console
    console.log(`${BANNER}\n${NOTICE}\nlisten http://127.0.0.1:${s.port} (loopback only)  accounts: ${ACCOUNTS.map((a) => a.email).join(", ")}  scenarios=${s.scenarios.length}`);
  }).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
