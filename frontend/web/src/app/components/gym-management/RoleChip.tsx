import { CrownSimpleIcon, UserIcon } from "@phosphor-icons/react";
import { cn } from "../ui/utils";

/**
 * `PartnerAccountRole` pill (OWNER/MANAGER) — an in-app permission, not a system role (see
 * GYM_PARTNER_IDENTITY_MODEL.md §2 — this is explicitly NOT `GYM_STAFF`). Kept visually
 * distinct from the four status-axis badges in statusConfig.ts on purpose: this isn't a
 * status, it never changes on its own, and mixing it into the same tone system would blur
 * that distinction.
 */
export function RoleChip({ role, className }: { role: "OWNER" | "MANAGER"; className?: string }) {
  const isOwner = role === "OWNER";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap",
        isOwner
          ? "bg-primary/10 border-primary/30 text-primary"
          : "bg-zinc-800/60 border-zinc-700 text-zinc-300",
        className,
      )}
    >
      {isOwner ? <CrownSimpleIcon className="size-3" weight="fill" /> : <UserIcon className="size-3" weight="bold" />}
      {isOwner ? "Chủ sở hữu" : "Quản lý"}
    </span>
  );
}
