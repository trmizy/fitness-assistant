import { PhasePlaceholder } from "../../../src/components/navigation/PhasePlaceholder";

/**
 * CL-15 — thống kê hoạt động.
 *
 * NOTE: the migration manifest lists CL-15 under Phase 5, but the plan's own phase description
 * puts `Stats.tsx` in Phase 6 ("Dinh dưỡng + InBody + Thống kê"). Reported to Ngài rather than
 * resolved unilaterally; parked here in the meantime so the dashboard's "Thống kê" quick action
 * resolves. The dashboard already reads the same `/stats/activity-heatmap` endpoint this screen
 * will use, so the data path is proven.
 */
export default function ClientActivityStatsScreen() {
  return (
    <PhasePlaceholder
      title="Thống kê"
      phase="Phase 6"
      description="Lịch nhiệt hoạt động, bản đồ nhóm cơ, biểu đồ tiến bộ theo bài."
    />
  );
}
