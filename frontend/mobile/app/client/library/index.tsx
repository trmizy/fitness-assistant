import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Apple, BookOpen, ChevronRight, Compass, Dumbbell, PersonStanding, Search, type LucideIcon } from "lucide-react-native";

import { Card, Skeleton, Stagger, StaggerItem, Tappable } from "../../../src/components/ui";
import { workoutService } from "../../../src/services/api";
import { usePullToRefresh } from "../../../src/hooks/usePullToRefresh";
import { useWorkspaceAccent } from "../../../src/theme/workspace";

/**
 * SH-11 — "Khám phá" hub.
 *
 * Visual authority: `New Frontend/src/screens/discover/Discover.tsx`. Behavioural authority:
 * web's `pages/client/library/LibraryPage.tsx` — same four destinations, same preview queries,
 * same 5-minute staleTime (this is a catalog, not live data; re-fetching it on every visit is
 * pure waste on a phone connection).
 *
 * Food and nutrition-knowledge previews are NOT fetched here yet: their screens land in Phase 6
 * with the rest of the nutrition domain, so pulling their data now would render a preview strip
 * that navigates nowhere. The two cards stay — they are part of the hub's design — and point at
 * the Phase 6 placeholders.
 */
const DESTINATIONS: {
  href: "/client/library/exercises" | "/client/library/foods" | "/client/library/learn" | "/client/library/muscles";
  icon: LucideIcon;
  tint: string;
  title: string;
  description: string;
}[] = [
  {
    href: "/client/library/exercises",
    icon: Dumbbell,
    tint: "#34d399",
    title: "Bài tập",
    description: "Catalog bài tập có hướng dẫn, nhóm cơ, thiết bị và media minh hoạ",
  },
  {
    href: "/client/library/foods",
    icon: Apple,
    tint: "#fb7185",
    title: "Thực phẩm",
    description: "Tra cứu calo, protein, carb, fat theo 100g từ bảng food hiện có",
  },
  {
    href: "/client/library/learn",
    icon: BookOpen,
    tint: "#fbbf24",
    title: "Kiến thức",
    description: "Các bài viết ngắn về calo, macro, BMR, TDEE và hiệu suất tập",
  },
  {
    href: "/client/library/muscles",
    icon: PersonStanding,
    tint: "#38bdf8",
    title: "Nhóm cơ",
    description: "Bảng taxonomy nhóm cơ và bài tập liên quan từ mapping canonical",
  },
];

export default function LibraryHubScreen() {
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();

  const exercisesQuery = useQuery({
    queryKey: ["library-preview-exercises-with-media"],
    queryFn: () => workoutService.getExercises({ hasVideo: true, page: 1, limit: 6 }),
    staleTime: 5 * 60_000,
  });

  const musclesQuery = useQuery({
    queryKey: ["library-preview-muscles"],
    queryFn: () => workoutService.getMuscleTaxonomy(),
    staleTime: 5 * 60_000,
  });

  const { refreshing, onRefresh } = usePullToRefresh([
    ["library-preview-exercises-with-media"],
    ["library-preview-muscles"],
  ]);

  const exercises: any[] = Array.isArray(exercisesQuery.data) ? exercisesQuery.data : [];
  const muscles = (musclesQuery.data ?? []).slice(0, 6);

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 32 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent.primary} colors={[accent.primary]} />
      }
    >
      <View className="flex-row items-center justify-between px-5">
        <View className="flex-1 flex-row items-center gap-2">
          <Compass size={22} color={accent.primary} />
          <Text className="font-display text-2xl text-foreground">Khám phá</Text>
        </View>
        <Tappable
          className="h-11 w-11 items-center justify-center rounded-full border border-border bg-card"
          onPress={() => router.push("/client/library/search")}
        >
          <Search size={20} color="#8b9299" />
        </Tappable>
      </View>
      <Text className="px-5 pt-1 font-body text-sm text-muted-foreground">
        Thư viện tra cứu — bài tập, thực phẩm, nhóm cơ và kiến thức dinh dưỡng.
      </Text>

      <Stagger className="gap-3 px-5 pt-6">
        {DESTINATIONS.map((d) => (
          <StaggerItem key={d.href}>
            <Card className="flex-row items-center gap-3 p-4" onPress={() => router.push(d.href)}>
              <View
                className="h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                style={{ backgroundColor: `${d.tint}26` }}
              >
                <d.icon size={20} color={d.tint} />
              </View>
              <View className="flex-1">
                <Text className="font-body-semibold text-sm text-foreground">{d.title}</Text>
                <Text className="mt-0.5 font-body text-xs leading-4 text-muted-foreground">
                  {d.description}
                </Text>
              </View>
              <ChevronRight size={18} color="#8b9299" />
            </Card>
          </StaggerItem>
        ))}

        {/* Preview strips — same two the web hub shows, same order. */}
        <StaggerItem>
          <PreviewStrip
            title="Bài tập có media"
            loading={exercisesQuery.isLoading}
            empty="Chưa có bài tập nào kèm media."
            items={exercises.map((ex) => ({
              key: String(ex.id),
              label: ex.exerciseName,
              onPress: () => router.push({ pathname: "/client/library/exercises/[id]", params: { id: String(ex.id) } }),
            }))}
          />
        </StaggerItem>

        <StaggerItem>
          <PreviewStrip
            title="Nhóm cơ"
            loading={musclesQuery.isLoading}
            empty="Chưa có dữ liệu nhóm cơ."
            items={muscles.map((m) => ({
              key: m.code,
              label: m.nameVi,
              onPress: () => router.push("/client/library/muscles"),
            }))}
          />
        </StaggerItem>
      </Stagger>
    </ScrollView>
  );
}

function PreviewStrip({
  title,
  items,
  loading,
  empty,
}: {
  title: string;
  items: { key: string; label: string; onPress: () => void }[];
  loading: boolean;
  empty: string;
}) {
  return (
    <View>
      <Text className="mb-2 px-1 font-display text-base text-foreground">{title}</Text>
      {loading ? (
        <View className="flex-row gap-2">
          <Skeleton className="h-10 w-28 rounded-xl" />
          <Skeleton className="h-10 w-32 rounded-xl" />
          <Skeleton className="h-10 w-24 rounded-xl" />
        </View>
      ) : items.length === 0 ? (
        <Text className="px-1 font-body text-xs text-muted-foreground">{empty}</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pr-5">
          {items.map((item) => (
            <Tappable
              key={item.key}
              className="rounded-xl border border-border bg-card px-3.5 py-2.5"
              onPress={item.onPress}
            >
              <Text className="font-body text-xs text-foreground" numberOfLines={1}>
                {item.label}
              </Text>
            </Tappable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
