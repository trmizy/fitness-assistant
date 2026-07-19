import { Feather } from "@expo/vector-icons";
import { Screen, EmptyState } from "../../../src/ui";

// Thay bằng màn chat AI coach ở P10.
export default function CoachTab() {
  return (
    <Screen>
      <EmptyState
        icon={(p) => <Feather name="message-circle" {...p} />}
        title="Coach"
        description="Trò chuyện với AI coach sẽ ở đây."
      />
    </Screen>
  );
}
