import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import {
  ArrowLeft,
  Check,
  CloudOff,
  Dumbbell,
  Flame,
  Minus,
  Play,
  Plus,
  Square,
  Timer,
} from "lucide-react-native";

import {
  Badge,
  Button,
  Card,
  CountUp,
  EmptyState,
  ExerciseMedia,
  ScreenHeader,
  Tappable,
  useToast,
} from "../../../src/components/ui";
import { workoutService } from "../../../src/services/api";
import { toDateInputValue } from "../../../src/utils/date";
import { haptics } from "../../../src/lib/haptics";
import { useWorkspaceAccent } from "../../../src/theme/workspace";

import {
  formatClock as clock,
  keepUnsyncedRows,
  normalizeWorkout,
  sessionClockState,
  type ExerciseBlock,
  type SetRow,
} from "../../../src/features/workout/normalizeWorkout";

/**
 * CL-17 — live workout logging.
 *
 * Visual authority: `New Frontend/src/screens/WorkoutLog.tsx`. Behavioural authority: web's
 * `WorkoutLogPage.tsx`, specifically its set-by-set path: `startSchedule` pre-creates a real,
 * persisted `WorkoutSet` skeleton, and each row is written back with
 * `PATCH /workouts/sets/:setId` — the same call, the same fields. Nothing here invents a set
 * that the server did not create.
 *
 * A session that is already COMPLETED (reachable again through the week tab's "+" button) opens as
 * a summary: frozen real duration, "Đã hoàn thành", no pause control, and a way back instead of
 * "Kết thúc buổi tập". Its sets stay editable — the backend allows corrections on the same day.
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

  // Off until a started workout loads — see the clock effect, which also seeds `elapsed`.
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [rest, setRest] = useState<number | null>(null);
  const [blocks, setBlocks] = useState<ExerciseBlock[] | null>(null);
  const [starting, setStarting] = useState(false);
  const hydratedFor = useRef<string | null>(null);
  const clockSeededFor = useRef<string | null>(null);

  // Today's schedule is what a session is started from — same source the dashboard and the week
  // tab read, so all three agree on what "hôm nay" means.
  const todayKey = toDateInputValue(new Date());
  const scheduleQuery = useQuery({
    queryKey: ["workout-schedules", "today"],
    queryFn: () => workoutService.getSchedules(20, { startDate: todayKey, endDate: todayKey }),
    // Live session state, not a catalog: the app-wide 30s staleTime would render a cached status.
    staleTime: 0,
  });

  const schedule: any = useMemo(() => {
    const list: any[] = Array.isArray(scheduleQuery.data) ? scheduleQuery.data : [];
    return list[0] ?? null;
  }, [scheduleQuery.data]);

  const workoutId: string | null = schedule?.workoutId ?? schedule?.workout?.id ?? null;
  const completed = schedule?.status === "COMPLETED";

  const workoutQuery = useQuery({
    queryKey: ["workout", workoutId],
    queryFn: () => workoutService.getWorkout(String(workoutId)),
    enabled: !!workoutId,
    // Also 0: the workout id often arrives after the first focus, and becoming enabled only fetches
    // when the cached copy is stale.
    staleTime: 0,
  });

  // Re-read the session every time the screen gains focus. Two things kept it stale otherwise: the
  // screen stays mounted inside the workout tab's Stack when the user switches tabs, and the global
  // 30s staleTime lets a freshly pushed screen render the cached copy without fetching. Both showed a
  // session finished elsewhere as "Đang tập" with 0/4 sets and a running clock.
  const focusedAt = useRef(0);
  const resyncedFor = useRef(0);
  useFocusEffect(
    useCallback(() => {
      focusedAt.current = Date.now();
      // cancelRefetch:false joins a fetch the mount already started instead of restarting it.
      void queryClient.refetchQueries(
        { queryKey: ["workout-schedules", "today"], type: "active" },
        { cancelRefetch: false },
      );
      void queryClient.refetchQueries({ queryKey: ["workout"], type: "active" }, { cancelRefetch: false });
    }, [queryClient]),
  );

  // Hydrate local rows once per workout, then once more per focus from the fetch that focus started.
  // Re-hydrating on every background refetch would wipe values the user is mid-way through typing; a
  // focus refetch cannot, since nobody was typing while the screen was away. Rows still waiting to
  // sync keep their local value either way.
  const dataUpdatedAt = workoutQuery.dataUpdatedAt;
  useEffect(() => {
    if (!workoutId) return;
    const firstForWorkout = hydratedFor.current !== workoutId;
    const focusResync = dataUpdatedAt >= focusedAt.current && resyncedFor.current !== focusedAt.current;
    if (!firstForWorkout && !focusResync) return;
    const normalized = normalizeWorkout(workoutQuery.data);
    if (!normalized) return;
    setBlocks((prev) => (firstForWorkout ? normalized : keepUnsyncedRows(normalized, prev)));
    hydratedFor.current = workoutId;
    if (dataUpdatedAt >= focusedAt.current) resyncedFor.current = focusedAt.current;
  }, [workoutId, workoutQuery.data, dataUpdatedAt]);

  // Seed the clock per session AND status, separately from the rows: the first render can come from
  // a cached IN_PROGRESS schedule followed moments later by the fresh COMPLETED one, and seeding only
  // once per workout would leave a finished session ticking. A refetch with the same status is a
  // no-op, so pausing is never undone by background refreshes.
  const clockKey = workoutId && workoutQuery.data ? `${workoutId}:${schedule?.status ?? ""}` : null;
  useEffect(() => {
    if (!clockKey || clockSeededFor.current === clockKey) return;
    clockSeededFor.current = clockKey;
    const seeded = sessionClockState(schedule, workoutQuery.data, Date.now());
    setElapsed(seeded.elapsedSeconds);
    setRunning(seeded.running);
  }, [clockKey, schedule, workoutQuery.data]);

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
      // Today's schedule too: reopening this screen must read the status the last set just set,
      // not a cached IN_PROGRESS copy.
      queryClient.refetchQueries({ queryKey: ["workout-schedules", "today"] }),
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
      <ScreenHeader
        title={workoutId && completed ? "Buổi tập hôm nay" : "Đang tập"}
        onBack={() => router.back()}
      />

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
                  <Badge tone={completed || running ? "success" : "neutral"}>
                    {completed ? "Đã hoàn thành" : running ? "Đang tập" : "Tạm dừng"}
                  </Badge>
                  <Text className="font-display mt-1.5 text-lg leading-tight text-foreground">
                    {schedule?.programDay?.name ?? schedule?.name ?? "Buổi tập"}
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="font-display text-3xl text-primary" style={{ fontVariant: ["tabular-nums"] }}>
                    {clock(elapsed)}
                  </Text>
                  <Text className="font-body text-[11px] text-muted-foreground">
                    {completed ? "Tổng thời gian" : "Thời gian tập"}
                  </Text>
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
                {/* Pausing a finished session's frozen clock would be meaningless. */}
                {completed ? null : (
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
                )}
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
                      <ExerciseMedia
                        videoUrl={block.mediaUrl}
                        className="h-12 w-12 shrink-0 rounded-xl"
                        iconSize={18}
                      />
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

          {/* Finish bar — a finished session has nothing left to finish. */}
          <View
            className="absolute inset-x-0 bottom-0 border-t border-border bg-background px-5 pt-3"
            style={{ paddingBottom: insets.bottom + 12 }}
          >
            {completed ? (
              <Button full size="lg" variant="secondary" icon={ArrowLeft} onPress={() => router.back()}>
                Về Tập luyện
              </Button>
            ) : (
              <Button full size="lg" icon={Flame} onPress={finish}>
                Kết thúc buổi tập
              </Button>
            )}
          </View>
        </>
      )}
    </View>
  );
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
