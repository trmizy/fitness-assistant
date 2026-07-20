import { useMemo, useState } from "react";
import { FlatList, View, Pressable } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import {
  Screen,
  Text,
  Input,
  Button,
  EmptyState,
  SkeletonCard,
  ErrorNotice,
  colors,
  spacing,
  radius,
} from "../../../../src/ui";
import { useExercisesQuery, useExerciseFilterOptionsQuery } from "../../../../src/api/queries";
import { useDebouncedValue } from "../../../../src/lib/useDebouncedValue";
import { ExerciseListItem } from "../../../../src/features/workouts/ExerciseListItem";
import { useWorkoutDraftStore } from "../../../../src/features/workouts/workoutDraftStore";

export default function ExercisesScreen() {
  const router = useRouter();
  const { pick } = useLocalSearchParams<{ pick?: string }>();
  const isPickMode = pick === "1";

  const [search, setSearch] = useState("");
  const [muscleGroup, setMuscleGroup] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  const { data: filterOptions } = useExerciseFilterOptionsQuery();
  const { data, isLoading, isError, refetch } = useExercisesQuery({
    search: debouncedSearch || undefined,
    muscleGroup: muscleGroup ?? undefined,
    limit: 50,
  });

  const exercises = useWorkoutDraftStore((s) => s.exercises);
  const addExercise = useWorkoutDraftStore((s) => s.addExercise);
  const removeExercise = useWorkoutDraftStore((s) => s.removeExercise);
  const selectedIds = useMemo(() => new Set(exercises.map((e) => e.exerciseId)), [exercises]);

  return (
    <Screen padded={false} style={{ flex: 1 }}>
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <Input
          placeholder="Tìm bài tập..."
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={filterOptions?.muscleGroups ?? []}
          keyExtractor={(item) => item}
          contentContainerStyle={{ gap: spacing.xs }}
          renderItem={({ item }) => {
            const active = muscleGroup === item;
            return (
              <Pressable
                onPress={() => setMuscleGroup(active ? null : item)}
                style={{
                  paddingVertical: 6,
                  paddingHorizontal: spacing.md,
                  borderRadius: radius.full,
                  borderWidth: 1,
                  borderColor: active ? colors.accent : colors.border,
                  backgroundColor: active ? colors.accent : "transparent",
                }}
              >
                <Text variant="small" color={active ? colors.onAccent : colors.textSecondary}>
                  {item}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>

      {isLoading ? (
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </View>
      ) : isError ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ErrorNotice onRetry={refetch} />
        </View>
      ) : (
        <FlatList
          data={data?.exercises ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ExerciseListItem
              exercise={item}
              selected={selectedIds.has(item.id)}
              onToggle={() =>
                selectedIds.has(item.id) ? removeExercise(item.id) : addExercise(item.id, item.exerciseName)
              }
            />
          )}
          ItemSeparatorComponent={() => (
            <View style={{ height: 1, backgroundColor: colors.border, marginHorizontal: spacing.lg }} />
          )}
          ListEmptyComponent={
            <EmptyState
              icon={(p) => <Feather name="search" {...p} />}
              title="Không tìm thấy bài tập"
              description="Thử từ khoá hoặc nhóm cơ khác."
            />
          }
          contentContainerStyle={{ paddingBottom: exercises.length > 0 ? 96 : spacing.lg }}
          initialNumToRender={16}
          windowSize={7}
          removeClippedSubviews
        />
      )}

      {exercises.length > 0 ? (
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: spacing.lg,
            backgroundColor: colors.surface,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <Button
            label={`Tiếp tục (${exercises.length} bài đã chọn)`}
            onPress={() =>
              isPickMode
                ? router.back()
                : router.push("/(app)/(tabs)/workouts/log")
            }
            fullWidth
          />
        </View>
      ) : null}
    </Screen>
  );
}
