import { forwardRef, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { useHref, useLinkClickHandler } from "react-router";
import { ArrowClockwiseIcon, ArrowLeftIcon, InfoIcon, WarningCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { Button } from "../../components/ui/button";
import type { PillTone } from "./partyModel";

/**
 * D4 - small building blocks of the party-side dispute screens. They live in the normal client/PT app shell, so every colour is a shell
 * token (`--card-bg`, `--text-color`, ... and the shared `--st-*` status tokens that exist for both themes): no hex, no one-off palette.
 */
export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-color)]";
export const LIST_PATH = "/disputes";
export const casePath = (id: string) => `/disputes/${encodeURIComponent(id)}`;

export const CARD = "rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-color)]";
export const MUTED = "text-[var(--muted-text-color)]";

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string };

/** A real `<a href>` with client-side navigation (built on react-router's hooks; `<Link>` does not type-check in this tree: two @types/react copies). */
export const PartyLink = forwardRef<HTMLAnchorElement, LinkProps>(function PartyLink({ to, onClick, target, ...rest }, ref) {
  const href = useHref(to);
  const handleClick = useLinkClickHandler<HTMLAnchorElement>(to, { target });
  return (
    <a
      {...rest}
      ref={ref}
      href={href}
      target={target}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (!event.defaultPrevented) handleClick(event);
      }}
    />
  );
});

const PILL: Record<PillTone, string> = {
  info: "border-st-info-border bg-st-info-bg text-st-info",
  neutral: "border-st-neutral-border bg-st-neutral-bg text-st-neutral",
  pending: "border-st-pending-border bg-st-pending-bg text-st-pending",
  success: "border-st-success-border bg-st-success-bg text-st-success",
  warning: "border-st-warning-border bg-st-warning-bg text-st-warning",
  danger: "border-st-danger-border bg-st-danger-bg text-st-danger",
};

export function Pill({ tone = "neutral", children, testId }: { tone?: PillTone; children: ReactNode; testId?: string }) {
  return (
    <span data-testid={testId} className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-5 ${PILL[tone]}`}>
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}

const NOTICE: Record<"info" | "warning" | "danger" | "pending", string> = {
  info: PILL.info,
  warning: PILL.warning,
  danger: PILL.danger,
  pending: PILL.pending,
};

export function Notice({ tone = "info", children, testId, role }: { tone?: keyof typeof NOTICE; children: ReactNode; testId?: string; role?: "note" | "status" | "alert" }) {
  const Icon = tone === "danger" || tone === "warning" ? WarningIcon : InfoIcon;
  return (
    <div role={role ?? "note"} data-testid={testId} className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${NOTICE[tone]}`}>
      <Icon className="mt-0.5 size-4 shrink-0" weight="fill" aria-hidden />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

export function Panel({ id, title, children, testId, aside }: { id: string; title: string; children: ReactNode; testId?: string; aside?: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-h`} data-testid={testId} className={`${CARD} p-4 sm:p-5`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-h`} className="text-base font-semibold">
          {title}
        </h2>
        {aside}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function BackLink({ to = LIST_PATH, children = "Khiếu nại của tôi" }: { to?: string; children?: ReactNode }) {
  return (
    <PartyLink to={to} data-testid="d4-back" className={`inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 text-sm font-medium text-[var(--primary-color)] hover:underline ${FOCUS}`}>
      <ArrowLeftIcon className="size-4" aria-hidden /> {children}
    </PartyLink>
  );
}

export function ReloadButton({ onClick, busy, label = "Tải lại", testId = "d4-reload" }: { onClick: () => void; busy?: boolean; label?: string; testId?: string }) {
  return (
    <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={onClick} disabled={busy} aria-busy={busy || undefined} data-testid={testId}>
      <ArrowClockwiseIcon className={`size-4 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
      {busy ? "Đang tải…" : label}
    </Button>
  );
}

export function LoadingBlock({ testId = "d4-loading", rows = 3 }: { testId?: string; rows?: number }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" data-testid={testId} className="space-y-3">
      <span className="sr-only">Đang tải…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`${CARD} h-24 animate-pulse motion-reduce:animate-none`} aria-hidden />
      ))}
    </div>
  );
}

/** A failed READ. It is never drawn like an empty list. */
export function FailureBlock({
  title,
  message,
  onRetry,
  retrying,
  testId = "d4-failure",
  children,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  testId?: string;
  children?: ReactNode;
}) {
  return (
    <div role="alert" data-testid={testId} className={`${CARD} flex flex-col items-start gap-3 border-st-danger-border p-5`}>
      <div className="flex items-start gap-2">
        <WarningCircleIcon className="mt-0.5 size-5 shrink-0 text-st-danger" weight="fill" aria-hidden />
        <div className="min-w-0">
          <p className="font-semibold">{title}</p>
          <p className={`mt-1 text-sm ${MUTED} break-words`}>{message}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {onRetry && <ReloadButton onClick={onRetry} busy={retrying} label="Thử lại" testId={`${testId}-retry`} />}
        {children}
      </div>
    </div>
  );
}

/**
 * Primary action. The shell's default Button (white on --button-bg #059669) measures 3.76:1 in the light theme (< 4.5:1 for 14px text),
 * so this button uses the status tokens that were checked for both themes: --st-success as the fill, the card colour as the text.
 */
export const PRIMARY_BUTTON = `inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-st-success px-4 text-sm font-semibold text-[var(--card-bg)] transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-60 sm:min-h-9 ${FOCUS}`;

export function controlClass(invalid: boolean): string {
  return [
    "block w-full min-h-11 rounded-md border bg-[var(--input-bg)] px-3 py-2 text-base text-[var(--input-text)] placeholder:text-[var(--input-placeholder)] md:text-sm",
    invalid ? "border-st-danger" : "border-[var(--border-color)]",
    FOCUS,
    "disabled:opacity-60",
  ].join(" ");
}

export function Field({
  id,
  label,
  required,
  hint,
  error,
  counter,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  counter?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {required ? <span aria-hidden> *</span> : <span className={`font-normal ${MUTED}`}> (không bắt buộc)</span>}
      </label>
      {hint && (
        <p id={`${id}-hint`} className={`mt-0.5 text-xs ${MUTED}`}>
          {hint}
        </p>
      )}
      <div className="mt-1.5">{children}</div>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-2">
        <p id={`${id}-err`} role={error ? "alert" : undefined} className="min-w-0 break-words text-xs text-st-danger">
          {error}
        </p>
        {counter && <p className={`ml-auto text-xs ${MUTED}`}>{counter}</p>}
      </div>
    </div>
  );
}

/** `aria-describedby` for a field: hint (if any) + error (if any). */
export const describedBy = (id: string, hasHint: boolean, hasError: boolean) => [hasHint ? `${id}-hint` : null, hasError ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
