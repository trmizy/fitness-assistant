import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronUp, MessageSquare, Minus, Plus } from "lucide-react-native";

import { BottomSheet, Button, Input, Tappable, useToast } from "../../components/ui";
import { sessionFeedbackService, type SessionSkipReason } from "../../services/api";
import { addDays, toDateInputValue } from "../../utils/date";
import { useWorkspaceAccent } from "../../theme/workspace";
import { StarInput } from "../plans/PlanWidgets";
import {
  DIFFICULTY_OPTIONS,
  ENJOYMENT_OPTIONS,
  EXERCISE_ISSUE_TAGS,
  FEEDBACK_SCALES,
  PERCEIVED_PROGRESS_OPTIONS,
  SKIP_REASON_OPTIONS,
  WOULD_REPEAT_OPTIONS,
  completionPayload,
  hasSubmittedFeedback,
  initialCompletionForm,
  skipPayload,
  stepScale,
  type CompletionForm,
  type ScaleSpec,
} from "./sessionFeedback";

/**
 * 14B.1 (PG-A2) — web `WorkoutLogPage`'s post-session feedback (`SessionFeedbackModal`), the
 * skipped/cancelled reason form (`SkipCancelFeedbackModal`) and the "Đã ghi cảm nhận · Xem/sửa"
 * status row, as bottom sheets. Every field is optional on the completion form; the skip form only
 * needs a reason. The server picks the accepted shape from the session's real status.
 */

export function feedbackQueryKey(scheduleId: string) {
  return ["session-feedback", scheduleId];
}

function useAfterFeedbackSaved(scheduleId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: feedbackQueryKey(scheduleId) });
    // The cycle's feedback summary and progress read these rows.
    void queryClient.invalidateQueries({ queryKey: ["training-cycle"] });
  };
}

/** Status row for a finished session: shows whether feedback exists and opens the form. */
export function SessionFeedbackStatusRow({ scheduleId, onOpen }: { scheduleId: string; onOpen: () => void }) {
  const statusQuery = useQuery({
    queryKey: feedbackQueryKey(scheduleId),
    queryFn: () => sessionFeedbackService.get(scheduleId),
  });
  if (statusQuery.isLoading) return null;
  const has = hasSubmittedFeedback(statusQuery.data);
  return (
    <Tappable
      className={`flex-row items-center justify-center gap-1.5 rounded-xl border py-2.5 ${
        has ? "border-primary/40 bg-primary/5" : "border-warning/40 bg-warning/5"
      }`}
      onPress={onOpen}
    >
      <MessageSquare size={14} color={has ? "#22c55e" : "#f59e0b"} />
      <Text className={`font-body-semibold text-xs ${has ? "text-primary" : "text-warning"}`}>
        {has ? "Đã ghi cảm nhận · Xem/sửa" : "Chưa ghi cảm nhận · Thêm ngay"}
      </Text>
    </Tappable>
  );
}

function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  columns = 3,
}: {
  options: { value: T; label: string }[];
  value: T | undefined;
  onChange: (v: T) => void;
  columns?: 2 | 3;
}) {
  return (
    <View className="flex-row flex-wrap justify-between gap-y-1.5">
      {options.map((opt) => {
        const on = value === opt.value;
        return (
          <Tappable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            className={`${columns === 3 ? "w-[32.5%]" : "w-[49%]"} items-center rounded-lg border py-2.5 ${
              on ? "border-primary bg-primary" : "border-border bg-panel"
            }`}
            accessibilityLabel={on ? `${opt.label} (đã chọn)` : opt.label}
          >
            <Text className={`font-body-semibold text-xs ${on ? "text-on-primary" : "text-muted-foreground"}`}>{opt.label}</Text>
          </Tappable>
        );
      })}
    </View>
  );
}

function ScaleField({ spec, value, onChange }: { spec: ScaleSpec; value: number; onChange: (v: number) => void }) {
  const accent = useWorkspaceAccent();
  const fill = ((value - spec.min) / (spec.max - spec.min)) * 100;
  return (
    <View>
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 font-body-semibold text-xs text-foreground">{spec.label}</Text>
        <Tappable
          className="h-8 w-8 items-center justify-center rounded-lg bg-panel"
          onPress={() => onChange(stepScale(spec, value, -1))}
          accessibilityLabel={`Giảm ${spec.label}`}
        >
          <Minus size={14} color="#8b9299" />
        </Tappable>
        <Text className="w-16 text-center font-display text-base text-foreground">{spec.format ? spec.format(value) : value}</Text>
        <Tappable
          className="h-8 w-8 items-center justify-center rounded-lg bg-panel"
          onPress={() => onChange(stepScale(spec, value, 1))}
          accessibilityLabel={`Tăng ${spec.label}`}
        >
          <Plus size={14} color="#8b9299" />
        </Tappable>
      </View>
      <View className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-panel">
        <View className="h-full rounded-full" style={{ width: `${fill}%`, backgroundColor: accent.primary }} />
      </View>
      <Text className="mt-1 font-body text-[10px] text-muted-foreground">{spec.hint}</Text>
    </View>
  );
}

function Label({ children }: { children: string }) {
  return <Text className="mb-1.5 font-body-semibold text-xs text-foreground">{children}</Text>;
}

/** The completion form. `exercises` are the session's exercises (Exercise.id + name). */
export function SessionFeedbackSheet({
  scheduleId,
  exercises,
  open,
  onClose,
}: {
  scheduleId: string;
  exercises: { exerciseId: string; name: string }[];
  open: boolean;
  onClose: () => void;
}) {
  const savedQuery = useQuery({
    queryKey: feedbackQueryKey(scheduleId),
    queryFn: () => sessionFeedbackService.get(scheduleId),
    enabled: open,
  });
  return (
    <BottomSheet open={open} onClose={onClose} title="Cảm nhận buổi tập này thế nào?">
      {/* Mounted per open, after the saved row arrives, so the form starts from what was saved. */}
      {open && !savedQuery.isLoading ? (
        <CompletionFormBody
          scheduleId={scheduleId}
          exercises={exercises}
          initial={initialCompletionForm(savedQuery.data?.feedback?.feedbackMissing ? null : savedQuery.data?.feedback)}
          onClose={onClose}
        />
      ) : null}
    </BottomSheet>
  );
}

function CompletionFormBody({
  scheduleId,
  exercises,
  initial,
  onClose,
}: {
  scheduleId: string;
  exercises: { exerciseId: string; name: string }[];
  initial: CompletionForm;
  onClose: () => void;
}) {
  const toast = useToast();
  const afterSaved = useAfterFeedbackSaved(scheduleId);
  const [form, setForm] = useState<CompletionForm>(initial);
  const [showExercises, setShowExercises] = useState(false);
  const set = <K extends keyof CompletionForm>(key: K, value: CompletionForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = useMutation({
    mutationFn: () => sessionFeedbackService.submit(scheduleId, completionPayload(form)),
    onSuccess: () => {
      toast.show("Đã ghi nhận cảm nhận buổi tập", "success");
      afterSaved();
      onClose();
    },
    onError: () => toast.show("Không thể ghi nhận cảm nhận buổi tập", "danger"),
  });

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 16, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
      <View className="items-center gap-1">
        <StarInput value={form.sessionRating} onChange={(n) => set("sessionRating", n)} size={30} />
        <Text className="font-body text-[10px] text-muted-foreground">Đánh giá tổng thể (không bắt buộc)</Text>
      </View>

      <View>
        <Label>Độ khó buổi tập</Label>
        <ToggleGroup options={DIFFICULTY_OPTIONS} value={form.difficulty} onChange={(v) => set("difficulty", v)} />
      </View>
      <View>
        <Label>Bạn có thích buổi tập này không?</Label>
        <ToggleGroup options={ENJOYMENT_OPTIONS} value={form.enjoyment} onChange={(v) => set("enjoyment", v)} />
      </View>

      {FEEDBACK_SCALES.map((spec) => (
        <ScaleField key={spec.key} spec={spec} value={form[spec.key]} onChange={(v) => set(spec.key, v)} />
      ))}

      {form.painScore > 0 ? (
        <Input
          value={form.painLocation}
          onChangeText={(t) => set("painLocation", t)}
          placeholder="Vị trí đau (vd: vai trái, đầu gối phải)"
        />
      ) : null}

      <View>
        <Label>Bạn có muốn tập lại buổi này không?</Label>
        <ToggleGroup options={WOULD_REPEAT_OPTIONS} value={form.wouldRepeatSession} onChange={(v) => set("wouldRepeatSession", v)} />
      </View>
      <View>
        <Label>So với buổi trước</Label>
        <ToggleGroup
          columns={2}
          options={PERCEIVED_PROGRESS_OPTIONS}
          value={form.perceivedProgress}
          onChange={(v) => set("perceivedProgress", form.perceivedProgress === v ? undefined : v)}
        />
      </View>

      {exercises.length > 0 ? (
        <View className="border-t border-border pt-3">
          <Tappable className="flex-row items-center justify-between" onPress={() => setShowExercises((v) => !v)}>
            <Text className="font-body text-xs text-muted-foreground">Chi tiết từng bài tập (không bắt buộc)</Text>
            {showExercises ? <ChevronUp size={15} color="#8b9299" /> : <ChevronDown size={15} color="#8b9299" />}
          </Tappable>
          {showExercises ? (
            <View className="mt-3 gap-3">
              {exercises.map((ex) => (
                <View key={ex.exerciseId}>
                  <Text className="mb-1.5 font-body text-xs text-foreground">{ex.name}</Text>
                  <View className="flex-row flex-wrap gap-1.5">
                    {EXERCISE_ISSUE_TAGS.map((tag) => {
                      const on = form.exerciseTags[ex.exerciseId] === tag.value;
                      return (
                        <Tappable
                          key={tag.value}
                          onPress={() =>
                            set("exerciseTags", { ...form.exerciseTags, [ex.exerciseId]: on ? undefined : tag.value })
                          }
                          className={`rounded-full border px-2.5 py-1 ${on ? "border-primary bg-primary" : "border-border bg-panel"}`}
                        >
                          <Text className={`font-body text-[11px] ${on ? "text-on-primary" : "text-muted-foreground"}`}>{tag.label}</Text>
                        </Tappable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <Input
        value={form.notes}
        onChangeText={(t) => set("notes", t)}
        placeholder="Ghi chú thêm (không bắt buộc)"
        multiline
        style={{ minHeight: 64, textAlignVertical: "top" }}
      />

      <View className="flex-row gap-2">
        <Button className="flex-1" variant="secondary" onPress={onClose}>
          Bỏ qua
        </Button>
        <Button className="flex-1" disabled={submit.isPending} onPress={() => submit.mutate()}>
          {submit.isPending ? "Đang lưu..." : "Lưu"}
        </Button>
      </View>
    </ScrollView>
  );
}

/** The skipped/cancelled form — a reason is the only required field. */
export function SkipFeedbackSheet({ scheduleId, open, onClose }: { scheduleId: string; open: boolean; onClose: () => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Vì sao bạn bỏ buổi tập này?">
      {open ? <SkipFormBody scheduleId={scheduleId} onClose={onClose} /> : null}
    </BottomSheet>
  );
}

function SkipFormBody({ scheduleId, onClose }: { scheduleId: string; onClose: () => void }) {
  const toast = useToast();
  const afterSaved = useAfterFeedbackSaved(scheduleId);
  const [reason, setReason] = useState<SessionSkipReason | null>(null);
  const [notes, setNotes] = useState("");
  const [adjust, setAdjust] = useState(false);
  const [makeupDay, setMakeupDay] = useState<string | null>(null);
  // Web has a free date input; on a phone the next seven days cover "when can you make it up".
  const days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 7 }, (_, i) => addDays(today, i + 1));
  }, []);

  const submit = useMutation({
    mutationFn: () => {
      if (!reason) throw new Error("skipReason required");
      return sessionFeedbackService.submit(scheduleId, skipPayload({ skipReason: reason, notes, shouldAdjustPlan: adjust, makeupDay }));
    },
    onSuccess: () => {
      toast.show("Đã ghi nhận lý do bỏ buổi tập", "success");
      afterSaved();
      onClose();
    },
    onError: () => toast.show("Không thể ghi nhận. Vui lòng chọn lý do.", "danger"),
  });

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 16, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
      <ToggleGroup columns={2} options={SKIP_REASON_OPTIONS} value={reason ?? undefined} onChange={setReason} />

      <Tappable className="flex-row items-center gap-2.5" onPress={() => setAdjust((v) => !v)} accessibilityLabel={adjust ? "Đã chọn: muốn điều chỉnh kế hoạch" : "Muốn điều chỉnh kế hoạch"}>
        <View className={`h-5 w-5 items-center justify-center rounded-md border ${adjust ? "border-primary bg-primary" : "border-border bg-panel"}`}>
          {adjust ? <Check size={13} strokeWidth={3} color="#0a0a0a" /> : null}
        </View>
        <Text className="flex-1 font-body text-xs text-foreground">Tôi muốn điều chỉnh lại kế hoạch tập</Text>
      </Tappable>

      <View>
        <Text className="mb-1.5 font-body text-[11px] text-muted-foreground">Ngày bạn có thể tập bù (không bắt buộc)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {days.map((d) => {
            const key = toDateInputValue(d);
            const on = makeupDay === key;
            return (
              <Tappable
                key={key}
                onPress={() => setMakeupDay(on ? null : key)}
                className={`items-center rounded-lg border px-3 py-2 ${on ? "border-primary bg-primary" : "border-border bg-panel"}`}
              >
                <Text className={`font-body text-[10px] ${on ? "text-on-primary" : "text-muted-foreground"}`}>
                  {d.toLocaleDateString("vi-VN", { weekday: "short" })}
                </Text>
                <Text className={`font-body-semibold text-xs ${on ? "text-on-primary" : "text-foreground"}`}>
                  {key.slice(8, 10)}/{key.slice(5, 7)}
                </Text>
              </Tappable>
            );
          })}
        </ScrollView>
      </View>

      <Input
        value={notes}
        onChangeText={setNotes}
        placeholder="Ghi chú thêm (không bắt buộc)"
        multiline
        style={{ minHeight: 64, textAlignVertical: "top" }}
      />

      <View className="flex-row gap-2">
        <Button className="flex-1" variant="secondary" onPress={onClose}>
          Bỏ qua
        </Button>
        <Button className="flex-1" disabled={submit.isPending || !reason} onPress={() => submit.mutate()}>
          {submit.isPending ? "Đang lưu..." : "Lưu"}
        </Button>
      </View>
    </ScrollView>
  );
}
