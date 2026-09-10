import type { ElementType } from "react";
import { cn } from "./utils";
import type { StatusTone } from "../gym-management/statusConfig";
import { TONE_CLASSES } from "../gym-management/statusConfig";

export interface StatusBadgeProps {
  label: string;
  tone: StatusTone;
  icon?: ElementType;
  className?: string;
  size?: "sm" | "md";
}

/**
 * GYM_MANAGEMENT master spec §55/§56 — the one shared status pill every screen should use.
 * Always icon + text + color (§56/§59: "status not communicated by color alone" —
 * accessibility, not decoration) — `icon` is optional only for callers migrating gradually;
 * new call sites should always pass one. Domain-specific wrappers (OperationalStatusBadge,
 * ModerationStatusBadge, PartnerStatusBadge, VerificationStatusBadge in
 * components/gym-management/) already do this — reach for those first before using this
 * directly with a raw tone.
 */
export function StatusBadge({ label, tone, icon: Icon, className, size = "sm" }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-bold whitespace-nowrap",
        size === "sm" ? "text-[10px] px-2 py-0.5" : "text-xs px-2.5 py-1",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {Icon && <Icon className={size === "sm" ? "size-3" : "size-3.5"} weight="bold" />}
      {label}
    </span>
  );
}
