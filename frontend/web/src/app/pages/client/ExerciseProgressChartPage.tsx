import { useMemo } from "react";
import { useParams, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { ArrowLeft, LineChart as LineChartIcon, Loader2 } from "lucide-react";
import {
  statsService,
  type ExerciseLoggingMode,
  type ExerciseProgressSessionPoint,
} from "../../services/api";

/**
 * Roadmap P3.3 "Exercise progress charts" (§ 23,
 * docs/features/EXERCISE_PROGRESS_CHARTS_IMPACT_ANALYSIS.md).
 *
 * Entry point: the "Xem tiến độ" link in WorkoutLogPage.tsx's existing
 * Exercise Detail modal.
 *
 * §23's explicit warning — "do not graph 'weight' for exercises where
 * weight is not meaningful" — is enforced here, in the one place that
 * decides which chart lines to render, per `Exercise.loggingMode`. The
 * backend deliberately does NOT pre-filter by mode (see
 * exercise-progress.util.ts's own doc comment) — every field is real or
 * null, and a chart is additionally only rendered when at least one real
 * session actually has that field populated, so a mode with genuinely no
 * matching data never shows an empty misleading chart either.
 */

type ChartSpec = {
  id: string;
  title: string;
  dataKey: keyof ExerciseProgressSessionPoint;
  color: string;
  unit: string;
  note?: string;
  formatValue?: (v: number) => string;
};

const CHART_SPECS_BY_MODE: Record<ExerciseLoggingMode, ChartSpec[]> = {
  REPS_LOAD: [
    { id: "weight", title: "Khối lượng nâng (nặng nhất mỗi buổi)", dataKey: "maxWeightKg", color: "#10b981", unit: "kg" },
    { id: "reps", title: "Số lần lặp lại (nhiều nhất mỗi buổi)", dataKey: "maxReps", color: "#38bdf8", unit: "reps" },
    { id: "e1rm", title: "Ước tính 1RM (set tốt nhất mỗi buổi)", dataKey: "bestEstimated1RmKg", color: "#f97316", unit: "kg" },
  ],
  BODYWEIGHT_REPS: [
    { id: "bw-reps", title: "Số lần lặp lại (bodyweight)", dataKey: "maxReps", color: "#38bdf8", unit: "reps" },
  ],
  TIME: [
    { id: "duration", title: "Thời gian giữ (lâu nhất mỗi buổi)", dataKey: "maxDurationSeconds", color: "#a78bfa", unit: "giây" },
  ],
  TIME_LOAD: [
    { id: "weight", title: "Khối lượng nâng (nặng nhất mỗi buổi)", dataKey: "maxWeightKg", color: "#10b981", unit: "kg" },
    { id: "duration", title: "Thời gian giữ (lâu nhất mỗi buổi)", dataKey: "maxDurationSeconds", color: "#a78bfa", unit: "giây" },
  ],
  DISTANCE_TIME: [
    { id: "distance", title: "Quãng đường (xa nhất mỗi buổi)", dataKey: "maxDistanceMeters", color: "#34d399", unit: "m" },
    {
      id: "pace",
      title: "Tốc độ (nhanh nhất mỗi buổi)",
      dataKey: "bestPaceSecPerKm",
      color: "#fb7185",
      unit: "giây/km",
      note: "Thấp hơn = nhanh hơn",
    },
  ],
};

const MODE_LABELS: Record<ExerciseLoggingMode, string> = {
  REPS_LOAD: "Có tạ + số lần",
  BODYWEIGHT_REPS: "Trọng lượng cơ thể",
  TIME: "Tính giờ",
  TIME_LOAD: "Tính giờ có tạ",
  DISTANCE_TIME: "Quãng đường/thời gian",
};

const tooltipStyle = {
  contentStyle: { background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#a1a1aa" },
};

export function ExerciseProgressChartPage() {
  const { exerciseId } = useParams<{ exerciseId: string }>();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ["exercise-progress", exerciseId],
    queryFn: () => statsService.getExerciseProgress(exerciseId!),
    enabled: !!exerciseId,
  });

  const specs = useMemo(() => {
    if (!query.data) return [];
    const all = CHART_SPECS_BY_MODE[query.data.loggingMode] ?? [];
    // A spec is only worth rendering when at least one real session
    // actually has that dimension populated — never an empty chart.
    return all.filter((spec) => query.data!.sessions.some((s) => s[spec.dataKey] != null));
  }, [query.data]);

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      <button type="button" onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300">
        <ArrowLeft className="w-3.5 h-3.5" /> Quay lại
      </button>

      {query.isLoading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Đang tải...
        </div>
      ) : query.data ? (
        <>
          <div>
            <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold" data-testid="exercise-progress-title">
              <LineChartIcon className="w-5 h-5 text-emerald-400" /> {query.data.exerciseName}
            </h1>
            <p className="text-zinc-500 text-sm mt-0.5">
              Tiến độ theo thời gian · {MODE_LABELS[query.data.loggingMode] ?? query.data.loggingMode}
            </p>
          </div>

          {query.data.sessions.length === 0 ? (
            <div className="glass-panel rounded-xl p-10 text-center" data-testid="exercise-progress-empty">
              <p className="text-zinc-400 font-semibold mb-1">Chưa có dữ liệu</p>
              <p className="text-zinc-600 text-sm">
                Hoàn thành ít nhất một buổi tập với bài này để xem biểu đồ tiến độ.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {specs.map((spec) => (
                <div
                  key={spec.id}
                  className="rounded-2xl border border-zinc-700/40 bg-zinc-900/50 p-4"
                  data-testid={`exercise-progress-chart-${spec.id}`}
                >
                  <div className="flex items-baseline justify-between mb-2">
                    <p className="text-sm text-zinc-200 font-semibold">{spec.title}</p>
                    {spec.note && <p className="text-[10px] text-zinc-600">{spec.note}</p>}
                  </div>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={query.data!.sessions}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} />
                      <YAxis tick={{ fontSize: 10, fill: "#71717a" }} domain={["auto", "auto"]} />
                      <Tooltip
                        {...tooltipStyle}
                        formatter={(value: number) => [`${value} ${spec.unit}`, spec.title]}
                        content={
                          spec.id === "e1rm"
                            ? ({ active, payload, label }: any) => {
                                if (!active || !payload?.length) return null;
                                const point: ExerciseProgressSessionPoint = payload[0].payload;
                                return (
                                  <div style={tooltipStyle.contentStyle} className="px-3 py-2">
                                    <p className="text-zinc-400">{label}</p>
                                    <p className="text-orange-400">e1RM: {point.bestEstimated1RmKg} kg</p>
                                    {point.bestSetWeightKg != null && point.bestSetReps != null && (
                                      <p className="text-zinc-500">
                                        Set tốt nhất: {point.bestSetWeightKg}kg × {point.bestSetReps} reps
                                      </p>
                                    )}
                                  </div>
                                );
                              }
                            : undefined
                        }
                      />
                      <Line
                        type="monotone"
                        dataKey={spec.dataKey as string}
                        stroke={spec.color}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        connectNulls
                        name={spec.title}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-red-400">Không tải được dữ liệu tiến độ.</p>
      )}
    </div>
  );
}
