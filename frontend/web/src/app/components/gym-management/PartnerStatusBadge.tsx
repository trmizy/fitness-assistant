import { StatusBadge } from "../ui/StatusBadge";
import { getPartnerStatusMeta, getVerificationStatusMeta } from "./statusConfig";

/** `GymPartnerStatus` pill — where a partner is in the business relationship lifecycle. */
export function PartnerStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = getPartnerStatusMeta(status);
  return <StatusBadge label={meta.label} tone={meta.tone} icon={meta.icon} className={className} />;
}

/**
 * `PartnerVerificationStatus` pill — document/identity vetting (GYM_MANAGEMENT Phase 1),
 * independent of `PartnerStatusBadge` above. Show both side by side on a partner row/detail
 * page rather than picking one — they answer different questions (see
 * GYM_PARTNER_STATUS_MAPPING.md).
 */
export function VerificationStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = getVerificationStatusMeta(status);
  return <StatusBadge label={meta.label} tone={meta.tone} icon={meta.icon} className={className} />;
}
