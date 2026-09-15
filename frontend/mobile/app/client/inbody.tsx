import { PhasePlaceholder } from "../../src/components/navigation/PhasePlaceholder";

/** CL — InBody. Linked from the dashboard's quick actions; the capture/history flow (including
 * expo-camera) belongs to Phase 6 together with the nutrition domain. */
export default function ClientInBodyScreen() {
  return (
    <PhasePlaceholder
      title="InBody"
      phase="Phase 6"
      description="Nhập tay / chụp phiếu InBody, lịch sử chỉ số cơ thể."
    />
  );
}
