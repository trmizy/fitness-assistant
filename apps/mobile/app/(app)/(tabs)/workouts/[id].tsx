import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Screen, Text, Card, Badge, SkeletonCard, ErrorNotice, spacing } from "../../../../src/ui";
import { useWorkoutQuery } from "../../../../src/api/queries";
import { formatShortDate } from "../../../../src/lib/date";

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: workout, isLoading, isError, refetch } = useWorkoutQuery(id);

  if (isLoading) {
    return (
      <Screen scroll>
        <SkeletonCard lines={3} />
        <SkeletonCard lines={3} />
      </Screen>
    );
  }

  if (isError || !workout) {
    return (
      <Screen scroll>
        <ErrorNotice message={isError ? undefined : "Không tìm thấy buổi tập"} onRetry={refetch} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Card>
        <Text variant="heading">{workout.name}</Text>
        <Text variant="caption">{formatShortDate(workout.date)}</Text>
        {workout.notes ? (
          <Text variant="caption" style={{ marginTop: spacing.xs }}>
            {workout.notes}
          </Text>
        ) : null}
      </Card>

      {workout.exercises.map((ex) => (
        <Card key={ex.id}>
          <Text variant="bodyStrong">{ex.exercise.exerciseName}</Text>
          <Text variant="caption" style={{ marginBottom: spacing.sm }}>
            Kế hoạch: {ex.sets} set × {ex.reps ?? "-"} reps{ex.weight ? ` @ ${ex.weight}kg` : ""}
          </Text>

          {ex.workoutSets && ex.workoutSets.length > 0 ? (
            <View style={{ gap: spacing.xs }}>
              {ex.workoutSets
                .sort((a, b) => a.setNumber - b.setNumber)
                .map((s) => (
                  <View key={s.id} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text variant="caption">Set {s.setNumber}</Text>
                    <View style={{ flexDirection: "row", gap: spacing.sm }}>
                      <Text variant="caption">{s.reps ?? "-"} reps</Text>
                      <Text variant="caption">{s.weight ?? "-"} kg</Text>
                      {s.rpe ? <Badge label={`RPE ${s.rpe}`} tone="neutral" /> : null}
                    </View>
                  </View>
                ))}
            </View>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}
