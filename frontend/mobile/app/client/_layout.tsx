import { Dumbbell, HandHeart, Home, MessageCircle, User } from "lucide-react-native";

import { RequireRole } from "../../src/components/guards/RequireRole";
import { RequireOnboarding } from "../../src/components/guards/RequireOnboarding";
import {
  WorkspaceTabs,
  type WorkspaceTab,
} from "../../src/components/navigation/WorkspaceTabs";

/**
 * Client workspace — the app's largest actor.
 *
 * These five tabs follow doc 08 §4.2, confirmed by Ngài on 2026-09-13 when it turned out the
 * design prototype disagreed with the brief: the prototype kept **Dinh dưỡng** as a tab and pushed
 * AI Coach onto a floating button, while the brief asks for **Trò chuyện** as a tab with nutrition
 * folded into a larger tab's sub-navigation. The brief won. Nutrition therefore lives under
 * Tập luyện (Phase 6), and there is no floating AI Coach button.
 *
 * Both guards sit outside the tabs so neither the tab bar nor any screen renders for the wrong
 * account: role first (is this even a client?), then onboarding (has this client finished setup?).
 */
const clientTabs: WorkspaceTab[] = [
  { name: "dashboard", label: "Trang chủ", icon: Home },
  { name: "workout", label: "Tập luyện", icon: Dumbbell },
  { name: "services", label: "Dịch vụ", icon: HandHeart },
  { name: "messages", label: "Trò chuyện", icon: MessageCircle },
  { name: "profile", label: "Cá nhân", icon: User },
];

export default function ClientLayout() {
  return (
    <RequireRole allow={["client", "pt"]}>
      <RequireOnboarding>
        <WorkspaceTabs
          workspace="client"
          tabs={clientTabs}
          // Reachable but never a tab: onboarding (RequireOnboarding redirects here), and the
          // screens the five tabs push to — every file under app/client/ becomes a Tabs.Screen,
          // so anything not listed here would silently grow a sixth tab.
          hiddenRoutes={["onboarding", "notifications", "inbody", "stats", "library"]}
          fullScreenRoutes={["onboarding"]}
        />
      </RequireOnboarding>
    </RequireRole>
  );
}
