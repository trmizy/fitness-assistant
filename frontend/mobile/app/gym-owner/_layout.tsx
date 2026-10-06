import { Building2, LayoutDashboard, UserRound, Wallet } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";

import { RequireRole } from "../../src/components/guards/RequireRole";
import { RequirePartnerAccess } from "../../src/components/guards/RequirePartnerAccess";
import {
  WorkspaceTabs,
  type WorkspaceTab,
} from "../../src/components/navigation/WorkspaceTabs";
import { useApp } from "../../src/context/AppContext";
import { isManagerAccount } from "../../src/features/gymOwner/gymOwner";
import { gymService } from "../../src/services/api";

/**
 * Gym owner workspace. Three tabs, from the design prototype's `gymTabs` — deliberately fewer than
 * the other actors, because the brand/branch management this role does is depth-first (a branch,
 * then its plans, then its documents) rather than spread across peers.
 *
 * The one-owner-one-brand invariant this workspace must never violate: nothing here — or in any
 * screen below — creates or selects a brand. gym-service resolves it from ownership and ignores a
 * client-supplied brandId (see features/gymOwner/gymOwner.ts).
 *
 * Two guards, in order: role first (is this even a gym owner?), then partner access (has their
 * application actually been approved?). The second one fails CLOSED — see RequirePartnerAccess.
 */
const gymTabs: WorkspaceTab[] = [
  { name: "dashboard", label: "Tổng quan", icon: LayoutDashboard },
  { name: "gyms", label: "Phòng gym", icon: Building2 },
  { name: "wallet", label: "Ví", icon: Wallet },
  // Tab thứ tư, ngoài `gymTabs` ba tab của bản thiết kế: WB-18 (hồ sơ chủ gym) là màn web mọc thêm
  // sau khi Figma vẽ xong, và nó chứa mật khẩu + tài khoản nhận tiền — không thể chôn sau hai lần
  // bấm. Mọi không gian khác cũng có tab hồ sơ, nên đây là chỗ người dùng sẽ đi tìm.
  { name: "profile", label: "Hồ sơ", icon: UserRound },
];

export default function GymOwnerLayout() {
  return (
    <RequireRole allow={["gym_owner"]}>
      <RequirePartnerAccess>
        <GymTabs />
      </RequirePartnerAccess>
    </RequireRole>
  );
}

const hiddenRoutes = ["plans", "collaborations", "managers", "checkin-qr", "branch"];

/** The "Ví" tab is OWNER-only (gym-service 403s a manager), so a manager's bar leaves it out. */
function GymTabs() {
  const { user } = useApp();
  const status = useQuery({
    queryKey: ["partner-onboarding-status", user?.id ?? "guest"],
    queryFn: () => gymService.getOnboardingStatus(),
  });
  const manager = isManagerAccount(status.data);
  return (
    <WorkspaceTabs
      workspace="gym"
      tabs={manager ? gymTabs.filter((t) => t.name !== "wallet") : gymTabs}
      hiddenRoutes={manager ? [...hiddenRoutes, "wallet"] : hiddenRoutes}
    />
  );
}
