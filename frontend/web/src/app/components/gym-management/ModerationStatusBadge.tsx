import { StatusBadge } from "../ui/StatusBadge";
import { getBranchModerationStatusMeta } from "./statusConfig";

/** `GymStatus` pill — "is this branch allowed to exist on the platform at all". */
export function ModerationStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = getBranchModerationStatusMeta(status);
  return <StatusBadge label={meta.label} tone={meta.tone} icon={meta.icon} className={className} />;
}
