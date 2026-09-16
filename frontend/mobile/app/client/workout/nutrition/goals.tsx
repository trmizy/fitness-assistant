import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Target, TriangleAlert } from "lucide-react-native";

import { Badge, Button, Card, ScreenHeader, useToast } from "../../../../src/components/ui";
import { nutritionService } from "../../../../src/services/api";
import { haptics } from "../../../../src/lib/haptics";
import { useWorkspaceAccent } from "../../../../src/theme/workspace";
import {
  ATWATER,
  MACRO_CALORIE_TOLERANCE_KCAL,
  macroConsistency,
} from "../../../../src/features/nutrition/nutritionMath";

/**
 * CL-19 (goals half) — the nutrition target.
 *
 * Visual authority: `New Frontend/NutritionExtras.tsx#NutritionGoals` — preset cards with a tick
 * ring, then macro fields, then one full-width save.
 *
 * Behavioural authority: `PUT /nutrition/goals`, which **refuses** a goal whose macros do not add up
 * to its own calories (Atwater 4/4/9, ±50 kcal). The design's presets only set a calorie number,
 * which would fail that check on every save; here a preset scales the existing macros to the new
 * calorie figure, so what the card promises is what the server accepts. The same check runs live on
 * screen, so the user sees the mismatch before spending a round trip on it.
 *
 * `goalMode` follows the backend's meaning: RECOMMENDED for a preset the app computed, CUSTOM the
 * moment a macro is hand-edited.
 */
const PRESETS = [
  { name: "Giảm mỡ", calories: 2000, desc: "Thâm hụt 400 kcal/ngày" },
  { name: "Duy trì", calories: 2400, desc: "Cân bằng năng lượng" },
  { name: "Tăng cơ", calories: 2800, desc: "Thặng dư 400 kcal/ngày" },
];

type Form = { calories: string; protein: string; carbs: string; fat: string; water: string };

const toNumber = (value: string) => Number(value.replace(",", ".")) || 0;

export default function NutritionGoalsScreen() {
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();

  const goalQuery = useQuery({
    queryKey: ["nutrition-goal"],
    queryFn: () => nutritionService.getGoal(),
  });
  const historyQuery = useQuery({
    queryKey: ["nutrition-goal-history"],
    queryFn: () => nutritionService.getGoalHistory(),
  });

  const [form, setForm] = useState<Form | null>(null);
  const [mode, setMode] = useState<"RECOMMENDED" | "CUSTOM">("RECOMMENDED");
  const [saving, setSaving] = useState(false);

  // Seed once the real goal arrives; every later edit is the user's, not the server's.
  useEffect(() => {
    if (!goalQuery.data || form) return;
    const goal = goalQuery.data;
    setForm({
      calories: String(goal.calories ?? 2000),
      protein: String(goal.protein ?? 150),
      carbs: String(goal.carbs ?? 200),
      fat: String(goal.fat ?? 65),
      water: goal.waterMl ? String(goal.waterMl / 1000) : "",
    });
    setMode(goal.goalMode === "CUSTOM" ? "CUSTOM" : "RECOMMENDED");
  }, [goalQuery.data, form]);

  const check = useMemo(() => {
    if (!form) return null;
    return macroConsistency(
      toNumber(form.calories),
      toNumber(form.protein),
      toNumber(form.carbs),
      toNumber(form.fat),
    );
  }, [form]);

  const edit = (key: keyof Form, value: string) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    // Touching a macro by hand is exactly what CUSTOM means to the backend.
    if (key !== "water") setMode("CUSTOM");
  };

  /**
   * A preset keeps the macro split the user already has and rescales it to the new calories, so the
   * saved goal stays self-consistent. Scaling by the macros' own computed calories (not the old
   * stated ones) also repairs a goal that was already inconsistent.
   */
  const applyPreset = (calories: number) => {
    haptics.tap();
    setForm((prev) => {
      if (!prev) return prev;
      const protein = toNumber(prev.protein);
      const carbs = toNumber(prev.carbs);
      const fat = toNumber(prev.fat);
      const computed = protein * ATWATER.protein + carbs * ATWATER.carb + fat * ATWATER.fat;
      if (computed <= 0) return { ...prev, calories: String(calories) };
      const scale = calories / computed;
      return {
        calories: String(calories),
        protein: String(Math.round(protein * scale)),
        carbs: String(Math.round(carbs * scale)),
        fat: String(Math.round(fat * scale)),
        water: prev.water,
      };
    });
    setMode("RECOMMENDED");
  };

  const save = async () => {
    if (!form || !check) return;
    if (!check.consistent) {
      toast.show(
        `Macro cộng lại là ${check.computedCalories} kcal, lệch ${Math.abs(check.discrepancyKcal)} kcal so với mục tiêu đã nhập.`,
        "danger",
      );
      return;
    }
    setSaving(true);
    try {
      const waterL = toNumber(form.water);
      await nutritionService.upsertGoal({
        calories: Math.round(toNumber(form.calories)),
        protein: toNumber(form.protein),
        carbs: toNumber(form.carbs),
        fat: toNumber(form.fat),
        ...(waterL > 0 ? { waterMl: Math.round(waterL * 1000) } : {}),
        goalMode: mode,
      });
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["nutrition-goal"] }),
        queryClient.refetchQueries({ queryKey: ["nutrition-goal-history"] }),
      ]).catch(() => {});
      haptics.success();
      toast.show("Đã cập nhật mục tiêu!", "success");
      router.back();
    } catch (e: any) {
      // The server's message names the exact numbers, which is more useful than anything generic.
      toast.show(
        e?.response ? e.response.data?.error ?? "Không lưu được mục tiêu." : "Mất mạng — chưa lưu được mục tiêu.",
        "danger",
      );
    } finally {
      setSaving(false);
    }
  };

  const history = historyQuery.data ?? [];

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Mục tiêu dinh dưỡng" onBack={() => router.back()} />

      {!form ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={accent.primary} />
        </View>
      ) : (
        <>
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 140 }}
            keyboardShouldPersistTaps="handled"
          >
            <View className="mb-3 flex-row items-center gap-2 px-1">
              <Target size={17} color={accent.primary} />
              <Text className="font-display text-base text-foreground">Chọn mục tiêu</Text>
            </View>

            <View className="gap-3">
              {PRESETS.map((preset) => {
                const on = Math.round(toNumber(form.calories)) === preset.calories;
                return (
                  <Card
                    key={preset.name}
                    className={`flex-row items-center gap-3 p-4 ${on ? "border-primary bg-primary/5" : ""}`}
                    onPress={() => applyPreset(preset.calories)}
                  >
                    <View className="flex-1">
                      <Text className="font-body-semibold text-sm text-foreground">{preset.name}</Text>
                      <Text className="mt-0.5 font-body text-xs text-muted-foreground">{preset.desc}</Text>
                    </View>
                    <Text className="font-display text-base text-primary">
                      {preset.calories.toLocaleString("vi-VN")}
                    </Text>
                    <View
                      className={`h-6 w-6 items-center justify-center rounded-full ${
                        on ? "bg-primary" : "border-2 border-border"
                      }`}
                    >
                      {on ? <Check size={14} strokeWidth={3} color={accent.onPrimary} /> : null}
                    </View>
                  </Card>
                );
              })}
            </View>

            <Text className="mb-3 mt-6 px-1 font-body text-[11px] uppercase tracking-wide text-muted-foreground">
              Mục tiêu Macro
            </Text>
            <View className="gap-4">
              <Field label="Calo mỗi ngày" unit="kcal" value={form.calories} onChange={(v) => edit("calories", v)} />
              <Field label="Đạm (Protein)" unit="g" value={form.protein} onChange={(v) => edit("protein", v)} />
              <Field label="Tinh bột (Carb)" unit="g" value={form.carbs} onChange={(v) => edit("carbs", v)} />
              <Field label="Chất béo (Fat)" unit="g" value={form.fat} onChange={(v) => edit("fat", v)} />
              <Field label="Nước" unit="L" value={form.water} onChange={(v) => edit("water", v)} />
            </View>

            {/* The server's rule, shown before the round trip rather than after it. */}
            <Card
              className={`mt-5 flex-row items-start gap-3 p-4 ${
                check?.consistent ? "" : "border-warning/40 bg-warning/5"
              }`}
            >
              {check?.consistent ? (
                <Check size={18} color={accent.primary} />
              ) : (
                <TriangleAlert size={18} color="#f59e0b" />
              )}
              <View className="flex-1">
                <Text className="font-body-semibold text-sm text-foreground">
                  Macro cộng lại: {check?.computedCalories.toLocaleString("vi-VN")} kcal
                </Text>
                <Text className="mt-1 font-body text-xs leading-5 text-muted-foreground">
                  {check?.consistent
                    ? `Khớp với mục tiêu đã nhập (sai số cho phép ±${MACRO_CALORIE_TOLERANCE_KCAL} kcal).`
                    : `Lệch ${Math.abs(check?.discrepancyKcal ?? 0)} kcal so với ${Math.round(
                        toNumber(form.calories),
                      ).toLocaleString("vi-VN")} kcal đã nhập. Máy chủ sẽ từ chối lưu cho tới khi khớp.`}
                </Text>
              </View>
            </Card>

            {history.length > 0 ? (
              <View className="mt-6">
                <Text className="mb-2 px-1 font-display text-base text-foreground">Lịch sử mục tiêu</Text>
                <View className="gap-2">
                  {history.slice(0, 5).map((row) => (
                    <Card key={row.id} className="flex-row items-center gap-3 p-3.5">
                      <View className="flex-1">
                        <Text className="font-body-semibold text-sm text-foreground">
                          {row.calories.toLocaleString("vi-VN")} kcal · {row.protein}P / {row.carbs}C / {row.fat}F
                        </Text>
                        <Text className="mt-0.5 font-body text-[11px] text-muted-foreground">
                          Từ {new Date(row.validFrom).toLocaleDateString("vi-VN")}
                          {row.reason ? ` · ${row.reason}` : ""}
                        </Text>
                      </View>
                      <Badge tone={row.status === "ACTIVE" ? "success" : "neutral"}>
                        {row.status === "ACTIVE" ? "Đang dùng" : "Đã thay"}
                      </Badge>
                    </Card>
                  ))}
                </View>
              </View>
            ) : null}
          </ScrollView>

          <View
            className="absolute inset-x-0 bottom-0 border-t border-border bg-background px-5 pt-3"
            style={{ paddingBottom: insets.bottom + 12 }}
          >
            <Button full size="lg" icon={Check} disabled={saving || !check?.consistent} onPress={save}>
              Lưu mục tiêu
            </Button>
          </View>
        </>
      )}
    </View>
  );
}

function Field({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <View>
      <Text className="mb-1.5 px-1 font-body text-xs text-muted-foreground">{label}</Text>
      <View className="flex-row items-center gap-2 rounded-xl border border-border bg-panel px-3.5">
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          className="h-12 flex-1 font-body text-sm text-foreground"
          style={{ paddingVertical: 0 }}
        />
        <Text className="font-body-semibold text-sm text-muted-foreground">{unit}</Text>
      </View>
    </View>
  );
}
