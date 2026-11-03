/**
 * D3 - shared pieces of the Case Workspace write forms: the write hook (one idempotent POST per confirm, mapped errors, reload-first
 * rule), field/input shells, buttons, result and error notes, and the two-step confirm dialog.
 * Admin tokens only (no hex, no zinc/amber). Every control has a >= 44px tap target on phones.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowClockwiseIcon, CheckCircleIcon, CircleNotchIcon, InfoIcon, WarningIcon } from "@phosphor-icons/react";
import { useModalA11y } from "../../shared/useModalA11y";
import { canOfferRetry, mustReloadFirst, parseDisputeError, type DisputeErrorView } from "../disputeCaseErrors";
import { useIdempotentAction } from "../useIdempotentAction";
import { fieldErrorsFromView, type Errors } from "./actionModel";

export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)]";
const CONTROL = `block w-full rounded-lg border border-adm-border bg-adm-surface px-3 text-sm text-adm-text placeholder:text-adm-text-2 disabled:opacity-60 ${FOCUS}`;

// ───────────────────────────────────────────────────────── write hook ──
export type Reload = () => void | Promise<unknown>;

export interface WriteState<B, R> {
  pending: boolean;
  error: DisputeErrorView | null;
  /** server `fields[]` of a 400, as { fieldName: Vietnamese message } */
  fieldErrors: Errors;
  /** the last success (kept until the next submit) */
  result: R | null;
  /** a blind resend is not allowed until the case was reloaded (conflict, unknown outcome, state refusal) */
  mustReload: boolean;
  reloading: boolean;
  submit: (body: B, send: (key: string, body: B) => Promise<R>) => Promise<{ ok: true; value: R } | { ok: false; error: DisputeErrorView | null }>;
  retry: () => void;
  reload: () => Promise<void>;
  clear: () => void;
  clearResult: () => void;
  /** call from every field's onChange: drops a stale validation error and the previous success note */
  onEdit: () => void;
}

/**
 * One instance per form. `submit` = one POST with a stable Idempotency-Key (same body -> same key on retry, new key after a success or a
 * changed body). Nothing is retried automatically. After a success the case is re-read (`onChanged`). After CASE_VERSION_CONFLICT, a
 * state refusal or an unknown outcome the form KEEPS its content and asks for an explicit "Tải lại hồ sơ" before it may be sent again.
 */
export function useWrite<B, R>(onChanged: Reload): WriteState<B, R> {
  const act = useIdempotentAction<B, R>();
  const [error, setError] = useState<DisputeErrorView | null>(null);
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
        const view = parseDisputeError(out.error, { action: "write" });
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
    } catch {
      /* page-level banner */
    } finally {
      setReloading(false);
      setMustReload(false);
      setError(null);
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

// ───────────────────────────────────────────────────────────── layout ──
export function ActionGroup({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-testid={testId} className="space-y-3">
      <h3 id={id} className="text-sm font-semibold text-adm-text">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function FormCard({ title, caption, testId, children }: { title: string; caption?: ReactNode; testId: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-testid={testId} className="space-y-3 rounded-xl border border-adm-border bg-adm-surface p-4 shadow-adm-card">
      <div>
        <h4 id={id} className="text-sm font-semibold text-adm-text">
          {title}
        </h4>
        {caption && <p className="mt-0.5 text-xs text-adm-text-2">{caption}</p>}
      </div>
      {children}
    </section>
  );
}

export function MutedLine({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p data-testid={testId} className="flex items-start gap-2 text-xs text-adm-text-2">
      <InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

const NOTE_TONE = {
  success: "border-st-success-border bg-st-success-bg text-st-success",
  warning: "border-st-warning-border bg-st-warning-bg text-st-warning",
  info: "border-st-info-border bg-st-info-bg text-st-info",
  danger: "border-st-danger-border bg-st-danger-bg text-st-danger",
} as const;

/** A result that stays on screen after a write (role=status). `warning` = done but NOT a success of the whole flow. */
export function ResultNote({ tone = "success", children, testId }: { tone?: keyof typeof NOTE_TONE; children: ReactNode; testId?: string }) {
  const Icon = tone === "success" ? CheckCircleIcon : tone === "info" ? InfoIcon : WarningIcon;
  return (
    <div role="status" data-testid={testId} className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${NOTE_TONE[tone]}`}>
      <Icon className="mt-0.5 size-4 shrink-0" weight="fill" aria-hidden />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

export interface SlotNote {
  id: number;
  tone: "success" | "warning" | "info";
  text: string;
  testId: string;
}
export type PushNote = (n: Omit<SlotNote, "id">) => void;

/** Results that must outlive the form that produced them (the write moved the case, so the form is gone after the re-read). */
export function useSlotNotes() {
  const [notes, setNotes] = useState<SlotNote[]>([]);
  const seq = useRef(0);
  const push = useCallback<PushNote>((n) => setNotes((cur) => [...cur.slice(-2), { ...n, id: ++seq.current }]), []);
  return { notes, push };
}
export function SlotNotes({ notes }: { notes: SlotNote[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const count = notes.length;
  // The write moved the case, so the form that had keyboard focus may be gone: give focus to the result instead of dropping it on <body>.
  useEffect(() => {
    if (count === 0) return;
    const raf = requestAnimationFrame(() => {
      const a = document.activeElement;
      if (!a || a === document.body) ref.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [count]);
  if (notes.length === 0) return null;
  return (
    <div ref={ref} tabIndex={-1} className="space-y-2 outline-none" data-testid="d3-slot-notes">
      {notes.map((n) => (
        <ResultNote key={n.id} tone={n.tone} testId={n.testId}>
          {n.text}
        </ResultNote>
      ))}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── fields ──
export function Field({
  id,
  label,
  error,
  hint,
  required,
  count,
  max,
  children,
}: {
  id: string;
  label: string;
  error?: string | null;
  hint?: ReactNode;
  required?: boolean;
  /** trimmed length of the value, to show "n/max" */
  count?: number;
  max?: number;
  children: ReactNode;
}) {
  const over = typeof count === "number" && typeof max === "number" && count > max;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <label htmlFor={id} className="text-xs font-semibold text-adm-text">
          {label}
          {required ? <span className="ml-1 font-normal text-adm-text-2">(bắt buộc)</span> : null}
        </label>
        {typeof count === "number" && typeof max === "number" && (
          <span className={`text-[11px] tabular-nums ${over ? "font-semibold text-st-danger" : "text-adm-text-2"}`} aria-hidden>
            {count}/{max}
          </span>
        )}
      </div>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-adm-text-2">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} data-testid={`${id}-err`} className="flex items-start gap-1 text-xs font-medium text-st-danger">
          <WarningIcon className="mt-px size-3.5 shrink-0" weight="fill" aria-hidden />
          <span className="min-w-0 break-words">{error}</span>
        </p>
      )}
    </div>
  );
}

export const describedBy = (id: string, hasError: boolean, hasHint = false) =>
  [hasHint ? `${id}-hint` : null, hasError ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;

export function TextArea({ id, value, onChange, error, rows = 3, hint, disabled, placeholder }: { id: string; value: string; onChange: (v: string) => void; error?: string | null; rows?: number; hint?: boolean; disabled?: boolean; placeholder?: string }) {
  return (
    <textarea
      id={id}
      value={value}
      rows={rows}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, !!error, !!hint)}
      className={`${CONTROL} min-h-24 py-2 ${error ? "border-st-danger" : ""}`}
    />
  );
}

export function Select({
  id,
  value,
  onChange,
  options,
  placeholder,
  error,
  disabled,
  hint,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  error?: string | null;
  disabled?: boolean;
  hint?: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, !!error, !!hint)}
      className={`${CONTROL} min-h-11 py-2 xl:min-h-9 ${error ? "border-st-danger" : ""}`}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Check({ id, checked, onChange, label, help, error, disabled }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; help?: string; error?: string | null; disabled?: boolean }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg py-1.5 text-sm text-adm-text xl:min-h-9">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, !!error, !!help)}
          className={`mt-0.5 size-5 shrink-0 accent-[var(--adm-focus)] ${FOCUS}`}
        />
        <span className="min-w-0 break-words">{label}</span>
      </label>
      {help && (
        <p id={`${id}-hint`} className="pl-8 text-xs text-adm-text-2">
          {help}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="pl-8 text-xs font-medium text-st-danger">
          {error}
        </p>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────── buttons ──
type Variant = "primary" | "danger" | "outline";
const VARIANT: Record<Variant, string> = {
  primary: "bg-st-success text-adm-bg hover:brightness-95 border border-transparent",
  danger: "bg-st-danger text-adm-bg hover:brightness-95 border border-transparent",
  outline: "border border-adm-border bg-adm-surface text-adm-text hover:bg-adm-surface-2",
};

export function ActionButton({
  children,
  onClick,
  variant = "primary",
  disabled,
  pending,
  testId,
  type = "button",
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: Variant;
  disabled?: boolean;
  pending?: boolean;
  testId?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      // While a request is in flight the button is NOT `disabled` (a disabled button drops keyboard focus to <body>): it is aria-disabled
      // and a click does nothing; the write hook has its own lock as well.
      onClick={() => {
        if (!pending) onClick();
      }}
      disabled={disabled}
      aria-busy={pending ? true : undefined}
      aria-disabled={pending ? true : undefined}
      data-testid={testId}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-wait aria-disabled:opacity-70 motion-reduce:transition-none xl:min-h-9 ${VARIANT[variant]} ${FOCUS}`}
    >
      {pending && <CircleNotchIcon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
      {children}
    </button>
  );
}

/** Buttons of one form: side by side from `sm` up; stacked on phones with 44px between the safe and the dangerous one. */
export function ButtonRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 max-sm:gap-11">{children}</div>;
}

// ──────────────────────────────────────────────────────────── errors ──
export function ErrorBox({
  error,
  mustReload,
  reloading,
  onReload,
  onRetry,
  pending,
  testId = "d3-error",
}: {
  error: DisputeErrorView | null;
  mustReload: boolean;
  reloading: boolean;
  onReload: () => void;
  onRetry?: () => void;
  pending?: boolean;
  testId?: string;
}) {
  if (!error) return null;
  const showReload = mustReload || mustReloadFirst(error);
  const showRetry = !showReload && canOfferRetry(error) && !!onRetry;
  return (
    <div role="alert" data-testid={testId} data-error-code={error.code ?? undefined} data-error-kind={error.kind} className="space-y-2 rounded-lg border border-st-danger-border bg-st-danger-bg px-3 py-2.5 text-sm text-st-danger">
      <p className="break-words">{error.message}</p>
      {(showReload || showRetry) && (
        <div className="flex flex-wrap gap-3">
          {showReload && (
            <ActionButton variant="outline" onClick={onReload} pending={reloading} testId={`${testId}-reload`}>
              <ArrowClockwiseIcon className="size-4" aria-hidden /> Tải lại hồ sơ
            </ActionButton>
          )}
          {showRetry && (
            <ActionButton variant="outline" onClick={onRetry!} pending={pending} testId={`${testId}-retry`}>
              <ArrowClockwiseIcon className="size-4" aria-hidden /> Thử lại
            </ActionButton>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────── dialog ──
export interface ConfirmRow {
  label: string;
  value: ReactNode;
}

/**
 * Two-step confirmation (handoff section 4). Portalled to <body> (the admin tokens live on :root), `role=dialog aria-modal`, focus trap /
 * Esc / focus return from `useModalA11y`. Esc, the backdrop and "Huỷ" are inert while the request is in flight. Closes by the caller
 * (after the server answered). On phones the safe and the dangerous button are 44px apart.
 */
export function ConfirmModal({
  open,
  onClose,
  title,
  description,
  rows,
  notice,
  children,
  confirmLabel,
  pendingLabel,
  danger,
  confirmDisabled,
  pending,
  onConfirm,
  error,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  rows?: ConfirmRow[];
  /** the irreversible-consequence sentence of handoff section 4 */
  notice: string;
  children?: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  pending: boolean;
  onConfirm: () => void;
  error?: ReactNode;
  testId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalA11y(
    ref,
    () => {
      if (!pending) onClose();
    },
    open,
  );
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" data-testid={`${testId}-overlay`} onMouseDown={(e) => e.target === e.currentTarget && !pending && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
        className="max-h-[100dvh] w-full space-y-4 overflow-y-auto rounded-t-2xl border border-adm-border bg-adm-surface p-5 text-adm-text shadow-adm-pop outline-none sm:max-h-[90dvh] sm:max-w-lg sm:rounded-2xl"
      >
        <div>
          <h2 id={titleId} className="text-base font-bold text-adm-text">
            {title}
          </h2>
          {description && <p className="mt-1 text-sm text-adm-text-2">{description}</p>}
        </div>
        {rows && rows.length > 0 && (
          <dl className="grid grid-cols-1 gap-2 rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
            {rows.map((r, i) => (
              <div key={i} className="contents">
                <dt className="text-xs text-adm-text-2 sm:text-sm">{r.label}</dt>
                <dd className="min-w-0 whitespace-pre-wrap break-words font-medium sm:text-right">{r.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <div role="note" data-testid={`${testId}-notice`} className="flex items-start gap-2 rounded-lg border border-st-warning-border bg-st-warning-bg px-3 py-2.5 text-sm font-medium text-st-warning">
          <WarningIcon className="mt-0.5 size-4 shrink-0" weight="fill" aria-hidden />
          <span className="min-w-0 break-words">{notice}</span>
        </div>
        {children}
        {error}
        <div className="flex flex-col gap-3 max-sm:gap-11 sm:flex-row sm:justify-end">
          <ActionButton variant="outline" onClick={onClose} disabled={pending} testId={`${testId}-cancel`}>
            Huỷ
          </ActionButton>
          <ActionButton variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={confirmDisabled} pending={pending} testId={`${testId}-confirm`}>
            {pending ? pendingLabel : confirmLabel}
          </ActionButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Closes a dialog when the write succeeded, or when the server pointed at form fields (so they can be fixed in the form). */
export function useCloseOnResult(open: boolean, setOpen: (v: boolean) => void, w: { error: DisputeErrorView | null; result: unknown }) {
  const lastErr = useRef<DisputeErrorView | null>(null);
  useEffect(() => {
    if (open && w.error && w.error !== lastErr.current && (w.error.kind === "validation" || w.error.code === "EVIDENCE_CHANGED")) setOpen(false);
    lastErr.current = w.error;
  }, [open, w.error, setOpen]);
}

export const counter = (value: string) => value.trim().length;
