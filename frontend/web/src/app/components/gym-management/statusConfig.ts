import type { ElementType } from "react";
import {
  CheckCircleIcon,
  ClockIcon,
  PauseCircleIcon,
  XCircleIcon,
  ProhibitIcon,
  ArchiveIcon,
  CircleIcon,
  MagnifyingGlassIcon,
  WarningCircleIcon,
  PaperPlaneTiltIcon,
} from "@phosphor-icons/react";

/**
 * GYM_MANAGEMENT master spec §56 "Status Visual Language" — one source of truth for how
 * every status pill in the gym-partner-management screens looks, across all FOUR
 * independent axes (see GYM_PARTNER_STATUS_MAPPING.md at the repo root for the full
 * cross-product and rationale). Never hand-roll a `STATUS_LABEL` map on a page again —
 * that duplicated pattern (AdminGymModeration.tsx, AdminPartnersPage.tsx both had their own,
 * slightly inconsistent with each other — e.g. a SUSPENDED *branch* was gray while a
 * SUSPENDED *partner* was amber) is exactly what this file replaces.
 *
 * Tone classes stay inside the app's existing Tailwind palette (green/amber/red/rose/blue/
 * zinc) — no new colors invented — and every text-color class used here is one already
 * covered by the light-mode retrofit rules in styles/theme.css, so a badge looks correct in
 * both themes with no extra work.
 */
export type StatusTone = "success" | "warning" | "danger" | "dangerDark" | "dangerMuted" | "info" | "neutral";

export const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-green-500/10 border-green-500/20 text-green-400",
  warning: "bg-amber-500/10 border-amber-500/20 text-amber-400",
  danger: "bg-red-500/10 border-red-500/20 text-red-400",
  // §56: SUSPENDED gets its own "dark red" tier, distinct from REJECTED's plain red — reuses
  // rose (already covered by the light-mode text override rules alongside text-red-400).
  dangerDark: "bg-rose-500/10 border-rose-500/25 text-rose-400",
  // §56: TERMINATED / PERMANENTLY_CLOSED get a "muted red" — a red-tinted chip but neutral
  // (already light-mode-safe) text, reading as "faded / over" rather than an active alarm.
  dangerMuted: "bg-red-500/5 border-red-500/10 text-zinc-400",
  info: "bg-blue-500/10 border-blue-500/20 text-blue-400",
  neutral: "bg-zinc-700/50 border-zinc-700 text-zinc-400",
};

export interface StatusMeta {
  label: string;
  tone: StatusTone;
  icon: ElementType;
}

/** `GymPartnerStatus` — lifecycle. */
export const PARTNER_STATUS: Record<string, StatusMeta> = {
  PROSPECT: { label: "Tiềm năng", tone: "neutral", icon: CircleIcon },
  INVITED: { label: "Đã mời, chờ thiết lập", tone: "info", icon: PaperPlaneTiltIcon },
  ACTIVE: { label: "Đang hoạt động", tone: "success", icon: CheckCircleIcon },
  SUSPENDED: { label: "Đang tạm khoá", tone: "dangerDark", icon: ProhibitIcon },
  TERMINATED: { label: "Đã chấm dứt hợp tác", tone: "dangerMuted", icon: ArchiveIcon },
};

/** `PartnerVerificationStatus` — document/identity vetting, added in GYM_MANAGEMENT Phase 1. */
export const VERIFICATION_STATUS: Record<string, StatusMeta> = {
  NOT_VERIFIED: { label: "Chưa thẩm định", tone: "neutral", icon: CircleIcon },
  IN_REVIEW: { label: "Đang xem xét", tone: "info", icon: MagnifyingGlassIcon },
  NEEDS_INFO: { label: "Cần bổ sung hồ sơ", tone: "warning", icon: WarningCircleIcon },
  VERIFIED: { label: "Đã thẩm định", tone: "success", icon: CheckCircleIcon },
  REJECTED: { label: "Đã từ chối thẩm định", tone: "danger", icon: XCircleIcon },
};

/** `GymStatus` — branch moderation (is this branch allowed on the platform at all). */
export const BRANCH_MODERATION_STATUS: Record<string, StatusMeta> = {
  PENDING_REVIEW: { label: "Đang chờ duyệt", tone: "warning", icon: ClockIcon },
  APPROVED: { label: "Đã duyệt", tone: "success", icon: CheckCircleIcon },
  REJECTED: { label: "Đã từ chối", tone: "danger", icon: XCircleIcon },
  SUSPENDED: { label: "Đã tạm khoá", tone: "dangerDark", icon: ProhibitIcon },
};

/** `GymOperationalStatus` — branch operations (is this branch physically open right now). */
export const BRANCH_OPERATIONAL_STATUS: Record<string, StatusMeta> = {
  OPEN: { label: "Đang mở cửa", tone: "success", icon: CheckCircleIcon },
  TEMPORARILY_CLOSED: { label: "Tạm đóng cửa", tone: "warning", icon: PauseCircleIcon },
  PERMANENTLY_CLOSED: { label: "Đã đóng cửa vĩnh viễn", tone: "dangerMuted", icon: ArchiveIcon },
};

/** `PartnerAccountStatus` — one login (OWNER or MANAGER), not the partner as a whole. */
export const ACCOUNT_STATUS: Record<string, StatusMeta> = {
  INVITED: { label: "Đã mời, chưa kích hoạt", tone: "info", icon: PaperPlaneTiltIcon },
  ACTIVE: { label: "Đang hoạt động", tone: "success", icon: CheckCircleIcon },
  REVOKED: { label: "Đã thu hồi", tone: "dangerMuted", icon: ProhibitIcon },
};

function resolve(map: Record<string, StatusMeta>, value: string): StatusMeta {
  return map[value] ?? { label: value, tone: "neutral", icon: CircleIcon };
}

export const getPartnerStatusMeta = (value: string) => resolve(PARTNER_STATUS, value);
export const getVerificationStatusMeta = (value: string) => resolve(VERIFICATION_STATUS, value);
export const getBranchModerationStatusMeta = (value: string) => resolve(BRANCH_MODERATION_STATUS, value);
export const getBranchOperationalStatusMeta = (value: string) => resolve(BRANCH_OPERATIONAL_STATUS, value);
export const getAccountStatusMeta = (value: string) => resolve(ACCOUNT_STATUS, value);
