/**
 * D6 - shared pieces of the gym case write forms: the write hook (one idempotent POST per confirm, gym error mapping, reload-first rule)
 * and a few shells. The look (fields, buttons, confirm dialog, error box) is the D3 kit, imported read-only; only what differs for gym lives here.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { fieldErrorsFromView } from "../disputes/actions/actionModel";
import { mustReloadFirst } from "../disputes/disputeCaseErrors";
import { FOCUS, MutedLine, type Reload, type WriteState } from "../disputes/actions/actionKit";
import { useIdempotentAction } from "../disputes/useIdempotentAction";
import { parseGymError, type GymErrorView } from "./gymCaseErrors";

export { ActionButton, ButtonRow, Check, ConfirmModal, ErrorBox, Field, FormCard, MutedLine, ResultNote, SlotNotes, TextArea, Select, counter, describedBy, useSlotNotes, useCloseOnResult } from "../disputes/actions/actionKit";
export type { PushNote, WriteState } from "../disputes/actions/actionKit";

/**
 * One instance per form. `submit` = one POST with a stable Idempotency-Key (same body -> same key on retry, new key after a success or a changed
 * body). Nothing is retried automatically. After a success the case is re-read (`onChanged`). After CASE_VERSION_CONFLICT, a state refusal or
 * an unknown outcome the form KEEPS its content and asks for an explicit reload before it may be sent again.
 */
export function useGymWrite<B, R>(onChanged: Reload): WriteState<B, R> {
  const act = useIdempotentAction<B, R>();
  const [error, setError] = useState<GymErrorView | null>(null);
  const [result, setResult] = useState<R | null>(null);
  const [mustReload, setMustReload] = useState(false);
  const [reloading, setReloading] = useState(false);
  const last = useRef<{ body: B; send: (key: string, body: B) => Promise<R> } | null>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const submit = useCallback<WriteState<B, R>["submit"]>(
    async (body, send) => {
      last.current = { body, send };
      const out = await act.run(body, send);
      if (out.status === "busy") return { ok: false, error: null };
      if (out.status === "error") {
        const view = parseGymError(out.error, { action: "write" });
        setError(view);
        setResult(null);
        setMustReload(mustReloadFirst(view));
        return { ok: false, error: view };
      }
      setError(null);
      setMustReload(false);
      setResult(out.value);
      try {
        await changed.current();
      } catch {
        /* the write is done; a failed re-read shows its own banner on the page */
      }
      return { ok: true, value: out.value };
    },
    [act],
  );

  const retry = useCallback(() => {
    const l = last.current;
    if (l) void submit(l.body, l.send);
  }, [submit]);

  const reload = useCallback(async () => {
    setReloading(true);
    try {
      await changed.current();
      setMustReload(false);
      setError(null);
    } catch {
      /* page-level banner */
    } finally {
      setReloading(false);
    }
  }, []);

  return {
    pending: act.pending,
    error,
    fieldErrors: fieldErrorsFromView(error),
    result,
    mustReload,
    reloading,
    submit,
    retry,
    reload,
    clear: () => setError(null),
    clearResult: () => setResult(null),
    onEdit: () => {
      setResult(null);
      setError((e) => (e && e.kind === "validation" ? null : e));
    },
  };
}

/** A single-line input on the admin tokens (the D3 kit has only textarea and select). */
export function TextInput({
  id,
  value,
  onChange,
  error,
  hint,
  placeholder,
  disabled,
  mono,
  inputMode,
  maxLength,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  hint?: boolean;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
  inputMode?: "text" | "numeric";
  maxLength?: number;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  return (
    <input
      id={id}
      type="text"
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      inputMode={inputMode}
      maxLength={maxLength}
      autoComplete="off"
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      className={`block min-h-11 w-full rounded-lg border bg-adm-surface px-3 py-2 text-sm text-adm-text placeholder:text-adm-text-2 disabled:opacity-60 xl:min-h-9 ${mono ? "font-mono" : ""} ${error ? "border-st-danger" : "border-adm-border"} ${FOCUS}`}
    />
  );
}

/** Why a form is not drawn (muted). Nothing when the whole write layer is off: the page shows one note for that. */
export function GateLine({ why, testId }: { why: string | null; testId?: string }) {
  if (!why) return null;
  return <MutedLine testId={testId ?? "d6-gate"}>{why}</MutedLine>;
}

export function Group({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <section aria-label={title} data-testid={testId} className="space-y-3">
      <h3 className="text-sm font-semibold text-adm-text">{title}</h3>
      {children}
    </section>
  );
}
