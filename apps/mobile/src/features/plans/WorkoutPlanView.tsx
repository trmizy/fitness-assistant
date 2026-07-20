import { View } from "react-native";
import { Card, Text, Badge, colors, spacing } from "../../ui";
import type { WorkoutPlan } from "../../api/plans";

export function WorkoutPlanView({ plan }: { plan: WorkoutPlan }) {
  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <Text variant="subheading">{plan.name}</Text>
        <Text variant="caption">{plan.description}</Text>
        <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
          <Badge label={`${plan.duration} tuần`} tone="neutral" />
          <Badge label={`${plan.daysPerWeek} ngày/tuần`} tone="neutral" />
        </View>
      </Card>

      {plan.plan.weeklySchedule.map((day, idx) => (
        <Card key={`${day.day}-${idx}`}>
          <Text variant="bodyStrong">{day.day}</Text>
          <Text variant="caption" style={{ marginBottom: spacing.sm }}>
            {day.goal}
          </Text>
          {day.exercises.map((ex) => (
            <View
              key={`${ex.exerciseId}-${ex.order}`}
              style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}
            >
              <Text variant="caption" style={{ flex: 1 }}>
                {ex.order}. {ex.name}
              </Text>
              <Text variant="caption" color={colors.textSecondary}>
                {ex.sets} × {ex.reps}
              </Text>
            </View>
          ))}
          {day.cardio ? (
            <Text variant="small" style={{ marginTop: spacing.xs }}>
              Cardio: {day.cardio}
            </Text>
          ) : null}
        </Card>
      ))}
    </View>
  );
}
