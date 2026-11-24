import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { WarningIcon as Warning } from "@phosphor-icons/react";
import { fitnessRoadmapService, profileService, type GoalCoherenceAction, type GoalCoherenceResult } from "../services/api";

// One place that says "your goals disagree", wherever the user is (Tổng quan, Lộ trình, Dinh dưỡng). The backend only detects
// (GET /fitness-roadmaps/goal-coherence); every fix is the user's decision, confirmed here and executed through the existing
// authorised endpoint. Nothing is changed silently. Renders nothing when everything agrees.

const GOAL_LABEL: Record<string, string> = {
  WEIGHT_LOSS: "giảm mỡ",
  MUSCLE_GAIN: "tăng cơ",
  MAINTENANCE: "duy trì vóc dáng",
  ATHLETIC_PERFORMANCE: "hiệu suất thể thao",
};

export function GoalCoherenceBanner({ className = "" }: { className?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery<GoalCoherenceResult>({
    queryKey: ["goal-coherence"],
    queryFn: fitnessRoadmapService.getGoalCoherence,
    retry: false,
    staleTime: 30_000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["goal-coherence"] });
    queryClient.invalidateQueries({ queryKey: ["fitness-roadmap"] });
    queryClient.invalidateQueries({ queryKey: ["profile"] });
    queryClient.invalidateQueries({ queryKey: ["nutrition-active-state"] });
  };

  const setProfileGoal = useMutation({
    mutationFn: (goal: string) => profileService.updateProfile({ goal }),
    onSuccess: () => {
      toast.success("Đã cập nhật mục tiêu hồ sơ");
      refresh();
    },
    onError: (error: any) => toast.error(error?.response?.data?.error ?? "Không thể cập nhật mục tiêu hồ sơ"),
  });
  const endRoadmap = useMutation({
    mutationFn: (roadmapId: string) => fitnessRoadmapService.cancel(roadmapId),
    onSuccess: () => {
      toast.success("Đã kết thúc lộ trình. Bạn có thể tạo lộ trình mới.");
      refresh();
    },
    onError: (error: any) => toast.error(error?.response?.data?.error ?? "Không thể kết thúc lộ trình"),
  });

  const data = query.data;
  if (!data || data.coherent || data.conflicts.length === 0) return null;
  const busy = setProfileGoal.isPending || endRoadmap.isPending;

  function run(action: GoalCoherenceAction) {
    if (busy) return;
    switch (action.key) {
      case "SET_PROFILE_GOAL": {
        const target = GOAL_LABEL[action.value ?? ""] ?? action.value;
        if (action.value && window.confirm(`Đổi mục tiêu hồ sơ thành "${target}"?\n\nMục tiêu này được dùng để gợi ý và giải thích trong toàn bộ ứng dụng.`)) setProfileGoal.mutate(action.value);
        return;
      }
      case "END_ROADMAP":
        if (data!.roadmapId && window.confirm("Kết thúc lộ trình đang chạy để tạo lại?\n\nLịch sử tập luyện, số đo và đánh giá vẫn được giữ. Các buổi tập sắp tới của lộ trình này sẽ bị huỷ.")) endRoadmap.mutate(data!.roadmapId);
        return;
      case "OPEN_PROFILE":
        navigate("/client/profile");
        return;
      case "OPEN_NUTRITION":
        navigate("/client/nutrition");
        return;
    }
  }

  return (
    <section role="status" aria-label="Mục tiêu chưa khớp nhau" data-testid="goal-coherence-banner" className={`space-y-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 ${className}`}>
      <p className="flex items-center gap-2 text-sm font-bold text-amber-300">
        <Warning className="h-4 w-4 flex-shrink-0" weight="fill" /> Mục tiêu của bạn chưa khớp nhau
      </p>
      <ul className="space-y-4">
        {data.conflicts.map((conflict) => (
          <li key={conflict.code} className="space-y-1.5" data-testid={`goal-conflict-${conflict.code}`}>
            <p className="text-sm font-semibold text-zinc-100">{conflict.title}</p>
            <p className="text-xs leading-relaxed text-zinc-400">{conflict.detail}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {conflict.actions.map((action, i) => (
                <button
                  key={action.key}
                  type="button"
                  disabled={busy}
                  onClick={() => run(action)}
                  className={`min-h-11 rounded-lg px-3 text-sm font-semibold transition-colors disabled:opacity-60 ${
                    i === 0 ? "bg-amber-500 text-black hover:bg-amber-400" : "border border-zinc-600 text-zinc-300 hover:border-amber-500/50"
                  }`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
