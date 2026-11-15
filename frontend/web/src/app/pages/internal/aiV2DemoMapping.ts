/**
 * Pure mapping from the local demo API's JSON onto what the demo page shows. No React, no DOM, no network: unit-testable.
 *
 * Honesty rules (owner brief):
 *  - "Executed agents" come ONLY from the real API field `data.agents` (the agents that actually ran). A routing decision in the
 *    server-side trace is shown separately as "chosen / dropped" and is never labelled as executed.
 *  - The deferred-intent notice is derived from the response TEXT that the real route returned; no API metadata is invented.
 *  - turnId / traceId are shown only when the real response carries them.
 */

export interface DemoScenarioTurn { label: string; question: string; sessionId?: string; as: "A" | "B"; noAuth: boolean }
export interface DemoScenario { id: string; group: string; title: string; description: string; expect: string; mocked: string[]; turns: DemoScenarioTurn[] }
export interface DemoScenarioList { banner: string; notice: string; scenarios: DemoScenario[] }

export interface DemoTraceDelegation { agentId: string; completionStatus: string; modelCalls: number; tools: string[] }
export interface DemoTrace { supervisorStatus: string; decision?: { strategy: string; chosen: string[]; dropped: string[]; reasonCodes: string[] }; routingMode?: string; delegations: DemoTraceDelegation[] }
export interface DemoApiTurn {
  label: string;
  request: { question: string; sessionId?: string; actingAs: "A" | "B" | "none" };
  http: { status: number };
  response: { data?: { status: string; answer: string; agents: string[]; turnId?: string; traceId?: string }; error?: { code?: string; message?: string } };
  trace: DemoTrace | null;
}
export interface DemoRunResponse { scenarioId: string; banner: string; notice: string; turns: DemoApiTurn[]; tripwires: { fetch: number; bedrock: number; callLLM: number; unmockedHttp: number }; durationMs: number }

export type StatusTone = "ok" | "partial" | "blocked" | "error";
export interface StatusView { label: string; tone: StatusTone; explanation: string }

const STATUS: Record<string, StatusView> = {
  ANSWERED: { label: "ANSWERED", tone: "ok", explanation: "Đã trả lời." },
  PARTIAL: { label: "PARTIAL", tone: "partial", explanation: "Trả lời một phần: có phần chưa được xử lý hoặc một agent lỗi." },
  SAFETY_BLOCKED: { label: "SAFETY_BLOCKED", tone: "blocked", explanation: "Bị chặn bởi kiểm tra an toàn trước khi gọi agent." },
  MINOR_PROTECTED: { label: "MINOR_PROTECTED", tone: "blocked", explanation: "Hạn chế vì người dùng đã tự khai dưới 18 tuổi; không đọc dữ liệu cá nhân." },
  SESSION_UNAVAILABLE: { label: "SESSION_UNAVAILABLE", tone: "error", explanation: "Không đọc được ngữ cảnh/hạn chế; hệ thống từ chối theo hướng an toàn (fail-closed)." },
  FAILED: { label: "FAILED", tone: "error", explanation: "Agent không trả lời được; thông báo cố định, không bịa nội dung." },
  OUT_OF_SCOPE: { label: "OUT_OF_SCOPE", tone: "partial", explanation: "Ngoài phạm vi của trợ lý." },
  INSUFFICIENT_DATA: { label: "INSUFFICIENT_DATA", tone: "partial", explanation: "Không đủ dữ liệu để trả lời." },
};

export function statusView(status: string | undefined): StatusView {
  if (!status) return { label: "—", tone: "error", explanation: "Không có trạng thái." };
  return STATUS[status] ?? { label: status, tone: "partial", explanation: "Trạng thái do route V2 trả về (không có mô tả riêng trong trang demo)." };
}

/** HTTP-level failures (404 flag off, 401, 400…) have no `data`; show the real error code and a short reading. */
export function httpErrorView(turn: DemoApiTurn): StatusView | null {
  if (turn.response.data) return null;
  const code = turn.response.error?.code ?? "";
  const map: Record<number, string> = { 401: "Chưa đăng nhập hoặc token không hợp lệ.", 403: "Không đủ quyền.", 404: "Route V2 không được phục vụ (cờ AI_AGENT_V2 tắt hoặc production chưa được duyệt).", 400: "Yêu cầu không đúng schema V2.", 503: "Dịch vụ V2 từ chối khởi chạy (fail-closed)." };
  return { label: `HTTP ${turn.http.status}${code ? ` ${code}` : ""}`, tone: "error", explanation: map[turn.http.status] ?? "Lỗi trả về từ route." };
}

/** True when the REAL answer text tells the user some parts were not handled this turn (the supervisor's deferred-intent disclosure). */
export function hasDeferredNotice(answer: string | undefined): boolean {
  return !!answer && /chưa được xử lý trong lượt này/.test(answer);
}

export interface TurnView {
  label: string; question: string; sessionLabel: string; actingAs: string;
  status: StatusView; httpStatus: number;
  executedAgents: string[];          // from the real `data.agents` only
  chosenAgents: string[];            // routing decision (server-side trace) — NOT executed
  droppedAgents: string[];
  delegations: DemoTraceDelegation[]; // what the supervisor trace says actually started
  answer: string; deferredNotice: boolean;
  turnId?: string; traceId?: string;
  routing?: string; routingMode?: string; supervisorStatus?: string;
}

export function mapTurn(t: DemoApiTurn): TurnView {
  const data = t.response.data;
  return {
    label: t.label, question: t.request.question,
    sessionLabel: t.request.sessionId ? t.request.sessionId : "không có sessionId",
    actingAs: t.request.actingAs === "none" ? "không token" : `tài khoản ${t.request.actingAs}`,
    status: httpErrorView(t) ?? statusView(data?.status), httpStatus: t.http.status,
    executedAgents: data ? [...data.agents] : [],
    chosenAgents: t.trace?.decision?.chosen ?? [], droppedAgents: t.trace?.decision?.dropped ?? [],
    delegations: t.trace?.delegations ?? [],
    answer: data?.answer ?? t.response.error?.message ?? "", deferredNotice: hasDeferredNotice(data?.answer),
    ...(data?.turnId ? { turnId: data.turnId } : {}), ...(data?.traceId ? { traceId: data.traceId } : {}),
    ...(t.trace?.decision ? { routing: t.trace.decision.strategy } : {}), ...(t.trace?.routingMode ? { routingMode: t.trace.routingMode } : {}),
    ...(t.trace ? { supervisorStatus: t.trace.supervisorStatus } : {}),
  };
}

export function mapRun(r: DemoRunResponse): { turns: TurnView[]; tripwireTotal: number } {
  const t = r.tripwires;
  return { turns: r.turns.map(mapTurn), tripwireTotal: t.fetch + t.bedrock + t.callLLM + t.unmockedHttp };
}

export const AGENT_LABEL: Record<string, string> = { training: "Training", nutrition: "Nutrition", recovery: "Recovery", progress: "Progress" };
