import { useLocation } from "react-router";
import { Dumbbell, Search } from "lucide-react";
import { TabbedPage } from "../../components/TabbedPage";
import { GymsPage } from "./GymsPage";
import { GymMembershipsPage } from "./GymMembershipsPage";

export function GymPage() {
  // GymDetailPage navigates directly to /client/gym-memberships after a
  // purchase, expecting the memberships tab active, not the browse tab.
  const location = useLocation();
  const defaultTab = location.pathname.endsWith("/gym-memberships")
    ? "memberships"
    : "browse";

  return (
    <TabbedPage
      defaultTab={defaultTab}
      tabs={[
        {
          value: "browse",
          label: "Tìm phòng gym",
          icon: Search,
          content: <GymsPage />,
        },
        {
          value: "memberships",
          label: "Hội viên gym",
          icon: Dumbbell,
          content: <GymMembershipsPage />,
        },
      ]}
    />
  );
}
