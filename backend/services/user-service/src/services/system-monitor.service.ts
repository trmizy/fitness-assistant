import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

/**
 * Per-service health probe for GET /admin/system-monitor on AWS. The gateway's version probes HTTP
 * URLs, which do not exist there; here every backend Lambda is invoked directly with a synthetic
 * `GET /health` event. A service this Lambda is not allowed to invoke (IAM: lambda:InvokeFunction on
 * that function) is reported as "degraded" with that exact reason and marked optional — never as a
 * fake "healthy" — so it neither inflates nor drags down the core health score.
 */
export interface ProbeResult {
  key: string; name: string; status: "healthy" | "degraded" | "down";
  statusCode: number; latencyMs: number; uptimeSeconds: number | null;
  timestamp: string; error: string | null; optional: boolean;
}

export interface MonitorTarget { key: string; name: string; functionName: string | null; self?: boolean }

export function monitorTargets(authLambdaName: string | undefined, selfFunctionName: string | undefined): MonitorTarget[] {
  const base = (authLambdaName ?? "").replace(/-auth$/, "");
  const fn = (svc: string) => (base ? `${base}-${svc}` : null);
  return [
    { key: "auth", name: "Auth Service", functionName: authLambdaName ?? fn("auth") },
    { key: "user", name: "User Service", functionName: selfFunctionName ?? fn("user"), self: true },
    { key: "fitness", name: "Fitness Service", functionName: fn("fitness") },
    { key: "gym", name: "Gym Service", functionName: fn("gym") },
    { key: "payment", name: "Payment Service", functionName: fn("payment") },
    { key: "ai", name: "AI Service", functionName: fn("ai") },
  ];
}

export function interpretHealthEnvelope(envelope: { statusCode?: number; body?: string } | null | undefined) {
  const statusCode = typeof envelope?.statusCode === "number" ? envelope.statusCode : 0;
  let body: any = {};
  try { body = envelope?.body ? JSON.parse(envelope.body) : {}; } catch { body = {}; }
  const healthy = statusCode > 0 && statusCode < 400 && (body.status === "ok" || body.status === "healthy");
  return { statusCode, healthy, uptimeSeconds: typeof body.uptime === "number" ? body.uptime : null };
}

let client: LambdaClient | null = null;
const lambda = () => (client ??= new LambdaClient({ region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION }));
const HEALTH_EVENT = { version: "2.0", routeKey: "GET /health", rawPath: "/health", rawQueryString: "", headers: {}, requestContext: { http: { method: "GET", path: "/health" } } };

async function probeOne(t: MonitorTarget): Promise<ProbeResult> {
  const started = Date.now();
  const base = { key: t.key, name: t.name, uptimeSeconds: null as number | null, optional: false };
  const now = () => new Date().toISOString();
  if (t.self) return { ...base, status: "healthy", statusCode: 200, latencyMs: 0, timestamp: now(), error: null };
  if (!t.functionName) {
    return { ...base, optional: true, status: "degraded", statusCode: 0, latencyMs: 0, timestamp: now(), error: "Chưa biết tên Lambda để dò" };
  }
  try {
    const res = await lambda().send(
      new InvokeCommand({ FunctionName: t.functionName, InvocationType: "RequestResponse", Payload: Buffer.from(JSON.stringify(HEALTH_EVENT)) }),
      { abortSignal: AbortSignal.timeout(5000) },
    );
    const latencyMs = Date.now() - started;
    if (res.FunctionError) return { ...base, status: "down", statusCode: 0, latencyMs, timestamp: now(), error: "Lambda trả lỗi khi khởi động/chạy (FunctionError)" };
    const envelope = JSON.parse(Buffer.from(res.Payload ?? []).toString("utf8") || "null");
    const r = interpretHealthEnvelope(envelope);
    return {
      ...base, status: r.healthy ? "healthy" : "degraded", statusCode: r.statusCode, latencyMs,
      uptimeSeconds: r.uptimeSeconds, timestamp: now(), error: r.healthy ? null : `Health endpoint returned status ${r.statusCode}`,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - started;
    if (err?.name === "AccessDeniedException") {
      return { ...base, optional: true, status: "degraded", statusCode: 0, latencyMs, timestamp: now(),
        error: `Chưa dò được: user Lambda chưa có quyền lambda:InvokeFunction trên ${t.functionName}` };
    }
    return { ...base, status: "down", statusCode: 0, latencyMs, timestamp: now(), error: err?.message || "Health check failed" };
  }
}

export const systemMonitorService = {
  probeAll(): Promise<ProbeResult[]> {
    const targets = monitorTargets(process.env.AUTH_LAMBDA_NAME, process.env.AWS_LAMBDA_FUNCTION_NAME);
    return Promise.all(targets.map(probeOne));
  },
};

export function buildMonitorSummary(probes: ProbeResult[]) {
  const core = probes.filter((s) => !s.optional);
  const coreHealthy = core.filter((s) => s.status === "healthy").length;
  return {
    serviceCount: probes.length,
    healthyCount: probes.filter((s) => s.status === "healthy").length,
    degradedCount: probes.filter((s) => s.status === "degraded").length,
    downCount: probes.filter((s) => s.status === "down").length,
    healthScore: core.length > 0 ? Math.round((coreHealthy / core.length) * 100) : 0,
    recentErrors: probes.filter((s) => s.status !== "healthy").map((s) => ({
      level: s.status === "down" ? "error" : "warning",
      service: s.name,
      message: s.error || "Unknown issue",
      time: new Date(s.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    })),
  };
}
