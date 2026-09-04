import { CalendarCheckIcon as CalendarClock, BarbellIcon as Dumbbell } from "@phosphor-icons/react";
import { TabbedPage } from "../../components/TabbedPage";
import { WorkoutLogPage } from "./WorkoutLogPage";
import { TrainingCyclePage } from "./TrainingCyclePage";

export function TrainingPage() {
  return (
    <TabbedPage
      tabs={[
        {
          value: "workout",
          label: "Nhật ký tập",
          icon: Dumbbell,
          content: <WorkoutLogPage />,
        },
        {
          value: "cycle",
          label: "Chu kỳ tập luyện",
          icon: CalendarClock,
          content: <TrainingCyclePage />,
        },
      ]}
    />
  );
}
