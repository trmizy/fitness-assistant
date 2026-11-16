/**
 * M9.4-T1 — side-by-side runner. OFFLINE, mock dependencies only (no live model, no real user data, no DB / Redis / Qdrant / network).
 *
 * For every EvalCase the SAME fixture facts are served to both engines through the real ai-service `app`:
 *   V2 run : bridge ON + user allow-listed → real bridge / continuity / executor / Supervisor / deterministic Router / bounded agents / tool
 *            registries / answer guards. Domain data comes from the M5 `world` deps (V2's reader shapes); the model is a SCRIPT.
 *   V1 run : bridge OFF → real controller → ragService → llmOrchestrator (+ real fitness agent, guards). Domain data comes from an HTTP fixture
 *            answered by a fake transport (the shapes V1's profile extractor reads); the model is a SCRIPT that echoes a fixed text.
 * Both deliveries carry the same facts (checked by `fixtureParity`). Because every model is a script, only DETERMINISTIC code behaviour is
 * measured here: ANSWER QUALITY IS NOT EVALUATED, and model-chosen tool selection is NOT_EVALUABLE.
 */
import request from "supertest";
import axios, { AxiosError, type AxiosAdapter, type AxiosResponse } from "axios";
import type { Express } from "express";
import type { MockProvider, WorldState } from "../m5-benchmark/harness";
import type { AgentId } from "../../agent-v2/multi-agent-contracts";
import type { SupervisorTrace } from "../../agent-v2/supervisor";
import type { ToolTraceEvent } from "../../agent-v2/tool-registry";
import { CASES, MARKERS, type EvalCase, type MarkerKey } from "./cases";
import { fakeStore, fakeHistory } from "../coach-continuity-fakes";
import type { FakeDb } from "../v1-real-path-fakes";

export const USERS = {
  A: { id: "11111111-1111-4111-8111-111111111111", token: "tok-a", age: 30 as number | null },
  B: { id: "22222222-2222-4222-8222-222222222222", token: "tok-b", age: 30 as number | null },
  M: { id: "33333333-3333-4333-8333-333333333333", token: "tok-m", age: 16 as number | null },
  U: { id: "44444444-4444-4444-8444-444444444444", token: "tok-u", age: null as number | null },
} as const;
const BY_TOKEN = new Map<string, { id: string; token: string; age: number | null }>(Object.values(USERS).map((u) => [u.token, u]));
const T0 = Date.parse("2026-11-13T09:00:00.000Z");
const V1_FAKE_ANSWER = "Đây là câu trả lời mẫu của mô hình V1 giả lập.";
const SESSION_V1 = "55555555-5555-4555-8555-555555555555";
const ALL_AGENTS: AgentId[] = ["training", "nutrition", "recovery", "progress"];

const todayVN = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());

// ── V1 HTTP fixture: the facts of a WorldState expressed in the shapes V1's profile extractor reads ─────────────────────────
export function v1Fixture(world: WorldState, age: number | null, noProfileWeight = false): Record<string, { status: number; data?: unknown }> {
  const inbody = (() => {
    switch (world.body) {
      case "full": return [{ weight: 72.4, bodyFatPct: 18.5, muscleMass: 33.1, date: "2026-11-10T07:00:00Z" }, { weight: 73.6, bodyFatPct: 19.4, muscleMass: 33.0, date: "2026-10-20T07:00:00Z" }];
      case "single_no_bf": return [{ weight: 72.4, date: "2026-11-10T07:00:00Z" }];
      case "stale": return [{ weight: 72.4, bodyFatPct: 18.5, date: "2026-04-17T07:00:00Z" }];
      default: return [];
    }
  })();
  const workouts = world.history === "lower_yesterday" ? [{ id: "w1", date: "2026-11-12T09:00:00Z", name: "Leg day", duration: 50, exercises: [{ exercise: { exerciseName: "Barbell Squat", bodyPart: "LOWER_BODY" }, sets: 4, reps: 5, weight: 96 }] }]
    : world.history === "upper_yesterday" ? [{ id: "w1", date: "2026-11-12T09:00:00Z", name: "Push day", duration: 50, exercises: [{ exercise: { exerciseName: "Bench Press", bodyPart: "UPPER_BODY" }, sets: 4, reps: 5, weight: 72 }] }] : [];
  const fx: Record<string, { status: number; data?: unknown }> = {
    "/profile/me": { status: 200, data: { profile: { ...(age === null ? {} : { age }), gender: "MALE", heightCm: 175, goal: "WEIGHT_LOSS", experienceLevel: "INTERMEDIATE", currentWeight: world.body === "absent" || noProfileWeight ? undefined : 72.4, targetWeight: 68 } } },
    "/inbody": world.body === "error" ? { status: 503, data: {} } : { status: 200, data: inbody },
    "/workouts/programs/current": { status: 200, data: { data: { program: { name: "Cut 3 ngày/tuần", daysPerWeek: 3 } } } },
    // V1 reads schedule rows as { date, programDay: { title, exercises, program } } and matches `date` against the REAL today (VN time)
    "/workouts/schedules": world.schedule === "error" ? { status: 503, data: {} } : world.schedule === "leg"
      ? { status: 200, data: { data: [{ id: "s-1", date: todayVN(), status: "SCHEDULED", programDay: { dayNumber: 1, title: "Leg day", exercises: [{ exercise: { exerciseName: "Barbell Squat", bodyPart: "LOWER_BODY" }, sets: 4, reps: 5 }, { exercise: { exerciseName: "Leg Press", bodyPart: "LOWER_BODY" }, sets: 3, reps: 10 }], program: { name: "Cut 3 ngày/tuần", daysPerWeek: 3 } } }] } }
      : { status: 200, data: { data: [] } },
    "/workouts": world.history === "error" ? { status: 503, data: {} } : { status: 200, data: workouts },
    "/nutrition/daily-history": { status: 200, data: { data: [] } },
    "/nutrition/goals": world.nutritionTarget === "error" ? { status: 503, data: {} } : { status: 200, data: { data: { id: "g-1", status: "ACTIVE", calories: 2400, protein: 150, carbs: 270, fat: 80 } } },
    "/nutrition/plans/current": { status: 404, data: {} },
    "/nutrition": { status: 200, data: [] },
  };
  return fx;
}

export interface RunResult {
  id: string;
  v2run: {
    http: number; handledBy: "V2" | "V1" | "NONE"; status: string; agents: string[]; answer: string; selected: AgentId[] | null; dropped: string[];
    toolsOk: string[]; toolsRefused: string[]; writes: string[]; markersVisible: MarkerKey[]; modelCalls: number; toolCalls: number; deferredDisclosed: boolean;
    runtimeLoaded: boolean; v1Entered: boolean; historyTurns: number; profileReads: number; errorCode?: string;
  };
  v1run: { http: number; answer: string; llmCalls: number; markersInPrompt: MarkerKey[]; readPaths: string[]; ragEntered: boolean; errorCode?: string };
}

export async function createRunner() {
  process.env.LLM_PROVIDER = "mock";
  process.env.DATABASE_URL = "postgresql://nobody:nothing@127.0.0.1:1/never_connected";
  process.env.INTERNAL_SERVICE_SECRET = "test-internal-secret";
  process.env.AI_ASK_RATE_LIMIT_MAX = "100000";
  process.env.LOG_LEVEL = "silent";
  process.env.USER_SERVICE_URL = "http://user-service.m9eval.invalid";
  process.env.FITNESS_SERVICE_URL = "http://fitness-service.m9eval.invalid";
  for (const k of ["RATE_LIMIT_PROVIDER", "USER_LAMBDA_NAME", "FITNESS_LAMBDA_NAME", "AUTH_LAMBDA_NAME", "AI_AGENT_V2", "AI_AGENT_V2_ROUTING_MODE", "AI_COACH_V2_BRIDGE", "AI_COACH_V2_BRIDGE_USERS", "ENABLE_TOOL_CALLING"]) delete process.env[k];

  const trip = { fetch: 0, bedrock: 0, v1Http: [] as string[], v1HttpHosts: new Set<string>(), unexpectedHttp: 0 };
  let currentFixture: Record<string, { status: number; data?: unknown }> = {};
  let currentToken = "";
  const adapter: AxiosAdapter = async (config) => {
    const url = String(config.url ?? "");
    const h = config.headers as unknown as { get?: (k: string) => unknown; Authorization?: unknown };
    const auth = String(h?.get?.("Authorization") ?? h?.Authorization ?? "").replace(/^Bearer /, "");
    const u = new URL(url);
    trip.v1HttpHosts.add(u.host);
    const respond = (status: number, data: unknown): AxiosResponse => {
      const response: AxiosResponse = { data, status, statusText: String(status), headers: {}, config, request: {} };
      if (!config.validateStatus || config.validateStatus(status)) return response;
      throw new AxiosError(`Request failed with status code ${status}`, status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST, config, {}, response);
    };
    if (!BY_TOKEN.has(auth)) return respond(401, {});
    trip.v1Http.push(`${auth === currentToken ? "" : "!"}${u.pathname}`);
    const hit = currentFixture[u.pathname];
    if (hit) return respond(hit.status, hit.data ?? {});
    trip.unexpectedHttp++;
    return respond(404, { error: "not in fixture" });
  };
  axios.defaults.adapter = adapter;
  globalThis.fetch = (async () => { trip.fetch++; throw new Error("network blocked"); }) as typeof fetch;
  const { bedrockRuntimeDeps } = await import("../../services/bedrock.client");
  bedrockRuntimeDeps.send = (async () => { trip.bedrock++; throw new Error("provider blocked"); }) as never;
  const { authServiceClientDeps } = await import("../../clients/auth-service.client");
  authServiceClientDeps.verify = (async (token: string) => {
    const u = BY_TOKEN.get(token);
    if (!u) throw Object.assign(new Error("invalid"), { response: { status: 401 } });
    return { status: 200, data: { user: { id: u.id, role: "CUSTOMER" } } };
  }) as never;
  const { prisma } = await import("../../repositories/conversation.repository");
  const { Prisma } = await import("../../generated/prisma");
  const { installFakePrisma } = await import("../v1-real-path-fakes");
  const models = Object.values(Prisma.ModelName).map((n) => n[0].toLowerCase() + n.slice(1));
  const llm = { calls: 0, prompts: [] as string[], answer: V1_FAKE_ANSWER };
  const { llmService } = await import("../../services/llm.service");
  (llmService as any).callLLM = async (prompt: string) => { llm.calls++; llm.prompts.push(prompt); return { answer: llm.answer, promptTokens: 5, completionTokens: 7, totalTokens: 12 }; };
  (llmService as any).generateEmbedding = async () => { throw new Error("embedding blocked (no Qdrant)"); };
  const { ragService } = await import("../../services/rag.service");
  let ragEntered = 0;
  const origRag = ragService.rag.bind(ragService);
  (ragService as any).rag = (...a: Parameters<typeof origRag>) => { ragEntered++; return origRag(...a); };
  const { profileExtractor } = await import("../../llm/profile_extractor");
  const hz = await import("../m5-benchmark/harness");
  const rt = await import("../../agent-v2-integration/multi-agent-runtime");
  const { default: app } = (await import("../../app")) as { default: Express };
  const { coachBridgeSeam } = await import("../../services/coach-bridge.middleware");
  const realLoader = coachBridgeSeam.loadExecutor;
  let loaderCalls = 0;
  coachBridgeSeam.loadExecutor = async () => { loaderCalls++; return realLoader!(); };
  let db: FakeDb = installFakePrisma(prisma, models);

  const { say, use, call } = hz;
  const traces: SupervisorTrace[] = [];
  const toolEvents: ToolTraceEvent[] = [];
  let rig: { prov: Record<AgentId, MockProvider>; world: ReturnType<typeof hz.world> } | null = null;
  const clock = () => T0;

  function buildV2(c: EvalCase) {
    const world = hz.world(clock, c.world);
    const prov: Record<AgentId, MockProvider> = { training: hz.mockProvider("training"), nutrition: hz.mockProvider("nutrition"), recovery: hz.mockProvider("recovery"), progress: hz.mockProvider("progress") };
    for (const a of ALL_AGENTS) {
      const s = c.v2Script?.[a] ?? { say: `Trả lời mẫu (${a}).` };
      if (s.tools?.length) prov[a].script(use(...s.tools.map((t) => call(t))), say(s.say)); else prov[a].script(say(s.say));
    }
    const runtime = rt.createMultiAgentRuntime({
      providerFor: (a) => prov[a], now: clock,
      deps: { training: world.training, nutrition: world.nutrition, recovery: world.recovery, progress: world.progress },
      traceSink: (x) => traces.push(x), toolTraceSink: (e) => toolEvents.push(e),
    });
    rt.multiAgentRuntimeSeam.factory = () => runtime;
    rig = { prov, world };
  }

  const world0 = (c: EvalCase): WorldState => ({ ...hz.DEFAULT_WORLD, ...(c.world ?? {}) });
  const userOf = (c: EvalCase) => USERS[c.user ?? "A"];
  let n = 0;
  const bodyOf = (c: EvalCase, sessionId?: string) => ({ question: c.question, ...(c.clientRequestId === false ? {} : { clientRequestId: `m9eval-${++n}-00000001` }), ...(sessionId ? { sessionId } : {}) });
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const sessionFor = (c: EvalCase): string | undefined => (c.sessionState === "v1_existing" ? SESSION_V1 : c.otherUsersSession ? SESSION_V1 : undefined);
  const sessionOwner = (c: EvalCase) => (c.otherUsersSession ? USERS.B.id : userOf(c).id);
  const markersIn = (text: string, keys: readonly MarkerKey[]): MarkerKey[] => keys.filter((k) => text.includes(MARKERS[k]));
  const ALL_KEYS = Object.keys(MARKERS) as MarkerKey[];

  async function runV2(c: EvalCase): Promise<RunResult["v2run"]> {
    const u = userOf(c);
    traces.length = 0; toolEvents.length = 0; loaderCalls = 0; ragEntered = 0; llm.calls = 0; llm.prompts.length = 0; llm.answer = c.v1Llm ?? V1_FAKE_ANSWER;
    db = installFakePrisma(prisma, models); profileExtractor.invalidateCache(u.id);
    currentFixture = v1Fixture(world0(c), u.age, c.noProfileWeight === true); currentToken = u.token; trip.v1Http.length = 0;
    process.env.AI_COACH_V2_BRIDGE = "on"; process.env.AI_AGENT_V2 = "on"; // BEFORE building the runtime: the tool registries read the V2 flag at creation
    buildV2(c);
    const store = fakeStore(); const history = fakeHistory();
    const sid = sessionFor(c);
    if (sid) {
      const owner = sessionOwner(c);
      history.sessions.set(sid, { id: sid, userId: owner, archivedAt: null });
      if (c.sessionState === "v1_existing") history.legacyEngines.set(sid, ["v1-model"]);
      db.sessions.push({ id: sid, userId: owner, title: "seed", lastMessageAt: new Date(), archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    }
    coachBridgeSeam.ports = { idempotency: store.store, history: history.history };
    coachBridgeSeam.overrides = { now: clock, userAllowed: () => c.allowlisted !== false };
    try {
      const r = await request(app).post("/ai/ask").set(bearer(u.token)).send(bodyOf(c, sid));
      const d = r.body?.data ?? {};
      const handledBy = r.status !== 200 ? "NONE" : d.engine === "multi-agent-v2" ? "V2" : "V1";
      const tr = traces[traces.length - 1];
      const prov = rig!.prov;
      const visible = markersIn(ALL_AGENTS.map((a) => JSON.stringify(prov[a].requests.map((q: any) => (q.messages ?? []).slice(1)))).join("\n"), ALL_KEYS);
      const answer = String(d.answer ?? "");
      return {
        http: r.status, handledBy, status: String(d.v2?.status ?? (handledBy === "V1" ? "V1_SERVED" : "NONE")), agents: Array.isArray(d.v2?.agents) ? d.v2.agents : [], answer,
        selected: tr?.decision?.agents ?? null, dropped: tr?.decision?.dropped ?? [],
        toolsOk: [...new Set(toolEvents.filter((e) => e.outcome === "ok").map((e) => e.toolId))], toolsRefused: [...new Set(toolEvents.filter((e) => e.outcome !== "ok").map((e) => e.toolId + ":" + e.outcome))],
        writes: rig!.world.calls.filter((x) => x.startsWith("WRITE:")), markersVisible: visible,
        modelCalls: tr?.totals.modelCallCount ?? 0, toolCalls: tr?.totals.toolCallCount ?? 0, deferredDisclosed: /chưa được xử lý trong lượt này/.test(answer),
        runtimeLoaded: loaderCalls > 0, v1Entered: ragEntered > 0, historyTurns: history.turns.length, profileReads: trip.v1Http.filter((p) => p.endsWith("/profile/me")).length - (handledBy === "V1" ? 0 : 0),
        ...(r.status !== 200 ? { errorCode: r.body?.error?.code } : {}),
      };
    } finally { delete process.env.AI_COACH_V2_BRIDGE; delete process.env.AI_AGENT_V2; coachBridgeSeam.ports = null; coachBridgeSeam.overrides = {}; rt.multiAgentRuntimeSeam.factory = null; }
  }

  async function runV1(c: EvalCase): Promise<RunResult["v1run"]> {
    const u = userOf(c);
    ragEntered = 0; llm.calls = 0; llm.prompts.length = 0; llm.answer = c.v1Llm ?? V1_FAKE_ANSWER;
    db = installFakePrisma(prisma, models); profileExtractor.invalidateCache(u.id);
    currentFixture = v1Fixture(world0(c), u.age, c.noProfileWeight === true); currentToken = u.token; trip.v1Http.length = 0;
    const sid = sessionFor(c);
    if (sid) db.sessions.push({ id: sid, userId: sessionOwner(c), title: "seed", lastMessageAt: new Date(), archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const r = await request(app).post("/ai/ask").set(bearer(u.token)).send(bodyOf(c, sid));
    return {
      http: r.status, answer: String(r.body?.data?.answer ?? ""), llmCalls: llm.calls, markersInPrompt: markersIn(llm.prompts.join("\n"), ALL_KEYS),
      readPaths: [...new Set(trip.v1Http.map((p) => p.replace(/^!/, "")))].sort(), ragEntered: ragEntered > 0, ...(r.status !== 200 ? { errorCode: r.body?.error?.code } : {}),
    };
  }

  /** Facts carried by BOTH fixture channels (V2 world deps vs V1 HTTP fixture) for the default world — fixes "no side gets data the other lacks". */
  async function fixtureParity(): Promise<Record<MarkerKey, { v2: boolean; v1: boolean }>> {
    const w = hz.world(clock, {});
    const ctx = { userId: USERS.A.id, authorizationHeader: "Bearer x" } as any;
    const dump: unknown[] = [];
    for (const group of [w.training, w.nutrition, w.recovery, w.progress] as unknown as Array<Record<string, (c: any) => Promise<unknown>>>)
      for (const fn of Object.values(group)) { try { dump.push(await fn(ctx)); } catch { /* writes / errors are not data */ } }
    const v2 = JSON.stringify(dump);
    const v1 = JSON.stringify(v1Fixture({ ...hz.DEFAULT_WORLD }, 30));
    return Object.fromEntries((Object.keys(MARKERS) as MarkerKey[]).map((k) => [k, { v2: v2.includes(MARKERS[k]), v1: v1.includes(MARKERS[k]) }])) as Record<MarkerKey, { v2: boolean; v1: boolean }>;
  }

  async function runAll(): Promise<RunResult[]> {
    const out: RunResult[] = [];
    for (const c of CASES) out.push({ id: c.id, v2run: await runV2(c), v1run: await runV1(c) });
    return out;
  }
  function close() { delete process.env.AI_COACH_V2_BRIDGE; delete process.env.AI_AGENT_V2; }
  return { runAll, runV2, runV1, fixtureParity, trip, close, getDb: () => db };
}
