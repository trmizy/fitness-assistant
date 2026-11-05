import { forwardRef, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { useHref, useLinkClickHandler } from "react-router";
import { ArrowClockwiseIcon, ArrowLeftIcon, InfoIcon, LockKeyIcon, WarningCircleIcon, WarningIcon, WifiSlashIcon } from "@phosphor-icons/react";
import { Button } from "../../../../components/ui/button";
import { CompactReference, isReferenceValue } from "../shared/CompactReference";
import { Pill, type PillTone } from "../../shared/b9bPill";
import type { PayloadField } from "./evidenceModel";
import type { LoadFailure } from "./workspaceModel";

/** Shared look of the dispute queue and workspace: admin tokens only (no zinc/amber, no hex). */
export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)]";
export const CARD = "rounded-xl border border-adm-border bg-adm-surface shadow-adm-card";
export const QUEUE_PATH = "/admin/disputes";

type DisputeLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string; state?: unknown };

/**
 * A real `<a href>` with client-side navigation that can carry router `state` (the queue's query string, so "Danh sách khiếu nại"
 * returns to the same filter/page). Built like `AdminLink` (react-router's own hooks) because `<Link>` does not type-check in this tree
 * (two @types/react copies) and the temp tsc count must not grow.
 */
export const DisputeLink = forwardRef<HTMLAnchorElement, DisputeLinkProps>(function DisputeLink({ to, state, onClick, target, ...rest }, ref) {
  const href = useHref(to);
  const handleClick = useLinkClickHandler<HTMLAnchorElement>(to, { state, target });
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

export { Pill };
export type { PillTone };

const NOTICE_TONE: Record<"info" | "warning" | "danger" | "pending", string> = {
  info: "border-st-info-border bg-st-info-bg text-st-info",
  warning: "border-st-warning-border bg-st-warning-bg text-st-warning",
  danger: "border-st-danger-border bg-st-danger-bg text-st-danger",
  pending: "border-st-pending-border bg-st-pending-bg text-st-pending",
};

export function Notice({
  tone = "info",
  children,
  testId,
  role,
  icon = true,
}: {
  tone?: keyof typeof NOTICE_TONE;
  children: ReactNode;
  testId?: string;
  role?: "note" | "status" | "alert";
  icon?: boolean;
}) {
  const Icon = tone === "danger" || tone === "warning" ? WarningIcon : InfoIcon;
  return (
    <div role={role ?? "note"} data-testid={testId} className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${NOTICE_TONE[tone]}`}>
      {icon && <Icon className="mt-0.5 size-4 shrink-0" weight="fill" aria-hidden />}
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

export function Muted({ children, testId, className = "" }: { children: ReactNode; testId?: string; className?: string }) {
  return (
    <p data-testid={testId} className={`flex items-start gap-2 text-xs text-adm-text-2 ${className}`}>
      <InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

export function Section({ title, children, testId, aside }: { title: string; children: ReactNode; testId?: string; aside?: ReactNode }) {
  return (
    <section data-testid={testId} className={`${CARD} p-4`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-adm-text">{title}</h3>
        {aside}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function EmptyBox({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} className="rounded-xl border border-dashed border-adm-border bg-adm-surface px-4 py-8 text-center text-sm text-adm-text-2">
      {children}
    </div>
  );
}

export function FieldList({ fields, testId }: { fields: PayloadField[]; testId?: string }) {
  if (fields.length === 0) return null;
  return (
    <dl data-testid={testId} className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {fields.map((f, i) => (
        <div key={`${f.label}-${i}`} className="min-w-0">
          <dt className="text-xs text-adm-text-2">{f.label}</dt>
          <dd className="break-words font-medium text-adm-text">{isReferenceValue(f.value) ? <CompactReference value={f.value} label={f.label} /> : f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function LoadingSkeleton({ testId = "d2-loading" }: { testId?: string }) {
  const bar = "animate-pulse rounded-md bg-adm-pill motion-reduce:animate-none";
  return (
    <div role="status" aria-busy="true" aria-label="Đang tải" data-testid={testId} className="space-y-4">
      <div className={`${bar} h-6 w-64 max-w-full`} />
      <div className={`${bar} h-4 w-full max-w-md`} />
      <div className={`${CARD} space-y-3 p-4`}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2">
            <div className={`${bar} h-4 w-40`} />
            <div className={`${bar} h-10 w-full`} />
          </div>
        ))}
      </div>
      <span className="sr-only">Đang tải dữ liệu…</span>
    </div>
  );
}

/** A failed load. Never an empty state. */
export function FailurePanel({
  failure,
  onReload,
  reloading,
  testId = "d2-failure",
}: {
  failure: LoadFailure;
  onReload?: () => void;
  reloading?: boolean;
  testId?: string;
}) {
  const Icon = failure.kind === "forbidden" || failure.kind === "auth" ? LockKeyIcon : failure.kind === "network" ? WifiSlashIcon : WarningCircleIcon;
  return (
    <div
      role="alert"
      data-testid={testId}
      data-failure={failure.kind}
      className="flex flex-col items-center gap-3 rounded-xl border border-st-danger-border bg-st-danger-bg px-6 py-10 text-center"
    >
      <Icon className="size-8 text-st-danger" aria-hidden />
      <div>
        <p className="text-sm font-semibold text-st-danger">{failure.title}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-adm-text">{failure.body}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {failure.canReload && onReload && (
          <Button type="button" variant="outline" size="sm" onClick={onReload} disabled={reloading} className="min-h-11 xl:min-h-8" data-testid={`${testId}-reload`}>
            <ArrowClockwiseIcon aria-hidden /> {failure.kind === "conflict" ? "Tải lại hồ sơ" : "Thử lại"}
          </Button>
        )}
        {failure.backToQueue && (
          <DisputeLink
            to={QUEUE_PATH}
            data-testid={`${testId}-back`}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-md border border-adm-border bg-adm-surface px-3 text-sm font-medium text-adm-text hover:bg-adm-surface-2 xl:min-h-8 ${FOCUS}`}
          >
            <ArrowLeftIcon className="size-4" aria-hidden /> Về danh sách khiếu nại
          </DisputeLink>
        )}
      </div>
    </div>
  );
}
