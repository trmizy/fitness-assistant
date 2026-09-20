import { CalendarDays, LayoutDashboard, User, Users, Wallet } from "lucide-react-native";

import { RequireRole } from "../../src/components/guards/RequireRole";
import {
  WorkspaceTabs,
  type WorkspaceTab,
} from "../../src/components/navigation/WorkspaceTabs";

/**
 * PT workspace. Tabs from the design prototype's `ptTabs`.
 *
 * No onboarding guard: that wizard collects a CLIENT training profile and has nothing to say about
 * a trainer's professional space — web draws the same line.
 *
 * A PT also has a second, personal client workspace (see app/client/_layout.tsx, which admits
 * "pt"). The switch between the two arrives in Phase 10; the routing that makes it possible is
 * already here.
 */
const ptTabs: WorkspaceTab[] = [
  { name: "dashboard", label: "Tổng quan", icon: LayoutDashboard },
  { name: "students", label: "Học viên", icon: Users },
  { name: "schedule", label: "Lịch dạy", icon: CalendarDays },
  { name: "wallet", label: "Ví", icon: Wallet },
  { name: "profile", label: "Hồ sơ", icon: User },
];

export default function PtLayout() {
  return (
    <RequireRole allow={["pt"]}>
      <WorkspaceTabs workspace="pt" tabs={ptTabs} />
    </RequireRole>
  );
}
