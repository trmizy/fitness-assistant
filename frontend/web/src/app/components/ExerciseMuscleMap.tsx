import { useEffect, useRef, useState } from "react";
import { BodyChart, ViewSide, type BodyState } from "body-muscles";
import { MUSCLE_CODE_TO_BODY_MUSCLES_REGIONS, isBackViewMuscle } from "../constants/muscleRegionMap";
import { workoutService } from "../services/api";

/**
 * Gate 6 (exercise/anatomy data-expansion roadmap) — real muscle-map SVG
 * for one exercise, backed by GET /exercises/:id/muscle-map (real
 * ExerciseMuscle data, never guessed from the exercise name). Renders
 * primary muscles at full intensity, secondary at reduced intensity, and
 * an explicit "chưa có dữ liệu nhóm cơ" state when an exercise has no
 * mapping yet — never a blank chart with no explanation, and never a
 * crash (per the task's own explicit muscle-map requirements: front/
 * back, primary/secondary, intensity, unknown/unmapped state).
 *
 * body-muscles (Apache-2.0, verified — see
 * docs/research/fitness-data-source-and-license-review.md) is a
 * framework-agnostic class, not a React component — mounted imperatively
 * via useEffect/ref, matching the standard pattern for wrapping
 * non-React DOM libraries.
 */
interface MuscleMapEntry {
  code: string;
  nameVi: string;
  nameEn: string | null;
  anatomyRegion: string | null;
}

export default function ExerciseMuscleMap({ exerciseId }: { exerciseId: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<BodyChart | null>(null);
  const [view, setView] = useState<ViewSide>(ViewSide.FRONT);
  const [loading, setLoading] = useState(true);
  const [mapped, setMapped] = useState(true);
  const [primary, setPrimary] = useState<MuscleMapEntry[]>([]);
  const [secondary, setSecondary] = useState<MuscleMapEntry[]>([]);
  const [unmappedCodes, setUnmappedCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    workoutService
      .getExerciseMuscleMap(exerciseId)
      .then((res) => {
        if (cancelled) return;
        setMapped(res.mapped);
        setPrimary(res.primary);
        setSecondary(res.secondary);
        // Default to whichever view the exercise's PRIMARY muscles mostly
        // belong to, so the user isn't shown an empty front view for a
        // back-dominant exercise (e.g. rows, lat pulldowns) by default —
        // still switchable via the Front/Back toggle either way.
        if (res.primary.length > 0) {
          const backCount = res.primary.filter((m) => isBackViewMuscle(m.code)).length;
          setView(backCount > res.primary.length / 2 ? ViewSide.BACK : ViewSide.FRONT);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? "Không thể tải dữ liệu nhóm cơ");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [exerciseId]);

  useEffect(() => {
    if (!containerRef.current || loading || error) return;

    const bodyState: BodyState = {};
    const stillUnmapped: string[] = [];
    for (const m of primary) {
      const regions = MUSCLE_CODE_TO_BODY_MUSCLES_REGIONS[m.code];
      if (!regions) {
        stillUnmapped.push(m.nameVi);
        continue;
      }
      for (const regionId of regions) bodyState[regionId] = { intensity: 9, selected: true };
    }
    for (const m of secondary) {
      const regions = MUSCLE_CODE_TO_BODY_MUSCLES_REGIONS[m.code];
      if (!regions) {
        stillUnmapped.push(m.nameVi);
        continue;
      }
      for (const regionId of regions) {
        // Don't downgrade a region a primary muscle already claimed.
        if (!bodyState[regionId]) bodyState[regionId] = { intensity: 4, selected: false };
      }
    }
    setUnmappedCodes([...new Set(stillUnmapped)]);

    if (!chartRef.current) {
      chartRef.current = new BodyChart(containerRef.current, {
        view,
        bodyState,
        showViewLabel: true,
        ariaLabel: "Sơ đồ nhóm cơ của bài tập",
      });
    } else {
      chartRef.current.update({ view, bodyState });
    }

    return () => {
      // Only tear down when the component itself unmounts (handled by the
      // separate cleanup effect below) — this effect re-runs on every
      // data/view change and must NOT destroy+rebuild the chart each time.
    };
  }, [primary, secondary, view, loading, error]);

  // Real unmount cleanup — body-muscles' own destroy() removes DOM
  // elements/listeners it created, matching the library's documented
  // lifecycle contract.
  useEffect(() => {
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, []);

  if (loading) {
    return <div className="text-sm text-zinc-400">Đang tải sơ đồ nhóm cơ...</div>;
  }

  if (error) {
    return <div className="text-sm text-red-400">{error}</div>;
  }

  if (!mapped) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 text-sm text-zinc-400">
        Chưa có dữ liệu nhóm cơ chi tiết cho bài tập này.
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
            view === ViewSide.FRONT ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-300"
          }`}
        >
          Mặt trước
        </button>
        <button
          type="button"
          onClick={() => setView(ViewSide.BACK)}
          className={`rounded px-3 py-1 text-xs font-medium ${
            view === ViewSide.BACK ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-300"
          }`}
        >
          Mặt sau
        </button>
      </div>
      <div ref={containerRef} className="mx-auto max-w-xs" />
      <div className="flex flex-wrap gap-2 text-xs">
        {primary.map((m) => (
          <span key={m.code} className="rounded-full bg-emerald-600/20 px-2 py-1 text-emerald-400">
            {m.nameVi} (chính)
          </span>
        ))}
        {secondary.map((m) => (
          <span key={m.code} className="rounded-full bg-zinc-700/50 px-2 py-1 text-zinc-400">
            {m.nameVi} (phụ)
          </span>
        ))}
      </div>
      {unmappedCodes.length > 0 && (
        <div className="text-xs text-zinc-500">
          Chưa có vị trí hiển thị trên sơ đồ cho: {unmappedCodes.join(", ")}
        </div>
      )}
    </div>
  );
}
