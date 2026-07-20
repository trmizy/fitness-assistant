import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { Screen, Text, Card, Button, EmptyState, colors, spacing } from "../../../../src/ui";
import {
  useWorkoutDraftStore,
  computeTotalVolume,
} from "../../../../src/features/workouts/workoutDraftStore";
import { SetRow } from "../../../../src/features/workouts/SetRow";
import { workoutsApi } from "../../../../src/api/workouts";
import { getApiErrorMessage } from "../../../../src/api/client";

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export default function LogWorkoutScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { name, exercises, addSet, updateSet, removeSet, removeExercise, reset } =
    useWorkoutDraftStore();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalVolume = computeTotalVolume(exercises);
  const totalSets = exercises.reduce((sum, e) => sum + e.sets.length, 0);

  const onSubmit = async () => {
    setError(null);
    if (exercises.length === 0) return;
    setSubmitting(true);
    try {
      const workout = await workoutsApi.createWorkout({
        name,
        date: new Date().toISOString(),
        exercises: exercises.map((e) => ({
          exerciseId: e.exerciseId,
          sets: e.sets.length,
          reps: Math.round(average(e.sets.map((s) => s.reps))),
          weight: Math.round(average(e.sets.map((s) => s.weight)) * 10) / 10,
        })),
      });

      // Per-set detail (reps/weight/RPE per set) is recorded separately —
      // WorkoutExercise above only stores summary sets/reps/weight.
      for (const e of exercises) {
        for (let i = 0; i < e.sets.length; i++) {
          const s = e.sets[i];
          await workoutsApi.addSet(workout.id, {
            exerciseId: e.exerciseId,
            setNumber: i + 1,
            reps: s.reps,
            weight: s.weight,
            rpe: s.rpe,
          });
        }
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workouts"] }),
      ]);
      reset();
      router.replace(`/(app)/(tabs)/workouts/${workout.id}`);
    } catch (err) {
      setError(getApiErrorMessage(err, "Không thể lưu buổi tập"));
    } finally {
      setSubmitting(false);
    }
  };

  if (exercises.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon={(p) => <Feather name="clipboard" {...p} />}
          title="Chưa chọn bài tập nào"
          description="Thêm bài tập để bắt đầu ghi buổi tập."
          actionLabel="Chọn bài tập"
          onAction={() => router.push("/(app)/(tabs)/workouts/exercises")}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text variant="subheading">{name}</Text>
          <Text variant="bodyStrong" color={colors.accent}>
            {totalVolume.toLocaleString("vi-VN")} kg
          </Text>
        </View>
        <Text variant="caption">{totalSets} set · {exercises.length} bài tập</Text>
      </Card>

      {exercises.map((e) => (
        <Card key={e.exerciseId}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text variant="bodyStrong">{e.exerciseName}</Text>
            <Button label="Xoá bài" variant="ghost" size="sm" onPress={() => removeExercise(e.exerciseId)} />
          </View>

          {e.sets.map((s, idx) => (
            <SetRow
              key={s.localId}
              index={idx}
              set={s}
              onChange={(patch) => updateSet(e.exerciseId, s.localId, patch)}
              onRemove={() => removeSet(e.exerciseId, s.localId)}
            />
          ))}

          <Button
            label="+ Thêm set"
            variant="secondary"
            size="sm"
            onPress={() => addSet(e.exerciseId)}
            style={{ marginTop: spacing.sm }}
          />
        </Card>
      ))}

      <Button
        label="+ Thêm bài tập"
        variant="secondary"
        onPress={() => router.push("/(app)/(tabs)/workouts/exercises")}
      />

      {error ? (
        <Text variant="caption" color={colors.danger}>
          {error}
        </Text>
      ) : null}

      <Button label="Lưu buổi tập" onPress={onSubmit} loading={submitting} fullWidth />
    </Screen>
  );
}
