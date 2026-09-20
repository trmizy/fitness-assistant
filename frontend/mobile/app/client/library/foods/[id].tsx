import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Apple, ChevronLeft, Flame } from "lucide-react-native";

import { Badge, Card, EmptyState, Tappable } from "../../../../src/components/ui";
import { foodService } from "../../../../src/services/api";
import { useWorkspaceAccent } from "../../../../src/theme/workspace";
import {
  caloriesLabel,
  gramLabel,
  macroRatio,
  normalizeFood,
} from "../../../../src/features/library/foodLibrary";

const MACRO_TINTS: Record<string, string> = {
  protein: "#22c55e",
  carbs: "#a78bfa",
  fats: "#f59e0b",
};

/**
 * SH-13 (detail) — one food, per 100 g.
 *
 * Visual authority: the reference's `FoodDetail` — hero image, one big energy figure, three macro
 * cards, and a single stacked ratio bar. The ratio is by grams, as the reference draws it.
 *
 * Web additionally honours a kcal/kJ preference from the profile; mobile has no settings screen
 * until Phase 9, so everything here is kcal and the unit is always written out.
 */
export default function FoodDetailScreen() {
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const query = useQuery({
    queryKey: ["food", id],
    queryFn: () => foodService.getById(String(id)),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });

  const food = query.data ? normalizeFood(query.data) : null;
  const slices = food ? macroRatio(food) : [];

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
        <Text className="flex-1 font-display text-xl text-foreground" numberOfLines={2}>
          {food?.name ?? "Thực phẩm"}
        </Text>
      </View>

      {query.isLoading ? (
        <View className="items-center py-16">
          <ActivityIndicator color={accent.primary} />
        </View>
      ) : !food ? (
        <EmptyState
          icon={Apple}
          title="Không tìm thấy món này"
          description="Món này có thể đã bị gỡ khỏi catalog."
        />
      ) : (
        <View className="gap-4 px-5 pt-4">
          <View className="aspect-video w-full overflow-hidden rounded-2xl bg-panel">
            {food.imageUrl ? (
              <Image
                source={{ uri: food.imageUrl }}
                style={{ width: "100%", height: "100%" }}
                contentFit="cover"
                transition={150}
                cachePolicy="memory-disk"
              />
            ) : (
              <View className="h-full w-full items-center justify-center">
                <Apple size={32} color={accent.primary} />
              </View>
            )}
          </View>

          <View className="flex-row flex-wrap gap-1.5">
            {food.source ? <Badge tone="neutral">{food.source}</Badge> : null}
            {food.foodForm ? <Badge tone="neutral">{food.foodForm}</Badge> : null}
            {food.isSupplement ? <Badge tone="info">Thực phẩm bổ sung</Badge> : null}
          </View>

          <Card className="items-center p-5">
            <Text className="font-body text-xs text-muted-foreground">Năng lượng / 100 g</Text>
            <View className="mt-1 flex-row items-center gap-2">
              <Flame size={24} color="#f59e0b" />
              <Text className="font-display text-3xl text-foreground">
                {caloriesLabel(food.calories)}
              </Text>
            </View>
          </Card>

          <View className="flex-row gap-3">
            {slices.map((slice) => (
              <Card key={slice.key} className="flex-1 items-center p-4">
                <Text className="font-display text-2xl" style={{ color: MACRO_TINTS[slice.key] }}>
                  {gramLabel(slice.grams)}
                </Text>
                <Text className="mt-0.5 font-body text-xs text-muted-foreground">{slice.label}</Text>
              </Card>
            ))}
          </View>

          <View>
            <Text className="mb-2 px-1 font-body-semibold text-sm text-foreground">Tỷ lệ macro</Text>
            <View className="h-3 flex-row overflow-hidden rounded-full bg-panel">
              {slices.map((slice) => (
                <View
                  key={slice.key}
                  style={{ width: `${slice.pct}%`, backgroundColor: MACRO_TINTS[slice.key] }}
                />
              ))}
            </View>
            <View className="mt-2 flex-row flex-wrap gap-3">
              {slices.map((slice) => (
                <View key={slice.key} className="flex-row items-center gap-1.5">
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 3,
                      backgroundColor: MACRO_TINTS[slice.key],
                    }}
                  />
                  <Text className="font-body text-[11px] text-muted-foreground">
                    {slice.label} {slice.pct}%
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  );
}
