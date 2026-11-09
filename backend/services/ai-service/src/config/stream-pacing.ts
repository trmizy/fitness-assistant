/**
 * Typing-effect pacing for POST /ai/ask/stream.
 *
 * The coach answer is complete before the first token event goes out (the
 * answer validator may still replace the model's text, so raw model tokens are
 * never streamed). The controller therefore re-chunks the final answer with a
 * short delay so the client renders it as typing.
 *
 * That delay only makes sense when every write reaches the client as it
 * happens. Behind a transport that buffers the whole response — the
 * serverless-http Lambda behind API Gateway (lambda.ts) — nobody sees the
 * typing, and the delay is pure added latency inside the Lambda's ~29 s budget
 * (about 9 s for a 2,000-character answer). Such a transport calls
 * `markResponseTransportBuffered()` once at startup, and the answer is then
 * sent as a single token event. Clients already concatenate token events, so
 * the rendered text is identical.
 *
 * On a live transport (local Express, the response-streaming Lambda in
 * stream-lambda.ts behind CloudFront) the stream also carries an SSE comment
 * heartbeat while the answer is being prepared: the model call can be silent
 * for ~25 s, and CloudFront drops an origin that sends nothing for its
 * response timeout. Clients ignore every line that does not start with
 * "data: ", so the heartbeat is invisible to them.
 */

export interface StreamPacing {
  chunkSize: number;
  intervalMs: number;
  heartbeatMs: number;
}

const STREAMING_PACING: StreamPacing = { chunkSize: 4, intervalMs: 18, heartbeatMs: 10_000 };

let responseTransportBuffered = false;

/** Called by an entrypoint whose response is delivered to the client in one piece. */
export function markResponseTransportBuffered(): void {
  responseTransportBuffered = true;
}

/** Pacing to apply, or `null` to send the whole answer in one token event (no heartbeat). */
export function streamPacing(): StreamPacing | null {
  return responseTransportBuffered ? null : STREAMING_PACING;
}

/** Test-only: restore the default (streaming) transport. */
export function resetStreamPacingForTests(): void {
  responseTransportBuffered = false;
}
