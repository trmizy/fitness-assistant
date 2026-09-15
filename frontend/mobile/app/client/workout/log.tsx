import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { Check, CloudOff, Dumbbell, Flame, Minus, Play, Plus, Square, Timer } from "lucide-react-native";

import {
  Badge,
  Button,
  Card,
  CountUp,
  EmptyState,
  ScreenHeader,
  Tappable,
  useToast,
} from "../../../src/components/ui";
import { workoutService } from "../../../src/services/api";
import { toDateInputValue } from "../../../src/utils/date";
import { haptics } from "../../../src/lib/haptics";
import { useWorkspaceAccent } from "../../../src/theme/workspace";

type SetRow = {
  id: string;
  setNumber: number;
  weight: number;
  reps: number;
  targetReps: number | null;
  targetRpe: number | null;
  completed: boolean;
  /** Set locally but the PATCH never reached the server — shown as "chờ đồng bộ", retryable. */
  unsynced?: boolean;
};

type ExerciseBlock = {
  key: string;
  exerciseId: string;
  name: string;
  restSeconds: number;
  sets: SetRow[];
};

const DEFAULT_REST_SECONDS = 90;

function clock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * CL-17 — live workout logging.
 *
 * Visual authority: `New Frontend/src/screens/WorkoutLog.tsx`. Behavioural authority: web's
 * `WorkoutLogPage.tsx`, specifically its set-by-set path: `startSchedule` pre-creates a real,
 * persisted `WorkoutSet` skeleton, and each row is written back with
 * `PATCH /workouts/sets/:setId` — the same call, the same fields. Nothing here invents a set
 * that the server did not create.
 *
 * Deliberately NOT ported from web: the durable offline event queue (`enqueueWorkoutEvent`,
 * IndexedDB-backed, Roadmap P1.4). A half-built queue is worse than none — it loses sets while
 * looking like it saved them. What IS here is the honest half: a PATCH that fails with no HTTP
 * response marks that row "chờ đồng bộ" and stays retryable, so nothing is silently dropped. The
 * reference's offline banner is a manual demo toggle in the prototype; real connectivity
 * detection needs `@react-native-community/netinfo` (a native module), batched with Phase 14.
 */
export default function WorkoutLogScreen() {
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();

  // Off until a started workout loads — see the hydration effect, which also seeds `elapsed`.
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [rest, setRest] = useState<number | null>(null);
  const [blocks, setBlocks] = useState<ExerciseBlock[] | null>(null);
  const [starting, setStarting] = useState(false);
  const hydratedFor = useRef<string | null>(null);

  // Today's schedule is what a session is started from — same source the dashboard and the week
  // tab read, so all three agree on what "hôm nay" means.
  const todayKey = toDateInputValue(new Date());
  const scheduleQuery = useQuery({
    queryKey: ["workout-schedules", "today"],
    queryFn: () => workoutService.getSchedules(20, { startDate: todayKey, endDate: todayKey }),
  });

  const schedule: any = useMemo(() => {
    const list: any[] = Array.isArray(scheduleQuery.data) ? scheduleQuery.data : [];
    return list[0] ?? null;
  }, [scheduleQuery.data]);

  const workoutId: string | null = schedule?.workoutId ?? schedule?.workout?.id ?? null;

  const workoutQuery = useQuery({
    queryKey: ["workout", workoutId],
    queryFn: () => workoutService.getWorkout(String(workoutId)),
    enabled: !!workoutId,
  });

  // Hydrate local rows once per workout. Re-hydrating on every refetch would wipe values the
  // user is mid-way through typing.
  useEffect(() => {
    if (!workoutId || hydratedFor.current === workoutId) return;
    const normalized = normalizeWorkout(workoutQuery.data);
    if (normalized) {
      setBlocks(normalized);
      hydratedFor.current = workoutId;
      // The clock measures the session, not how long this screen has been open: it starts from
      // when the workout was created by "Bắt đầu", so reopening a session mid-way keeps counting
      // from the real start instead of showing time spent looking at the start card.
      const raw: any = workoutQuery.data;
      const startedAt = Date.parse(
        schedule?.startedAt ?? (raw?.workout ?? raw?.data ?? raw)?.createdAt ?? "",
      );
      setElapsed(
        Number.isFinite(startedAt) ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0,
      );
      setRunning(true);
    }
  }, [workoutId, workoutQuery.data]);

  // Elapsed clock.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  // Rest countdown. Ends itself at zero with a haptic so the user does not have to watch it.
  useEffect(() => {
    if (rest === null) return;
    if (rest <= 0) {
      haptics.success();
      setRest(null);
      return;
    }
    const t = setTimeout(() => setRest((r) => (r === null ? null : r - 1)), 1000);
    return () => clearTimeout(t);
  }, [rest]);

  const completedSets = useMemo(
    () => (blocks ?? []).reduce((n, b) => n + b.sets.filter((s) => s.completed).length, 0),
    [blocks],
  );
  const totalVolume = useMemo(
    () =>
      (blocks ?? []).reduce(
        (v, b) => v + b.sets.filter((s) => s.completed).reduce((a, s) => a + s.weight * s.reps, 0),
        0,
      ),
    [blocks],
  );

  const patchRow = useCallback(
    (blockKey: string, setId: string, patch: Partial<SetRow>) => {
      setBlocks((prev) =>
        (prev ?? []).map((b) =>
          b.key === blockKey
            ? { ...b, sets: b.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) }
            : b,
        ),
      );
    },
    [],
  );

  const persist = useCallback(
    async (blockKey: string, row: SetRow, completed: boolean) => {
      try {
        await workoutService.updateSet(row.id, {
          weight: row.weight,
          reps: row.reps,
          completed,
        });
        patchRow(blockKey, row.id, { unsynced: false });
      } catch (e: any) {
        // A response means the server rejected it — that is a real error worth showing. No
        // response at all means the network dropped; keep the value and let them retry.
        if (e?.response) {
          toast.show(e?.response?.data?.error ?? "Không lưu được set này.", "danger");
          patchRow(blockKey, row.id, { completed: !completed });
        } else {
          patchRow(blockKey, row.id, { unsynced: true });
          toast.show("Mất mạng — set đã ghi tạm, bấm để thử lại.", "danger");
        }
      }
    },
    [patchRow, toast],
  );

  const toggleSet = useCallback(
    (block: ExerciseBlock, row: SetRow) => {
      const next = !row.completed;
      haptics.tap();
      patchRow(block.key, row.id, { completed: next });
      if (next) setRest(block.restSeconds);
      void persist(block.key, row, next);
    },
    [patchRow, persist],
  );

  const addSet = useCallback(
    async (block: ExerciseBlock) => {
      if (!workoutId) return;
      const last = block.sets[block.sets.length - 1];
      try {
        const created: any = await workoutService.addSet(workoutId, {
          exerciseId: block.exerciseId,
          setNumber: (last?.setNumber ?? block.sets.length) + 1,
          weight: last?.weight ?? 20,
          reps: last?.targetReps ?? last?.reps ?? 10,
        });
        const createdSet = created?.set ?? created?.data ?? created;
        if (!createdSet?.id) throw new Error("no id");
        setBlocks((prev) =>
          (prev ?? []).map((b) =>
            b.key === block.key
              ? {
                  ...b,
                  sets: [
                    ...b.sets,
                    {
                      id: String(createdSet.id),
                      setNumber: Number(createdSet.setNumber ?? b.sets.length + 1),
                      weight: Number(createdSet.weight ?? last?.weight ?? 20),
                      reps: Number(createdSet.reps ?? last?.reps ?? 10),
                      targetReps: last?.targetReps ?? null,
                      targetRpe: last?.targetRpe ?? null,
                      completed: false,
                    },
                  ],
                }
              : b,
          ),
        );
      } catch {
        toast.show("Không thêm được set. Thử lại khi có mạng.", "danger");
      }
    },
    [workoutId, toast],
  );

  const startSession = useCallback(async () => {
    if (!schedule?.id) return;
    setStarting(true);
    try {
      await workoutService.startSchedule(String(schedule.id));
      await queryClient.refetchQueries({ queryKey: ["workout-schedules", "today"] });
      haptics.success();
    } catch {
      toast.show("Không bắt đầu được buổi tập. Kiểm tra kết nối rồi thử lại.", "danger");
    } finally {
      setStarting(false);
    }
  }, [schedule?.id, queryClient, toast]);

  const finish = useCallback(async () => {
    haptics.success();
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["workout-history", "recent"] }),
      queryClient.refetchQueries({ queryKey: ["workout-schedules", "week"] }),
      queryClient.refetchQueries({ queryKey: ["activity-heatmap", "dashboard-week"] }),
    ]).catch(() => {});
    toast.show("Đã hoàn thành buổi tập!", "success");
    router.back();
  }, [queryClient, toast]);

  const loading = scheduleQuery.isLoading || (!!workoutId && workoutQuery.isLoading);
  const unsyncedCount = (blocks ?? []).reduce(
    (n, b) => n + b.sets.filter((s) => s.unsynced).length,
    0,
  );

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Đang tập" onBack={() => router.back()} />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={accent.primary} />
        </View>
      ) : !schedule ? (
        <EmptyState
          icon={Dumbbell}
          title="Hôm nay không có buổi nào được lên lịch"
          description="Mở Tập luyện để xem lịch tuần hoặc lên lịch một buổi mới."
          actionLabel="Về Tập luyện"
          onAction={() => router.back()}
        />
      ) : !workoutId ? (
        <View className="flex-1 justify-center px-5">
          <Card className="p-5">
            <Text className="font-display text-xl text-foreground">
              {schedule?.programDay?.name ?? schedule?.name ?? "Buổi tập hôm nay"}
            </Text>
            <Text className="mt-1.5 font-body text-sm text-muted-foreground">
              Bấm bắt đầu để mở buổi tập — hệ thống sẽ tạo sẵn các set theo giáo án.
            </Text>
            <View className="mt-4">
              <Button full size="lg" icon={Play} disabled={starting} onPress={startSession}>
                Bắt đầu buổi tập
              </Button>
            </View>
          </Card>
        </View>
      ) : (
        <>
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 160 }}
            keyboardShouldPersistTaps="handled"
          >
            {unsyncedCount > 0 ? (
              <View className="mb-4 flex-row items-center gap-2.5 rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5">
                <CloudOff size={16} color="#f59e0b" />
                <Text className="flex-1 font-body-medium text-xs text-warning">
                  {unsyncedCount} set chưa đồng bộ — bấm lại dấu tích để thử gửi lại.
                </Text>
              </View>
            ) : null}

            <Card className="mb-4 p-4">
              <View className="mb-3 flex-row items-start justify-between gap-3">
                <View className="flex-1">
                  <Badge tone={running ? "success" : "neutral"}>
                    {running ? "Đang tập" : "Tạm dừng"}
                  </Badge>
                  <Text className="font-display mt-1.5 text-lg leading-tight text-foreground">
                    {schedule?.programDay?.name ?? schedule?.name ?? "Buổi tập"}
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="font-display text-3xl text-primary" style={{ fontVariant: ["tabular-nums"] }}>
                    {clock(elapsed)}
                  </Text>
                  <Text className="font-body text-[11px] text-muted-foreground">Thời gian tập</Text>
                </View>
              </View>

              <View className="flex-row items-center gap-3 border-t border-border pt-3">
                <View className="flex-1">
                  <Text className="font-display text-xl text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
                    <CountUp to={totalVolume} suffix=" kg" />
                  </Text>
                  <Text className="font-body text-[11px] text-muted-foreground">Tổng khối lượng</Text>
                </View>
                <View className="flex-1">
                  <Text className="font-display text-xl text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
                    {completedSets}
                  </Text>
                  <Text className="font-body text-[11px] text-muted-foreground">Set hoàn thành</Text>
                </View>
                <Tappable
                  className="h-11 w-11 items-center justify-center rounded-xl bg-panel"
                  onPress={() => setRunning((r) => !r)}
                >
                  {running ? (
                    <Square size={18} color="#e6eae8" />
                  ) : (
                    <Play size={18} color="#e6eae8" />
                  )}
                </Tappable>
              </View>
            </Card>

            {(blocks ?? []).length === 0 ? (
              <EmptyState
                icon={Dumbbell}
                title="Buổi tập này chưa có bài nào"
                description="Giáo án chưa xếp bài cho buổi này."
              />
            ) : (
              <View className="gap-4">
                {(blocks ?? []).map((block) => (
                  <Card key={block.key} className="p-4">
                    <View className="mb-3 flex-row items-center gap-3">
                      <View className="h-10 w-10 items-center justify-center rounded-xl bg-panel">
                        <Dumbbell size={18} color={accent.primary} />
                      </View>
                      <View className="flex-1">
                        <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                          {block.name}
                        </Text>
                        <View className="mt-0.5 flex-row items-center gap-1">
                          <Timer size={11} color="#8b9299" />
                          <Text className="font-body text-[11px] text-muted-foreground">
                            Nghỉ {block.restSeconds}s giữa set
                          </Text>
                        </View>
                      </View>
                      <Text className="font-body text-xs text-muted-foreground">
                        {block.sets.filter((s) => s.completed).length}/{block.sets.length}
                      </Text>
                    </View>

                    <View className="gap-2">
                      {block.sets.map((row, i) => (
                        <View
                          key={row.id}
                          className={`rounded-xl border p-2.5 ${
                            row.unsynced
                              ? "border-warning/40 bg-warning/5"
                              : row.completed
                                ? "border-primary/40 bg-primary/5"
                                : "border-border bg-panel"
                          }`}
                        >
                          <View className="flex-row items-center gap-2">
                            <Text className="font-display w-6 shrink-0 text-center text-sm text-muted-foreground">
                              {i + 1}
                            </Text>
                            <NumField
                              label="kg"
                              value={row.weight}
                              step={2.5}
                              onChange={(v) => patchRow(block.key, row.id, { weight: v })}
                            />
                            <NumField
                              label="reps"
                              value={row.reps}
                              step={1}
                              onChange={(v) => patchRow(block.key, row.id, { reps: v })}
                            />
                            <Tappable
                              className={`h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                                row.completed ? "bg-primary" : "border border-border bg-card"
                              }`}
                              onPress={() => toggleSet(block, row)}
                            >
                              <Check
                                size={18}
                                strokeWidth={3}
                                color={row.completed ? accent.onPrimary : "#8b9299"}
                              />
                            </Tappable>
                          </View>
                          {row.targetReps != null || row.targetRpe != null ? (
                            <Text className="mt-1.5 pl-8 font-body text-[11px] text-muted-foreground">
                              Mục tiêu: {row.targetReps ?? "—"} reps
                              {row.targetRpe != null ? ` · RPE ${row.targetRpe}` : ""}
                            </Text>
                          ) : null}
                        </View>
                      ))}
                    </View>

                    <Tappable
                      className="mt-3 flex-row items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5"
                      onPress={() => void addSet(block)}
                    >
                      <Plus size={16} color="#8b9299" />
                      <Text className="font-body-semibold text-sm text-muted-foreground">Thêm set</Text>
                    </Tappable>
                  </Card>
                ))}
              </View>
            )}
          </ScrollView>

          {/* Rest countdown */}
          {rest !== null ? (
            <Animated.View
              entering={FadeInDown.springify().damping(32).stiffness(340)}
              exiting={FadeOutDown.duration(160)}
              className="absolute inset-x-0 px-5"
              style={{ bottom: insets.bottom + 84 }}
            >
              <View className="rounded-2xl border border-primary/40 bg-primary/10 p-3.5">
                <View className="mb-2.5 flex-row items-center gap-2">
                  <Timer size={18} color={accent.primary} />
                  <Text className="font-body-semibold text-sm text-primary">Nghỉ giữa set</Text>
                  <Text
                    className="font-display ml-auto text-2xl text-primary"
                    style={{ fontVariant: ["tabular-nums"] }}
                  >
                    {clock(rest)}
                  </Text>
                </View>
                <View className="flex-row gap-2">
                  <RestButton
                    icon={Minus}
                    label="15s"
                    onPress={() => setRest((r) => Math.max(0, (r ?? 0) - 15))}
                  />
                  <RestButton icon={Plus} label="15s" onPress={() => setRest((r) => (r ?? 0) + 15)} />
                  <Tappable
                    className="flex-1 items-center rounded-xl bg-primary py-2"
                    onPress={() => setRest(null)}
                  >
                    <Text className="font-body-semibold text-sm text-on-primary">Bỏ qua</Text>
                  </Tappable>
                </View>
              </View>
            </Animated.View>
          ) : null}

          {/* Finish bar */}
          <View
            className="absolute inset-x-0 bottom-0 border-t border-border bg-background px-5 pt-3"
            style={{ paddingBottom: insets.bottom + 12 }}
          >
            <Button full size="lg" icon={Flame} onPress={finish}>
              Kết thúc buổi tập
            </Button>
          </View>
        </>
      )}
    </View>
  );
}

/**
 * The workout endpoint's shape is loose (`any` all the way down), and the set skeleton
 * `startSchedule` creates can arrive under a couple of different names depending on how the
 * workout was opened. Normalizing in one place keeps that knowledge out of the render tree.
 */
function normalizeWorkout(raw: any): ExerciseBlock[] | null {
  const workout = raw?.workout ?? raw?.data ?? raw;
  const exercises = workout?.exercises;
  if (!Array.isArray(exercises)) return null;

  return exercises.map((ex: any, index: number): ExerciseBlock => {
    // The logged rows live in `workoutSets`; `sets` on a workout exercise is the planned set COUNT
    // (a number), so reading it as the row list rendered every session as 0/0.
    const sets: any[] = Array.isArray(ex?.workoutSets)
      ? ex.workoutSets
      : Array.isArray(ex?.sets)
        ? ex.sets
        : [];
    return {
      key: String(ex?.id ?? index),
      exerciseId: String(ex?.exerciseId ?? ex?.exercise?.id ?? ex?.id ?? ""),
      name:
        ex?.exercise?.exerciseName ??
        ex?.exerciseNameSnapshot ??
        ex?.exerciseName ??
        ex?.name ??
        "Bài tập",
      restSeconds: Number(ex?.restSeconds ?? ex?.restBetweenSetsSeconds ?? DEFAULT_REST_SECONDS),
      sets: sets.map((s: any, i: number) => ({
        id: String(s?.id ?? `${index}-${i}`),
        setNumber: Number(s?.setNumber ?? i + 1),
        weight: Number(s?.weight ?? s?.targetWeight ?? 0),
        reps: Number(s?.reps ?? s?.targetReps ?? 0),
        targetReps: s?.targetReps != null ? Number(s.targetReps) : null,
        targetRpe: s?.targetRpe != null ? Number(s.targetRpe) : null,
        completed: !!s?.completed,
      })),
    };
  });
}

function RestButton({
  icon: Icon,
  label,
  onPress,
}: {
  icon: typeof Plus;
  label: string;
  onPress: () => void;
}) {
  return (
    <Tappable
      className="flex-1 flex-row items-center justify-center gap-1 rounded-xl border border-border bg-card py-2"
      onPress={onPress}
    >
      <Icon size={14} color="#8b9299" />
      <Text className="font-body-semibold text-sm text-foreground">{label}</Text>
    </Tappable>
  );
}

function NumField({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (next: number) => void;
}) {
  return (
    <View className="flex-1 flex-row items-center gap-1 rounded-lg bg-card px-1.5 py-1">
      <Tappable
        className="h-7 w-7 items-center justify-center rounded-md bg-panel"
        haptic={false}
        onPress={() => onChange(Math.max(0, Number((value - step).toFixed(1))))}
      >
        <Minus size={13} color="#8b9299" />
      </Tappable>
      <View className="flex-1">
        <TextInput
          value={String(value)}
          onChangeText={(text) => onChange(Number(text.replace(",", ".")) || 0)}
          keyboardType="decimal-pad"
          className="font-display w-full text-center text-sm text-foreground"
          style={{ fontVariant: ["tabular-nums"], paddingVertical: 0 }}
        />
        <Text className="-mt-0.5 text-center font-body text-[9px] uppercase text-muted-foreground">
          {label}
        </Text>
      </View>
      <Tappable
        className="h-7 w-7 items-center justify-center rounded-md bg-panel"
        haptic={false}
        onPress={() => onChange(Number((value + step).toFixed(1)))}
      >
        <Plus size={13} color="#8b9299" />
      </Tappable>
    </View>
  );
}
