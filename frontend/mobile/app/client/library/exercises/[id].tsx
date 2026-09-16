import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Dumbbell } from "lucide-react-native";

import { Badge, Card, EmptyState, ExerciseMedia, Tappable } from "../../../../src/components/ui";
import { workoutService } from "../../../../src/services/api";
import {
  bodyPartLabel,
  difficultyLabel,
  equipmentLabel,
  loggingModeLabel,
} from "../../../../src/config/exerciseLabels";
import { useWorkspaceAccent } from "../../../../src/theme/workspace";

/**
 * SH-12 (detail) — one exercise.
 *
 * Behavioural authority: web's `ExerciseDetailPage.tsx`, including its media preview: `videoUrl`
 * holds a still JPG from the free-exercise-db dataset, which ships a start and an end frame per
 * exercise, so the movement is shown by cross-fading the two (`ExerciseMedia`). No video player is
 * involved — an earlier note here assumed `expo-video` was needed and left the image out entirely.
 */
export default function ExerciseDetailScreen() {
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const query = useQuery({
    queryKey: ["exercise", id],
    queryFn: () => workoutService.getExercise(String(id)),
    enabled: !!id,
  });

  const exercise: any = (query.data as any)?.exercise ?? query.data;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 32 }}
    >
      <View className="flex-row items-center gap-2 px-5">
        <Tappable
          className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
          onPress={() => router.back()}
        >
          <ChevronLeft size={20} color="#8b9299" />
        </Tappable>
        <Text className="flex-1 font-display text-xl text-foreground" numberOfLines={1}>
          {exercise?.exerciseName ?? "Bài tập"}
        </Text>
      </View>

      {query.isLoading ? (
        <View className="items-center py-16">
          <ActivityIndicator color={accent.primary} />
        </View>
      ) : !exercise ? (
        <EmptyState
          icon={Dumbbell}
          title="Không tìm thấy bài tập"
          description="Bài tập này có thể đã bị gỡ khỏi catalog."
        />
      ) : (
        <View className="gap-3 px-5 pt-5">
          <ExerciseMedia
            videoUrl={exercise.videoUrl}
            className="aspect-video w-full rounded-2xl"
            animate
            badge
            iconSize={32}
          />

          <View className="flex-row flex-wrap gap-1.5">
            <Badge tone="neutral">{bodyPartLabel(exercise.bodyPart)}</Badge>
            <Badge tone="neutral">{equipmentLabel(exercise.typeOfEquipment)}</Badge>
            <Badge tone="info">{loggingModeLabel(exercise.loggingMode)}</Badge>
            {exercise.difficultyLevel ? (
              <Badge tone="warning">{difficultyLabel(exercise.difficultyLevel)}</Badge>
            ) : null}
            {exercise.source === "USER_CUSTOM" ? <Badge tone="success">Bài tự tạo</Badge> : null}
          </View>

          {exercise.aliases?.length > 0 ? (
            <Text className="font-body text-xs text-muted-foreground">
              Tên khác: {exercise.aliases.map((a: any) => a.alias).join(", ")}
            </Text>
          ) : null}

          {exercise.instructions ? (
            <Card className="p-4">
              <Text className="mb-2 font-display text-base text-foreground">Hướng dẫn</Text>
              <Text className="font-body text-sm leading-6 text-muted-foreground">
                {exercise.instructions}
              </Text>
              {exercise.movementPattern ? (
                <Text className="mt-3 font-body text-xs text-muted-foreground">
                  Kiểu chuyển động: {String(exercise.movementPattern).replace(/_/g, " ")}
                  {exercise.mechanics ? ` · ${exercise.mechanics}` : ""}
                </Text>
              ) : null}
            </Card>
          ) : null}

          {exercise.sources?.length > 0 ? (
            <Card className="p-4">
              <Text className="mb-2 font-display text-base text-foreground">Nguồn</Text>
              {exercise.sources.map((s: any, i: number) => (
                <Text key={i} className="font-body text-xs leading-5 text-muted-foreground">
                  • {s?.title ?? s?.url ?? String(s)}
                </Text>
              ))}
            </Card>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}
