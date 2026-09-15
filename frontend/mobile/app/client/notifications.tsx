import { PhasePlaceholder } from "../../src/components/navigation/PhasePlaceholder";

/** SH — thông báo. Reachable from the dashboard's bell today so the header is the real one from
 * the reference; the list itself needs the notification domain ported in Phase 9. */
export default function ClientNotificationsScreen() {
  return (
    <PhasePlaceholder
      title="Thông báo"
      phase="Phase 9"
      description="Danh sách thông báo + điều hướng theo loại sự kiện."
    />
  );
}
