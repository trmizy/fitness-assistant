/**
 * Dispute V2.1 admin UI (D1) - one stable `Idempotency-Key` per open form / confirm attempt.
 *
 * Contract (server: same key + same body = the stored answer, same key + other body = 409 IDEMPOTENCY_KEY_REUSED,
 * no key = every call is a NEW operation, so a double click duplicates):
 *  - the key is created on the first `run` of a form and REUSED when the same body is sent again (retry after an error / timeout);
 *  - it is renewed only (a) after a success, (b) when `reset()` is called (the form was reopened), (c) when the body changed;
 *  - a lock makes a second `run` while one is in flight a no-op (`status:"busy"`, nothing is sent): double click = one request;
 *  - nothing is retried automatically: whether to retry (and after reloading the case) is the user's click.
 *
 * `createIdempotentAction` is plain TypeScript (tested under `npx tsx --test`); `useIdempotentAction` is the thin React wrapper.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const KEY_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

/** crypto.randomUUID (insecure origins such as a LAN http URL may lack it, hence the getRandomValues fallback). */
export function newIdempotencyKey(): string {
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else throw new Error("NO_SECURE_RANDOM"); // never fall back to Math.random for a money-affecting key
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** JSON with sorted keys and without `undefined`, so {a:1,b:2} and {b:2,a:1} are the same body. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v === undefined ? null : v)).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export type RunOutcome<R> = { status: "ok"; value: R; key: string } | { status: "error"; error: unknown; key: string } | { status: "busy" };

export interface IdempotentAction<B, R> {
  /** Send `body` with the current key. Resolves, never throws. */
  run(body: B, send: (key: string, body: B) => Promise<R>): Promise<RunOutcome<R>>;
  /** The form was reopened: the next run gets a fresh key. */
  reset(): void;
  readonly pending: boolean;
  /** The key the next run would use for `body` (null = a new one will be made). Test/diagnostic only. */
  peekKey(body: B): string | null;
}

export function createIdempotentAction<B = unknown, R = unknown>(options?: { newKey?: () => string; onPendingChange?: (pending: boolean) => void }): IdempotentAction<B, R> {
  const mint = options?.newKey ?? newIdempotencyKey;
  let key: string | null = null;
  let fingerprint: string | null = null;
  let inFlight = false;

  const setPending = (p: boolean) => {
    inFlight = p;
    options?.onPendingChange?.(p);
  };

  return {
    async run(body, send) {
      if (inFlight) return { status: "busy" }; // ref lock: the second click sends nothing
      const fp = stableStringify(body);
      if (key === null || fingerprint !== fp) {
        key = mint();
        fingerprint = fp;
      }
      const used = key;
      if (!KEY_RE.test(used)) return { status: "error", error: new Error("INVALID_IDEMPOTENCY_KEY"), key: used };
      setPending(true);
      try {
        const value = await send(used, body);
        key = null; // success: the next attempt is a new operation
        fingerprint = null;
        return { status: "ok", value, key: used };
      } catch (error) {
        // failure (or unknown outcome): keep the key, a retry of the SAME body must replay, not duplicate
        return { status: "error", error, key: used };
      } finally {
        setPending(false);
      }
    },
    reset() {
      if (inFlight) return; // never drop the key of a request that is still out
      key = null;
      fingerprint = null;
    },
    get pending() {
      return inFlight;
    },
    peekKey(body) {
      return key !== null && fingerprint === stableStringify(body) ? key : null;
    },
  };
}

export interface UseIdempotentAction<B, R> {
  run: (body: B, send: (key: string, body: B) => Promise<R>) => Promise<RunOutcome<R>>;
  reset: () => void;
  pending: boolean;
}

/** One instance per mounted form/dialog: unmount + mount again = a new key (the form was reopened). */
export function useIdempotentAction<B = unknown, R = unknown>(): UseIdempotentAction<B, R> {
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const action = useMemo(
    () =>
      createIdempotentAction<B, R>({
        onPendingChange: (p) => {
          if (mounted.current) setPending(p);
        },
      }),
    [],
  );
  const run = useCallback((body: B, send: (key: string, body: B) => Promise<R>) => action.run(body, send), [action]);
  const reset = useCallback(() => action.reset(), [action]);
  return { run, reset, pending };
}
