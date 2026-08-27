import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, ChevronRight, CalendarDays, Loader2 } from "lucide-react";
import { useNavigate } from "react-router";
import { statsService, type ActivityDayState } from "../../services/api";

/**
 * Roadmap P3.2 "Activity heatmap"
 * (docs/features/ACTIVITY_HEATMAP_IMPACT_ANALYSIS.md).
 *
 * A month-grid calendar (GitHub-style day coloring, month layout rather
 * than a horizontal year scroller — simpler to build correctly, same
 * "more than yes/no" spirit) with 5 real day states, click-through to a
 * real detail panel.
 */

const STATE_STYLES: Record<ActivityDayState, string> = {
  completed: "bg-emerald-500 text-black",
  partial: "bg-amber-500 text-black",
  missed: "bg-red-500/70 text-white",
  rescheduled: "bg-sky-500/60 text-white",
  rest: "bg-zinc-800 text-zinc-500",
};
const STATE_LABELS: Record<ActivityDayState, string> = {
  completed: "Hoàn thành",
  partial: "Một phần",
  missed: "Bỏ lỡ",
  rescheduled: "Đã dời lịch",
  rest: "Nghỉ",
};

function toDateLabel(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function ActivityHeatmapPage() {
  const navigate = useNavigate();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-based
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const from = toDateLabel(year, month, 1);
  const to = toDateLabel(year, month, daysInMonth);

  const heatmapQuery = useQuery({
    queryKey: ["activity-heatmap", from, to],
    queryFn: () => statsService.getActivityHeatmap(from, to),
  });

  const detailQuery = useQuery({
    queryKey: ["activity-heatmap-day", selectedDate],
    queryFn: () => statsService.getActivityDayDetail(selectedDate!),
    enabled: !!selectedDate,
  });

  const stateByDate = useMemo(() => {
    const map = new Map<string, ActivityDayState | null>();
    for (const d of heatmapQuery.data?.days ?? []) map.set(d.date, d.state);
    return map;
  }, [heatmapQuery.data]);

  // Leading blank cells so day 1 lands on the correct weekday column
  // (Mon..Sun, matching this app's own week-start convention elsewhere).
  const leadingBlanks = (firstOfMonth.getUTCDay() + 6) % 7;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      <button type="button" onClick={() => navigate("/client/profile")} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300">
        <ArrowLeft className="w-3.5 h-3.5" /> Quay lại hồ sơ
      </button>

      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <CalendarDays className="w-5 h-5 text-emerald-400" /> Lịch hoạt động tập luyện
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">Xem chi tiết mỗi buổi tập theo ngày — bấm vào một ngày để xem chi tiết.</p>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          data-testid="activity-heatmap-prev-month"
          onClick={() => {
            if (month === 0) { setYear((y) => y - 1); setMonth(11); } else setMonth((m) => m - 1);
            setSelectedDate(null);
          }}
          className="p-2 rounded-lg border border-zinc-700/40 text-zinc-400 hover:bg-zinc-800/40"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <p className="text-sm text-zinc-200 font-semibold" data-testid="activity-heatmap-month-label">
          Tháng {month + 1}/{year}
        </p>
        <button
          type="button"
          data-testid="activity-heatmap-next-month"
          onClick={() => {
            if (month === 11) { setYear((y) => y + 1); setMonth(0); } else setMonth((m) => m + 1);
            setSelectedDate(null);
          }}
          className="p-2 rounded-lg border border-zinc-700/40 text-zinc-400 hover:bg-zinc-800/40"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {heatmapQuery.isLoading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Đang tải...
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1.5" data-testid="activity-heatmap-grid">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
            const dateLabel = toDateLabel(year, month, day);
            const state = stateByDate.get(dateLabel);
            const styleClass = state ? STATE_STYLES[state] : "bg-zinc-900 text-zinc-600 border border-zinc-800/60";
            return (
              <button
                key={dateLabel}
                type="button"
                data-testid={`activity-heatmap-day-${dateLabel}`}
                data-state={state ?? "unclassified"}
                onClick={() => setSelectedDate(dateLabel)}
                className={`aspect-square rounded-lg text-[11px] font-medium flex items-center justify-center transition-transform hover:scale-105 ${styleClass} ${selectedDate === dateLabel ? "ring-2 ring-white/60" : ""}`}
                title={state ? STATE_LABELS[state] : undefined}
              >
                {day}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-[11px] text-zinc-500">
        {(Object.keys(STATE_LABELS) as ActivityDayState[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`w-3 h-3 rounded ${STATE_STYLES[s]}`} /> {STATE_LABELS[s]}
          </span>
        ))}
      </div>

      {selectedDate && (
        <div className="rounded-2xl border border-zinc-700/40 bg-zinc-900/50 p-4 space-y-2" data-testid="activity-day-detail-panel">
          {detailQuery.isLoading ? (
            <div className="flex items-center gap-2 text-zinc-500 text-xs">
              <Loader2 className="w-4 h-4 animate-spin" /> Đang tải chi tiết...
            </div>
          ) : detailQuery.data ? (
            <>
              <p className="text-sm text-zinc-200 font-semibold">{selectedDate}</p>
              {detailQuery.data.workout ? (
                <div className="space-y-1.5 text-xs text-zinc-400">
                  <p data-testid="activity-day-workout-name">{detailQuery.data.workout.name}</p>
                  {detailQuery.data.durationMinutes != null && <p>Thời lượng: {detailQuery.data.durationMinutes} phút</p>}
                  {detailQuery.data.volumeKg != null && <p data-testid="activity-day-volume">Khối lượng: {detailQuery.data.volumeKg} kg</p>}
                  {detailQuery.data.rpeAverage != null && <p>RPE trung bình: {detailQuery.data.rpeAverage}</p>}
                  {detailQuery.data.rirAverage != null && <p>RIR trung bình: {detailQuery.data.rirAverage}</p>}
                  {detailQuery.data.prs.length > 0 && (
                    <div className="pt-1" data-testid="activity-day-prs">
                      {detailQuery.data.prs.map((pr, i) => (
                        <p key={i} className="text-emerald-400">🏆 PR: {pr.exerciseName}</p>
                      ))}
                    </div>
                  )}
                  {detailQuery.data.notes && <p className="italic">"{detailQuery.data.notes}"</p>}
                </div>
              ) : (
                <p className="text-xs text-zinc-500" data-testid="activity-day-no-workout">
                  {STATE_LABELS[detailQuery.data.state ?? "rest"] || "Không có dữ liệu"}
                </p>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
