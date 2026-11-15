import { getBranchModerationStatusMeta, getBranchOperationalStatusMeta } from "../../../components/gym-management/statusConfig";

const TONE: Record<string, string> = {
  PENDING_REVIEW: "border-st-pending-border bg-st-pending-bg text-st-pending",
  APPROVED: "border-st-success-border bg-st-success-bg text-st-success",
  REJECTED: "border-st-danger-border bg-st-danger-bg text-st-danger",
  SUSPENDED: "border-st-danger-border bg-st-danger-bg text-st-danger",
};

/**
 * B9a — branch moderation status pill on the admin status tokens (`--st-*`), AA contrast in both
 * themes. Same Vietnamese labels as `ModerationStatusBadge` (single label source: statusConfig).
 * Text + colour, never colour alone.
 */
export function GymStatusPill({ status }: { status: string }) {
  const meta = getBranchModerationStatusMeta(status);
  const Icon = meta.icon;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE[status] ?? "border-st-neutral-border bg-st-neutral-bg text-st-neutral"}`}>
      {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
      {meta.label}
    </span>
  );
}

const OPERATIONAL_TONE: Record<string, string> = {
  OPEN: "border-st-success-border bg-st-success-bg text-st-success",
  TEMPORARILY_CLOSED: "border-st-warning-border bg-st-warning-bg text-st-warning",
  PERMANENTLY_CLOSED: "border-st-neutral-border bg-st-neutral-bg text-st-neutral",
};

/** FIX2-ADMIN Q5 - the branch's open/closed switch (independent of moderation), same pill language as GymStatusPill. */
export function GymOperationalPill({ status }: { status: string }) {
  const meta = getBranchOperationalStatusMeta(status);
  const Icon = meta.icon;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${OPERATIONAL_TONE[status] ?? "border-st-neutral-border bg-st-neutral-bg text-st-neutral"}`}>
      {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
      {meta.label}
    </span>
  );
}
