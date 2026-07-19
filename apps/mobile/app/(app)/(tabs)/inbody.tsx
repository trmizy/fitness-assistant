import { Feather } from "@expo/vector-icons";
import { Screen, EmptyState } from "../../../src/ui";

// Thay bằng danh sách + biểu đồ trend InBody ở P8.
export default function InBodyTab() {
  return (
    <Screen>
      <EmptyState
        icon={(p) => <Feather name="bar-chart-2" {...p} />}
        title="InBody"
        description="Lịch sử đo và biểu đồ trend sẽ ở đây."
      />
    </Screen>
  );
}
