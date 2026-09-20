import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Dumbbell, Repeat } from "lucide-react-native";

import { Badge, Card, EmptyState, ExerciseMedia, ScreenHeader } from "../../../src/components/ui";
import { workoutService } from "../../../src/services/api";
import { useWorkspaceAccent } from "../../../src/theme/workspace";

/**
 * A finished workout, opened from "Gần đây" on the Nhật ký tab.
 *
 * Read-only on purpose: editing a past session is web's `WorkoutLogPage` territory and depends on
 * the whole set-skeleton editing surface. What a phone actually needs here is "what did I lift
 * last Tuesday" — so this renders the session's exercises and their sets, nothing more.
 */
/** Logged rows live in `workoutSets`; `sets` is the planned set count (a number). */
function loggedSets(ex: any): any[] {
  if (Array.isArray(ex?.workoutSets)) return ex.workoutSets;
  return Array.isArray(ex?.sets) ? ex.sets : [];
}

export default function WorkoutDetailScreen() {
  const accent = useWorkspaceAccent();
  const { id } = useLocalSearchParams<{ id: string }>();

  const query = useQuery({
    queryKey: ["workout", id],
    queryFn: () => workoutService.getWorkout(String(id)),
    enabled: !!id,
  });

  const workout: any = (query.data as any)?.workout ?? (query.data as any)?.data ?? query.data;
  const exercises: any[] = Array.isArray(workout?.exercises) ? workout.exercises : [];

  const totalVolume = exercises.reduce((v: number, ex: any) => {
    const sets = loggedSets(ex);
    return (
      v +
      sets
        .filter((s) => s?.completed)
        .reduce((a, s) => a + Number(s?.weight ?? 0) * Number(s?.reps ?? 0), 0)
    );
  }, 0);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={workout?.name ?? "Buổi tập"} onBack={() => router.back()} />

      {query.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={accent.primary} />
        </View>
      ) : !workout ? (
        <EmptyState icon={Dumbbell} title="Không tìm thấy buổi tập này" />
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 }}
        >
          <Card className="mb-4 flex-row items-center gap-4 p-4">
            <View className="flex-1">
              <Text className="font-body text-xs text-muted-foreground">Tổng khối lượng</Text>
              <Text
                className="font-display text-2xl text-foreground"
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {totalVolume.toLocaleString("vi-VN")} kg
              </Text>
            </View>
            <View className="flex-1">
              <Text className="font-body text-xs text-muted-foreground">Số bài</Text>
              <Text
                className="font-display text-2xl text-foreground"
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {exercises.length}
              </Text>
            </View>
          </Card>

          {exercises.length === 0 ? (
            <EmptyState icon={Dumbbell} title="Buổi tập này không có bài nào" />
          ) : (
            <View className="gap-3">
              {exercises.map((ex: any, i: number) => {
                const sets = loggedSets(ex);
                return (
                  <Card key={String(ex?.id ?? i)} className="p-4">
                    <View className="mb-2.5 flex-row items-center gap-3">
                      <ExerciseMedia
                        videoUrl={ex?.exercise?.videoUrl ?? ex?.videoUrl}
                        className="h-12 w-12 shrink-0 rounded-xl"
                        iconSize={18}
                      />
                      <Text
                        className="flex-1 font-body-semibold text-sm text-foreground"
                        numberOfLines={1}
                      >
                        {ex?.exercise?.exerciseName ?? ex?.exerciseName ?? ex?.name ?? "Bài tập"}
                      </Text>
                      <Badge tone="neutral">{sets.length} set</Badge>
                    </View>
                    {sets.map((s: any, si: number) => (
                      <View
                        key={String(s?.id ?? si)}
                        className="flex-row items-center gap-2 border-t border-border py-2"
                      >
                        <Text className="w-6 text-center font-display text-xs text-muted-foreground">
                          {s?.setNumber ?? si + 1}
                        </Text>
                        <Repeat size={12} color="#8b9299" />
                        <Text
                          className="flex-1 font-body text-sm text-foreground"
                          style={{ fontVariant: ["tabular-nums"] }}
                        >
                          {s?.reps ?? "—"} reps × {s?.weight ?? 0} kg
                        </Text>
                        {s?.rpe != null ? (
                          <Text className="font-body text-xs text-muted-foreground">RPE {s.rpe}</Text>
                        ) : null}
                      </View>
                    ))}
                  </Card>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}
