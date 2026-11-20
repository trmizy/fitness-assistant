import { CheckIcon as Check, FlagIcon as Flag } from "@phosphor-icons/react";
import { CartesianGrid, LabelList, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PhaseForecastResult, RoadmapPhaseType, RoadmapPhaseWithCycles } from "../../services/api";
import "./RoadmapJourneyMap.css";

// The journey as a picture: one route (a segment per phase, drawn up to today, "Bạn ở đây" on it), the same
// phases as a vertical stepper with a spine (reads on a 360px phone), and the projected weight curve with the
// current phase shaded. Presentation only — every figure comes from the projection the page already loaded
// (phase dates/status, creation-time forecast snapshot). The forecast stays a non-binding scenario.

const PHASE_PLAIN_DESCRIPTION: Record<RoadmapPhaseType, string> = {
  FAT_LOSS: "Ăn ít hơn mức cơ thể tiêu hao một chút để giảm mỡ mà vẫn giữ cơ.",
  DIET_BREAK: "Ăn đủ năng lượng một thời gian để cơ thể hồi phục trước khi giảm tiếp.",
  MAINTENANCE: "Giữ cân nặng và vóc dáng đã đạt được, củng cố thói quen.",
  LEAN_GAIN: "Ăn dư một chút để tăng cơ, hạn chế tăng mỡ.",
  MINI_CUT: "Giảm mỡ nhanh trong thời gian ngắn.",
  RECOMPOSITION: "Vừa giảm mỡ vừa tăng cơ, cân nặng thay đổi ít.",
  PERFORMANCE: "Tập trung nâng sức mạnh và hiệu suất.",
  RECOVERY: "Giảm tải để cơ thể hồi phục.",
};

// Only classes that have a light-theme override in theme.css (or brand colours that read on both themes).
const SEGMENT_CLASS: Record<RoadmapPhaseWithCycles["status"], string> = {
  COMPLETED: "bg-blue-500 text-black",
  ACTIVE: "bg-green-500/25 text-zinc-100",
  PLANNED: "border border-zinc-700 text-zinc-400",
  SKIPPED: "border border-dashed border-zinc-700 text-zinc-500",
  CANCELLED: "bg-red-500/30 text-zinc-300",
};

const DAY_MS = 86_400_000;

function formatShort(value: string) {
  const d = new Date(value);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatFull(value: string) {
  return new Date(value).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function kg(value: number) {
  return value.toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function phaseDays(phase: RoadmapPhaseWithCycles) {
  const days = (new Date(phase.plannedEndAt).getTime() - new Date(phase.plannedStartAt).getTime()) / DAY_MS;
  return Math.max(days, 1);
}

function weeksOf(phase: RoadmapPhaseWithCycles) {
  return Math.max(1, Math.round(phaseDays(phase) / 7));
}

/** Position of today along the whole journey, 0..100, or null when the journey has no usable dates. */
export function journeyProgressPercent(phases: RoadmapPhaseWithCycles[], now: number = Date.now()): number | null {
  if (phases.length === 0) return null;
  const start = new Date(phases[0].plannedStartAt).getTime();
  const end = new Date(phases[phases.length - 1].plannedEndAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
}

/** How much of one phase's own time has passed, 0..1. */
function elapsedFraction(phase: RoadmapPhaseWithCycles, now: number) {
  const start = new Date(phase.plannedStartAt).getTime();
  const end = new Date(phase.plannedEndAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="truncate text-base font-semibold text-zinc-100">{value}</p>
    </div>
  );
}

export function RoadmapJourneyMap({
  phases,
  forecasts,
  phaseTypeLabel,
  actuals,
  now = Date.now(),
}: {
  phases: RoadmapPhaseWithCycles[];
  forecasts?: PhaseForecastResult[] | null;
  /** Measured weight at the end of finished phases (from the forecast reconciliation) — drawn solid over the dashed forecast. */
  actuals?: { phaseIndex: number; weightKg: number }[] | null;
  phaseTypeLabel: Record<RoadmapPhaseType, string>;
  now?: number;
}) {
  const ordered = [...phases].sort((a, b) => a.phaseIndex - b.phaseIndex);
  if (ordered.length === 0) return null;

  const totalDays = ordered.reduce((sum, phase) => sum + phaseDays(phase), 0);
  const here = journeyProgressPercent(ordered, now);
  const forecastByIndex = new Map((forecasts ?? []).map((forecast) => [forecast.phaseIndex, forecast]));
  const activeIdx = ordered.findIndex((phase) => phase.status === "ACTIVE");
  const lastPhase = ordered[ordered.length - 1];
  const weeksLeft = Math.max(0, Math.ceil((new Date(lastPhase.plannedEndAt).getTime() - now) / (7 * DAY_MS)));

  const firstForecast = forecastByIndex.get(ordered[0].phaseIndex);
  const lastForecast = forecastByIndex.get(lastPhase.phaseIndex);
  const weightFact =
    firstForecast && lastForecast && Number.isFinite(firstForecast.projectedStartWeightKg) && Number.isFinite(lastForecast.projectedEndWeightKg)
      ? `${kg(firstForecast.projectedStartWeightKg)} → ${kg(lastForecast.projectedEndWeightKg)} kg`
      : null;

  const actualByIndex = new Map((actuals ?? []).filter((a) => Number.isFinite(a.weightKg)).map((a) => [a.phaseIndex, a.weightKg]));
  const curve: { label: string; weight: number; actual?: number }[] = [];
  if (firstForecast && Number.isFinite(firstForecast.projectedStartWeightKg)) {
    curve.push({ label: "Nay", weight: firstForecast.projectedStartWeightKg });
    ordered.forEach((phase, i) => {
      const forecast = forecastByIndex.get(phase.phaseIndex);
      if (forecast && Number.isFinite(forecast.projectedEndWeightKg)) curve.push({ label: `${i + 1}`, weight: forecast.projectedEndWeightKg, actual: actualByIndex.get(phase.phaseIndex) });
    });
  }
  const hasActual = curve.some((point) => point.actual != null);
  // The current phase spans curve[activeIdx] -> curve[activeIdx + 1] (curve[0] is "Hiện tại").
  const shade = activeIdx >= 0 && curve.length > activeIdx + 1 ? { x1: curve[activeIdx].label, x2: curve[activeIdx + 1].label } : null;

  return (
    <div className="t-journey space-y-6" data-testid="roadmap-journey-map">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Fact label="Đang ở" value={activeIdx >= 0 ? `Giai đoạn ${activeIdx + 1}/${ordered.length}` : `${ordered.length} giai đoạn`} />
        <Fact label="Còn lại" value={weeksLeft > 0 ? `${weeksLeft} tuần` : "Đã tới đích"} />
        <Fact label="Kết thúc dự kiến" value={formatFull(lastPhase.plannedEndAt)} />
        {weightFact && <Fact label="Cân nặng dự kiến" value={weightFact} />}
      </div>

      {/* The route */}
      <div>
        <div className="relative h-8" data-testid="journey-here-wrap">
          {here != null && (
            <>
              <div className="absolute top-0 -translate-x-1/2" style={{ left: `clamp(36px, ${here}%, calc(100% - 36px))` }}>
                <span className="t-journey-pop block whitespace-nowrap rounded-full bg-green-500 px-2.5 py-0.5 text-xs font-bold text-black" data-testid="journey-here-marker">
                  Bạn ở đây
                </span>
              </div>
              <div className="absolute bottom-0 h-0 w-0 -translate-x-1/2 border-x-4 border-t-[5px] border-x-transparent border-t-green-500" style={{ left: `${here}%` }} />
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <div className="flex h-8 min-w-0 flex-1 gap-0.5 overflow-hidden rounded-lg" role="img" aria-label="Các giai đoạn của lộ trình">
            {ordered.map((phase, i) => {
              const fraction = phase.status === "ACTIVE" ? elapsedFraction(phase, now) : 0;
              const wide = phaseDays(phase) / totalDays >= 0.2;
              return (
                <div
                  key={phase.id}
                  className={`relative flex h-full items-center justify-center overflow-hidden text-xs font-bold ${SEGMENT_CLASS[phase.status]}`}
                  style={{ width: `${(phaseDays(phase) / totalDays) * 100}%` }}
                  title={`${phaseTypeLabel[phase.phaseType]}, ${weeksOf(phase)} tuần`}
                >
                  {phase.status === "ACTIVE" && fraction > 0 && (
                    <span className="t-journey-fill absolute inset-y-0 left-0 bg-green-500/60" style={{ width: `${fraction * 100}%` }} />
                  )}
                  <span className="relative z-10 flex items-center gap-1 px-1">
                    {phase.status === "COMPLETED" ? <Check className="h-3.5 w-3.5 flex-shrink-0" weight="bold" /> : <span className="flex-shrink-0">{i + 1}</span>}
                    {wide && <span className="hidden min-w-0 truncate font-semibold sm:inline">{phaseTypeLabel[phase.phaseType]}</span>}
                  </span>
                </div>
              );
            })}
          </div>
          <Flag className="h-5 w-5 flex-shrink-0 text-green-400" weight="fill" aria-label="Đích" />
        </div>
        <div className="mt-1.5 flex justify-between pr-6 text-xs text-zinc-500">
          <span>{formatShort(ordered[0].plannedStartAt)}</span>
          <span>{formatShort(lastPhase.plannedEndAt)}</span>
        </div>
      </div>

      {/* The same phases as a vertical stepper */}
      <ol className="space-y-2">
        {ordered.map((phase, i) => {
          const forecast = forecastByIndex.get(phase.phaseIndex);
          const isActive = phase.status === "ACTIVE";
          const done = phase.status === "COMPLETED";
          const isLast = i === ordered.length - 1;
          return (
            <li key={phase.id} className="t-journey-item relative pl-11" style={{ ["--i" as string]: i }}>
              {!isLast && <span className={`absolute left-[13px] top-8 -bottom-2 border-l ${done ? "border-blue-500" : "border-zinc-700"}`} aria-hidden />}
              <span
                className={`absolute left-0 top-3 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                  isActive ? "bg-green-500 text-black" : done ? "bg-blue-500 text-black" : "border border-zinc-700 bg-zinc-900 text-zinc-400"
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" weight="bold" /> : i + 1}
              </span>
              <div className={`rounded-xl border p-3 ${isActive ? "border-green-500/40 bg-green-500/5" : "border-zinc-800 bg-zinc-900/40"}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className={`text-sm font-semibold ${isActive ? "text-zinc-100" : "text-zinc-300"}`}>{phaseTypeLabel[phase.phaseType]}</p>
                  <p className="text-xs text-zinc-500">
                    {weeksOf(phase)} tuần, {formatShort(phase.plannedStartAt)} đến {formatShort(phase.plannedEndAt)}
                  </p>
                </div>
                <p className="mt-0.5 text-xs text-zinc-400">{PHASE_PLAIN_DESCRIPTION[phase.phaseType]}</p>
                {forecast && Number.isFinite(forecast.projectedEndWeightKg) && (
                  <p className="mt-1 text-xs text-zinc-500">
                    Dự kiến {kg(forecast.projectedStartWeightKg)} → {kg(forecast.projectedEndWeightKg)} kg
                    {forecast.projectedEndBodyFatPct != null ? `, mỡ khoảng ${forecast.projectedEndBodyFatPct.toFixed(0)}%` : ""}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Projected weight curve, current phase shaded */}
      {curve.length >= 2 && (
        <div data-testid="journey-weight-curve">
          <p className="mb-1 text-sm font-semibold text-zinc-300">{hasActual ? "Cân nặng thật so với dự báo" : "Cân nặng dự kiến qua các giai đoạn"}</p>
          <div className="h-44 w-full text-green-400">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curve} margin={{ top: 22, right: 20, bottom: 0, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.12} />
                {shade && <ReferenceArea x1={shade.x1} x2={shade.x2} fill="currentColor" fillOpacity={0.12} stroke="none" />}
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: "currentColor", opacity: 0.65 }} stroke="currentColor" strokeOpacity={0.2} />
                <YAxis hide domain={["dataMin - 1", "dataMax + 1"]} />
                <Tooltip formatter={(value: number, name: string) => [`${kg(value)} kg`, name === "actual" ? "Số đo thật" : "Dự báo"]} />
                <Line type="monotone" dataKey="weight" stroke="currentColor" strokeOpacity={hasActual ? 0.55 : 1} strokeWidth={hasActual ? 1.5 : 2.5} strokeDasharray={hasActual ? "5 4" : undefined} dot={{ r: hasActual ? 2.5 : 3.5 }} isAnimationActive={false}>
                  {!hasActual && <LabelList dataKey="weight" position="top" offset={10} formatter={(v: number) => kg(v)} style={{ fontSize: 12, fill: "currentColor" }} />}
                </Line>
                {hasActual && (
                  <Line type="monotone" dataKey="actual" stroke="currentColor" strokeWidth={3} dot={{ r: 4 }} connectNulls isAnimationActive={false}>
                    <LabelList dataKey="actual" position="top" offset={10} formatter={(v: number) => kg(v)} style={{ fontSize: 12, fontWeight: 700, fill: "currentColor" }} />
                  </Line>
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-zinc-600">{hasActual ? "Nét liền là số đo thật của bạn, nét đứt là dự báo lúc tạo lộ trình. " : "Đây là dự báo tham khảo từ lúc tạo lộ trình. "}Số dưới trục là số thứ tự giai đoạn, vùng sáng là giai đoạn bạn đang ở, và dự báo sẽ điều chỉnh theo số đo thật.</p>
        </div>
      )}
    </div>
  );
}
