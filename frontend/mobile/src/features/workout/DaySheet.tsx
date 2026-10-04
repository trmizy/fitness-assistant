import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Play, Plus, Trash2 } from "lucide-react-native";

import { Badge, BottomSheet, Button, Input, Tappable, useToast } from "../../components/ui";
import { workoutService } from "../../services/api";
import { toDateInputValue } from "../../utils/date";
import {
  canDeleteSchedule,
  canReschedule,
  programDayOptions,
  rescheduleTargets,
  scheduleErrorMessage,
} from "./scheduleActions";
import type { TrainingDay } from "./trainingWeek";

/**
 * 14B.4 (PG-A3) — one day of the training week: web's day detail actions (Dời lịch, Ẩn khỏi lịch,
 * Thêm lịch tập) as a sheet. Starting a session stays where it was — only today's, in the log screen.
 */

export function scheduleTitle(schedule: any, fallback = "Buổi tập"): string {
  return String(schedule?.programDay?.title ?? schedule?.programDay?.name ?? schedule?.name ?? fallback);
}

function useRefreshWeek() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.refetchQueries({ queryKey: ["workout-schedules"] }),
      queryClient.invalidateQueries({ queryKey: ["workout-current-program"] }),
    ]).catch(() => {});
}

export function DaySheet({ day, onClose }: { day: TrainingDay | null; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefreshWeek();
  const [mode, setMode] = useState<"view" | "reschedule" | "add">("view");
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [programDayId, setProgramDayId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [forKey, setForKey] = useState<string | null>(null);
  if (day && forKey !== day.key) {
    setForKey(day.key);
    setMode("view");
    setTarget(null);
    setReason("");
    setProgramDayId(null);
    setNotes("");
  }

  const todayKey = toDateInputValue(new Date());
  const schedule = day?.schedule ?? null;

  const programQuery = useQuery({
    queryKey: ["workout-current-program"],
    queryFn: () => workoutService.getCurrentProgram(),
    enabled: !!day && mode === "add",
  });
  const program = (programQuery.data as any)?.data?.program ?? (programQuery.data as any)?.program ?? programQuery.data;
  const options = programDayOptions(program);

  const close = () => {
    setForKey(null);
    onClose();
  };

  const reschedule = useMutation({
    mutationFn: () => workoutService.rescheduleSchedule(String(schedule?.id), String(target), reason.trim() || undefined),
    onSuccess: () => {
      toast.show("Đã dời lịch buổi tập.", "success");
      void refresh();
      close();
    },
    onError: (e) => toast.show(scheduleErrorMessage(e, "Không thể dời lịch buổi tập này."), "danger"),
  });
  const remove = useMutation({
    mutationFn: () => workoutService.deleteSchedule(String(schedule?.id)),
    onSuccess: () => {
      toast.show("Đã ẩn buổi tập khỏi lịch.", "success");
      void refresh();
      close();
    },
    onError: (e) => toast.show(scheduleErrorMessage(e, "Không thể ẩn buổi tập này."), "danger"),
  });
  const add = useMutation({
    mutationFn: () => workoutService.createSchedule({ date: String(day?.key), programDayId: String(programDayId), notes: notes.trim() || undefined }),
    onSuccess: (res: any) => {
      toast.show(res?.alreadyExists || res?.data?.alreadyExists ? "Ngày này đã có lịch tập." : "Đã thêm lịch tập.", "success");
      void refresh();
      close();
    },
    onError: (e) => toast.show(scheduleErrorMessage(e, "Không thể thêm lịch tập. Vui lòng thử lại."), "danger"),
  });

  const dateLabel = day ? `${day.label} · ${day.key.slice(8, 10)}/${day.key.slice(5, 7)}` : "";
  const exercises: any[] = Array.isArray(schedule?.programDay?.exercises) ? schedule.programDay.exercises : [];

  return (
    <BottomSheet open={day != null} onClose={close} title={dateLabel}>
      {day ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14, paddingBottom: 8 }}>
          {schedule && mode === "view" ? (
            <>
              <View className="flex-row items-center justify-between gap-2">
                <Text className="flex-1 font-display text-lg text-foreground">{scheduleTitle(schedule)}</Text>
                <Badge tone={day.done ? "success" : day.inProgress ? "warning" : schedule.status === "SKIPPED" ? "neutral" : day.past ? "danger" : "info"}>
                  {day.done ? "Đã xong" : day.inProgress ? "Đang tập" : schedule.status === "SKIPPED" ? "Đã bỏ qua" : day.past ? "Bỏ lỡ" : "Theo lịch"}
                </Badge>
              </View>
              {schedule.originalPlannedDate && schedule.rescheduledAt ? (
                <Text className="font-body text-[11px] text-muted-foreground">
                  Đã dời từ {String(schedule.originalPlannedDate).slice(8, 10)}/{String(schedule.originalPlannedDate).slice(5, 7)}
                  {schedule.rescheduleReason ? ` · ${schedule.rescheduleReason}` : ""}
                </Text>
              ) : null}
              {exercises.length > 0 ? (
                <View className="gap-1.5">
                  {exercises.map((ex: any) => (
                    <View key={ex.id} className="flex-row items-center justify-between rounded-xl bg-panel px-3 py-2.5">
                      <Text className="min-w-0 flex-1 font-body-semibold text-sm text-foreground" numberOfLines={1}>
                        {ex.exercise?.exerciseName ?? "Bài tập"}
                      </Text>
                      <Text className="font-body text-xs text-muted-foreground">
                        {ex.sets ?? "—"} × {ex.reps ?? "—"}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {day.today && !day.done ? (
                <Button full icon={Play} onPress={() => { close(); router.push("/client/workout/log"); }}>
                  {day.inProgress ? "Tiếp tục buổi tập" : "Mở buổi tập hôm nay"}
                </Button>
              ) : null}
              {canReschedule(schedule) ? (
                <Button full variant="secondary" icon={CalendarDays} onPress={() => setMode("reschedule")}>
                  Dời lịch buổi tập
                </Button>
              ) : null}
              {canDeleteSchedule(schedule, todayKey) ? (
                <Button
                  full
                  variant="ghost"
                  icon={Trash2}
                  disabled={remove.isPending}
                  onPress={() =>
                    Alert.alert("Ẩn khỏi lịch?", "Xoá buổi tập này khỏi lịch? Workout đã hoàn thành sẽ không bị xoá.", [
                      { text: "Không", style: "cancel" },
                      { text: "Ẩn", style: "destructive", onPress: () => remove.mutate() },
                    ])
                  }
                >
                  Ẩn khỏi lịch
                </Button>
              ) : null}
              {!day.today && !canReschedule(schedule) && !day.done ? (
                <Text className="text-center font-body text-[11px] text-muted-foreground">
                  {day.past ? "Ngày này đã qua nên không thể chỉnh sửa." : "Chưa đến ngày tập này nên chưa thể bắt đầu."}
                </Text>
              ) : null}
            </>
          ) : null}

          {schedule && mode === "reschedule" ? (
            <>
              <Text className="font-body text-xs text-muted-foreground">{`Chọn ngày mới cho “${scheduleTitle(schedule)}”:`}</Text>
              <View className="flex-row flex-wrap gap-1.5">
                {rescheduleTargets(day.key, new Date()).map((t) => {
                  const on = target === t.key;
                  return (
                    <Tappable
                      key={t.key}
                      onPress={() => setTarget(t.key)}
                      className={`w-[23.5%] items-center rounded-lg border py-2 ${on ? "border-primary bg-primary" : "border-border bg-panel"}`}
                    >
                      <Text className={`font-body text-[10px] ${on ? "text-on-primary" : "text-muted-foreground"}`}>{t.weekday}</Text>
                      <Text className={`font-body-semibold text-xs ${on ? "text-on-primary" : "text-foreground"}`}>{t.label}</Text>
                    </Tappable>
                  );
                })}
              </View>
              <Input label="Lý do (không bắt buộc)" value={reason} onChangeText={setReason} placeholder="Bận việc, đi công tác…" />
              <View className="flex-row gap-2">
                <Button className="flex-1" variant="secondary" onPress={() => setMode("view")}>
                  Quay lại
                </Button>
                <Button className="flex-1" disabled={!target || reschedule.isPending} onPress={() => reschedule.mutate()}>
                  {reschedule.isPending ? "Đang dời…" : "Dời lịch"}
                </Button>
              </View>
            </>
          ) : null}

          {!schedule && mode === "view" ? (
            <>
              <Text className="font-body text-sm text-muted-foreground">Ngày nghỉ — chưa có buổi tập nào theo lịch.</Text>
              <Button full icon={Plus} onPress={() => setMode("add")}>
                Thêm lịch tập
              </Button>
            </>
          ) : null}

          {!schedule && mode === "add" ? (
            programQuery.isLoading ? (
              <Text className="font-body text-sm text-muted-foreground">Đang tải chương trình…</Text>
            ) : options.length === 0 ? (
              <>
                <Text className="font-body text-sm text-muted-foreground">Bạn chưa có chương trình tập. Hãy tạo chương trình trước.</Text>
                <Button full onPress={() => { close(); router.push("/client/workout/programs/new"); }}>
                  Tạo chương trình
                </Button>
              </>
            ) : (
              <>
                <Text className="font-body text-xs text-muted-foreground">{`Chọn buổi trong “${String(program?.name ?? "chương trình hiện tại")}”:`}</Text>
                <View className="gap-1.5">
                  {options.map((o) => {
                    const on = programDayId === o.id;
                    return (
                      <Tappable
                        key={o.id}
                        onPress={() => setProgramDayId(o.id)}
                        className={`flex-row items-center justify-between rounded-xl border px-3 py-3 ${on ? "border-primary bg-primary/10" : "border-border bg-panel"}`}
                      >
                        <Text className="font-body-semibold text-sm text-foreground">{o.label}</Text>
                        <Text className="font-body text-xs text-muted-foreground">{o.exerciseCount} bài</Text>
                      </Tappable>
                    );
                  })}
                </View>
                <Input label="Ghi chú (không bắt buộc)" value={notes} onChangeText={setNotes} />
                <View className="flex-row gap-2">
                  <Button className="flex-1" variant="secondary" onPress={() => setMode("view")}>
                    Quay lại
                  </Button>
                  <Button className="flex-1" disabled={!programDayId || add.isPending} onPress={() => add.mutate()}>
                    {add.isPending ? "Đang thêm…" : "Thêm lịch"}
                  </Button>
                </View>
              </>
            )
          ) : null}
        </ScrollView>
      ) : null}
    </BottomSheet>
  );
}
