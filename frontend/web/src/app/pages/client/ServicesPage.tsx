import { useLocation } from "react-router";
import { Calendar, Dumbbell, FileText, Search, Store } from "lucide-react";
import { TabbedPage } from "../../components/TabbedPage";
import { BookingPage } from "./BookingPage";
import { ContractPage } from "./ContractPage";
import { GymMembershipsPage } from "./GymMembershipsPage";
import { GymsPage } from "./GymsPage";
import { PTDiscoveryPage } from "./PTDiscoveryPage";

type ServiceTab = "coaches" | "booking" | "contracts" | "gyms" | "memberships";

/** Keep legacy deep links useful while presenting one unified service workspace. */
export function resolveServiceTab(pathname: string): ServiceTab {
  if (pathname.endsWith("/booking")) return "booking";
  if (pathname.endsWith("/contracts")) return "contracts";
  if (pathname.endsWith("/gym-memberships")) return "memberships";
  if (pathname.endsWith("/gyms")) return "gyms";
  return "coaches";
}

export function ServicesPage() {
  const location = useLocation();

  return (
    <TabbedPage
      defaultTab={resolveServiceTab(location.pathname)}
      tabs={[
        { value: "coaches", label: "Tìm PT", icon: Search, content: <PTDiscoveryPage /> },
        { value: "booking", label: "Đặt lịch", icon: Calendar, content: <BookingPage /> },
        { value: "contracts", label: "Hợp đồng", icon: FileText, content: <ContractPage /> },
        { value: "gyms", label: "Phòng gym", icon: Store, content: <GymsPage /> },
        { value: "memberships", label: "Hội viên gym", icon: Dumbbell, content: <GymMembershipsPage /> },
      ]}
    />
  );
}
