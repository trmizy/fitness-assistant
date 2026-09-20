import { Building2, LayoutDashboard, Wallet } from "lucide-react-native";

import { RequireRole } from "../../src/components/guards/RequireRole";
import {
  WorkspaceTabs,
  type WorkspaceTab,
} from "../../src/components/navigation/WorkspaceTabs";

/**
 * Gym owner workspace. Three tabs, from the design prototype's `gymTabs` — deliberately fewer than
 * the other actors, because the brand/branch management this role does is depth-first (a branch,
 * then its plans, then its documents) rather than spread across peers.
 *
 * The one-owner-one-brand invariant this workspace must never violate belongs to Phase 12; nothing
 * here creates or selects a brand.
 */
const gymTabs: WorkspaceTab[] = [
  { name: "dashboard", label: "Tổng quan", icon: LayoutDashboard },
  { name: "gyms", label: "Phòng gym", icon: Building2 },
  { name: "wallet", label: "Ví", icon: Wallet },
];

export default function GymOwnerLayout() {
  return (
    <RequireRole allow={["gym_owner"]}>
      <WorkspaceTabs workspace="gym" tabs={gymTabs} />
    </RequireRole>
  );
}
