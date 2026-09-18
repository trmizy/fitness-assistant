import { BarbellIcon as Dumbbell, MapTrifoldIcon as MapTrifold } from "@phosphor-icons/react";
import { TabbedPage } from "../../components/TabbedPage";
import { WorkoutLogPage } from "./WorkoutLogPage";
import { RoadmapJourneyPage } from "./RoadmapJourneyPage";

// Gymini Training Navigation Simplification (design doc §14) — TrainingCycle
// used to be a third, equal-weight tab here ("Chu kỳ tập luyện"). It is no
// longer a top-level concept: current-cycle info now lives inline inside
// the "Lộ trình" tab (RoadmapJourneyPage), with a "Xem chi tiết chu kỳ"
// link drilling into the still-fully-functional TrainingCyclePage at
// /workout/cycle (see routes.tsx) — the page itself was never deleted.
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
          value: "journey",
          label: "Lộ trình",
          icon: MapTrifold,
          content: <RoadmapJourneyPage />,
        },
      ]}
    />
  );
}
