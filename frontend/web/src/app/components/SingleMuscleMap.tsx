import { useEffect, useRef, useState } from "react";
import { BodyChart, ViewSide, type BodyState } from "body-muscles";
import { MUSCLE_CODE_TO_BODY_MUSCLES_REGIONS, isBackViewMuscle } from "../constants/muscleRegionMap";

/**
 * Product Completeness pass — Muscle Detail page's "Body location
 * visualization" (spec §23). Sibling to ExerciseMuscleMap.tsx, reusing the
 * exact same body-muscles chart + MUSCLE_CODE_TO_BODY_MUSCLES_REGIONS
 * mapping, but for ONE muscle passed in directly rather than fetched from
 * an exercise's muscle-map — no new data source, no second body-region
 * mapping invented.
 */
export default function SingleMuscleMap({ muscleCode }: { muscleCode: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<BodyChart | null>(null);
  const [view, setView] = useState<ViewSide>(
    isBackViewMuscle(muscleCode) ? ViewSide.BACK : ViewSide.FRONT,
  );

  const regions = MUSCLE_CODE_TO_BODY_MUSCLES_REGIONS[muscleCode];

  useEffect(() => {
    setView(isBackViewMuscle(muscleCode) ? ViewSide.BACK : ViewSide.FRONT);
  }, [muscleCode]);

  useEffect(() => {
    if (!containerRef.current || !regions) return;
    const bodyState: BodyState = {};
    for (const regionId of regions) bodyState[regionId] = { intensity: 9, selected: true };

    if (!chartRef.current) {
      chartRef.current = new BodyChart(containerRef.current, {
        view,
        bodyState,
        showViewLabel: true,
        ariaLabel: "Sơ đồ vị trí nhóm cơ",
      });
    } else {
      chartRef.current.update({ view, bodyState });
    }
  }, [regions, view]);

  useEffect(() => {
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, []);

  if (!regions) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 text-sm text-zinc-400">
        Chưa có vị trí hiển thị trên sơ đồ cho nhóm cơ này.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setView(ViewSide.FRONT)}
          className={`rounded px-3 py-1 text-xs font-medium ${
            view === ViewSide.FRONT ? "bg-sky-600 text-white" : "bg-zinc-800 text-zinc-300"
          }`}
        >
          Mặt trước
        </button>
        <button
          type="button"
          onClick={() => setView(ViewSide.BACK)}
          className={`rounded px-3 py-1 text-xs font-medium ${
            view === ViewSide.BACK ? "bg-sky-600 text-white" : "bg-zinc-800 text-zinc-300"
          }`}
        >
          Mặt sau
        </button>
      </div>
      <div ref={containerRef} className="mx-auto max-w-xs" data-testid="single-muscle-map" />
    </div>
  );
}
