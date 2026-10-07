import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, View } from "react-native";
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
  Info,
  Minus,
  Play,
  Plus,
  Repeat,
  CheckCheck,
  Undo2,
  SkipForward,
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
import {
  workoutService,
  type ExerciseSubstitute,
} from "../../../src/services/api";
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
import {
  SessionFeedbackSheet,
  SessionFeedbackStatusRow,
  SkipFeedbackSheet,
} from "../../../src/features/workout/SessionFeedbackSheets";
import { FEEDBACK_COMPLETION_STATUSES, FEEDBACK_SKIP_STATUSES } from "../../../src/features/workout/sessionFeedback";
import {
  canCompleteWhole,
  canSwap,
  canUndoWhole,
  closesCycleSession,
  plannedNotLogged,
  setTypeLabel,
  wholeCompletionPayload,
  type Swap,
} from "../../../src/features/workout/exerciseActions";
import { SessionSummaryCard, SetTypeSheet, SwapExerciseSheet } from "../../../src/features/workout/SessionExtras";
import { ExerciseGuideSheet } from "../../../src/features/workout/ExerciseGuide";
import {
  computeNextInterleavedWorkoutStep,
  findCurrentInterleavedWorkoutStep,
  groupAwareBlocks,
  groupMetaFromDay,
  setRowsByProgramExerciseId,
} from "../../../src/features/workout/exerciseGroups";
import { GROUP_TYPE_LABEL } from "../../../src/features/workout/programEdit";

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
  // 14B.4 — inside a superset the rest is "between exercises" / "after the round" and names what comes next.
  const [restInfo, setRestInfo] = useState<{
    title: string;
    next: string | null;
  }>({ title: "Nghỉ giữa set", next: null });
  const [blocks, setBlocks] = useState<ExerciseBlock[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [skipping, setSkipping] = useState(false);
  // 14B.1 (PG-A2) — post-session feedback / skip reason sheets. `backAfterFeedback`: opened by
  // "Kết thúc buổi tập", so closing it finishes the flow the way finishing used to.
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [backAfterFeedback, setBackAfterFeedback] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  // 14B.4 — session-only swaps by block key, the block being swapped, the set whose type is being picked.
  const [swaps, setSwaps] = useState<Record<string, Swap>>({});
  const [swapFor, setSwapFor] = useState<{
    key: string;
    exerciseId: string;
    name: string;
  } | null>(null);
  const [setTypeFor, setSetTypeFor] = useState<{
    blockKey: string;
    row: SetRow;
  } | null>(null);
  const [guideFor, setGuideFor] = useState<{ exerciseId: string; name: string } | null>(null);
  const [blockBusy, setBlockBusy] = useState<string | null>(null);
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

  const groupMeta = useMemo(() => groupMetaFromDay(schedule?.programDay), [schedule]);

  const workoutId: string | null = schedule?.workoutId ?? schedule?.workout?.id ?? null;
  const scheduleId: string | null = schedule?.id ? String(schedule.id) : null;
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

  // Everything OUTSIDE this screen that summarizes sessions — Home's "today" card and weekly ring,
  // the week list, history, the heatmaps. They used to be refreshed only by "Kết thúc buổi tập",
  // but the exercise that completes a session removes that button, so Home went on offering
  // "Bắt đầu buổi tập" for a session already done until the app was restarted (real phone, 7/10).
  const refreshSessionSummaries = useCallback(() => {
    for (const queryKey of [["workout-schedules"], ["workout-history"], ["activity-heatmap"]]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [queryClient]);

  const persist = useCallback(
    async (blockKey: string, row: SetRow, completed: boolean) => {
      try {
        const res: any = await workoutService.updateSet(row.id, {
          weight: row.weight,
          reps: row.reps,
          completed,
        });
        patchRow(blockKey, row.id, { unsynced: false });
        // 14B.1 (PG-A2) — the set that closes a session inside a training cycle asks for feedback
        // right away, as web does: the server flips the session to COMPLETED on this very call, so
        // the "Kết thúc buổi tập" button is already gone by the time the user would press it.
        const progress = res?.progress ?? res?.data?.progress;
        const closesSession =
          completed &&
          !!progress &&
          (progress.progressPercent >= 100 || progress.completedExercises >= progress.totalExercises);
        if (closesSession) refreshSessionSummaries();
        if (closesSession && progress.trainingCycleId) {
          setRest(null);
          setBackAfterFeedback(false);
          setFeedbackOpen(true);
        }
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
    [patchRow, toast, refreshSessionSummaries],
  );

  const toggleSet = useCallback(
    (block: ExerciseBlock, row: SetRow) => {
      const next = !row.completed;
      haptics.tap();
      patchRow(block.key, row.id, { completed: next });
      if (next) {
        // Web's interleaved order: in a group the next step is the next member's same set, then the
        // next round — rest length and the "Tiếp theo" line come from that step.
        const list = blocks ?? [];
        const index = list.findIndex((b) => b.key === block.key);
        const rows = setRowsByProgramExerciseId(list);
        const own = block.programExerciseId
          ? rows[String(block.programExerciseId)]
          : undefined;
        if (own)
          rows[String(block.programExerciseId)] = own.map((r) =>
            r.setNumber === row.setNumber ? { ...r, completed: true } : r,
          );
        const step =
          index >= 0
            ? computeNextInterleavedWorkoutStep(
                groupAwareBlocks(list, groupMeta),
                rows,
                index,
                row.setNumber,
                block.restSeconds,
              )
            : null;
        if (step) {
          const nextBlock = list[step.exerciseIndex];
          setRestInfo({
            title:
              step.restKind === "after_round"
                ? "Nghỉ sau vòng"
                : "Nghỉ giữa bài",
            next: `${swaps[nextBlock.key]?.name ?? nextBlock.name} · set ${step.setNumber}`,
          });
          setRest(step.restSeconds);
        } else {
          setRestInfo({ title: "Nghỉ giữa set", next: null });
          setRest(block.restSeconds);
        }
      }
      void persist(block.key, row, next);
    },
    [patchRow, persist, blocks, groupMeta, swaps],
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

  const refreshSession = useCallback(async () => {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["workout-schedules", "today"] }),
      queryClient.refetchQueries({ queryKey: ["workout", workoutId] }),
    ]).catch(() => {});
    refreshSessionSummaries();
  }, [queryClient, workoutId, refreshSessionSummaries]);

  // "Xong cả bài" / a swapped exercise — web's exercise-level completion (applies a swap server-side).
  const completeWhole = useCallback(
    async (block: ExerciseBlock) => {
      if (!scheduleId || !block.programExerciseId) return;
      setBlockBusy(block.key);
      try {
        const res = await workoutService.completeScheduleExercise(
          scheduleId,
          block.programExerciseId,
          wholeCompletionPayload(block, swaps[block.key]),
        );
        haptics.success();
        hydratedFor.current = null;
        await refreshSession();
        if (closesCycleSession(res)) {
          setRest(null);
          setBackAfterFeedback(false);
          setFeedbackOpen(true);
        }
      } catch (e: any) {
        toast.show(
          e?.response?.data?.error ?? "Không hoàn thành được bài này.",
          "danger",
        );
      } finally {
        setBlockBusy(null);
      }
    },
    [scheduleId, swaps, refreshSession, toast],
  );

  // A plan exercise the session has no row for yet (added to the program mid-session).
  const completePlanned = useCallback(
    async (programExercise: any) => {
      if (!scheduleId) return;
      setBlockBusy(`planned-${programExercise.id}`);
      try {
        const res = await workoutService.completeScheduleExercise(scheduleId, String(programExercise.id));
        haptics.success();
        hydratedFor.current = null;
        await refreshSession();
        if (closesCycleSession(res)) {
          setRest(null);
          setBackAfterFeedback(false);
          setFeedbackOpen(true);
        }
      } catch (e: any) {
        toast.show(e?.response?.data?.error ?? "Không hoàn thành được bài này.", "danger");
      } finally {
        setBlockBusy(null);
      }
    },
    [scheduleId, refreshSession, toast],
  );

  const undoWhole = useCallback(
    async (block: ExerciseBlock) => {
      if (!scheduleId || !block.programExerciseId) return;
      setBlockBusy(block.key);
      try {
        await workoutService.undoCompleteScheduleExercise(
          scheduleId,
          block.programExerciseId,
        );
        hydratedFor.current = null;
        await refreshSession();
      } catch (e: any) {
        toast.show(
          e?.response?.data?.error ?? "Không hoàn tác được bài này.",
          "danger",
        );
      } finally {
        setBlockBusy(null);
      }
    },
    [scheduleId, refreshSession, toast],
  );

  const pickSubstitute = useCallback(
    (sub: ExerciseSubstitute) => {
      if (!swapFor) return;
      setSwaps((prev) => ({
        ...prev,
        [swapFor.key]: {
          exerciseId: sub.id,
          name: sub.exerciseName,
          fromName: swapFor.name,
        },
      }));
      setSwapFor(null);
      toast.show(
        `Đã đổi sang "${sub.exerciseName}" cho buổi tập này`,
        "success",
      );
    },
    [swapFor, toast],
  );

  const saveSetType = useCallback(
    async (value: string) => {
      const target = setTypeFor;
      setSetTypeFor(null);
      if (!target) return;
      patchRow(target.blockKey, target.row.id, { setType: value });
      try {
        await workoutService.updateSet(target.row.id, { setType: value });
      } catch {
        patchRow(target.blockKey, target.row.id, {
          setType: target.row.setType ?? null,
        });
        toast.show("Không lưu được loại set.", "danger");
      }
    },
    [setTypeFor, patchRow, toast],
  );

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
    // Web asks for feedback right after a session that closed inside a training cycle.
    const fresh: any[] = queryClient.getQueryData(["workout-schedules", "today"]) ?? [];
    const closed = fresh[0];
    // Say what is true. A session only closes when every exercise is done (there is no "end
    // early" on the server), so leaving with exercises open is saved progress, not a finished
    // session — the old unconditional "Đã hoàn thành buổi tập!" claimed otherwise (7/10).
    toast.show(
      closed?.status === "COMPLETED"
        ? "Đã hoàn thành buổi tập!"
        : "Đã lưu tiến độ. Buổi tập còn bài chưa xong — bạn có thể quay lại tập tiếp trong hôm nay.",
      "success",
    );
    if (closed?.trainingCycleId && FEEDBACK_COMPLETION_STATUSES.includes(closed.status)) {
      setBackAfterFeedback(true);
      setFeedbackOpen(true);
      return;
    }
    router.back();
  }, [queryClient, toast]);

  // Skipping is only offered before the session was started (the server refuses it after).
  const skipSession = useCallback(() => {
    if (!scheduleId) return;
    Alert.alert("Bỏ qua buổi tập này?", "Buổi hôm nay sẽ được đánh dấu là bỏ qua. Bạn vẫn có thể bắt đầu tập lại trong hôm nay.", [
      { text: "Không", style: "cancel" },
      {
        text: "Bỏ qua",
        style: "destructive",
        onPress: async () => {
          setSkipping(true);
          try {
            await workoutService.skipSchedule(scheduleId);
            await Promise.all([
              queryClient.refetchQueries({ queryKey: ["workout-schedules", "today"] }),
              queryClient.refetchQueries({ queryKey: ["workout-schedules", "week"] }),
            ]).catch(() => {});
            setSkipOpen(true);
          } catch (e: any) {
            toast.show(e?.response?.data?.error ?? "Không thể bỏ qua buổi tập này.", "danger");
          } finally {
            setSkipping(false);
          }
        },
      },
    ]);
  }, [scheduleId, queryClient, toast]);

  const closeFeedback = useCallback(() => {
    setFeedbackOpen(false);
    if (backAfterFeedback) router.back();
  }, [backAfterFeedback]);

  const loading = scheduleQuery.isLoading || (!!workoutId && workoutQuery.isLoading);
  // Per-exercise feedback is keyed by Exercise.id, one entry per exercise even if it repeats.
  const feedbackExercises = useMemo(() => {
    const seen = new Set<string>();
    return (blocks ?? [])
      .filter((b) => b.exerciseId && !seen.has(b.exerciseId) && seen.add(b.exerciseId))
      .map((b) => ({ exerciseId: b.exerciseId, name: b.name }));
  }, [blocks]);
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
              {schedule?.programDay?.title ?? schedule?.programDay?.name ?? schedule?.name ?? "Buổi tập hôm nay"}
            </Text>
            <Text className="mt-1.5 font-body text-sm text-muted-foreground">
              Bấm bắt đầu để mở buổi tập — hệ thống sẽ tạo sẵn các set theo giáo án.
            </Text>
            <View className="mt-4 gap-2">
              <Button full size="lg" icon={Play} disabled={starting || skipping} onPress={startSession}>
                Bắt đầu buổi tập
              </Button>
              {FEEDBACK_SKIP_STATUSES.includes(schedule?.status) ? (
                <Button full variant="ghost" onPress={() => setSkipOpen(true)}>
                  {`${schedule.status === "SKIPPED" ? "Đã bỏ qua buổi này" : "Đã hủy buổi này"} · Ghi lý do`}
                </Button>
              ) : schedule?.status === "NOT_STARTED" ? (
                <Button full variant="ghost" icon={SkipForward} disabled={skipping || starting} onPress={skipSession}>
                  {skipping ? "Đang bỏ qua..." : "Bỏ qua buổi tập này"}
                </Button>
              ) : null}
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
                    {schedule?.programDay?.title ??
                      schedule?.programDay?.name ??
                      schedule?.name ??
                      "Buổi tập"}
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

            {FEEDBACK_COMPLETION_STATUSES.includes(schedule?.status) ? (
              <View className="mb-4">
                <SessionFeedbackStatusRow
                  scheduleId={String(schedule.id)}
                  onOpen={() => {
                    setBackAfterFeedback(false);
                    setFeedbackOpen(true);
                  }}
                />
              </View>
            ) : null}

            {completed && workoutId ? (
              <SessionSummaryCard workoutId={workoutId} />
            ) : null}

            {(blocks ?? []).length === 0 ? (
              <EmptyState
                icon={Dumbbell}
                title="Buổi tập này chưa có bài nào"
                description="Giáo án chưa xếp bài cho buổi này."
              />
            ) : (
              <View className="gap-4">
                {(blocks ?? []).map((block, blockIndex) => (
                  <Card key={block.key} className="p-4">
                    <View className="mb-3 flex-row items-center gap-3">
                      {/* Photo + name open the exercise guide (how to do it) without leaving the
                          session — the substitute's guide when the exercise was swapped. */}
                      <Tappable
                        accessibilityLabel={`Xem cách tập ${swaps[block.key]?.name ?? block.name}`}
                        className="flex-1 flex-row items-center gap-3"
                        disabled={!(swaps[block.key]?.exerciseId ?? block.exerciseId)}
                        onPress={() =>
                          setGuideFor({
                            exerciseId: swaps[block.key]?.exerciseId ?? block.exerciseId,
                            name: swaps[block.key]?.name ?? block.name,
                          })
                        }
                      >
                      <ExerciseMedia
                        videoUrl={block.mediaUrl}
                        className="h-12 w-12 shrink-0 rounded-xl"
                        iconSize={18}
                      />
                      <View className="flex-1">
                        <View className="flex-row items-center gap-1.5">
                          <Text className="shrink font-body-semibold text-sm text-foreground" numberOfLines={1}>
                            {swaps[block.key]?.name ?? block.name}
                          </Text>
                          <Info size={14} color={accent.primary} />
                        </View>
                        {swaps[block.key] ? (
                          <Text
                            className="font-body text-[11px] text-primary"
                            numberOfLines={1}
                          >
                            {`Đổi từ "${swaps[block.key].fromName}" · chỉ buổi này`}
                          </Text>
                        ) : block.notes ? (
                          <Text
                            className="font-body text-[11px] text-muted-foreground"
                            numberOfLines={1}
                          >
                            {block.notes}
                          </Text>
                        ) : null}
                        <View className="mt-0.5 flex-row items-center gap-1">
                          <Timer size={11} color="#8b9299" />
                          <Text className="font-body text-[11px] text-muted-foreground">
                            Nghỉ {block.restSeconds}s giữa set
                          </Text>
                        </View>
                        {(() => {
                          const meta = block.programExerciseId
                            ? groupMeta.get(String(block.programExerciseId))
                            : undefined;
                          if (!meta) return null;
                          const exercises = groupAwareBlocks(
                            blocks ?? [],
                            groupMeta,
                          );
                          const members = exercises.filter(
                            (e) => e.groupId === meta.groupId,
                          ).length;
                          if (members < 2) return null;
                          const position =
                            exercises
                              .filter((e) => e.groupId === meta.groupId)
                              .sort(
                                (a, b) =>
                                  (a.groupOrder ?? 0) - (b.groupOrder ?? 0),
                              )
                              .findIndex(
                                (e) =>
                                  e.programExerciseId ===
                                  block.programExerciseId,
                              ) + 1;
                          const activeRow = block.sets.find(
                            (s) => !s.completed,
                          );
                          const step = activeRow
                            ? findCurrentInterleavedWorkoutStep(
                                exercises,
                                setRowsByProgramExerciseId(blocks ?? []),
                                blockIndex,
                                activeRow.setNumber,
                              )
                            : null;
                          return (
                            <View className="mt-1 flex-row">
                              <Badge tone="info">
                                {`${GROUP_TYPE_LABEL[meta.groupType] ?? "Nhóm bài"} · Bài ${position}/${members}${step ? ` · Vòng ${step.roundNumber}/${step.totalRounds}` : ""}`}
                              </Badge>
                            </View>
                          );
                        })()}
                      </View>
                      </Tappable>
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
                              } ${swaps[block.key] ? "opacity-30" : ""}`}
                              // A swapped exercise is completed as a whole (that call carries the swap).
                              disabled={!!swaps[block.key]}
                              onPress={() => toggleSet(block, row)}
                            >
                              <Check
                                size={18}
                                strokeWidth={3}
                                color={row.completed ? accent.onPrimary : "#8b9299"}
                              />
                            </Tappable>
                          </View>
                          <View className="mt-1.5 flex-row items-center gap-2 pl-8">
                            <Tappable
                              haptic={false}
                              className="rounded-md border border-border bg-card px-2 py-0.5"
                              accessibilityLabel={`Loại set ${i + 1}: ${setTypeLabel(row.setType)}`}
                              onPress={() => setSetTypeFor({ blockKey: block.key, row })}
                            >
                              <Text className="font-body text-[10px] text-muted-foreground">{`${setTypeLabel(row.setType)} ▾`}</Text>
                            </Tappable>
                            {row.targetReps != null || row.targetRpe != null ? (
                              <Text className="font-body text-[11px] text-muted-foreground">
                                Mục tiêu: {row.targetReps ?? "—"} reps
                                {row.targetRpe != null ? ` · RPE ${row.targetRpe}` : ""}
                              </Text>
                            ) : null}
                          </View>
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
                    {/* 14B.4 — exercise-level actions (web): swap before any set is done, finish the whole
                        exercise in one go, or undo a finished one. */}
                    <View className="mt-2 flex-row gap-2">
                      {canSwap(block, completed) && !swaps[block.key] ? (
                        <View className="flex-1">
                          <Button
                            full
                            size="sm"
                            variant="ghost"
                            icon={Repeat}
                            onPress={() =>
                              setSwapFor({
                                key: block.key,
                                exerciseId: block.exerciseId,
                                name: block.name,
                              })
                            }
                          >
                            Đổi bài
                          </Button>
                        </View>
                      ) : null}
                      {canCompleteWhole(block, completed) ? (
                        <View className="flex-1">
                          <Button
                            full
                            size="sm"
                            variant="secondary"
                            icon={CheckCheck}
                            disabled={blockBusy === block.key}
                            onPress={() => void completeWhole(block)}
                          >
                            {blockBusy === block.key
                              ? "Đang lưu…"
                              : "Xong cả bài"}
                          </Button>
                        </View>
                      ) : null}
                      {canUndoWhole(block) ? (
                        <View className="flex-1">
                          <Button
                            full
                            size="sm"
                            variant="ghost"
                            icon={Undo2}
                            disabled={blockBusy === block.key}
                            onPress={() => void undoWhole(block)}
                          >
                            Hoàn tác bài
                          </Button>
                        </View>
                      ) : null}
                    </View>
                  </Card>
                ))}
                {!completed && workoutId
                  ? plannedNotLogged(schedule?.programDay, blocks ?? []).map((pe: any) => (
                      <Card key={`planned-${pe.id}`} className="gap-3 p-4">
                        <View>
                          <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                            {pe.exercise?.exerciseName ?? "Bài tập"}
                          </Text>
                          <Text className="font-body text-[11px] text-muted-foreground">
                            {`${pe.sets ?? "—"} × ${pe.reps ?? "—"} · thêm vào giáo án sau khi buổi đã bắt đầu`}
                          </Text>
                        </View>
                        <Button
                          full
                          size="sm"
                          variant="secondary"
                          icon={CheckCheck}
                          disabled={blockBusy === `planned-${pe.id}`}
                          onPress={() => void completePlanned(pe)}
                        >
                          Xong cả bài
                        </Button>
                      </Card>
                    ))
                  : null}
              </View>
            )}
          </ScrollView>

          {/* Rest countdown */}
          {/* A finished session has no next set to rest for. */}
          {rest !== null && !completed ? (
            <Animated.View
              entering={FadeInDown.springify().damping(32).stiffness(340)}
              exiting={FadeOutDown.duration(160)}
              className="absolute inset-x-0 px-5"
              style={{ bottom: insets.bottom + 84 }}
            >
              {/* Opaque backing: the tinted card alone let the exercise rows underneath show through. */}
              <View className="overflow-hidden rounded-2xl bg-background">
                <View className="rounded-2xl border border-primary/40 bg-primary/10 p-3.5">
                  <View className="mb-2.5 flex-row items-center gap-2">
                    <Timer size={18} color={accent.primary} />
                    <View className="min-w-0 flex-1">
                      <Text className="font-body-semibold text-sm text-primary">{restInfo.title}</Text>
                      {restInfo.next ? (
                        <Text className="font-body text-[11px] text-primary" numberOfLines={1}>
                          Tiếp theo: {restInfo.next}
                        </Text>
                      ) : null}
                    </View>
                    <Text
                      className="font-display text-2xl text-primary"
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
                    <RestButton
                      icon={Plus}
                      label="15s"
                      onPress={() => setRest((r) => (r ?? 0) + 15)}
                    />
                    <Tappable
                      className="flex-1 items-center rounded-xl bg-primary py-2"
                      onPress={() => setRest(null)}
                    >
                      <Text className="font-body-semibold text-sm text-on-primary">Bỏ qua</Text>
                    </Tappable>
                  </View>
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

      {schedule?.id ? (
        <>
          <SessionFeedbackSheet
            scheduleId={String(schedule.id)}
            exercises={feedbackExercises}
            open={feedbackOpen}
            onClose={closeFeedback}
          />
          <SkipFeedbackSheet scheduleId={String(schedule.id)} open={skipOpen} onClose={() => setSkipOpen(false)} />
          <SwapExerciseSheet
            exercise={swapFor}
            otherExerciseIds={(blocks ?? [])
              .map((b) => b.exerciseId)
              .filter((id) => id && id !== swapFor?.exerciseId)}
            onSelect={pickSubstitute}
            onClose={() => setSwapFor(null)}
          />
          <ExerciseGuideSheet target={guideFor} onClose={() => setGuideFor(null)} />
          <SetTypeSheet
            current={setTypeFor?.row.setType}
            open={setTypeFor != null}
            onSelect={(v) => void saveSetType(v)}
            onClose={() => setSetTypeFor(null)}
          />
        </>
      ) : null}
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
