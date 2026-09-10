import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { OperationalStatusBadge } from "./OperationalStatusBadge";

export interface BranchOption {
  id: string;
  name: string;
  operationalStatus: string;
}

export interface BranchSelectorProps {
  branches: BranchOption[];
  value: string | null;
  onChange: (gymId: string) => void;
  placeholder?: string;
  /** Every-branch option, e.g. for a MANAGER invite scoped to more than one branch is picked
   * elsewhere (a checklist) — this component is single-select only, matching spec §55
   * ("BrandSelector is NOT needed — one owner has one brand"; this is its branch-level
   * counterpart, for the common single-branch pick: check-in scope, plan scope, etc). */
  className?: string;
}

/** GYM_MANAGEMENT master spec §55 — shared single-branch picker. */
export function BranchSelector({ branches, value, onChange, placeholder = "Chọn chi nhánh", className }: BranchSelectorProps) {
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {branches.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            <span className="flex items-center gap-2">
              {b.name}
              <OperationalStatusBadge status={b.operationalStatus} />
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
