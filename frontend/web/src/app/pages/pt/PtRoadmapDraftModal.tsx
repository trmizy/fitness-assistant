import { useState } from "react";
import { XIcon as X, CircleNotchIcon as Loader2 } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ptCoachService, type RoadmapPhaseType } from "../../services/api";
import { useBackDismissible } from "../../hooks/useBackDismissible";

const GOAL_OPTIONS = [
  { key: "WEIGHT_LOSS", label: "Giảm mỡ" },
  { key: "MUSCLE_GAIN", label: "Tăng cơ" },
  { key: "MAINTENANCE", label: "Duy trì vóc dáng" },
  { key: "ATHLETIC_PERFORMANCE", label: "Hiệu suất thể thao" },
];

const PHASE_TYPE_LABEL: Record<RoadmapPhaseType, string> = {
  FAT_LOSS: "Giảm mỡ",
  DIET_BREAK: "Nghỉ giữa kỳ",
  MAINTENANCE: "Duy trì",
  LEAN_GAIN: "Tăng cơ nạc",
  MINI_CUT: "Cắt ngắn",
  RECOMPOSITION: "Tái cấu trúc cơ thể",
  PERFORMANCE: "Hiệu suất",
  RECOVERY: "Hồi phục",
};

/** FitnessRoadmap PT-assisted integration (Phase E/hardening) — mirrors
 * AssignPlanModal.tsx's shell/state/API pattern. Only long-term planning
 * metadata (name/goal/phase type+duration/objective) is collected here —
 * never calories, macros, sets, reps, or a meal plan (those stay owned by
 * NutritionGoal/WorkoutProgram, unchanged). Creates a DRAFT only; the PT
 * cannot activate it — the client must review and explicitly activate it
 * themselves from their own Roadmap Journey page. See
 * docs/FITNESS_ROADMAP_PT_INTEGRATION_DESIGN.md. */
export function PtRoadmapDraftModal({
  clientUserId,
  clientName,
  onClose,
  onCreated,
}: {
  clientUserId: string;
  clientName: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState(`Lộ trình cho ${clientName}`);
  const [goalType, setGoalType] = useState("WEIGHT_LOSS");
  const [phaseType, setPhaseType] = useState<RoadmapPhaseType>("FAT_LOSS");
  const [durationWeeks, setDurationWeeks] = useState(8);

  useBackDismissible(true, onClose);

  const createMutation = useMutation({
    mutationFn: async () => {
      const startAt = new Date().toISOString().slice(0, 10);
      const endAt = new Date(Date.now() + durationWeeks * 7 * 86_400_000).toISOString().slice(0, 10);
      return ptCoachService.createRoadmapDraft(clientUserId, {
        name: name.trim() || `Lộ trình cho ${clientName}`,
        goalType,
        plannedStartAt: startAt,
        phases: [
          { phaseIndex: 1, name: PHASE_TYPE_LABEL[phaseType], phaseType, plannedStartAt: startAt, plannedEndAt: endAt },
        ],
      });
    },
    onSuccess: () => {
      toast.success("Đã tạo bản nháp lộ trình — học viên sẽ xem lại và tự kích hoạt");
      onCreated();
      onClose();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error ?? "Không thể tạo lộ trình cho học viên");
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl border border-zinc-700/60 bg-zinc-900 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800/60 bg-zinc-900 p-5">
          <h3 className="text-sm font-bold text-zinc-100">Tạo lộ trình cho {clientName}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-blue-200">
            Học viên sẽ xem lại và tự quyết định kích hoạt lộ trình này — bạn không thể kích hoạt thay học viên.
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-zinc-500">Tên lộ trình</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-zinc-700/60 bg-zinc-800/60 p-2 text-sm text-zinc-200"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-zinc-500">Mục tiêu</label>
            <div className="flex flex-wrap gap-2">
              {GOAL_OPTIONS.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => setGoalType(g.key)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                    goalType === g.key
                      ? "border-green-500 bg-green-500 text-black"
                      : "border-zinc-700/60 bg-zinc-900 text-zinc-400 hover:border-green-500/40"
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-zinc-500">Giai đoạn bắt đầu</label>
            <select
              value={phaseType}
              onChange={(e) => setPhaseType(e.target.value as RoadmapPhaseType)}
              className="w-full rounded-lg border border-zinc-700/60 bg-zinc-800/60 p-2 text-sm text-zinc-200"
            >
              {(Object.keys(PHASE_TYPE_LABEL) as RoadmapPhaseType[]).map((pt) => (
                <option key={pt} value={pt}>
                  {PHASE_TYPE_LABEL[pt]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-zinc-500">Thời gian giai đoạn (tuần)</label>
            <input
              type="number"
              min={1}
              max={26}
              value={durationWeeks}
              onChange={(e) => setDurationWeeks(Number(e.target.value) || 8)}
              className="w-28 rounded-lg border border-zinc-700/60 bg-zinc-800/60 p-2 text-sm text-zinc-200"
            />
          </div>

          <button
            type="button"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-500 px-4 py-2.5 text-sm font-bold text-black shadow-lg shadow-green-500/20 transition-all hover:bg-green-400 disabled:opacity-60"
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {createMutation.isPending ? "Đang tạo..." : "Tạo bản nháp"}
          </button>
        </div>
      </div>
    </div>
  );
}
