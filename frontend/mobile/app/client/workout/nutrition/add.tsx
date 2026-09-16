import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react-native";

import {
  Button,
  Card,
  EmptyState,
  ScreenHeader,
  Segmented,
  inputPlaceholderColor,
  useToast,
} from "../../../../src/components/ui";
import { foodService, nutritionService } from "../../../../src/services/api";
import { toDateInputValue } from "../../../../src/utils/date";
import { haptics } from "../../../../src/lib/haptics";
import { useWorkspaceAccent } from "../../../../src/theme/workspace";
import {
  MEAL_LABELS,
  MEAL_TYPES,
  buildLogPayload,
  isValidQuantity,
  scaleFood,
  type MealType,
} from "../../../../src/features/nutrition/nutritionMath";

/**
 * CL-03 — logging one food.
 *
 * A pushed screen rather than the bottom sheet this started as: the sheet is a `Modal`, and on
 * Android the keyboard covered it whole — search field, results and all — because a modal does not
 * take part in the window's `adjustResize`. Searching 13k rows is also a screen's worth of work,
 * not a sheet's. The sheet stays for the deactivate confirmation, which has no text input.
 *
 * Macros come from the catalog per 100 g and are scaled here exactly as web scales them, so a
 * portion logged on either client produces the same row.
 */
export default function AddFoodScreen() {
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ meal?: string }>();

  const today = toDateInputValue(new Date());

  const [mealType, setMealType] = useState<MealType>(
    MEAL_TYPES.includes(params.meal as MealType) ? (params.meal as MealType) : "breakfast",
  );
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<any | null>(null);
  const [grams, setGrams] = useState("100");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQuery(term.trim()), 350);
    return () => clearTimeout(t);
  }, [term]);

  const searchQuery = useQuery({
    queryKey: ["food-search", query],
    queryFn: () => foodService.search(query),
    enabled: query.length >= 2,
    staleTime: 60_000,
  });

  const gramsNumber = Number(grams.replace(",", ".")) || 0;
  const preview = selected ? scaleFood(selected, gramsNumber) : null;
  const results = searchQuery.data ?? [];

  const save = async () => {
    if (!selected || !preview) return;
    if (!isValidQuantity(gramsNumber)) {
      toast.show("Khối lượng phải trong khoảng 1–5000 g.", "danger");
      return;
    }
    setSaving(true);
    try {
      await nutritionService.createLog(
        buildLogPayload({
          mealType,
          foodName: selected.name,
          calories: preview.calories,
          protein: preview.protein,
          carbs: preview.carbs,
          fats: preview.fats,
          notes: `${Math.round(gramsNumber)}g`,
        }),
      );
      await queryClient.refetchQueries({ queryKey: ["nutrition-logs", today] }).catch(() => {});
      haptics.success();
      toast.show("Đã thêm món ăn", "success");
      router.back();
    } catch (e: any) {
      toast.show(
        e?.response ? e.response.data?.error ?? "Không thêm được món ăn." : "Mất mạng — chưa thêm được món.",
        "danger",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Thêm món ăn" onBack={() => router.back()} />

      <View className="px-5 pt-4">
        <Segmented
          options={MEAL_TYPES.map((m) => MEAL_LABELS[m])}
          value={MEAL_LABELS[mealType]}
          onChange={(next) => {
            const found = MEAL_TYPES.find((m) => MEAL_LABELS[m] === next);
            if (found) setMealType(found);
          }}
        />
      </View>

      {selected ? (
        <>
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 140 }}
            keyboardShouldPersistTaps="handled"
          >
            <Card className="p-4">
              <Text className="font-body-semibold text-sm text-foreground">{selected.name}</Text>
              <Text className="mt-1 font-body text-xs text-muted-foreground">
                {Math.round(Number(selected.calories) || 0)} kcal · {selected.protein}P / {selected.carbs}C /{" "}
                {selected.fats}F trên 100 g
              </Text>
            </Card>

            <Text className="mb-1.5 mt-4 px-1 font-body text-xs text-muted-foreground">Khối lượng</Text>
            <View className="flex-row items-center gap-2 rounded-xl border border-border bg-panel px-3.5">
              <TextInput
                value={grams}
                onChangeText={setGrams}
                keyboardType="decimal-pad"
                autoFocus
                className="h-12 flex-1 font-body text-sm text-foreground"
                style={{ paddingVertical: 0 }}
              />
              <Text className="font-body-semibold text-sm text-muted-foreground">g</Text>
            </View>

            <View className="mt-3 flex-row gap-2">
              {[50, 100, 150, 200].map((preset) => (
                <Button key={preset} variant="secondary" size="sm" onPress={() => setGrams(String(preset))}>
                  {`${preset}g`}
                </Button>
              ))}
            </View>

            {preview ? (
              <Card className="mt-4 flex-row items-center justify-between p-4">
                <Cell label="kcal" value={preview.calories} />
                <Cell label="đạm" value={preview.protein} suffix="g" />
                <Cell label="tinh bột" value={preview.carbs} suffix="g" />
                <Cell label="béo" value={preview.fats} suffix="g" />
              </Card>
            ) : null}

            <Button className="mt-4" variant="ghost" onPress={() => setSelected(null)}>
              Chọn món khác
            </Button>
          </ScrollView>

          <View
            className="absolute inset-x-0 bottom-0 border-t border-border bg-background px-5 pt-3"
            style={{ paddingBottom: insets.bottom + 12 }}
          >
            <Button full size="lg" icon={Plus} disabled={saving} onPress={save}>
              {`Thêm vào ${MEAL_LABELS[mealType].toLowerCase()}`}
            </Button>
          </View>
        </>
      ) : (
        <>
          <View className="px-5 pt-4">
            <View className="flex-row items-center gap-2 rounded-xl border border-border bg-panel px-3.5">
              <Search size={18} color="#8b9299" />
              <TextInput
                value={term}
                onChangeText={setTerm}
                placeholder="Tìm món trong thư viện…"
                placeholderTextColor={inputPlaceholderColor}
                autoFocus
                autoCorrect={false}
                className="h-12 flex-1 font-body text-sm text-foreground"
                style={{ paddingVertical: 0 }}
              />
            </View>
          </View>

          {query.length < 2 ? (
            <Text className="px-6 pt-4 font-body text-xs text-muted-foreground">
              Nhập ít nhất 2 ký tự để tìm trong 13.000+ món của catalog.
            </Text>
          ) : searchQuery.isLoading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator color={accent.primary} />
            </View>
          ) : results.length === 0 ? (
            <EmptyState
              icon={Search}
              title="Không tìm thấy món nào"
              description={`Không có món nào khớp với "${query}". Thử từ khoá tiếng Anh — catalog là dữ liệu USDA.`}
            />
          ) : (
            <ScrollView
              className="flex-1"
              contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32 }}
              keyboardShouldPersistTaps="handled"
            >
              <View className="gap-2">
                {results.slice(0, 30).map((food) => (
                  <Card
                    key={food.id}
                    className="flex-row items-center gap-3 p-3.5"
                    onPress={() => {
                      haptics.tap();
                      setSelected(food);
                    }}
                  >
                    <View className="flex-1">
                      <Text className="font-body-semibold text-sm text-foreground" numberOfLines={2}>
                        {food.name}
                      </Text>
                      <Text className="mt-0.5 font-body text-[11px] text-muted-foreground">
                        {Math.round(food.calories)} kcal · {food.protein}P / {food.carbs}C / {food.fats}F trên 100 g
                      </Text>
                    </View>
                    <Plus size={18} color={accent.primary} />
                  </Card>
                ))}
              </View>
            </ScrollView>
          )}
        </>
      )}
    </View>
  );
}

function Cell({ label, value, suffix = "" }: { label: string; value: number; suffix?: string }) {
  return (
    <View className="items-center">
      <Text className="font-display text-base text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
        {value}
        {suffix}
      </Text>
      <Text className="font-body text-[11px] text-muted-foreground">{label}</Text>
    </View>
  );
}
