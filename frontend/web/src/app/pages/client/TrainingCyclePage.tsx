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
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${cfg.className}`}
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
    <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
      <Icon className="h-3.5 w-3.5" />
      {cycle.startWeightKg}kg → {cycle.endWeightKg}kg (
      {delta > 0 ? "+" : ""}
      {delta.toFixed(1)}kg)
    </span>
  );
}

function CycleHistoryRow({ cycle }: { cycle: TrainingCycle }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-800/60 bg-zinc-900 p-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          <CalendarClock className="h-4 w-4 text-zinc-500" />
          {formatDate(cycle.startDate)} – {formatDate(cycle.endDate)}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
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
  const closedHistory = (historyQuery.data ?? []).filter(
    (c) => c.status === "CLOSED",
  );

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <CalendarClock className="w-5 h-5 text-green-400" /> Chu kỳ tập
          luyện tháng
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Theo dõi mức độ tuân thủ lịch tập và kết quả InBody trong một chu kỳ.
        </p>
      </div>

      {/* Current cycle hero card */}
      <div className="bg-gradient-to-br from-green-500/15 to-zinc-900 rounded-2xl border border-green-500/20 p-6">
        {currentQuery.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
          </div>
        ) : hasActiveCycle && current ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                <Flag className="h-4 w-4 text-green-400" />
                Chu kỳ hiện tại — bắt đầu {formatDate(current.startDate)}
              </div>
              <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-1 text-xs font-bold text-green-400">
                Đang diễn ra
              </span>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs text-zinc-400">
                <span>Tuân thủ lịch tập</span>
                <span className="font-semibold text-zinc-300">
                  {preview?.completed ?? 0}/{preview?.total ?? 0} buổi (
                  {preview?.percent ?? 0}%)
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-green-500 transition-all"
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
              className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black py-2.5 rounded-xl text-sm font-bold transition-all"
            >
              {closing && <Loader2 className="w-4 h-4 animate-spin" />}
              {closing ? "Đang kết thúc..." : "Kết thúc chu kỳ"}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <p className="text-sm text-zinc-400">
              Bạn chưa có chu kỳ tập luyện nào đang diễn ra.
            </p>
            <button
              type="button"
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              className="flex items-center gap-2 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-500/20"
            >
              {startMutation.isPending && (
                <Loader2 className="w-4 h-4 animate-spin" />
              )}
              {startMutation.isPending
                ? "Đang bắt đầu..."
                : "Bắt đầu chu kỳ mới"}
            </button>
          </div>
        )}
      </div>

      {/* History */}
      <div>
        <h2 className="text-sm font-bold text-zinc-300 mb-2">
          Lịch sử chu kỳ
        </h2>
        {historyQuery.isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
          </div>
        ) : closedHistory.length > 0 ? (
          <div className="space-y-2">
            {closedHistory.map((cycle) => (
              <CycleHistoryRow key={cycle.id} cycle={cycle} />
            ))}
          </div>
        ) : (
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-10 text-center">
            <CalendarClock className="w-10 h-10 text-zinc-800 mx-auto mb-3" />
            <p className="text-sm text-zinc-500">
              Chưa có chu kỳ nào được hoàn thành.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
