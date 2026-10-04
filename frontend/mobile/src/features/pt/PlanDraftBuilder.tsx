import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Search, Sparkles, Trash2, type LucideIcon } from "lucide-react-native";

import { BottomSheet, Button, Card, Input, Tappable, inputPlaceholderColor, useToast } from "../../components/ui";
import { ptCoachService, workoutService } from "../../services/api";
import { useWorkspaceAccent } from "../../theme/workspace";
import { darkColors, designTokens } from "../../theme/colors";
import {
  WEEKDAYS,
  daysFromAiDraft,
  emptyDay,
  nextFreeWeekday,
  planDraftError,
  planDraftPayload,
  removeDayAt,
  type DraftDay,
  type DraftEx,
  type PlanDraftPayload,
} from "./planDraft";

const todayIso = () => new Date().toISOString().slice(0, 10);

function apiError(e: any, fallback: string): string {
  return e?.response?.data?.error?.message || e?.response?.data?.error || e?.message || fallback;
}

/**
 * The coach's plan builder — shared by the 1-1 order draft (PT-09) and "Giao kế hoạch" for a student
 * (14B.2, web `AssignPlanModal`). Days, a weekday per day (web's select; each weekday once), exercises
 * from the catalogue with sets / reps / rest, and the advisory AI draft (`generatePlanDraft`) that only
 * fills the list — nothing is sent until the trainer presses submit, because the trainer, not the
 * model, answers for what the client receives.
 */
export function PlanDraftBuilder({
  clientUserId,
  title,
  nameLabel = "Tên kế hoạch *",
  initialName,
  showGoal = false,
  goal: fixedGoal,
  defaultWeeks,
  submitLabel,
  submittingLabel,
  submitIcon,
  successMessage,
  errorFallback,
  onSubmit,
  onDone,
}: {
  clientUserId: string;
  title: string;
  nameLabel?: string;
  initialName: string;
  /** Show an editable goal field (assign plan); otherwise `goal` is sent as given (order intake). */
  showGoal?: boolean;
  goal?: string | null;
  defaultWeeks: number;
  submitLabel: string;
  submittingLabel: string;
  submitIcon?: LucideIcon;
  successMessage: string;
  errorFallback: string;
  onSubmit: (payload: PlanDraftPayload) => Promise<unknown>;
  onDone: () => void;
}) {
  const accent = useWorkspaceAccent();
  const toast = useToast();

  const [name, setName] = useState(initialName);
  const [goal, setGoal] = useState("");
  const [durationWeeks, setDurationWeeks] = useState(String(defaultWeeks));
  const [startDate, setStartDate] = useState(todayIso());
  const [days, setDays] = useState<DraftDay[]>([emptyDay(1, 1)]);
  const [ptNotes, setPtNotes] = useState("");
  const [aiInfo, setAiInfo] = useState<{ dataGaps: string[]; warnings: string[]; summaryForPt: string } | null>(null);
  const [pickFor, setPickFor] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const exercises = useQuery({
    queryKey: ["pt-draft-exercises", search],
    queryFn: () => workoutService.getExercises({ search: search || undefined, limit: 20 }),
    enabled: pickFor !== null,
  });
  // `getExercises` already unwraps to the array; the catalogue's field is `exerciseName`, not `name`.
  const exerciseRows: any[] = Array.isArray(exercises.data) ? exercises.data : [];

  const generate = useMutation({
    mutationFn: () =>
      ptCoachService.generatePlanDraft(clientUserId, {
        ptNotes: ptNotes.trim() || undefined,
        daysPerWeek: days.length,
        durationWeeks: Number(durationWeeks) || defaultWeeks,
      }),
    onSuccess: (res: any) => {
      setAiInfo({ dataGaps: res?.dataGaps ?? [], warnings: res?.warnings ?? [], summaryForPt: res?.summaryForPt ?? "" });
      const resDays: any[] = Array.isArray(res?.days) ? res.days : [];
      if (resDays.length === 0) {
        toast.show("AI chưa gợi ý được bài tập — bạn tự chọn nhé.", "danger");
        return;
      }
      setDays((prev) => daysFromAiDraft(prev, resDays));
      toast.show("AI đã soạn bản nháp — hãy xem lại trước khi gửi", "success");
    },
    onError: (e: any) => toast.show(apiError(e, "Chưa tạo được bản nháp AI"), "danger"),
  });

  const submit = useMutation({
    mutationFn: () =>
      onSubmit(
        planDraftPayload({ name, goal: showGoal ? goal : fixedGoal, durationWeeks, defaultWeeks, startDate, days }),
      ),
    onSuccess: () => {
      toast.show(successMessage, "success");
      onDone();
    },
    onError: (e: any) => toast.show(apiError(e, errorFallback), "danger"),
  });

  const usedWeekdays = new Set(days.map((d) => d.weekday));
  const patchDay = (i: number, patch: Partial<DraftDay>) => setDays((p) => p.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const addExercise = (dayIdx: number, exerciseId: string, exName: string) =>
    setDays((p) =>
      p.map((d, i) =>
        i === dayIdx ? { ...d, exercises: [...d.exercises, { exerciseId, name: exName, sets: 3, reps: 10, restSeconds: 90 }] } : d,
      ),
    );
  const removeExercise = (dayIdx: number, exIdx: number) =>
    setDays((p) => p.map((d, i) => (i === dayIdx ? { ...d, exercises: d.exercises.filter((_, j) => j !== exIdx) } : d)));
  const patchExercise = (dayIdx: number, exIdx: number, patch: Partial<DraftEx>) =>
    setDays((p) =>
      p.map((d, i) => (i === dayIdx ? { ...d, exercises: d.exercises.map((e, j) => (j === exIdx ? { ...e, ...patch } : e)) } : d)),
    );

  const error = planDraftError(name, days);

  return (
    <View className="gap-4">
      <Text className="px-1 font-display text-lg text-foreground">{title}</Text>

      <Card className="gap-3 p-4">
        <Input label={nameLabel} value={name} onChangeText={setName} />
        {showGoal ? <Input label="Mục tiêu (không bắt buộc)" value={goal} onChangeText={setGoal} placeholder="vd: Tăng cơ, giảm mỡ..." /> : null}
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Input label="Số tuần" value={durationWeeks} onChangeText={(t) => setDurationWeeks(t.replace(/[^\d]/g, ""))} keyboardType="number-pad" />
          </View>
          <View className="flex-1">
            <Input label="Bắt đầu (YYYY-MM-DD)" value={startDate} onChangeText={setStartDate} />
          </View>
        </View>
      </Card>

      <Card className="gap-2.5 border-primary/30 bg-primary/5 p-4">
        <View className="flex-row items-center gap-1.5">
          <Sparkles size={15} color={accent.primary} />
          <Text className="font-body-semibold text-sm text-foreground">Gợi ý bằng AI</Text>
        </View>
        <Text className="font-body text-xs text-muted-foreground">
          Bản nháp tham khảo — bạn vẫn sửa và chịu trách nhiệm về kế hoạch gửi cho khách.
        </Text>
        <Input label="Ghi chú cho AI" value={ptNotes} onChangeText={setPtNotes} placeholder="Khách đau vai phải, tránh đẩy qua đầu…" multiline />
        <Button size="sm" variant="secondary" icon={Sparkles} disabled={generate.isPending} onPress={() => generate.mutate()}>
          {generate.isPending ? "Đang soạn…" : `Nhờ AI soạn nháp cho ${days.length} buổi/tuần`}
        </Button>
        {aiInfo?.summaryForPt ? <Text className="font-body text-xs text-muted-foreground">{aiInfo.summaryForPt}</Text> : null}
        {aiInfo?.warnings?.length ? <Text className="font-body text-xs text-warning">Lưu ý: {aiInfo.warnings.join("; ")}</Text> : null}
        {aiInfo?.dataGaps?.length ? (
          <Text className="font-body text-xs text-muted-foreground">Thiếu dữ liệu: {aiInfo.dataGaps.join("; ")}</Text>
        ) : null}
      </Card>

      {days.map((d, dayIdx) => (
        <Card key={dayIdx} className="gap-3 p-4">
          <View className="flex-row items-center gap-2">
            <TextInput
              value={d.title}
              onChangeText={(t) => patchDay(dayIdx, { title: t })}
              className="min-w-0 flex-1 font-body-semibold text-sm text-foreground"
              accessibilityLabel={`Tên buổi ${d.dayNumber}`}
            />
            {days.length > 1 ? (
              <Tappable
                accessibilityLabel={`Xoá buổi ${d.dayNumber}`}
                onPress={() => setDays((p) => removeDayAt(p, dayIdx))}
                className="h-8 w-8 items-center justify-center rounded-xl bg-panel"
              >
                <Trash2 size={14} color={darkColors.destructive} />
              </Tappable>
            ) : null}
          </View>
          <View className="flex-row justify-between">
            {WEEKDAYS.map((label, w) => {
              const on = d.weekday === w;
              const taken = !on && usedWeekdays.has(w);
              return (
                <Tappable
                  key={w}
                  disabled={taken}
                  onPress={() => patchDay(dayIdx, { weekday: w })}
                  accessibilityLabel={`${label}${on ? " (đã chọn)" : taken ? " (buổi khác đã dùng)" : ""}`}
                  className={`h-8 w-[13%] items-center justify-center rounded-lg border ${
                    on ? "border-primary bg-primary" : "border-border bg-panel"
                  } ${taken ? "opacity-30" : ""}`}
                >
                  <Text className={`font-body-semibold text-[11px] ${on ? "text-on-primary" : "text-muted-foreground"}`}>{label}</Text>
                </Tappable>
              );
            })}
          </View>
          {d.exercises.length === 0 ? (
            <Text className="font-body text-xs text-muted-foreground">Chưa có bài nào.</Text>
          ) : (
            d.exercises.map((ex, exIdx) => (
              <View key={`${ex.exerciseId}-${exIdx}`} className="gap-2 rounded-xl bg-panel p-3">
                <View className="flex-row items-center gap-2">
                  <Text className="min-w-0 flex-1 font-body-semibold text-xs text-foreground" numberOfLines={1}>
                    {ex.name}
                  </Text>
                  <Tappable accessibilityLabel={`Bỏ ${ex.name}`} onPress={() => removeExercise(dayIdx, exIdx)}>
                    <Trash2 size={14} color={darkColors.destructive} />
                  </Tappable>
                </View>
                <View className="flex-row gap-2">
                  <NumField label="Hiệp" value={ex.sets} onChange={(n) => patchExercise(dayIdx, exIdx, { sets: n })} />
                  <NumField label="Lần" value={ex.reps} onChange={(n) => patchExercise(dayIdx, exIdx, { reps: n })} />
                  <NumField label="Nghỉ (s)" value={ex.restSeconds} onChange={(n) => patchExercise(dayIdx, exIdx, { restSeconds: n })} />
                </View>
              </View>
            ))
          )}
          <Button
            size="sm"
            variant="secondary"
            icon={Plus}
            onPress={() => {
              setSearch("");
              setPickFor(dayIdx);
            }}
          >
            Thêm bài tập
          </Button>
        </Card>
      ))}

      {days.length < 7 ? (
        <Button variant="ghost" icon={Plus} onPress={() => setDays((p) => [...p, emptyDay(p.length + 1, nextFreeWeekday(p))])}>
          Thêm buổi
        </Button>
      ) : null}

      {error ? <Text className="font-body text-xs text-destructive">{error}</Text> : null}
      <Button full icon={submitIcon} disabled={!!error || submit.isPending} onPress={() => submit.mutate()}>
        {submit.isPending ? submittingLabel : submitLabel}
      </Button>

      <BottomSheet open={pickFor !== null} onClose={() => setPickFor(null)} title="Chọn bài tập">
        <View className="gap-3 pb-2">
          <View className="h-11 flex-row items-center gap-2 rounded-xl border border-border bg-panel px-3.5">
            <Search size={16} color={designTokens.mutedForeground} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Tìm bài tập"
              placeholderTextColor={inputPlaceholderColor}
              className="flex-1 font-body text-sm text-foreground"
            />
          </View>
          <ScrollView className="max-h-[360px]" keyboardShouldPersistTaps="handled">
            {exercises.isLoading ? (
              <ActivityIndicator className="py-6" color={accent.primary} />
            ) : exercises.isError ? (
              <Text className="py-6 text-center font-body text-sm text-destructive">Không thể tải danh sách bài tập. Vui lòng thử lại.</Text>
            ) : exerciseRows.length === 0 ? (
              <Text className="py-6 text-center font-body text-sm text-muted-foreground">Không tìm thấy bài tập.</Text>
            ) : (
              exerciseRows.map((ex: any) => (
                <Tappable
                  key={ex.id}
                  accessibilityLabel={exName(ex)}
                  onPress={() => {
                    if (pickFor !== null) addExercise(pickFor, ex.id, exName(ex));
                    setPickFor(null);
                  }}
                  className="border-b border-border py-3"
                >
                  <Text className="font-body-semibold text-sm text-foreground">{exName(ex)}</Text>
                  {exMeta(ex) ? <Text className="font-body text-xs text-muted-foreground">{exMeta(ex)}</Text> : null}
                </Tappable>
              ))
            )}
          </ScrollView>
        </View>
      </BottomSheet>
    </View>
  );
}

/** The exercise catalogue's own field names. */
function exName(ex: any): string {
  return ex?.exerciseName ?? ex?.name ?? "Bài tập";
}

function exMeta(ex: any): string {
  const muscle = Array.isArray(ex?.muscleGroupsActivated) ? ex.muscleGroupsActivated[0] : ex?.primaryMuscle;
  return [muscle, ex?.typeOfEquipment ?? ex?.equipment].filter(Boolean).join(" · ");
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <View className="flex-1">
      <Text className="mb-1 font-body text-[11px] text-muted-foreground">{label}</Text>
      <TextInput
        value={String(value)}
        onChangeText={(t) => onChange(Number(t.replace(/[^\d]/g, "")) || 0)}
        keyboardType="number-pad"
        className="rounded-lg border border-border bg-background px-2.5 py-2 font-body text-sm text-foreground"
      />
    </View>
  );
}
