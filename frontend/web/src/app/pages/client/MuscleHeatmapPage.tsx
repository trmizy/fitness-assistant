import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BodyChart, ViewSide, type BodyState } from "body-muscles";
import { ArrowLeftIcon as ArrowLeft, FlameIcon as Flame, CircleNotchIcon as Loader2 } from "@phosphor-icons/react";
import { useNavigate } from "react-router";
import { MUSCLE_CODE_TO_BODY_MUSCLES_REGIONS, isBackViewMuscle } from "../../constants/muscleRegionMap";
import { statsService, type MuscleHeatmapEntry } from "../../services/api";

/**
 * Roadmap P3.1 "Muscle heatmap"
 * (docs/features/MUSCLE_HEATMAP_IMPACT_ANALYSIS.md).
 *
 * Reuses the same body-muscles BodyChart integration
 * ExerciseMuscleMap.tsx already proved for the per-exercise case — real
 * per-muscle intensity (1-9, normalized against this window's own max)
 * instead of a flat primary/secondary split. An explicit "product
 * heuristic, not physiology" label per §21's own framing — never
 * presented as an exact measurement.
 */

const RANGES = [
  { value: "7d", label: "7 ngày" },
  { value: "30d", label: "30 ngày" },
  { value: "cycle", label: "Chu kỳ hiện tại" },
  { value: "custom", label: "Tùy chỉnh" },
] as const;
type RangeValue = (typeof RANGES)[number]["value"];

function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function MuscleHeatmapPage() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<BodyChart | null>(null);
  const [view, setView] = useState<ViewSide>(ViewSide.FRONT);
  const [range, setRange] = useState<RangeValue>("30d");
  const [customFrom, setCustomFrom] = useState(toDateInputValue(new Date(Date.now() - 30 * 86400_000)));
  const [customTo, setCustomTo] = useState(toDateInputValue(new Date()));

  const heatmapQuery = useQuery({
    queryKey: ["muscle-heatmap", range, range === "custom" ? customFrom : null, range === "custom" ? customTo : null],
    queryFn: () => statsService.getMuscleHeatmap(range === "custom" ? { range, from: customFrom, to: customTo } : { range }),
  });

  const muscles = heatmapQuery.data?.muscles ?? [];

  useEffect(() => {
    if (!containerRef.current || heatmapQuery.isLoading) return;
    const bodyState: BodyState = {};
    for (const m of muscles) {
      const regions = MUSCLE_CODE_TO_BODY_MUSCLES_REGIONS[m.code];
      if (!regions) continue;
      for (const regionId of regions) bodyState[regionId] = { intensity: m.intensity, selected: m.intensity >= 7 };
    }
    if (!chartRef.current) {
      chartRef.current = new BodyChart(containerRef.current, {
        view,
        bodyState,
        showViewLabel: true,
        ariaLabel: "Bản đồ nhiệt nhóm cơ",
      });
    } else {
      chartRef.current.update({ view, bodyState });
    }
  }, [muscles, view, heatmapQuery.isLoading]);

  useEffect(() => {
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, []);

  // Default to whichever view most of the real top muscles belong to —
  // same UX ExerciseMuscleMap.tsx already established for the
  // per-exercise case.
  useEffect(() => {
    if (muscles.length === 0) return;
    const backCount = muscles.filter((m) => isBackViewMuscle(m.code)).length;
    setView(backCount > muscles.length / 2 ? ViewSide.BACK : ViewSide.FRONT);
  }, [heatmapQuery.data]);

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      <button type="button" onClick={() => navigate("/client/dashboard")} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300">
        <ArrowLeft className="w-3.5 h-3.5" /> Quay lại
      </button>

      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Flame className="w-5 h-5 text-orange-400" /> Bản đồ nhiệt nhóm cơ
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Mức độ tập luyện tương đối của từng nhóm cơ — một chỉ số ước lượng sản phẩm, không phải đo lường sinh lý chính xác.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" data-testid="muscle-heatmap-range-selector">
        {RANGES.map((r) => (
          <button
            key={r.value}
            type="button"
            data-testid={`muscle-heatmap-range-${r.value}`}
            onClick={() => setRange(r.value)}
            className={`px-3 py-1.5 rounded-lg text-xs border ${range === r.value ? "border-orange-500/40 bg-orange-500/15 text-orange-300" : "border-zinc-700/40 text-zinc-400"}`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {range === "custom" && (
        <div className="flex gap-2">
          <input
            type="date"
            data-testid="muscle-heatmap-custom-from"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="flex-1 rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2 text-xs text-zinc-200"
          />
          <input
            type="date"
            data-testid="muscle-heatmap-custom-to"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="flex-1 rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2 text-xs text-zinc-200"
          />
        </div>
      )}

      {heatmapQuery.isLoading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Đang tải...
        </div>
      ) : heatmapQuery.data?.noActiveCycle ? (
        <div className="rounded-xl border border-zinc-700 bg-zinc-800/50 p-4 text-sm text-zinc-400" data-testid="muscle-heatmap-no-cycle">
          Bạn chưa có chu kỳ tập luyện nào đang hoạt động.
        </div>
      ) : muscles.length === 0 ? (
        <div className="rounded-xl border border-zinc-700 bg-zinc-800/50 p-4 text-sm text-zinc-400" data-testid="muscle-heatmap-empty">
          Chưa có buổi tập nào hoàn thành trong khoảng thời gian này.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <button type="button" onClick={() => setView(ViewSide.FRONT)} className={`rounded px-3 py-1 text-xs font-medium ${view === ViewSide.FRONT ? "bg-orange-500 text-black" : "bg-zinc-800 text-zinc-300"}`}>
              Mặt trước
            </button>
            <button type="button" onClick={() => setView(ViewSide.BACK)} className={`rounded px-3 py-1 text-xs font-medium ${view === ViewSide.BACK ? "bg-orange-500 text-black" : "bg-zinc-800 text-zinc-300"}`}>
              Mặt sau
            </button>
          </div>
          <div ref={containerRef} className="mx-auto max-w-xs" data-testid="muscle-heatmap-chart" />
          <div className="flex flex-wrap gap-2 text-xs" data-testid="muscle-heatmap-legend">
            {muscles.slice(0, 8).map((m: MuscleHeatmapEntry) => (
              <span key={m.muscleId} className="rounded-full bg-orange-500/15 px-2 py-1 text-orange-300">
                {m.nameVi} ({m.score})
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
