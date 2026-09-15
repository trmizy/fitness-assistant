import { useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { FlashList } from "@shopify/flash-list";
import { ChevronLeft, PersonStanding, Search } from "lucide-react-native";

import { Card, EmptyState, Input, Tappable } from "../../../../src/components/ui";
import { workoutService } from "../../../../src/services/api";
import { bodyPartLabel } from "../../../../src/config/exerciseLabels";
import { useWorkspaceAccent } from "../../../../src/theme/workspace";

/**
 * SH-15 — muscle taxonomy.
 *
 * Behavioural authority: web's `MuscleLibraryPage.tsx` — one call to `/exercises/muscles`, the
 * canonical taxonomy, grouped by anatomy region. Filtering is client-side here exactly as on web:
 * the taxonomy is a few dozen rows that arrive in one response, so a round trip per keystroke
 * would be slower AND less correct (it would lose the grouping).
 */
export default function MuscleLibraryScreen() {
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["muscle-taxonomy"],
    queryFn: () => workoutService.getMuscleTaxonomy(),
    staleTime: 5 * 60_000,
  });

  const rows = useMemo(() => {
    const all = query.data ?? [];
    const needle = search.trim().toLowerCase();
    const filtered = needle
      ? all.filter(
          (m) =>
            m.nameVi.toLowerCase().includes(needle) ||
            (m.nameEn ?? "").toLowerCase().includes(needle) ||
            m.code.toLowerCase().includes(needle),
        )
      : all;

    // Flatten into a single list with region headers so one FlashList can render the whole
    // grouped view — nesting a list per region would defeat virtualization.
    const byRegion = new Map<string, typeof filtered>();
    for (const m of filtered) {
      const region = m.anatomyRegion ?? "Khác";
      byRegion.set(region, [...(byRegion.get(region) ?? []), m]);
    }
    const out: Array<
      { kind: "header"; key: string; title: string } | { kind: "item"; key: string; muscle: (typeof filtered)[number] }
    > = [];
    for (const [region, muscles] of byRegion) {
      out.push({ kind: "header", key: `h-${region}`, title: region });
      for (const m of muscles) out.push({ kind: "item", key: m.code, muscle: m });
    }
    return out;
  }, [query.data, search]);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top + 12 }}>
      <View className="flex-row items-center gap-2 px-5">
        <Tappable
          className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
          onPress={() => router.back()}
        >
          <ChevronLeft size={20} color="#8b9299" />
        </Tappable>
        <Text className="flex-1 font-display text-xl text-foreground">Nhóm cơ</Text>
      </View>

      <View className="px-5 pt-4">
        <Input value={search} onChangeText={setSearch} placeholder="Tìm nhóm cơ…" icon={Search} autoCorrect={false} />
      </View>

      {query.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={accent.primary} />
        </View>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={PersonStanding}
          title="Không tìm thấy nhóm cơ nào"
          description="Thử một từ khoá khác."
        />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(row) => row.key}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 }}
          renderItem={({ item }) =>
            item.kind === "header" ? (
              <Text className="pb-2 pt-4 font-body text-[11px] uppercase tracking-wide text-muted-foreground">
                {/* anatomyRegion shares the bodyPart enum (CORE, LOWER_BODY…). Web shows it raw in a
                    small chip; here it is a section header, where a raw enum reads as a bug. */}
                {bodyPartLabel(item.title)}
              </Text>
            ) : (
              <Card
                className="mb-2.5 flex-row items-center gap-3 p-4"
                onPress={() =>
                  router.push({
                    pathname: "/client/library/exercises",
                    params: { search: item.muscle.nameVi },
                  })
                }
              >
                <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
                  <PersonStanding size={19} color={accent.primary} />
                </View>
                <View className="flex-1">
                  <Text className="font-body-semibold text-sm text-foreground">{item.muscle.nameVi}</Text>
                  {item.muscle.nameEn ? (
                    <Text className="font-body text-xs text-muted-foreground">{item.muscle.nameEn}</Text>
                  ) : null}
                </View>
              </Card>
            )
          }
        />
      )}
    </View>
  );
}
