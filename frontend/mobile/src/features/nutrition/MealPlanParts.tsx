import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Animated, { FadeIn } from "react-native-reanimated";
import { AlertTriangle, Check, Minus, Pencil, Plus, SkipForward, Sparkles, Trash2, TrendingUp, Undo2 } from "lucide-react-native";

import { Badge, BottomSheet, Button, Card, Input, Segmented, Tappable, useToast } from "../../components/ui";
import { nutritionService, type NutritionGoalPlanConsistency } from "../../services/api";
import { useWorkspaceAccent } from "../../theme/workspace";
import { MEAL_LABELS, MEAL_TYPES, type MealType, type NutritionLogRow } from "./nutritionMath";
import {
  MISMATCH_FIELD_LABEL,
  amountCompletion,
  canDeletePlanMeal,
  logEditForm,
  logEditPayload,
  mealLocked,
  mealStatusOf,
  mealTotals,
  partialPreview,
  percentCompletion,
  scaledItemPatch,
  type DayFeedback,
  type LogEditForm,
  type PlanMeal,
  type PlanMealItem,
} from "./mealPlan";

/**
 * 14B.3 (PG-A4, PG-C4) — today's plan meal with web's actions (Hoàn thành / Một phần / Bỏ qua /
 * Hoàn tác, xoá bữa, thêm / sửa lượng / xoá món), the partial-meal and edit sheets, the day's feedback,
 * the 7-day chart and the goal↔plan mismatch banner. Every write is the endpoint web calls; the server
 * decides what a completion records.
 */

function useRefreshDay(today: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.refetchQueries({ queryKey: ["nutrition-daily-task", today] }),
      queryClient.refetchQueries({ queryKey: ["nutrition-logs", today] }),
      queryClient.invalidateQueries({ queryKey: ["nutrition-monthly-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["nutrition-weekly"] }),
    ]).catch(() => {});
}

function apiError(e: any, fallback: string): string {
  return e?.response?.data?.error?.message || e?.response?.data?.error || fallback;
}

function confirmDelete(title: string, message: string, onYes: () => void) {
  Alert.alert(title, message, [
    { text: "Không", style: "cancel" },
    { text: "Xoá", style: "destructive", onPress: onYes },
  ]);
}

const STATUS_BADGE: Record<string, { label: (pct?: number | null) => string; tone: "success" | "warning" | "neutral" }> = {
  COMPLETED: { label: () => "✓ Hoàn thành", tone: "success" },
  PARTIAL: { label: (pct) => `½ ${pct ?? "?"}%`, tone: "warning" },
  SKIPPED: { label: () => "⊘ Bỏ qua", tone: "neutral" },
};

export function PlanMealCard({
  meal,
  mealType,
  today,
  icon: Icon,
}: {
  meal: PlanMeal;
  mealType: MealType;
  today: string;
  icon: typeof Plus;
}) {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const refresh = useRefreshDay(today);
  const [partialOpen, setPartialOpen] = useState(false);
  const [editItem, setEditItem] = useState<PlanMealItem | null>(null);
  const [editLog, setEditLog] = useState<PlanMealItem | null>(null);

  const status = mealStatusOf(meal);
  const locked = mealLocked(status);
  const totals = mealTotals(meal.items);
  const badge = STATUS_BADGE[status];

  const complete = useMutation({
    mutationFn: (body: { status: "COMPLETED" | "PARTIAL" | "SKIPPED"; pct?: number; overrideCalories?: number; overrideProtein?: number; overrideCarbs?: number; overrideFat?: number }) =>
      nutritionService.upsertMealCompletion(meal.id, today, body.status, {
        percentConsumed: body.pct,
        overrideCalories: body.overrideCalories,
        overrideProtein: body.overrideProtein,
        overrideCarbs: body.overrideCarbs,
        overrideFat: body.overrideFat,
      }),
    onSuccess: () => void refresh(),
    onError: () => toast.show("Không thể cập nhật trạng thái bữa ăn.", "danger"),
  });
  const undo = useMutation({
    mutationFn: () => nutritionService.deleteMealCompletion(meal.id, today),
    onSuccess: () => void refresh(),
    onError: () => toast.show("Không thể hoàn tác.", "danger"),
  });
  const removeMeal = useMutation({
    mutationFn: () => nutritionService.deletePlanMeal(meal.id),
    onSuccess: () => {
      toast.show("Đã xoá bữa ăn khỏi kế hoạch.", "success");
      void refresh();
    },
    onError: (e) => toast.show(apiError(e, "Không thể xoá bữa ăn."), "danger"),
  });
  const removeItem = useMutation({
    mutationFn: (item: PlanMealItem) =>
      item.sourceType === "PLAN_ITEM" ? nutritionService.deleteMealItem(item.id) : nutritionService.deleteLog(item.id),
    onSuccess: (_d, item) => {
      toast.show(item.sourceType === "PLAN_ITEM" ? "Đã xoá món." : "Đã xóa", "success");
      void refresh();
    },
    onError: (e) => toast.show(apiError(e, "Không thể xoá món."), "danger"),
  });
  const busy = complete.isPending || undo.isPending || removeMeal.isPending;

  return (
    <View>
      <View className="mb-2 flex-row items-center gap-2.5 px-1">
        <View className="h-9 w-9 items-center justify-center rounded-xl bg-panel">
          <Icon size={17} color={accent.primary} />
        </View>
        <View className="flex-1">
          <View className="flex-row flex-wrap items-center gap-1.5">
            <Text className="font-body-semibold text-sm text-foreground">{MEAL_LABELS[mealType]}</Text>
            {badge ? <Badge tone={badge.tone}>{badge.label(meal.completion?.percentConsumed)}</Badge> : null}
          </View>
          <Text className="font-body text-[11px] text-muted-foreground">
            {meal.items.length} món · theo kế hoạch
          </Text>
        </View>
        <Text className="font-display text-sm text-foreground">{Math.round(totals.calories).toLocaleString("vi-VN")} kcal</Text>
        {!locked ? (
          <Tappable
            className="h-8 w-8 items-center justify-center rounded-lg bg-panel"
            accessibilityLabel={`Thêm món vào ${MEAL_LABELS[mealType]}`}
            onPress={() =>
              router.push({
                pathname: "/client/workout/nutrition/add",
                params: { meal: mealType, planMealId: meal.id, mealTitle: MEAL_LABELS[mealType] },
              })
            }
          >
            <Plus size={15} color={accent.primary} />
          </Tappable>
        ) : null}
        {canDeletePlanMeal(status) ? (
          <Tappable
            className="h-8 w-8 items-center justify-center rounded-lg bg-panel"
            accessibilityLabel={`Xoá ${MEAL_LABELS[mealType]} khỏi kế hoạch`}
            disabled={busy}
            onPress={() =>
              confirmDelete(
                "Xoá bữa ăn?",
                `Xoá ${MEAL_LABELS[mealType].toLowerCase()} khỏi kế hoạch hôm nay? Các món trong bữa này sẽ bị xoá.`,
                () => removeMeal.mutate(),
              )
            }
          >
            <Trash2 size={14} color="#ef4444" />
          </Tappable>
        ) : null}
      </View>

      <Card className={`gap-2 p-3 ${status === "SKIPPED" ? "opacity-70" : ""}`}>
        {meal.items.length === 0 ? (
          <Text className="font-body text-xs text-muted-foreground">Bữa này chưa có món nào.</Text>
        ) : (
          meal.items.map((item) => (
            <View key={`${item.sourceType}-${item.id}`} className="flex-row items-center gap-2 rounded-xl bg-panel px-3 py-2.5">
              <View className="min-w-0 flex-1">
                <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                  {item.foodName}
                </Text>
                <Text className="font-body text-[11px] text-muted-foreground">
                  {item.quantity != null ? `${item.quantity}${item.unit ?? "g"} · ` : ""}
                  {Math.round(item.protein)}g đạm · {Math.round(item.carbs)}g tinh bột · {Math.round(item.fat)}g béo
                  {item.sourceType === "LOG_ITEM" ? " · tự ghi" : ""}
                </Text>
              </View>
              <Text className="font-display text-sm text-foreground">{Math.round(item.calories)}</Text>
              {!locked ? (
                <>
                  <Tappable
                    className="h-8 w-8 items-center justify-center rounded-lg bg-card"
                    accessibilityLabel={`Sửa ${item.foodName}`}
                    onPress={() => (item.sourceType === "PLAN_ITEM" ? setEditItem(item) : setEditLog(item))}
                  >
                    <Pencil size={13} color="#8b9299" />
                  </Tappable>
                  <Tappable
                    className="h-8 w-8 items-center justify-center rounded-lg bg-card"
                    accessibilityLabel={`Xoá ${item.foodName}`}
                    disabled={removeItem.isPending}
                    onPress={() => confirmDelete("Xoá món?", `Xoá "${item.foodName}" khỏi bữa này?`, () => removeItem.mutate(item))}
                  >
                    <Trash2 size={13} color="#ef4444" />
                  </Tappable>
                </>
              ) : null}
            </View>
          ))
        )}

        {status === "PENDING" ? (
          // Each button sits in its own flex-1 cell: flex-1 on the buttons themselves drifted to
          // content width after a re-render (seen on the emulator, 4/10).
          <View className="flex-row gap-1.5 pt-1">
            <View className="flex-1">
              <Button full size="sm" icon={Check} disabled={busy} onPress={() => complete.mutate({ status: "COMPLETED" })}>
                Hoàn thành
              </Button>
            </View>
            <View className="flex-1">
              <Button full size="sm" variant="secondary" icon={Minus} disabled={busy} onPress={() => setPartialOpen(true)}>
                Một phần
              </Button>
            </View>
            <View className="flex-1">
              <Button full size="sm" variant="ghost" icon={SkipForward} disabled={busy} onPress={() => complete.mutate({ status: "SKIPPED" })}>
                Bỏ qua
              </Button>
            </View>
          </View>
        ) : (
          <View className="flex-row items-center justify-between pt-1">
            <Text className="flex-1 font-body text-[11px] text-muted-foreground">
              {locked ? "Không thể sửa món sau khi bữa đã hoàn thành." : "Bữa này đã được bỏ qua."}
            </Text>
            <Button size="sm" variant="ghost" icon={Undo2} disabled={busy} onPress={() => undo.mutate()}>
              Hoàn tác
            </Button>
          </View>
        )}
      </Card>

      <PartialMealSheet
        open={partialOpen}
        mealName={MEAL_LABELS[mealType]}
        planned={totals}
        onClose={() => setPartialOpen(false)}
        onConfirm={(body) => {
          setPartialOpen(false);
          complete.mutate(body);
        }}
      />
      <PlanItemQuantitySheet item={editItem} today={today} onClose={() => setEditItem(null)} />
      <EditLogSheet
        log={
          editLog
            ? {
                id: editLog.id,
                date: today,
                mealType,
                foodName: editLog.foodName,
                calories: editLog.calories,
                protein: editLog.protein,
                carbs: editLog.carbs,
                fat: editLog.fat,
                notes: null,
                quantity: editLog.quantity,
              }
            : null
        }
        today={today}
        onClose={() => setEditLog(null)}
      />
    </View>
  );
}

function PartialMealSheet({
  open,
  mealName,
  planned,
  onClose,
  onConfirm,
}: {
  open: boolean;
  mealName: string;
  planned: { calories: number; protein: number; carbs: number; fat: number };
  onClose: () => void;
  onConfirm: (body: { status: "COMPLETED" | "PARTIAL"; pct: number; overrideCalories?: number; overrideProtein?: number; overrideCarbs?: number; overrideFat?: number }) => void;
}) {
  const [mode, setMode] = useState<"Theo phần trăm" | "Nhập lượng">("Theo phần trăm");
  const [pct, setPct] = useState("50");
  const [amount, setAmount] = useState({ calories: "", protein: "", carbs: "", fat: "" });
  const pctNum = Math.max(1, parseFloat(pct.replace(",", ".")) || 50);
  const preview = partialPreview(planned, pctNum);
  const byAmount = amountCompletion(planned.calories, amount);

  return (
    <BottomSheet open={open} onClose={onClose} title="Ghi nhận lượng thực ăn">
      {open ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14, paddingBottom: 8 }}>
          <Text className="text-center font-body text-xs text-muted-foreground">
            {mealName} · {Math.round(planned.calories)} kcal theo kế hoạch
          </Text>
          <Segmented options={["Theo phần trăm", "Nhập lượng"]} value={mode} onChange={(v) => setMode(v as typeof mode)} />

          {mode === "Theo phần trăm" ? (
            <>
              <View className="flex-row items-center justify-between">
                <Text className="font-body-semibold text-xs text-muted-foreground">Phần đã ăn (%)</Text>
                {pctNum > 100 ? (
                  <Text className="font-body text-[11px] text-warning">⚠ Ăn nhiều hơn kế hoạch</Text>
                ) : pctNum === 100 ? (
                  <Text className="font-body text-[11px] text-primary">✓ Đúng kế hoạch</Text>
                ) : null}
              </View>
              <Input value={pct} onChangeText={setPct} keyboardType="decimal-pad" placeholder="VD: 50, 75, 120..." />
              <View className="flex-row gap-1.5">
                {[25, 50, 75, 100, 125].map((p) => (
                  <Tappable
                    key={p}
                    onPress={() => setPct(String(p))}
                    className={`flex-1 items-center rounded-lg border py-2 ${pctNum === p ? "border-warning bg-warning" : "border-border bg-panel"}`}
                  >
                    <Text className={`font-body-semibold text-xs ${pctNum === p ? "text-background" : "text-muted-foreground"}`}>{p}%</Text>
                  </Tappable>
                ))}
              </View>
              <View className="flex-row rounded-xl bg-panel p-3">
                {[
                  ["Kcal", String(preview.calories)],
                  ["Đạm", `${preview.protein}g`],
                  ["Tinh bột", `${preview.carbs}g`],
                  ["Béo", `${preview.fat}g`],
                ].map(([label, value]) => (
                  <View key={label} className="flex-1 items-center">
                    <Text className="font-display text-sm text-foreground">{value}</Text>
                    <Text className="font-body text-[10px] text-muted-foreground">{label}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <>
              <Text className="font-body text-xs text-muted-foreground">
                Nhập calories thực tế đã ăn. Hữu ích khi ăn thêm hoặc ăn món khác ngoài kế hoạch.
              </Text>
              <Input label="Calories (bắt buộc)" value={amount.calories} keyboardType="decimal-pad" onChangeText={(t) => setAmount((a) => ({ ...a, calories: t }))} />
              <View className="flex-row gap-2">
                {(["protein", "carbs", "fat"] as const).map((k) => (
                  <View key={k} className="flex-1">
                    <Input
                      label={k === "protein" ? "Đạm (g)" : k === "carbs" ? "Tinh bột (g)" : "Béo (g)"}
                      value={amount[k]}
                      keyboardType="decimal-pad"
                      onChangeText={(t) => setAmount((a) => ({ ...a, [k]: t }))}
                    />
                  </View>
                ))}
              </View>
              {byAmount ? (
                <Text className="font-body text-[11px] text-muted-foreground">≈ {byAmount.pct}% so với kế hoạch</Text>
              ) : null}
            </>
          )}

          <View className="flex-row gap-2">
            <Button className="flex-1" variant="secondary" onPress={onClose}>
              Hủy
            </Button>
            <Button
              className="flex-1"
              disabled={mode === "Nhập lượng" && !byAmount}
              onPress={() => {
                const body = mode === "Theo phần trăm" ? percentCompletion(pct) : byAmount;
                if (body) onConfirm(body);
              }}
            >
              Xác nhận
            </Button>
          </View>
        </ScrollView>
      ) : null}
    </BottomSheet>
  );
}

function PlanItemQuantitySheet({ item, today, onClose }: { item: PlanMealItem | null; today: string; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefreshDay(today);
  const [qty, setQty] = useState("");
  const [forId, setForId] = useState<string | null>(null);
  if (item && forId !== item.id) {
    setForId(item.id);
    setQty(String(item.quantity ?? 100));
  }
  const save = useMutation({
    // Rescaled macros go along with the quantity (web sends the quantity alone — see scaledItemPatch).
    mutationFn: () => nutritionService.updateMealItem(String(item?.id), scaledItemPatch(item as PlanMealItem, Number(qty.replace(",", ".")))),
    onSuccess: () => {
      toast.show("Đã cập nhật lượng.", "success");
      onClose();
      void refresh();
    },
    onError: (e) => toast.show(apiError(e, "Không thể cập nhật."), "danger"),
  });
  const qtyNum = Number(qty.replace(",", "."));
  return (
    <BottomSheet open={item != null} onClose={onClose} title="Sửa lượng">
      {item ? (
        <View className="gap-3 pb-2">
          <Text className="text-center font-body text-sm text-foreground">{item.foodName}</Text>
          <Input label={`Khối lượng (${item.unit ?? "g"})`} value={qty} onChangeText={setQty} keyboardType="decimal-pad" autoFocus />
          <View className="flex-row gap-2">
            <Button className="flex-1" variant="secondary" onPress={onClose}>
              Hủy
            </Button>
            <Button className="flex-1" disabled={save.isPending || !(qtyNum > 0)} onPress={() => save.mutate()}>
              {save.isPending ? "Đang lưu…" : "Lưu"}
            </Button>
          </View>
        </View>
      ) : null}
    </BottomSheet>
  );
}

/** Edit a logged food (web's edit modal, `PATCH /nutrition/:id`). */
export function EditLogSheet({
  log,
  today,
  onClose,
}: {
  log: (NutritionLogRow & { quantity?: number | null }) | null;
  today: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const refresh = useRefreshDay(today);
  const [form, setForm] = useState<LogEditForm | null>(null);
  const [forId, setForId] = useState<string | null>(null);
  if (log && forId !== log.id) {
    setForId(log.id);
    setForm(logEditForm(log));
  }
  const set = (k: keyof LogEditForm, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => nutritionService.updateLog(String(log?.id), body),
    onSuccess: () => {
      toast.show("Cập nhật thành công", "success");
      onClose();
      void refresh();
    },
    onError: (e) => toast.show(apiError(e, "Không thể cập nhật"), "danger"),
  });
  return (
    <BottomSheet open={log != null} onClose={onClose} title="Sửa món đã ghi">
      {log && form ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
          <Segmented
            options={MEAL_TYPES.map((m) => MEAL_LABELS[m])}
            value={MEAL_LABELS[form.mealType]}
            onChange={(v) => {
              const found = MEAL_TYPES.find((m) => MEAL_LABELS[m] === v);
              if (found) setForm((f) => (f ? { ...f, mealType: found } : f));
            }}
          />
          <Input label="Tên món" value={form.foodName} onChangeText={(t) => set("foodName", t)} />
          <Input label="Khối lượng (g)" value={form.quantity} keyboardType="decimal-pad" onChangeText={(t) => set("quantity", t)} />
          <View className="flex-row flex-wrap justify-between gap-y-2">
            {(
              [
                ["calories", "Calories (kcal)"],
                ["protein", "Đạm (g)"],
                ["carbs", "Tinh bột (g)"],
                ["fat", "Béo (g)"],
              ] as const
            ).map(([k, label]) => (
              <View key={k} className="w-[48.5%]">
                <Input label={label} value={form[k]} keyboardType="decimal-pad" onChangeText={(t) => set(k, t)} />
              </View>
            ))}
          </View>
          <Input label="Ghi chú" value={form.notes} onChangeText={(t) => set("notes", t)} />
          <View className="flex-row gap-2">
            <Button className="flex-1" variant="secondary" onPress={onClose}>
              Hủy
            </Button>
            <Button
              className="flex-1"
              disabled={save.isPending}
              onPress={() => {
                const parsed = logEditPayload(form);
                if (!parsed.ok) toast.show(parsed.error, "danger");
                else save.mutate(parsed.body);
              }}
            >
              {save.isPending ? "Đang lưu…" : "Lưu"}
            </Button>
          </View>
        </ScrollView>
      ) : null}
    </BottomSheet>
  );
}

export function DayFeedbackCard({ items }: { items: DayFeedback[] }) {
  if (items.length === 0) return null;
  return (
    <View className="mt-4 gap-2">
      {items.map((f) => (
        <View
          key={f.text}
          className={`flex-row items-start gap-2 rounded-xl border p-3 ${f.tone === "success" ? "border-primary/30 bg-primary/10" : "border-warning/30 bg-warning/10"}`}
        >
          {f.tone === "success" ? <Check size={15} color="#22c55e" /> : <AlertTriangle size={15} color="#f59e0b" />}
          <Text className="flex-1 font-body text-xs leading-5 text-foreground">{f.text}</Text>
        </View>
      ))}
    </View>
  );
}

/** Web's "7 ngày gần nhất" bar chart, drawn with Views like the other mobile charts. */
export function WeeklyCaloriesCard({ days, goal }: { days: { key: string; day: string; calories: number }[]; goal: number }) {
  const max = Math.max(goal || 0, ...days.map((d) => d.calories), 1);
  return (
    <Card className="mt-4 gap-3 p-4">
      <View className="flex-row items-center gap-2">
        <TrendingUp size={16} color="#22c55e" />
        <Text className="font-body-semibold text-sm text-foreground">7 ngày gần nhất</Text>
      </View>
      <View className="flex-row items-end justify-between gap-2">
        {days.map((d, i) => (
          <View key={d.key} className="flex-1 items-center gap-1">
            <Text className="font-body text-[9px] text-muted-foreground">{d.calories > 0 ? d.calories : ""}</Text>
            <View className="h-20 w-full justify-end">
              <Animated.View
                entering={FadeIn.delay(i * 50).duration(240)}
                className="w-full rounded-md"
                style={{ height: `${d.calories > 0 ? Math.max(6, (d.calories / max) * 100) : 0}%`, backgroundColor: "#f97316" }}
              />
            </View>
            <Text className="font-body text-[10px] text-muted-foreground">{d.day}</Text>
          </View>
        ))}
      </View>
      <Text className="text-center font-body text-[11px] text-muted-foreground">Mục tiêu: {goal || 2000} kcal/ngày</Text>
    </Card>
  );
}

/** Goal changed after the plan was made (server's consistency check) — web's banner. */
export function GoalPlanMismatchBanner({ state, onKeep }: { state: NutritionGoalPlanConsistency | undefined; onKeep: () => void }) {
  if (state?.status !== "MACRO_MISMATCH" && state?.status !== "STALE_GOAL_CHANGED") return null;
  return (
    <View className="mt-4 gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4">
      <View className="flex-row items-start gap-2">
        <AlertTriangle size={16} color="#f59e0b" />
        <Text className="flex-1 font-body-semibold text-sm text-warning">
          {state.status === "MACRO_MISMATCH"
            ? "Bạn đã đổi mục tiêu dinh dưỡng. Thực đơn hiện tại có thể vẫn theo mục tiêu cũ."
            : "Mục tiêu dinh dưỡng đã đổi kể từ khi thực đơn này được tạo."}
        </Text>
      </View>
      {state.mismatches.length > 0 ? (
        <View className="flex-row flex-wrap gap-2">
          {state.mismatches.map((m) => (
            <View key={m.field} className="rounded-lg bg-panel px-2.5 py-1.5">
              <Text className="font-body text-[10px] text-muted-foreground">{MISMATCH_FIELD_LABEL[m.field] ?? m.field}</Text>
              <Text className="font-body-semibold text-xs text-foreground">
                {m.planValue} → {m.goalValue}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <View className="flex-row gap-2">
        <Button className="flex-1" size="sm" icon={Sparkles} onPress={() => router.push("/client/ai-coach")}>
          Tạo lại thực đơn
        </Button>
        <Button className="flex-1" size="sm" variant="secondary" onPress={onKeep}>
          Vẫn giữ thực đơn này
        </Button>
      </View>
    </View>
  );
}
