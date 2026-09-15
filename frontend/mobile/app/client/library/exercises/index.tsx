import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { FlashList } from "@shopify/flash-list";
import { ChevronLeft, ChevronRight, Dumbbell, Search } from "lucide-react-native";

import { Badge, Card, EmptyState, Input, Tappable, inputPlaceholderColor } from "../../../../src/components/ui";
import { workoutService } from "../../../../src/services/api";
import {
  EXERCISE_PAGE_SIZE,
  bodyPartLabel,
  difficultyLabel,
  equipmentLabel,
  loggingModeLabel,
} from "../../../../src/config/exerciseLabels";
import { useWorkspaceAccent } from "../../../../src/theme/workspace";

/**
 * SH-12 — exercise catalog.
 *
 * Behavioural authority: web's `ExerciseLibraryPage.tsx`. Same query key shape, same 350 ms
 * debounce (spec §29), same page size, same "reset to page 1 whenever a filter changes" rule.
 *
 * `FlashList` rather than `FlatList`: this is the longest list in the client app and the Phase
 * 0.5 audit asked for a virtualized list here specifically. FlashList v2 is JS-only under the
 * New Architecture (its peer deps are just react/react-native/@babel/runtime — no native module,
 * so no dev-client rebuild), which is what made it the safe pick over keeping FlatList.
 *
 * `keepPreviousData` matters on a phone: without it every page turn blanks the list and jumps
 * the scroll position to the top while the next page loads.
 */
export default function ExerciseLibraryScreen() {
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ search?: string }>();

  const [searchInput, setSearchInput] = useState(params.search ?? "");
  const [search, setSearch] = useState(params.search ?? "");
  const [bodyPart, setBodyPart] = useState("");
  const [equipment, setEquipment] = useState("");
  const [page, setPage] = useState(1);

  // Debounced search — one request per pause, not per keystroke, against a catalog this size.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [bodyPart, equipment]);

  const filterOptionsQuery = useQuery({
    queryKey: ["exercise-filter-options"],
    queryFn: () => workoutService.getExerciseFilterOptions(),
    staleTime: 5 * 60_000,
  });

  const listQuery = useQuery({
    queryKey: ["exercise-library", { search, bodyPart, equipment, page }],
    queryFn: () =>
      workoutService.getExercises({
        search: search || undefined,
        bodyPart: bodyPart || undefined,
        equipment: equipment || undefined,
        page,
        limit: EXERCISE_PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });

  const exercises: any[] = Array.isArray(listQuery.data) ? listQuery.data : [];
  const filters: any = filterOptionsQuery.data?.data ?? filterOptionsQuery.data;

  const bodyParts: string[] = useMemo(
    () => (Array.isArray(filters?.bodyParts) ? filters.bodyParts : []),
    [filters],
  );
  const equipments: string[] = useMemo(
    () => (Array.isArray(filters?.equipment) ? filters.equipment : []),
    [filters],
  );

  // The catalog endpoint returns a page, not a total, so "there may be more" is inferred the
  // same way web does it: a full page means another one probably exists.
  const hasNextPage = exercises.length === EXERCISE_PAGE_SIZE;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top + 12 }}>
      <View className="flex-row items-center gap-2 px-5">
        <Tappable
          className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
          onPress={() => router.back()}
        >
          <ChevronLeft size={20} color="#8b9299" />
        </Tappable>
        <Text className="flex-1 font-display text-xl text-foreground">Thư viện bài tập</Text>
      </View>

      <View className="px-5 pt-4">
        <Input
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder="Tìm bài tập…"
          placeholderTextColor={inputPlaceholderColor}
          icon={Search}
          autoCorrect={false}
        />
      </View>

      <FilterRow label="Nhóm" options={bodyParts} value={bodyPart} onChange={setBodyPart} format={bodyPartLabel} />
      <FilterRow label="Thiết bị" options={equipments} value={equipment} onChange={setEquipment} format={equipmentLabel} />

      {listQuery.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={accent.primary} />
        </View>
      ) : exercises.length === 0 ? (
        <EmptyState
          icon={Dumbbell}
          title="Không tìm thấy bài tập nào"
          description="Thử bỏ bớt bộ lọc hoặc đổi từ khoá tìm kiếm."
        />
      ) : (
        <FlashList
          data={exercises}
          keyExtractor={(item: any) => String(item.id)}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 }}
          ItemSeparatorComponent={() => <View className="h-2.5" />}
          renderItem={({ item }) => (
            <Card
              className="flex-row items-center gap-3 p-4"
              onPress={() =>
                router.push({
                  pathname: "/client/library/exercises/[id]",
                  params: { id: String(item.id) },
                })
              }
            >
              <View className="h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15">
                <Dumbbell size={20} color={accent.primary} />
              </View>
              <View className="flex-1">
                <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                  {item.exerciseName}
                </Text>
                <View className="mt-1.5 flex-row flex-wrap gap-1.5">
                  <Badge tone="neutral">{bodyPartLabel(item.bodyPart)}</Badge>
                  <Badge tone="neutral">{equipmentLabel(item.typeOfEquipment)}</Badge>
                  <Badge tone="info">{loggingModeLabel(item.loggingMode)}</Badge>
                  {item.difficultyLevel ? (
                    <Badge tone="warning">{difficultyLabel(item.difficultyLevel)}</Badge>
                  ) : null}
                </View>
              </View>
              <ChevronRight size={18} color="#8b9299" />
            </Card>
          )}
          ListFooterComponent={
            <View className="flex-row items-center justify-between pt-4">
              <Tappable
                className={`flex-row items-center gap-1 rounded-xl border border-border px-3.5 py-2 ${page <= 1 ? "opacity-40" : ""}`}
                disabled={page <= 1}
                onPress={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft size={16} color="#8b9299" />
                <Text className="font-body text-xs text-muted-foreground">Trước</Text>
              </Tappable>
              <Text className="font-body text-xs text-muted-foreground">
                Trang {page}
                {listQuery.isFetching ? " · đang tải…" : ""}
              </Text>
              <Tappable
                className={`flex-row items-center gap-1 rounded-xl border border-border px-3.5 py-2 ${!hasNextPage ? "opacity-40" : ""}`}
                disabled={!hasNextPage}
                onPress={() => setPage((p) => p + 1)}
              >
                <Text className="font-body text-xs text-muted-foreground">Sau</Text>
                <ChevronRight size={16} color="#8b9299" />
              </Tappable>
            </View>
          }
        />
      )}
    </View>
  );
}

function FilterRow({
  label,
  options,
  value,
  onChange,
  format,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (next: string) => void;
  format: (raw: string) => string;
}) {
  if (options.length === 0) return null;
  return (
    <View className="pt-3">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 px-5">
        <Text className="self-center font-body text-[11px] uppercase text-muted-foreground">{label}</Text>
        <Chip active={value === ""} label="Tất cả" onPress={() => onChange("")} />
        {options.map((option) => (
          <Chip
            key={option}
            active={value === option}
            label={format(option)}
            onPress={() => onChange(value === option ? "" : option)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function Chip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Tappable
      className={`rounded-full border px-3 py-1.5 ${active ? "border-primary bg-primary/15" : "border-border bg-card"}`}
      onPress={onPress}
    >
      <Text className={`font-body-medium text-xs ${active ? "text-primary" : "text-muted-foreground"}`}>
        {label}
      </Text>
    </Tappable>
  );
}
