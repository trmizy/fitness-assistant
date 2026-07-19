import { Feather } from "@expo/vector-icons";
import { Screen, EmptyState } from "../../../src/ui";

// Thay bằng workout/nutrition plan + card quyết định chu kỳ ở P9.
export default function PlansTab() {
  return (
    <Screen>
      <EmptyState
        icon={(p) => <Feather name="clipboard" {...p} />}
        title="Kế hoạch"
        description="Kế hoạch tập luyện, dinh dưỡng và quyết định chu kỳ sẽ ở đây."
      />
    </Screen>
  );
}
