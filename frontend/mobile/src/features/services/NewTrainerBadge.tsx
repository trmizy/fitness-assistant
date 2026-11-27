import { View } from "react-native";
import { Badge } from "../../components/ui";
import { NEW_TRAINER_DESCRIPTION, NEW_TRAINER_LABEL } from "./ptDiscovery";

/**
 * "Mới trên Gymini" chip for a trainer approved within the last 30 days (server decides: `isNewTrainer`).
 * Existing Badge, theme tokens only. Native has no hover tooltip, so the meaning is the screen-reader description.
 */
export function NewTrainerBadge({ className = "" }: { className?: string }) {
  return (
    <View
      testID="pt-new-trainer-badge"
      accessible
      accessibilityLabel={NEW_TRAINER_LABEL}
      accessibilityHint={NEW_TRAINER_DESCRIPTION}
      className={`self-start ${className}`}
    >
      <Badge tone="success">{NEW_TRAINER_LABEL}</Badge>
    </View>
  );
}
