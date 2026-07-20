import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import NetInfo from "@react-native-community/netinfo";
import axios from "axios";
import { Feather } from "@expo/vector-icons";
import { Screen, Text, Card, Button, Badge, EmptyState, colors, spacing } from "../../../../src/ui";
import {
  useWorkoutDraftStore,
  computeTotalVolume,
} from "../../../../src/features/workouts/workoutDraftStore";
import { SetRow } from "../../../../src/features/workouts/SetRow";
import { submitWorkoutLog } from "../../../../src/features/workouts/submitWorkoutLog";
import { getApiErrorMessage } from "../../../../src/api/client";
import { queryKeys } from "../../../../src/api/queries";
import { enqueueWorkoutLog, isOfflineQueueSupported } from "../../../../src/offline/workoutQueue";

function isNetworkError(err: unknown): boolean {
  return axios.isAxiosError(err) && !err.response;
}

export default function LogWorkoutScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { name, exercises, addSet, updateSet, removeSet, removeExercise, reset } =
    useWorkoutDraftStore();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedOffline, setQueuedOffline] = useState(false);

  const totalVolume = computeTotalVolume(exercises);
  const totalSets = exercises.reduce((sum, e) => sum + e.sets.length, 0);

  const queueForLater = async () => {
    await enqueueWorkoutLog({ name, date: new Date().toISOString(), exercises });
    await queryClient.invalidateQueries({ queryKey: queryKeys.pendingWorkoutLogs });
    reset();
    setQueuedOffline(true);
  };

  const onSubmit = async () => {
    setError(null);
    if (exercises.length === 0) return;
    setSubmitting(true);
    try {
      const net = await NetInfo.fetch();
      if (isOfflineQueueSupported() && net.isConnected === false) {
        await queueForLater();
        return;
      }

      const workout = await submitWorkoutLog({ name, date: new Date().toISOString(), exercises });
      await queryClient.invalidateQueries({ queryKey: ["workouts"] });
      reset();
      router.replace(`/(app)/(tabs)/workouts/${workout.id}`);
    } catch (err) {
      if (isOfflineQueueSupported() && isNetworkError(err)) {
        await queueForLater();
        return;
      }
      setError(getApiErrorMessage(err, "Không thể lưu buổi tập"));
    } finally {
      setSubmitting(false);
    }
  };

  if (queuedOffline) {
    return (
      <Screen>
        <EmptyState
          icon={(p) => <Feather name="cloud-off" {...p} />}
          title="Đã lưu offline"
          description="Buổi tập sẽ tự động đồng bộ khi có mạng trở lại."
          actionLabel="Về Tập luyện"
          onAction={() => router.replace("/(app)/(tabs)/workouts")}
        />
      </Screen>
    );
  }

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
        <View style={{ gap: spacing.xs }}>
          <Text variant="caption" color={colors.danger}>
            {error}
          </Text>
          {isOfflineQueueSupported() ? <Badge label="Sẽ tự lưu offline nếu mất mạng" tone="neutral" /> : null}
        </View>
      ) : null}

      <Button label="Lưu buổi tập" onPress={onSubmit} loading={submitting} fullWidth />
    </Screen>
  );
}
