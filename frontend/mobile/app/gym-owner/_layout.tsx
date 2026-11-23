import { Building2, ConciergeBell, LayoutDashboard, Receipt, UserRound, Wallet } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";

import { RequireRole } from "../../src/components/guards/RequireRole";
import { RequirePartnerAccess } from "../../src/components/guards/RequirePartnerAccess";
import {
  WorkspaceTabs,
  type WorkspaceTab,
} from "../../src/components/navigation/WorkspaceTabs";
import { useApp } from "../../src/context/AppContext";
import { ALL_STAFF_TABS, staffTabsFor } from "../../src/features/gymOwner/staffRoles";
import { gymService } from "../../src/services/api";
import { hasPartnerPermission } from "../../src/features/gymOwner/permissions";
import { usePendingCheckinExceptionCount } from "../../src/features/gymOwner/usePendingCheckinExceptionCount";

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
  // N15M-08 / N15M-10 — one home per narrow role: the receptionist's desk and the accountant's read-only finance.
  { name: "front-desk", label: "Quầy lễ tân", icon: ConciergeBell },
  { name: "finance", label: "Tài chính", icon: Receipt },
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

/** Listing Management (M2): "Tin đăng & tiện ích" is a drill-down from Phòng gym / the branch screen, never a tab. */
const LISTING_HIDDEN_ROUTES = ["listing"];

const hiddenRoutes = [...LISTING_HIDDEN_ROUTES, "plans", "collaborations", "managers", "checkin-qr", "branch"];

/**
 * Tab bar per role (staffRoles.ts, mirrors gym-service default-deny permissions): owner = Tổng quan / Phòng gym / Quầy lễ tân / Ví /
 * Tài chính / Hồ sơ; manager = Tổng quan / Phòng gym / Quầy lễ tân / Hồ sơ; receptionist = Quầy lễ tân + Hồ sơ; accountant =
 * Tài chính + Hồ sơ. A tab a role cannot use is hidden (href null) rather than shown and 403'd. Role not known yet → only Hồ sơ (fail-closed).
 */
function GymTabs() {
  const { user } = useApp();
  const status = useQuery({
    queryKey: ["partner-onboarding-status", user?.id ?? "guest"],
    queryFn: () => gymService.getOnboardingStatus(),
  });
  const keep: string[] = staffTabsFor(status.data);
  const dropped = ALL_STAFF_TABS.filter((n) => !keep.includes(n));
  // Item 6: badge on "Quầy lễ tân" = check-in exception requests waiting for this owner / manager to approve (polls every 30 s).
  const canApproveExceptions = keep.includes("front-desk") && hasPartnerPermission(status.data, "checkin.exception.approve");
  const pendingExceptions = usePendingCheckinExceptionCount(canApproveExceptions);
  return (
    <WorkspaceTabs
      workspace="gym"
      tabs={gymTabs
        .filter((t) => keep.includes(t.name))
        .map((t) => (t.name === "front-desk" && pendingExceptions > 0 ? { ...t, badge: pendingExceptions } : t))}
      hiddenRoutes={[...hiddenRoutes, ...dropped]}
    />
  );
}
