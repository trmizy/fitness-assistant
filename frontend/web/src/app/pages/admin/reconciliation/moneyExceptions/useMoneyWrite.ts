/**
 * D7 - the write hook of every money-exception form: ONE request per confirmation, a stable `Idempotency-Key` for a retry of the same body,
 * mapped errors, and the "reload first" rule.
 *
 *  - the key is made on the first submit of a mounted form and REUSED when the same body is sent again (retry after an unknown outcome or a
 *    503); it is renewed after a success or when the body changed; unmount + mount again (the dialog was reopened) = a new key (`useIdempotentAction`);
 *  - a second `submit` while one is in flight is a no-op (a ref lock inside `createIdempotentAction`): a double click sends exactly one request;
 *  - nothing is retried automatically;
 *  - after a conflict, a stale state or an unknown outcome the form keeps its content and refuses to send again until the admin reloads the state.
 */
import { useCallback, useRef, useState } from "react";
import { useIdempotentAction } from "../../disputes/useIdempotentAction";
import type { Answer } from "./moneyExceptionApi";
import { parseMoneyError, type MoneyErrorView } from "./moneyExceptionErrors";

export type SubmitResult<R> = { ok: true; value: Answer<R>; error?: undefined } | { ok: false; error: MoneyErrorView | null; value?: undefined };

export interface MoneyWrite<B, R> {
  pending: boolean;
  error: MoneyErrorView | null;
  /** the last success of this form (kept until the next submit) */
  result: Answer<R> | null;
  /** a blind resend is not allowed until the state was reloaded */
  mustReload: boolean;
  reloading: boolean;
  submit: (body: B, send: (key: string, body: B) => Promise<Answer<R>>) => Promise<SubmitResult<R>>;
  reload: () => Promise<void>;
  clearError: () => void;
}

export function useMoneyWrite<B, R = unknown>(afterWrite: () => Promise<unknown>): MoneyWrite<B, R> {
  const act = useIdempotentAction<B, Answer<R>>();
  const [error, setError] = useState<MoneyErrorView | null>(null);
  const [result, setResult] = useState<Answer<R> | null>(null);
  const [mustReload, setMustReload] = useState(false);
  const [reloading, setReloading] = useState(false);
  const after = useRef(afterWrite);
  after.current = afterWrite;

  const submit = useCallback<MoneyWrite<B, R>["submit"]>(
    async (body, send) => {
      if (mustReload) return { ok: false, error: null };
      const out = await act.run(body, send);
      if (out.status === "busy") return { ok: false, error: null };
      if (out.status === "error") {
        const view = parseMoneyError(out.error, { action: "write" });
        setError(view);
        setResult(null);
        setMustReload(view.mustReload);
        return { ok: false, error: view };
      }
      setError(null);
      setMustReload(false);
      setResult(out.value);
      try {
        await after.current();
      } catch {
        /* the write is done; a failed re-read shows its own banner on the page */
      }
      return { ok: true, value: out.value };
    },
    [act, mustReload],
  );

  const reload = useCallback(async () => {
    setReloading(true);
    try {
      await after.current();
      setMustReload(false);
      setError(null);
      // the key is kept on purpose: if the first attempt DID land, sending the same body again replays its stored answer instead of writing twice
    } catch {
      /* stays blocked: the state could not be re-read */
    } finally {
      setReloading(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { pending: act.pending, error, result, mustReload, reloading, submit, reload, clearError };
}
