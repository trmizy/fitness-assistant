import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, PersonStanding, Search } from "lucide-react-native";

import { Card, EmptyState, ExerciseMedia, Input, Tappable } from "../../../src/components/ui";
import { workoutService } from "../../../src/services/api";
import { bodyPartLabel, equipmentLabel } from "../../../src/config/exerciseLabels";
import { useWorkspaceAccent } from "../../../src/theme/workspace";

const MAX_GROUP_RESULTS = 8;
/** Same floor as web: a one-character query matches most of the catalog and helps nobody. */
const MIN_QUERY_LENGTH = 2;

function textMatches(query: string, values: (string | null | undefined)[]) {
  const q = query.trim().toLowerCase();
  return values.some((value) => (value ?? "").toLowerCase().includes(q));
}

/**
 * SH-14 — global search across the library.
 *
 * Behavioural authority: web's `GlobalSearchPage.tsx` — same two-character floor, same per-group
 * cap, same client-side filtering of the muscle taxonomy (it arrives whole, so filtering it here
 * is both faster and the only way to match on `anatomyRegion`).
 *
 * Web searches four groups; this searches the two whose screens exist. Foods and nutrition
 * articles join in Phase 6 alongside their own screens — returning results that navigate to a
 * placeholder would be worse than not offering them yet.
 */
export default function GlobalSearchScreen() {
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 350);
    return () => clearTimeout(t);
  }, [input]);

  const canSearch = query.length >= MIN_QUERY_LENGTH;

  const results = useQuery({
    queryKey: ["global-search", query],
    queryFn: async () => {
      const [exercises, muscles] = await Promise.all([
        workoutService.getExercises({ search: query, page: 1, limit: MAX_GROUP_RESULTS }),
        workoutService.getMuscleTaxonomy(),
      ]);
      return {
        exercises: (Array.isArray(exercises) ? exercises : []).slice(0, MAX_GROUP_RESULTS),
        muscles: (Array.isArray(muscles) ? muscles : [])
          .filter((m) => textMatches(query, [m.code, m.nameVi, m.nameEn, m.anatomyRegion]))
          .slice(0, MAX_GROUP_RESULTS),
      };
    },
    enabled: canSearch,
    staleTime: 60_000,
  });

  const exercises = results.data?.exercises ?? [];
  const muscles = results.data?.muscles ?? [];
  const nothingFound = canSearch && !results.isLoading && exercises.length === 0 && muscles.length === 0;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top + 12 }}>
      <View className="flex-row items-center gap-2 px-5">
        <Tappable
          className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
          onPress={() => router.back()}
        >
          <ChevronLeft size={20} color="#8b9299" />
        </Tappable>
        <Text className="flex-1 font-display text-xl text-foreground">Tìm kiếm</Text>
      </View>

      <View className="px-5 pt-4">
        <Input
          value={input}
          onChangeText={setInput}
          placeholder="Tìm bài tập, nhóm cơ…"
          icon={Search}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        {!canSearch ? (
          <Text className="pt-6 text-center font-body text-sm text-muted-foreground">
            Nhập ít nhất {MIN_QUERY_LENGTH} ký tự để tìm.
          </Text>
        ) : results.isLoading ? (
          <View className="items-center pt-10">
            <ActivityIndicator color={accent.primary} />
          </View>
        ) : nothingFound ? (
          <EmptyState
            icon={Search}
            title="Không có kết quả"
            description={`Không tìm thấy gì khớp với "${query}".`}
          />
        ) : (
          <View className="gap-5">
            {exercises.length > 0 ? (
              <Group title="Bài tập">
                {exercises.map((ex: any) => (
                  <Card
                    key={String(ex.id)}
                    className="mb-2.5 flex-row items-center gap-3 p-4"
                    onPress={() =>
                      router.push({
                        pathname: "/client/library/exercises/[id]",
                        params: { id: String(ex.id) },
                      })
                    }
                  >
                    <ExerciseMedia
                      videoUrl={ex.videoUrl}
                      className="h-12 w-12 shrink-0 rounded-xl"
                      iconSize={19}
                    />
                    <View className="flex-1">
                      <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                        {ex.exerciseName}
                      </Text>
                      <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                        {bodyPartLabel(ex.bodyPart)} · {equipmentLabel(ex.typeOfEquipment)}
                      </Text>
                    </View>
                  </Card>
                ))}
              </Group>
            ) : null}

            {muscles.length > 0 ? (
              <Group title="Nhóm cơ">
                {muscles.map((m) => (
                  <Card
                    key={m.code}
                    className="mb-2.5 flex-row items-center gap-3 p-4"
                    onPress={() =>
                      router.push({
                        pathname: "/client/library/exercises",
                        params: { search: m.nameVi },
                      })
                    }
                  >
                    <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
                      <PersonStanding size={19} color={accent.primary} />
                    </View>
                    <View className="flex-1">
                      <Text className="font-body-semibold text-sm text-foreground">{m.nameVi}</Text>
                      {m.nameEn ? (
                        <Text className="font-body text-xs text-muted-foreground">{m.nameEn}</Text>
                      ) : null}
                    </View>
                  </Card>
                ))}
              </Group>
            ) : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text className="mb-2 px-1 font-body text-[11px] uppercase tracking-wide text-muted-foreground">
        {title}
      </Text>
      {children}
    </View>
  );
}
