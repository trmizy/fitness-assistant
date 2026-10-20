import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction } from "express";

/**
 * Stable identity of ONE user intent (one chat send), established by the client before the request is sent and
 * reused by every retry of that send (e.g. the 401 refresh-and-resend). It is carried as `clientRequestId` in the
 * existing /ai/ask and /ai/ask/stream bodies (no new header: API Gateway CORS config is untouched).
 *
 * It is NOT authorization: it only names a request inside the verified caller's own namespace (the generation
 * operation is unique per verified actor + key) and is bound to the request fingerprint, so reusing it with
 * different input is rejected. A client that sends none (legacy) gets the older, weaker derivation documented in
 * fitness-agent.service.ts.
 */
export type RequestIdentity = { clientRequestId: string | null };

const storage = new AsyncLocalStorage<RequestIdentity>();

const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Mount AFTER requireAuth and body validation. */
export function bindRequestIdentity(req: Request, _res: Response, next: NextFunction): void {
  const raw = (req.body as { clientRequestId?: unknown } | undefined)?.clientRequestId;
  const clientRequestId = typeof raw === "string" && SAFE_ID.test(raw) ? raw : null;
  storage.run({ clientRequestId }, () => next());
}

export function currentClientRequestId(): string | null {
  return storage.getStore()?.clientRequestId ?? null;
}

/** Test seam: run `fn` as if a request carrying `clientRequestId` were being handled. */
export function withClientRequestId<T>(clientRequestId: string | null, fn: () => T): T {
  return storage.run({ clientRequestId }, fn);
}
