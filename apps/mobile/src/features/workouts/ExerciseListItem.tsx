import { Pressable, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Text, Badge, colors, radius, spacing } from "../../ui";
import type { Exercise } from "../../api/exercises";

const BODY_PART_LABEL: Record<Exercise["bodyPart"], string> = {
  UPPER_BODY: "Thân trên",
  LOWER_BODY: "Thân dưới",
  CORE: "Core",
  FULL_BODY: "Toàn thân",
};

interface ExerciseListItemProps {
  exercise: Exercise;
  selected: boolean;
  onToggle: () => void;
}

export function ExerciseListItem({ exercise, selected, onToggle }: ExerciseListItemProps) {
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          backgroundColor: selected ? colors.accentSoft : "transparent",
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{exercise.exerciseName}</Text>
        <View style={{ flexDirection: "row", gap: spacing.xs, marginTop: 4, flexWrap: "wrap" }}>
          <Badge label={BODY_PART_LABEL[exercise.bodyPart]} tone="neutral" />
          {exercise.muscleGroupsActivated.slice(0, 2).map((mg) => (
            <Badge key={mg} label={mg} tone="neutral" />
          ))}
        </View>
      </View>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: radius.full,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: selected ? colors.accent : colors.surfaceAlt,
        }}
      >
        <Feather name={selected ? "check" : "plus"} size={16} color={selected ? colors.onAccent : colors.textMuted} />
      </View>
    </Pressable>
  );
}
