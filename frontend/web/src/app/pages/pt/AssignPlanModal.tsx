import { useState } from "react";
import { XIcon as X, CircleNotchIcon as Loader2, PlusIcon as Plus, TrashIcon as Trash2, MagnifyingGlassIcon as Search, SparkleIcon as Sparkles, WarningIcon as AlertTriangle } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ptCoachService, workoutService } from "../../services/api";
import { useBackDismissible } from "../../hooks/useBackDismissible";

const WEEKDAY_LABEL = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

interface DayExerciseDraft {
  exerciseId: string;
  name: string;
  sets: number;
  reps: number;
}

interface DayDraft {
  dayNumber: number;
  title: string;
  weekday: number;
  exercises: DayExerciseDraft[];
}

function emptyDay(dayNumber: number, weekday: number): DayDraft {
  return { dayNumber, title: `Buổi ${dayNumber}`, weekday, exercises: [] };
}

/** Phase 6 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — PT creates AND
 * assigns a plan directly to a client in one step (delegates to the same
 * createManualProgram the client's own self-service flow uses, which both
 * creates the program and generates the schedule rows — see
 * coach.service.ts's doc comment). The PT reviews/edits before submitting;
 * nothing here auto-assigns without this explicit action. */
export function AssignPlanModal({
  clientUserId,
  clientName,
  onClose,
}: {
  clientUserId: string;
  clientName: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(`Kế hoạch cho ${clientName}`);
  const [goal, setGoal] = useState("");
  const [durationWeeks, setDurationWeeks] = useState(4);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [days, setDays] = useState<DayDraft[]>([emptyDay(1, 1)]);
  const [exerciseSearch, setExerciseSearch] = useState("");
  const [activeDayIndex, setActiveDayIndex] = useState<number | null>(null);
  const [ptNotes, setPtNotes] = useState("");
  const [aiInfo, setAiInfo] = useState<{ dataGaps: string[]; warnings: string[]; summaryForPt: string } | null>(null);

  // Mounted only while the modal is open.
  useBackDismissible(true, onClose);
  const draftMutation = useMutation({
    mutationFn: () => ptCoachService.generatePlanDraft(clientUserId, { ptNotes: ptNotes.trim() || undefined, daysPerWeek: days.length, durationWeeks }),
    onSuccess: (result) => {
      setAiInfo({ dataGaps: result.dataGaps, warnings: result.warnings, summaryForPt: result.summaryForPt });
      if (result.days.length === 0) {
        toast.error("AI không tạo được bài tập gợi ý — vui lòng tự chọn bài tập.");
        return;
      }
      setDays((prev) =>
        result.days.map((d, i) => ({
          dayNumber: d.dayNumber,
          title: d.title || `Buổi ${d.dayNumber}`,
          weekday: prev[i]?.weekday ?? i, // keep existing weekday assignment where possible
          exercises: d.exercises.map((e) => ({ exerciseId: e.exerciseId, name: e.exerciseName, sets: e.sets, reps: e.reps })),
        })),
      );
      toast.success("Đã tạo bản nháp bằng AI — hãy xem lại trước khi giao.");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || "Không thể tạo bản nháp AI lúc này.");
    },
  });

  const exercisesQuery = useQuery({
    queryKey: ["pt-assign-plan-exercises", exerciseSearch],
    queryFn: () => workoutService.getExercises({ search: exerciseSearch || undefined, limit: 20 }),
    enabled: activeDayIndex !== null,
  });

  const usedWeekdays = new Set(days.map((d) => d.weekday));

  const addDay = () => {
    if (days.length >= 7) return;
    const nextWeekday = [0, 1, 2, 3, 4, 5, 6].find((w) => !usedWeekdays.has(w)) ?? 0;
    setDays((prev) => [...prev, emptyDay(prev.length + 1, nextWeekday)]);
  };

  const removeDay = (idx: number) => {
    if (days.length <= 1) return;
    setDays((prev) => prev.filter((_, i) => i !== idx).map((d, i) => ({ ...d, dayNumber: i + 1 })));
  };

  const updateDay = (idx: number, patch: Partial<DayDraft>) => {
    setDays((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  const addExerciseToDay = (idx: number, exerciseId: string, exerciseName: string) => {
    setDays((prev) =>
      prev.map((d, i) =>
        i === idx ? { ...d, exercises: [...d.exercises, { exerciseId, name: exerciseName, sets: 3, reps: 10 }] } : d,
      ),
    );
  };

  const removeExerciseFromDay = (dayIdx: number, exIdx: number) => {
    setDays((prev) =>
      prev.map((d, i) => (i === dayIdx ? { ...d, exercises: d.exercises.filter((_, j) => j !== exIdx) } : d)),
    );
  };

  const submitMutation = useMutation({
    mutationFn: () => {
      if (!name.trim()) throw new Error("Tên kế hoạch không được để trống");
      if (days.some((d) => d.exercises.length === 0)) {
        throw new Error("Mỗi buổi tập cần có ít nhất 1 bài tập");
      }
      const weekdaySet = new Set(days.map((d) => d.weekday));
      if (weekdaySet.size !== days.length) {
        throw new Error("Mỗi buổi tập phải chọn một ngày trong tuần khác nhau");
      }
      return ptCoachService.createAndAssignPlan(clientUserId, {
        name: name.trim(),
        goal: goal.trim() || undefined,
        durationWeeks,
        daysPerWeek: days.length,
        startDate,
        selectedWeekdays: days.map((d) => d.weekday),
        days: days.map((d) => ({
          dayNumber: d.dayNumber,
          title: d.title.trim() || `Buổi ${d.dayNumber}`,
          exercises: d.exercises.map((e, order) => ({ exerciseId: e.exerciseId, order, sets: e.sets, reps: e.reps })),
        })),
      });
    },
    onSuccess: () => {
      toast.success("Đã tạo và giao kế hoạch cho học viên");
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || err?.message || "Không thể tạo kế hoạch");
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-zinc-800/60 sticky top-0 bg-zinc-900 z-10">
          <h3 className="text-zinc-100 font-bold text-sm">Giao kế hoạch tập cho {clientName}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Tên kế hoạch</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2 text-sm text-zinc-200"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Mục tiêu (không bắt buộc)</label>
              <input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="vd: Tăng cơ, giảm mỡ..."
                className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2 text-sm text-zinc-200 placeholder:text-zinc-600"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Số tuần</label>
              <input
                type="number"
                min={1}
                max={52}
                value={durationWeeks}
                onChange={(e) => setDurationWeeks(Number(e.target.value) || 1)}
                className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2 text-sm text-zinc-200"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Ngày bắt đầu</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2 text-sm text-zinc-200"
              />
            </div>
          </div>

          <div className="rounded-xl border border-violet-700/30 bg-violet-950/10 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-violet-300 font-semibold">
              <Sparkles className="w-3.5 h-3.5" /> Gợi ý bằng AI (bản nháp — bạn vẫn chỉnh sửa được)
            </div>
            <textarea
              value={ptNotes}
              onChange={(e) => setPtNotes(e.target.value)}
              placeholder="Ghi chú cho AI (vd: ưu tiên thân trên, khách hàng thích tập tạ tự do...)"
              rows={2}
              className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2 text-xs text-zinc-200 placeholder:text-zinc-600"
            />
            <button
              type="button"
              onClick={() => draftMutation.mutate()}
              disabled={draftMutation.isPending}
              className="flex items-center justify-center gap-1.5 w-full rounded-lg bg-violet-500/15 border border-violet-500/30 text-violet-300 text-xs font-semibold py-2 hover:bg-violet-500/25 disabled:opacity-50"
            >
              {draftMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Tạo bản nháp bằng AI cho {days.length} buổi/tuần
            </button>

            {aiInfo && (
              <div className="space-y-1.5 pt-1">
                <p className="text-[11px] text-zinc-400">{aiInfo.summaryForPt}</p>
                {aiInfo.dataGaps.length > 0 && (
                  <p className="text-[11px] text-zinc-500 italic">Thiếu dữ liệu: {aiInfo.dataGaps.join("; ")}</p>
                )}
                {aiInfo.warnings.length > 0 && (
                  <div className="flex items-start gap-1.5 rounded-lg border border-amber-700/30 bg-amber-950/20 p-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500/80 flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-200/80">{aiInfo.warnings.join("; ")}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-zinc-300 font-semibold">Các buổi tập trong tuần ({days.length})</p>
              <button
                type="button"
                onClick={addDay}
                disabled={days.length >= 7}
                className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 disabled:opacity-40"
              >
                <Plus className="w-3.5 h-3.5" /> Thêm buổi
              </button>
            </div>

            {days.map((day, dayIdx) => (
              <div key={dayIdx} className="rounded-xl border border-zinc-700/40 bg-zinc-800/20 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    value={day.title}
                    onChange={(e) => updateDay(dayIdx, { title: e.target.value })}
                    className="flex-1 rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-1.5 text-xs text-zinc-200"
                  />
                  <select
                    value={day.weekday}
                    onChange={(e) => updateDay(dayIdx, { weekday: Number(e.target.value) })}
                    className="rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-1.5 text-xs text-zinc-200"
                  >
                    {WEEKDAY_LABEL.map((label, w) => (
                      <option key={w} value={w} disabled={usedWeekdays.has(w) && w !== day.weekday}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {days.length > 1 && (
                    <button onClick={() => removeDay(dayIdx)} className="text-zinc-600 hover:text-red-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="space-y-1">
                  {day.exercises.map((ex, exIdx) => (
                    <div key={exIdx} className="flex items-center gap-2 text-[11px] bg-zinc-900/40 rounded-lg px-2 py-1.5">
                      <span className="flex-1 text-zinc-300">{ex.name}</span>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={ex.sets}
                        onChange={(e) =>
                          setDays((prev) =>
                            prev.map((d, i) =>
                              i === dayIdx
                                ? { ...d, exercises: d.exercises.map((x, j) => (j === exIdx ? { ...x, sets: Number(e.target.value) || 1 } : x)) }
                                : d,
                            ),
                          )
                        }
                        className="w-10 rounded bg-zinc-800 border border-zinc-700/60 p-1 text-center"
                      />
                      <span className="text-zinc-600">sets ×</span>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={ex.reps}
                        onChange={(e) =>
                          setDays((prev) =>
                            prev.map((d, i) =>
                              i === dayIdx
                                ? { ...d, exercises: d.exercises.map((x, j) => (j === exIdx ? { ...x, reps: Number(e.target.value) || 1 } : x)) }
                                : d,
                            ),
                          )
                        }
                        className="w-10 rounded bg-zinc-800 border border-zinc-700/60 p-1 text-center"
                      />
                      <span className="text-zinc-600">reps</span>
                      <button onClick={() => removeExerciseFromDay(dayIdx, exIdx)} className="text-zinc-600 hover:text-red-400">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {day.exercises.length === 0 && <p className="text-[11px] text-zinc-600 italic">Chưa có bài tập nào</p>}
                </div>

                <button
                  type="button"
                  onClick={() => setActiveDayIndex(activeDayIndex === dayIdx ? null : dayIdx)}
                  className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200"
                >
                  <Search className="w-3 h-3" /> {activeDayIndex === dayIdx ? "Đóng tìm kiếm" : "Thêm bài tập"}
                </button>

                {activeDayIndex === dayIdx && (
                  <div className="rounded-lg border border-zinc-700/40 bg-zinc-900/60 p-2">
                    <input
                      value={exerciseSearch}
                      onChange={(e) => setExerciseSearch(e.target.value)}
                      placeholder="Tìm bài tập (vd: squat, bench...)"
                      className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 mb-2"
                    />
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {exercisesQuery.isFetching && <p className="text-[11px] text-zinc-600">Đang tìm...</p>}
                      {exercisesQuery.isError && (
                        <p className="text-[11px] text-red-400">Không thể tải danh sách bài tập. Vui lòng thử lại.</p>
                      )}
                      {(exercisesQuery.data ?? []).map((ex: any) => (
                        <button
                          key={ex.id}
                          onClick={() => addExerciseToDay(dayIdx, ex.id, ex.exerciseName)}
                          className="w-full text-left text-[11px] text-zinc-300 hover:bg-zinc-800/60 rounded px-2 py-1"
                        >
                          {ex.exerciseName}
                        </button>
                      ))}
                      {!exercisesQuery.isFetching && !exercisesQuery.isError && (exercisesQuery.data ?? []).length === 0 && (
                        <p className="text-[11px] text-zinc-600">Không tìm thấy bài tập.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-xs font-bold text-zinc-400 hover:bg-zinc-800"
            >
              Hủy
            </button>
            <button
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-green-500 hover:bg-green-400 disabled:opacity-60 py-2.5 text-xs font-bold text-black"
            >
              {submitMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Tạo & giao kế hoạch
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
