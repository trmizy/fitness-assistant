import { useLocation } from "react-router";
import { CalendarIcon as Calendar, MagnifyingGlassIcon as Search } from "@phosphor-icons/react";
import { TabbedPage } from "../../components/TabbedPage";
import { PTDiscoveryPage } from "./PTDiscoveryPage";
import { BookingPage } from "./BookingPage";

export function CoachingPage() {
  // ContractPage navigates directly to /client/booking expecting the
  // booking tab to be active, not the default "Tìm PT" search tab.
  const location = useLocation();
  const defaultTab = location.pathname.endsWith("/booking")
    ? "booking"
    : "coaches";

  return (
    <TabbedPage
      defaultTab={defaultTab}
      tabs={[
        {
          value: "coaches",
          label: "Tìm PT",
          icon: Search,
          content: <PTDiscoveryPage />,
        },
        {
          value: "booking",
          label: "Đặt lịch",
          icon: Calendar,
          content: <BookingPage />,
        },
      ]}
    />
  );
}
