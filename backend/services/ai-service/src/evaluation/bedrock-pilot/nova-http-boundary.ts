import { AsyncLocalStorage } from "node:async_hooks";
import type { BedrockRuntimeClient, ConverseCommandInput } from "@aws-sdk/client-bedrock-runtime";
import { PilotError } from "./config";
import { digest } from "../evaluation-kit/identity";
import { NOVA_MODEL, serializeNova } from "./nova-converse-transport";
import { assertNovaHttpDestination, assertNovaSigningScope } from "./nova-endpoint";
import { novaAuthorityClock, novaAuthorityLatch } from "./nova-clock";

/** These values come from the session AFTER its signature, pins and issued-ledger checks. Not an authorization issuer. */
export interface NovaHttpSessionBinding {
  readonly approvalId: string;
  readonly approvalHash: string;
  readonly configHash: string;
  readonly ledgerDirectory: string;
  readonly approvalExpiresAt: string;
  readonly inferenceReleaseExpiresAt: string | null;
  readonly scope: "MEASURE_ONLY" | "INFERENCE_ONLY" | "ONE_SHOT";
}
export interface NovaHttpAuthorization {
  readonly binding: NovaHttpSessionBinding;
  readonly phase: "MEASURE" | "INFERENCE";
  readonly reservationId: string;
  readonly reservationOrdinal: number;
  readonly promptHash: string;
  readonly tokenPayloadHash: string;
  readonly requestHash: string;
  /** Synchronous session closure checking the matching durable reservation and current session authority. */
  readonly assertCurrent: (request: NovaHttpAuthorization) => void;
}

function current(binding: NovaHttpSessionBinding, phase: NovaHttpAuthorization["phase"], now: number): void {
  const approval = Date.parse(binding.approvalExpiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(approval)) throw new PilotError("NOVA_HTTP_CLOCK_OR_AUTHORITY_INVALID");
  if (approval <= now) throw new PilotError("LiveNotApproved");
  if (phase === "INFERENCE" && binding.scope === "INFERENCE_ONLY") {
    if (!binding.inferenceReleaseExpiresAt) throw new PilotError("INFERENCE_RELEASE_REQUIRED");
    const release = Date.parse(binding.inferenceReleaseExpiresAt);
    if (!Number.isFinite(release) || release > approval) throw new PilotError("INFERENCE_RELEASE_INVALID");
    if (release <= now) throw new PilotError("INFERENCE_RELEASE_EXPIRED");
  }
}

function assertSynchronousAuthority(authority: NovaHttpAuthorization): void {
  if (authority.assertCurrent(authority) !== undefined) throw new PilotError("NOVA_HTTP_ASYNC_AUTHORITY_FORBIDDEN");
}

/**
 * Per-client/per-send context, never a global "current approval". The wrapper is the final SDK handler boundary,
 * independent of middleware names/order. It does not guard STS/IMDS/SSO credential-provider IO or network-byte timing.
 */
export function installNovaHttpBoundary(client: BedrockRuntimeClient, expected: NovaHttpSessionBinding) {
  if (!expected || !expected.approvalId || !/^[a-f0-9]{64}$/.test(expected.approvalHash) ||
      !/^[a-f0-9]{64}$/.test(expected.configHash) || !expected.ledgerDirectory ||
      !["MEASURE_ONLY", "INFERENCE_ONLY", "ONE_SHOT"].includes(expected.scope)) throw new PilotError("NOVA_HTTP_SESSION_REQUIRED");
  const binding = Object.freeze({ ...expected }), bindingHash = digest(binding);
  const matchesBinding = (value: unknown) => { try { return digest(value) === bindingHash; } catch { return false; } };
  const delegate = client.config.requestHandler;
  if (!delegate || typeof delegate.handle !== "function") throw new PilotError("NOVA_HTTP_HANDLER_REQUIRED");
  const dispatchHttp = delegate.handle.bind(delegate);
  const clock = novaAuthorityClock(), authorityLatch = novaAuthorityLatch(); // one context per guarded client/session
  const context = new AsyncLocalStorage<{
    authorization: NovaHttpAuthorization; bodyHash: string; signal: AbortSignal; dispatched: boolean;
  }>();
  const reservations = new Set<string>();
  const handle: typeof delegate.handle = (request, options) => {
    const active = context.getStore();
    if (!active) throw new PilotError("NOVA_HTTP_AUTHORIZATION_REQUIRED");
    const { authorization: authority } = active;
    if (!matchesBinding(authority.binding)) throw new PilotError("NOVA_HTTP_AUTHORITY_MISMATCH");
    // Snapshot destination, signed headers, query and bytes once. A retained/mutable SDK request cannot redirect it.
    const headers = Object.freeze({ ...request.headers });
    const destination = Object.freeze({ ...request, headers, query: Object.freeze({ ...request.query }) });
    const signature = Object.entries(headers).find(([name]) => name.toLowerCase() === "authorization")?.[1];
    if (typeof signature !== "string" || !signature.startsWith("AWS4-HMAC-SHA256 ")) throw new PilotError("NOVA_HTTP_UNSIGNED_REQUEST");
    assertNovaHttpDestination(destination);
    assertNovaSigningScope(headers, "bedrock");
    let body: unknown, requestPath: string;
    try {
      const raw = typeof destination.body === "string" ? destination.body : destination.body instanceof Uint8Array ?
        Buffer.from(destination.body.buffer, destination.body.byteOffset, destination.body.byteLength).toString("utf8") : null;
      if (raw === null) throw new Error("unsupported body");
      body = JSON.parse(raw); requestPath = decodeURIComponent(destination.path);
      // The installed SDK emits compact JSON. Reject duplicate-key/ambiguous encodings rather than normalizing them.
      if (JSON.stringify(body) !== raw) throw new Error("noncanonical JSON body");
    } catch { throw new PilotError("NOVA_HTTP_REQUEST_MISMATCH"); }
    if (destination.method !== "POST" || requestPath !== `/model/${NOVA_MODEL}/converse` || digest(body) !== active.bodyHash) throw new PilotError("NOVA_HTTP_REQUEST_MISMATCH");
    const immutableRequest = Object.freeze({ ...destination, body: JSON.stringify(body) });
    if (active.signal.aborted || (options && "abortSignal" in options && options.abortSignal?.aborted)) { const error = new Error("Aborted"); error.name = "AbortError"; throw error; }
    // Every HTTP attempt, including SDK-internal retries, rechecks expiry. No await or middleware after this check.
    // P1 fix: observe the clock and judge the signed deadlines BEFORE the throwable session callback; any observed
    // expiry or rollback latches this guarded client permanently (a later wall-clock rollback cannot revive it).
    authorityLatch.check(clock, (now) => { current(binding, authority.phase, now); assertSynchronousAuthority(authority); current(binding, authority.phase, clock()); });
    if (active.dispatched) throw new PilotError("NOVA_HTTP_DISPATCH_REPLAY");
    active.dispatched = true;
    return dispatchHttp(immutableRequest, options).then(result => {
      if (result.response.statusCode >= 300 && result.response.statusCode < 400) throw new PilotError("NOVA_HTTP_REDIRECT_FORBIDDEN");
      return result;
    });
  };
  // Forward handler configuration/lifecycle methods with the original receiver (including lazily resolved handlers).
  const guarded = new Proxy(delegate, { get(target, key) {
    if (key === "handle") return handle;
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  Object.defineProperty(client.config, "requestHandler", { value: guarded, writable: false, configurable: false, enumerable: true });

  return {
    run<T>(input: ConverseCommandInput, signal: AbortSignal, supplied: NovaHttpAuthorization | undefined, send: (frozenInput: ConverseCommandInput) => Promise<T>): Promise<T> {
      if (!supplied || typeof supplied.assertCurrent !== "function") throw new PilotError("NOVA_HTTP_AUTHORIZATION_REQUIRED");
      if (!matchesBinding(supplied.binding)) throw new PilotError("NOVA_HTTP_AUTHORITY_MISMATCH");
      if (!["MEASURE", "INFERENCE"].includes(supplied.phase) ||
          (binding.scope === "MEASURE_ONLY" && supplied.phase !== "MEASURE") ||
          (binding.scope === "INFERENCE_ONLY" && supplied.phase !== "INFERENCE")) throw new PilotError("NOVA_HTTP_PHASE_MISMATCH");
      if (!supplied.reservationId || !Number.isSafeInteger(supplied.reservationOrdinal) || supplied.reservationOrdinal < 1 ||
          !/^[a-f0-9]{64}$/.test(supplied.promptHash)) throw new PilotError("NOVA_HTTP_RESERVATION_INVALID");
      const inputCopy = JSON.parse(JSON.stringify(input)) as ConverseCommandInput, wire = serializeNova(inputCopy);
      if (wire.identity.tokenPayloadHash !== supplied.tokenPayloadHash || wire.identity.inferenceRequestHash !== supplied.requestHash ||
          (supplied.phase === "MEASURE" && inputCopy.inferenceConfig?.maxTokens !== 1)) throw new PilotError("NOVA_HTTP_REQUEST_MISMATCH");
      const authority = Object.freeze({ ...supplied, binding });
      const slot = `${authority.phase}:${authority.reservationOrdinal}`;
      if (reservations.has(slot)) throw new PilotError("NOVA_HTTP_RESERVATION_REPLAY");
      authorityLatch.check(clock, (now) => { current(binding, authority.phase, now); assertSynchronousAuthority(authority); current(binding, authority.phase, clock()); });
      if (client.config.requestHandler !== guarded) throw new PilotError("NOVA_HTTP_HANDLER_REPLACED");
      reservations.add(slot);
      const { modelId: _model, ...body } = inputCopy;
      return context.run({ authorization: authority, bodyHash: digest(body), signal, dispatched: false }, () => send(inputCopy));
    },
  };
}
