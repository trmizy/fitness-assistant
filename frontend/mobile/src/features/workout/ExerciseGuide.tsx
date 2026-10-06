import { ActivityIndicator, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Dumbbell } from "lucide-react-native";

import { Badge, BottomSheet, Card, EmptyState, ExerciseMedia } from "../../components/ui";
import { workoutService } from "../../services/api";
import { bodyPartLabel, difficultyLabel, equipmentLabel, loggingModeLabel } from "../../config/exerciseLabels";
import { useWorkspaceAccent } from "../../theme/workspace";

/**
 * How one exercise is done: the start/end-frame preview, its tags and the written instructions.
 * One body for the library's detail screen and for the sheet opened from a running session, so the
 * two can never describe the same exercise differently.
 */
export function ExerciseGuide({ exercise, compact }: { exercise: any; compact?: boolean }) {
  // An alias identical to the name says nothing; a source row is a record ({ sourceName, sourceUrl… }),
  // which the old `String(s)` fallback printed as "[object Object]".
  const name = String(exercise.exerciseName ?? "").trim().toLowerCase();
  const aliases: string[] = (exercise.aliases ?? [])
    .map((a: any) => String(a?.alias ?? "").trim())
    .filter((a: string, i: number, all: string[]) => a && a.toLowerCase() !== name && all.indexOf(a) === i);
  const sources: string[] = compact
    ? []
    : (exercise.sources ?? [])
        .map((s: any) => (typeof s === "string" ? s : (s?.title ?? s?.sourceName ?? s?.sourceUrl ?? s?.url ?? "")))
        .filter(Boolean);

  return (
    <View className="gap-3">
      <ExerciseMedia videoUrl={exercise.videoUrl} className="aspect-video w-full rounded-2xl" animate badge iconSize={32} />

      <View className="flex-row flex-wrap gap-1.5">
        <Badge tone="neutral">{bodyPartLabel(exercise.bodyPart)}</Badge>
        <Badge tone="neutral">{equipmentLabel(exercise.typeOfEquipment)}</Badge>
        <Badge tone="info">{loggingModeLabel(exercise.loggingMode)}</Badge>
        {exercise.difficultyLevel ? <Badge tone="warning">{difficultyLabel(exercise.difficultyLevel)}</Badge> : null}
        {exercise.source === "USER_CUSTOM" ? <Badge tone="success">Bài tự tạo</Badge> : null}
      </View>

      {aliases.length > 0 ? (
        <Text className="font-body text-xs text-muted-foreground">Tên khác: {aliases.join(", ")}</Text>
      ) : null}

      {exercise.instructions ? (
        <Card className="p-4">
          <Text className="mb-2 font-display text-base text-foreground">Hướng dẫn</Text>
          <Text className="font-body text-sm leading-6 text-muted-foreground">{exercise.instructions}</Text>
          {exercise.movementPattern ? (
            <Text className="mt-3 font-body text-xs text-muted-foreground">
              Kiểu chuyển động: {String(exercise.movementPattern).replace(/_/g, " ")}
              {exercise.mechanics ? ` · ${exercise.mechanics}` : ""}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {sources.length > 0 ? (
        <Card className="p-4">
          <Text className="mb-2 font-display text-base text-foreground">Nguồn</Text>
          {sources.map((label, i) => (
            <Text key={i} className="font-body text-xs leading-5 text-muted-foreground">
              • {label}
            </Text>
          ))}
        </Card>
      ) : null}
    </View>
  );
}

/** The catalog record behind an exercise id — the library's own query, so the two share a cache. */
export function useExercise(id: string | null | undefined) {
  const query = useQuery({
    queryKey: ["exercise", id],
    queryFn: () => workoutService.getExercise(String(id)),
    enabled: !!id,
  });
  return { query, exercise: ((query.data as any)?.exercise ?? query.data) as any };
}

/**
 * The guide as a sheet over a running session ("Đang tập"): tapping an exercise used to do nothing,
 * so the only way to check form was to leave the session for the library (partner test, 6/10; web
 * shows the same detail inside its log page). A sheet keeps the timer and the logged sets in place.
 */
export function ExerciseGuideSheet({
  target,
  onClose,
}: {
  target: { exerciseId: string; name: string } | null;
  onClose: () => void;
}) {
  const accent = useWorkspaceAccent();
  const { height } = useWindowDimensions();
  const { query, exercise } = useExercise(target?.exerciseId);

  return (
    <BottomSheet open={target != null} onClose={onClose} title={target?.name}>
      <ScrollView style={{ maxHeight: height * 0.62 }} showsVerticalScrollIndicator={false}>
        {query.isLoading ? (
          <View className="items-center py-12">
            <ActivityIndicator color={accent.primary} />
          </View>
        ) : !exercise ? (
          <EmptyState
            icon={Dumbbell}
            title="Chưa có hướng dẫn cho bài này"
            description={query.isError ? "Không tải được hướng dẫn. Kiểm tra kết nối rồi mở lại." : "Bài tập này không còn trong thư viện."}
          />
        ) : (
          <ExerciseGuide exercise={exercise} compact />
        )}
      </ScrollView>
    </BottomSheet>
  );
}
