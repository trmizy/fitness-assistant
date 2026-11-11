// EVIDENCE OBSERVATION (part of the frozen evaluator). Reads what the production stack LOGGED; never infers route from text.
// Join keys: ai-service events carry correlationId = the /ai/ask response's traceId (pino JSON, one object per line).
// Events without a correlationId (ci_v2_llm_interpretation) are attributed by time window, valid because the harness
// runs one turn at a time against one stack.
import { UNOBSERVED } from "./metrics.mjs";

export function parseJsonLines(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s.startsWith("{")) continue; // tsx / framework lines are not evidence
    try { out.push(JSON.parse(s)); } catch { /* partial line at a window edge: ignored, counted by caller if needed */ }
  }
  return out;
}

// Ollama access log (gin): "[GIN] 2026/10/03 - 05:52:16 | 200 | 1.2s | ip | POST "/api/chat""
// Durations are Go-style and COMPOUND above one minute ("2m50s", "1h2m3s"). A previous version matched only one unit and
// silently dropped every slow call, which is exactly the calls that matter (timeouts). Fixed; see evaluator-changelog.md.
const GIN = /\[GIN\] (\d{4})\/(\d{2})\/(\d{2}) - (\d{2}):(\d{2}):(\d{2}) \| (\d{3}) \|\s*([0-9hmsµ.]+) \|.*?(GET|POST|PUT|DELETE|HEAD)\s+"([^"]+)"/;
const DUR_TOKEN = /([0-9.]+)(µs|ms|h|m|s)/g;
const UNIT_MS = { µs: 0.001, ms: 1, s: 1000, m: 60000, h: 3600000 };
export function parseGoDuration(s) {
  let total = 0, matched = 0;
  for (const m of s.matchAll(DUR_TOKEN)) { total += Number(m[1]) * UNIT_MS[m[2]]; matched += m[0].length; }
  return matched === s.length ? total : null; // refuse partial matches instead of guessing
}
export function parseOllamaGin(text, containerOffsetMinutes = 0) {
  const out = [];
  for (const line of text.split("\n")) {
    const m = GIN.exec(line);
    if (!m) continue;
    const durationMs = parseGoDuration(m[8]);
    if (durationMs === null) throw new Error(`UNPARSEABLE_GIN_DURATION "${m[8]}"`);
    const at = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - containerOffsetMinutes * 60000;
    out.push({ at, status: +m[7], durationMs, method: m[9], path: m[10] });
  }
  return out;
}

const last = (arr) => (arr.length ? arr[arr.length - 1] : null);

/**
 * @param aiEvents parsed ai-service events (ALL lines since the turn began, not filtered)
 * @param traceId  the turn's traceId from the /ai/ask response (null for control turns)
 * @param t0,t1    turn wall-clock window, epoch ms (harness clock, same host as the docker logs)
 * @param ollamaCalls parsed Ollama GIN calls (already offset-corrected)
 */
export function observeTurn({ aiEvents, traceId, t0, t1, ollamaCalls }) {
  const byCid = (msg) => (traceId ? aiEvents.filter((e) => e.msg === msg && e.correlationId === traceId) : []);
  const trace = last(byCid("ci_global_trace"));
  const boundary = last(byCid("ci_confirmation_boundary"));
  const llmEv = last(byCid("ci_global_llm_route"));
  const interp = aiEvents.filter((e) => e.msg === "ci_v2_llm_interpretation" && typeof e.time === "number" && e.time >= t0 && e.time <= t1);
  const qwen = ollamaCalls.filter((c) => c.at >= t0 - 1000 && c.at <= t1 + 1000 && (c.path === "/api/chat" || c.path === "/api/generate"));
  // Ollama logs "/api/embeddings" (observed in the live access log), so match the prefix, not an exact path.
  const embed = ollamaCalls.filter((c) => c.at >= t0 - 1000 && c.at <= t1 + 1000 && /^\/api\/embed/.test(c.path));
  const bRoute = boundary && ["CONFIRM", "STATUS"].includes(boundary.intent) ? boundary.intent : null;
  const route = bRoute ?? trace?.route ?? UNOBSERVED;
  const intent = bRoute ?? (trace?.route === "START_WORKFLOW" ? trace?.workflow ?? null : null);
  return {
    route,
    intent,
    traceFound: Boolean(trace),
    deterministicRoute: trace?.deterministicRoute ?? null,
    llm: {
      called: Boolean(trace?.llmCalled),
      rawRoute: llmEv?.llmRoute ?? null,
      accepted: Boolean(llmEv?.accepted),
      acceptedRoute: llmEv?.acceptedRoute ?? null,
      latencyMs: llmEv?.latencyMs ?? null,
      resultReturned: Boolean(llmEv),
      noResult: Boolean(trace?.llmCalled) && !llmEv,
    },
    interpreter: { calls: interp.length, latencyMs: interp.map((e) => e.latencyMs) },
    qwenChatCalls: qwen.length,
    qwenChatLatencyMs: qwen.map((c) => c.durationMs),
    embedCalls: embed.length,
    // Sanitized excerpts for the evidence file: routing ids and decisions only, no message text or profile values.
    evidence: {
      trace: trace ? { route: trace.route, topic: trace.topic ?? null, workflow: trace.workflow ?? null, deterministicRoute: trace.deterministicRoute, llmCalled: trace.llmCalled, llmAccepted: trace.llmAccepted ?? null, workflowStatus: trace.workflowStatus ?? null } : null,
      boundaryIntent: boundary?.intent ?? null,
      llmRoute: llmEv ? { llmRoute: llmEv.llmRoute ?? null, accepted: llmEv.accepted, acceptedRoute: llmEv.acceptedRoute ?? null, latencyMs: llmEv.latencyMs } : null,
    },
  };
}
