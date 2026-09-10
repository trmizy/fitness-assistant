import type { ReactNode } from "react";
import { RoleChip } from "./RoleChip";
import { StatusBadge } from "../ui/StatusBadge";
import { getAccountStatusMeta } from "./statusConfig";

export interface AccountRowProps {
  name: string;
  email?: string;
  role: "OWNER" | "MANAGER";
  status: string;
  /** Branch names this MANAGER is scoped to — omitted/empty for an OWNER (all branches). */
  scopedBranchNames?: string[];
  actions?: ReactNode;
}

/**
 * GYM_MANAGEMENT master spec §55/§62 — one row in the partner detail's ACCOUNTS tab
 * ("Admin opens the ACCOUNTS tab, sees three people with correct roles" — §62 acceptance
 * check). `actions` is a slot for whatever the caller can do to this row (revoke, resend
 * invite, transfer ownership) — kept generic since those actions are OWNER-only and
 * context-dependent (see GYM_PARTNER_IDENTITY_MODEL.md §5 permission matrix).
 */
export function AccountRow({ name, email, role, status, scopedBranchNames, actions }: AccountRowProps) {
  const statusMeta = getAccountStatusMeta(status);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-zinc-100 truncate">{name}</span>
          <RoleChip role={role} />
          <StatusBadge label={statusMeta.label} tone={statusMeta.tone} icon={statusMeta.icon} />
        </div>
        {email && <p className="text-xs text-zinc-500 mt-0.5 truncate">{email}</p>}
        {role === "MANAGER" && (
          <p className="text-xs text-zinc-500 mt-0.5">
            Phạm vi: {scopedBranchNames && scopedBranchNames.length > 0 ? scopedBranchNames.join(", ") : "—"}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
    </div>
  );
}
