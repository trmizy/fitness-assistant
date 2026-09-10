import { StatusBadge } from "../ui/StatusBadge";
import { getBranchOperationalStatusMeta } from "./statusConfig";

/** `GymOperationalStatus` pill — "is this branch physically open right now". */
export function OperationalStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = getBranchOperationalStatusMeta(status);
  return <StatusBadge label={meta.label} tone={meta.tone} icon={meta.icon} className={className} />;
}
