import { Feather } from "@expo/vector-icons";
import { Screen, EmptyState } from "../../../src/ui";

// Thay bằng danh sách bài tập + log buổi tập ở P6.
export default function WorkoutsTab() {
  return (
    <Screen>
      <EmptyState
        icon={(p) => <Feather name="activity" {...p} />}
        title="Tập luyện"
        description="Danh sách bài tập và log buổi tập sẽ ở đây."
      />
    </Screen>
  );
}
