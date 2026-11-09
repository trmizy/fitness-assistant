/**
 * D7 - the small building blocks of the two money-exception views: pills, notices, key/value rows, fields, buttons, the result/error notes
 * and the two-step confirm dialog. Admin tokens only (`adm-*`, `st-*`; no hex, no zinc/amber). Every control is >= 44px tall on phones.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowClockwiseIcon, CheckCircleIcon, CircleNotchIcon, ClockIcon, InfoIcon, LockKeyIcon, WarningIcon, XCircleIcon } from "@phosphor-icons/react";
import { useModalA11y } from "../../shared/useModalA11y";
import type { MoneyErrorView } from "./moneyExceptionErrors";
import type { Tone } from "./moneyExceptionLabels";
import type { ResultNote } from "./moneyExceptionModel";

export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)]";

const TONE: Record<Tone, string> = {
  success: "border-st-success-border bg-st-success-bg text-st-success",
  danger: "border-st-danger-border bg-st-danger-bg text-st-danger",
  warning: "border-st-warning-border bg-st-warning-bg text-st-warning",
  info: "border-st-info-border bg-st-info-bg text-st-info",
  pending: "border-st-pending-border bg-st-pending-bg text-st-pending",
  neutral: "border-st-neutral-border bg-st-neutral-bg text-st-neutral",
};

const TONE_ICON: Record<Tone, typeof InfoIcon> = {
  success: CheckCircleIcon,
  danger: XCircleIcon,
  warning: WarningIcon,
  info: InfoIcon,
  pending: ClockIcon,
  neutral: InfoIcon,
};

/** Status is always text AND icon, never colour alone. */
export function Pill({ tone, children, testId }: { tone: Tone; children: ReactNode; testId?: string }) {
  const Icon = TONE_ICON[tone];
  return (
    <span data-testid={testId} className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${TONE[tone]}`}>
      <Icon className="size-3.5" aria-hidden />
      <span>{children}</span>
    </span>
  );
}

/** A muted one-line notice (flag off, unknown, nothing to do). */
export function MutedLine({ children, testId, icon = "info" }: { children: ReactNode; testId?: string; icon?: "info" | "lock" }) {
  const Icon = icon === "lock" ? LockKeyIcon : InfoIcon;
  return (
    <p data-testid={testId} className="flex items-start gap-2 rounded-lg border border-adm-border-soft bg-adm-surface-2 px-3 py-2 text-xs leading-relaxed text-adm-text-2">
      <Icon className="mt-px size-4 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/** A strong notice (the "not paid" sentence, a stuck state). */
export function Notice({ tone, title, children, testId, role = "note" }: { tone: Tone; title?: string; children: ReactNode; testId?: string; role?: "note" | "status" | "alert" }) {
  const Icon = TONE_ICON[tone];
  return (
    <div role={role} data-testid={testId} className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${TONE[tone]}`}>
      <Icon className="mt-0.5 size-4 shrink-0" weight="fill" aria-hidden />
      <div className="min-w-0 break-words">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? "mt-0.5" : undefined}>{children}</div>
      </div>
    </div>
  );
}

export function ResultCard({ note, onDismiss, testId }: { note: ResultNote; onDismiss?: () => void; testId: string }) {
  return (
    <div data-testid={testId} className="space-y-2">
      <Notice tone={note.tone} title={note.title} role="status" testId={`${testId}-body`}>
        {note.text}
      </Notice>
      {onDismiss && (
        <Btn variant="outline" onClick={onDismiss} testId={`${testId}-dismiss`}>
          Đã xem
        </Btn>
      )}
    </div>
  );
}

export function Kv({ rows, testId }: { rows: Array<{ label: string; value: ReactNode }>; testId?: string }) {
  return (
    <dl data-testid={testId} className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`} className="contents">
          <dt className="text-xs text-adm-text-2 sm:text-sm">{r.label}</dt>
          <dd className="min-w-0 break-words font-medium text-adm-text sm:text-right">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({ title, children, testId, aside }: { title: string; children: ReactNode; testId?: string; aside?: ReactNode }) {
  return (
    <section data-testid={testId} className="space-y-3 rounded-xl border border-adm-border bg-adm-surface p-4 shadow-adm-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-adm-text">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

// ─────────────────────────────────────────────────────────── buttons ──
const BTN = `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60 xl:min-h-10 ${FOCUS}`;
const BTN_VARIANT = {
  primary: "border-transparent bg-st-success text-adm-bg hover:opacity-90",
  danger: "border-st-danger-border bg-st-danger-bg text-st-danger hover:opacity-90",
  outline: "border-adm-border bg-adm-surface text-adm-text hover:bg-adm-surface-2",
} as const;

export function Btn({
  children,
  onClick,
  variant = "outline",
  disabled,
  pending,
  testId,
  type = "button",
  describedBy,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: keyof typeof BTN_VARIANT;
  disabled?: boolean;
  pending?: boolean;
  testId?: string;
  type?: "button" | "submit";
  describedBy?: string;
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled || pending} aria-busy={pending || undefined} aria-describedby={describedBy} data-testid={testId} className={`${BTN} ${BTN_VARIANT[variant]}`}>
      {pending && <CircleNotchIcon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
      {children}
    </button>
  );
}

/**
 * An action that exists but cannot be pressed by this admin: the button is disabled and the reason sits right beside it (never a silent grey button).
 */
export function GatedButton({ label, reason, onClick, variant, testId }: { label: string; reason: string | null; onClick: () => void; variant?: keyof typeof BTN_VARIANT; testId: string }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Btn variant={variant} onClick={onClick} disabled={!!reason} describedBy={reason ? id : undefined} testId={testId}>
        {label}
      </Btn>
      {reason && (
        <p id={id} data-testid={`${testId}-why`} className="text-xs text-adm-text-2">
          {reason}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────── fields ──
const CONTROL = `block w-full rounded-lg border border-adm-border bg-adm-surface px-3 text-sm text-adm-text placeholder:text-adm-text-2 disabled:opacity-60 ${FOCUS}`;

export function Field({ id, label, hint, error, count, max, children }: { id: string; label: string; hint?: string; error?: string | null; count?: number; max?: number; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-adm-text">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-adm-text-2">
          {hint}
        </p>
      )}
      {children}
      <div className="flex items-start justify-between gap-2">
        <p id={`${id}-error`} role={error ? "alert" : undefined} className="min-h-4 text-xs text-st-danger">
          {error ?? ""}
        </p>
        {max !== undefined && count !== undefined && (
          <span className={`shrink-0 text-xs tabular-nums ${count > max ? "text-st-danger" : "text-adm-text-2"}`}>
            {count.toLocaleString("vi-VN")}/{max.toLocaleString("vi-VN")}
          </span>
        )}
      </div>
    </div>
  );
}

const describedBy = (id: string, hasError: boolean, hasHint: boolean) => [hasHint ? `${id}-hint` : "", hasError ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;

export function TextArea({ id, value, onChange, error, rows = 3, hint, disabled, placeholder }: { id: string; value: string; onChange: (v: string) => void; error?: string | null; rows?: number; hint?: boolean; disabled?: boolean; placeholder?: string }) {
  return (
    <textarea
      id={id}
      value={value}
      rows={rows}
      disabled={disabled}
      placeholder={placeholder}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, !!error, !!hint)}
      onChange={(e) => onChange(e.target.value)}
      className={`${CONTROL} min-h-11 py-2.5`}
    />
  );
}

export function SelectField({ id, value, onChange, options, placeholder, error, disabled, hint }: { id: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; placeholder: string; error?: string | null; disabled?: boolean; hint?: boolean }) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, !!error, !!hint)}
      onChange={(e) => onChange(e.target.value)}
      className={`${CONTROL} min-h-11 py-2`}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Check({ id, checked, onChange, label, error, disabled }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; error?: string | null; disabled?: boolean }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-adm-border bg-adm-surface px-3 py-2.5 text-sm text-adm-text">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.checked)}
          className={`mt-0.5 size-5 shrink-0 accent-[var(--adm-focus)] ${FOCUS}`}
        />
        <span className="min-w-0">{label}</span>
      </label>
      <p id={`${id}-error`} role={error ? "alert" : undefined} className="min-h-4 text-xs text-st-danger">
        {error ?? ""}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────── error / load states ──
export function ErrorBox({ view, onReload, reloading, testId }: { view: MoneyErrorView; onReload?: () => void; reloading?: boolean; testId: string }) {
  return (
    <div role="alert" data-testid={testId} className="space-y-2 rounded-lg border border-st-danger-border bg-st-danger-bg px-3 py-2.5 text-sm text-st-danger">
      <p className="break-words">{view.message}</p>
      {view.mustReload && onReload && (
        <Btn variant="outline" onClick={onReload} pending={reloading} testId={`${testId}-reload`}>
          <ArrowClockwiseIcon className="size-4" aria-hidden />
          Tải lại trạng thái
        </Btn>
      )}
    </div>
  );
}

export function ReadFailed({ what, view, onRetry, testId }: { what: string; view: MoneyErrorView | null; onRetry: () => void; testId: string }) {
  const forbidden = view?.kind === "forbidden" || view?.kind === "auth";
  return (
    <div role="alert" data-testid={testId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-st-warning-border bg-st-warning-bg p-3">
      <p className="flex min-w-0 flex-1 basis-60 items-start gap-1.5 text-xs font-medium text-st-warning">
        <WarningIcon className="mt-px size-4 shrink-0" aria-hidden />
        <span>
          {forbidden ? `Tài khoản này không xem được ${what}.` : `Không tải được ${what}. Chưa biết có mục nào hay không — đây không phải “không có mục”.`} {view && !forbidden ? view.message : ""}
        </span>
      </p>
      {!forbidden && (
        <Btn variant="outline" onClick={onRetry} testId={`${testId}-retry`}>
          Thử lại
        </Btn>
      )}
    </div>
  );
}

export function ListSkeleton({ testId, rows = 3 }: { testId: string; rows?: number }) {
  return (
    <div data-testid={testId} aria-busy="true" aria-label="Đang tải" className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl border border-adm-border bg-adm-surface-2 motion-reduce:animate-none" />
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────── confirm dialog ──
/**
 * Two-step confirmation (handoff section 4): portalled to <body>, `role=dialog aria-modal`, focus trap / Esc / focus return from `useModalA11y`.
 * Esc, the backdrop and "Huỷ" are inert while the request is in flight; the dialog closes only when the caller closes it (after the server answered).
 * On phones the safe and the dangerous button are 44px apart.
 */
export function ConfirmDialog({
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
  onClose,
  error,
  testId,
}: {
  title: string;
  description?: ReactNode;
  rows?: Array<{ label: string; value: ReactNode }>;
  notice: string;
  children?: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
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
    true,
  );
  useEffect(() => {
    // the page behind must not scroll under an open dialog
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  if (typeof document === "undefined") return null;
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
          <Btn variant="outline" onClick={onClose} disabled={pending} testId={`${testId}-cancel`}>
            Huỷ
          </Btn>
          <Btn variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={confirmDisabled} pending={pending} testId={`${testId}-confirm`}>
            {pending ? pendingLabel : confirmLabel}
          </Btn>
        </div>
      </div>
    </div>,
    document.body,
  );
}
