import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft, Dumbbell } from "lucide-react-native";

import { EmptyState, Tappable } from "../../../../src/components/ui";
import { ExerciseGuide, useExercise } from "../../../../src/features/workout/ExerciseGuide";
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

  const { query, exercise } = useExercise(id);

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
        <View className="px-5 pt-5">
          <ExerciseGuide exercise={exercise} />
        </View>
      )}
    </ScrollView>
  );
}
