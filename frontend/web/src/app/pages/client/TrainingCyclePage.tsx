import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CalendarClock,
  CheckCircle2,
  Circle,
  Flag,
  Loader2,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { trainingCycleService, type TrainingCycle } from "../../services/api";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const OUTCOME_CONFIG: Record<
  string,
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  ACHIEVED: {
    label: "Đạt chỉ tiêu",
    className: "text-green-400 bg-green-500/10 border-green-500/30",
    Icon: CheckCircle2,
  },
  PARTIAL: {
    label: "Lưng chừng",
    className: "text-amber-400 bg-amber-500/10 border-amber-500/30",
    Icon: Circle,
  },
  NOT_ACHIEVED: {
    label: "Không đạt",
    className: "text-red-400 bg-red-500/10 border-red-500/30",
    Icon: XCircle,
  },
};

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return null;
  const cfg = OUTCOME_CONFIG[outcome];
  if (!cfg) return null;
  const { Icon } = cfg;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${cfg.className}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {cfg.label}
    </span>
  );
}

function WeightTrend({ cycle }: { cycle: TrainingCycle }) {
  if (cycle.startWeightKg == null || cycle.endWeightKg == null) return null;
  const delta = cycle.endWeightKg - cycle.startWeightKg;
  const Icon = delta <= 0 ? TrendingDown : TrendingUp;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
      <Icon className="h-3.5 w-3.5" />
      {cycle.startWeightKg}kg → {cycle.endWeightKg}kg (
      {delta > 0 ? "+" : ""}
      {delta.toFixed(1)}kg)
    </span>
  );
}

function CycleHistoryRow({ cycle }: { cycle: TrainingCycle }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2 text-sm text-zinc-200">
          <CalendarClock className="h-4 w-4 text-zinc-500" />
          {formatDate(cycle.startDate)} – {formatDate(cycle.endDate)}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <span className="text-xs text-zinc-500">
            Tuân thủ: {cycle.adherencePercent ?? 0}%
          </span>
          <WeightTrend cycle={cycle} />
        </div>
        {cycle.outcomeReason && (
          <p className="mt-1 text-xs text-zinc-600">{cycle.outcomeReason}</p>
        )}
      </div>
      <OutcomeBadge outcome={cycle.outcome} />
    </div>
  );
}

export function TrainingCyclePage() {
  const queryClient = useQueryClient();
  const [closing, setClosing] = useState(false);

  const currentQuery = useQuery({
    queryKey: ["training-cycle", "current"],
    queryFn: trainingCycleService.getCurrent,
    retry: false,
  });

  const historyQuery = useQuery({
    queryKey: ["training-cycle", "history"],
    queryFn: () => trainingCycleService.list(20),
  });

  const startMutation = useMutation({
    mutationFn: () => trainingCycleService.start(),
    onSuccess: () => {
      toast.success("Đã bắt đầu chu kỳ tập luyện mới");
      queryClient.invalidateQueries({ queryKey: ["training-cycle"] });
    },
    onError: (error: any) => {
      toast.error(
        error?.response?.data?.error ?? "Không thể bắt đầu chu kỳ mới",
      );
    },
  });

  const closeMutation = useMutation({
    mutationFn: (id: string) => trainingCycleService.close(id),
    onMutate: () => setClosing(true),
    onSettled: () => setClosing(false),
    onSuccess: () => {
      toast.success("Đã kết thúc chu kỳ và tính kết quả");
      queryClient.invalidateQueries({ queryKey: ["training-cycle"] });
    },
    onError: (error: any) => {
      toast.error(
        error?.response?.data?.error ?? "Không thể kết thúc chu kỳ",
      );
    },
  });

  const current = currentQuery.data?.cycle;
  const preview = currentQuery.data?.adherencePreview;
  const hasActiveCycle = currentQuery.isSuccess && !!current;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">
          Chu kỳ tập luyện tháng
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Theo dõi mức độ tuân thủ lịch tập và kết quả InBody trong một chu kỳ.
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 backdrop-blur-md">
        {currentQuery.isLoading ? (
          <div className="flex items-center justify-center py-8 text-zinc-500">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : hasActiveCycle && current ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-zinc-300">
                <Flag className="h-4 w-4 text-blue-400" />
                Chu kỳ hiện tại — bắt đầu {formatDate(current.startDate)}
              </div>
              <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-400">
                Đang diễn ra
              </span>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
                <span>Tuân thủ lịch tập</span>
                <span>
                  {preview?.completed ?? 0}/{preview?.total ?? 0} buổi (
                  {preview?.percent ?? 0}%)
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all"
                  style={{ width: `${preview?.percent ?? 0}%` }}
                />
              </div>
            </div>

            {current.startWeightKg != null && (
              <p className="text-xs text-zinc-500">
                Cân nặng lúc bắt đầu: {current.startWeightKg}kg
                {current.targetWeightAtStart != null &&
                  ` · Mục tiêu: ${current.targetWeightAtStart}kg`}
              </p>
            )}

            <button
              type="button"
              onClick={() => closeMutation.mutate(current.id)}
              disabled={closing}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 py-2.5 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700/60 disabled:opacity-50"
            >
              {closing ? "Đang kết thúc..." : "Kết thúc chu kỳ"}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-zinc-400">
              Bạn chưa có chu kỳ tập luyện nào đang diễn ra.
            </p>
            <button
              type="button"
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
            >
              {startMutation.isPending
                ? "Đang bắt đầu..."
                : "Bắt đầu chu kỳ mới"}
            </button>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-zinc-300">
          Lịch sử chu kỳ
        </h2>
        {historyQuery.isLoading ? (
          <div className="flex items-center justify-center py-6 text-zinc-500">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : historyQuery.data && historyQuery.data.length > 0 ? (
          <div className="space-y-2">
            {historyQuery.data
              .filter((c) => c.status === "CLOSED")
              .map((cycle) => (
                <CycleHistoryRow key={cycle.id} cycle={cycle} />
              ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-600">
            Chưa có chu kỳ nào được hoàn thành.
          </p>
        )}
      </div>
    </div>
  );
}
