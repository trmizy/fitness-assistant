import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { MagnifyingGlassIcon as Search, BarbellIcon as Dumbbell, CaretLeftIcon as ChevronLeft, CaretRightIcon as ChevronRight, CircleNotchIcon as Loader2 } from "@phosphor-icons/react";
import { workoutService } from "../../../services/api";
import { ExerciseMediaPreview } from "./ExerciseMediaPreview";

const PAGE_SIZE = 24;

const BODY_PART_LABELS: Record<string, string> = {
  UPPER_BODY: "Thân trên",
  LOWER_BODY: "Thân dưới",
  CORE: "Bụng/Core",
  FULL_BODY: "Toàn thân",
};

const LOGGING_MODE_LABELS: Record<string, string> = {
  REPS_LOAD: "Số lần x Tạ",
  BODYWEIGHT_REPS: "Trọng lượng cơ thể",
  TIME: "Thời gian",
  TIME_LOAD: "Thời gian + Tạ",
  DISTANCE_TIME: "Quãng đường + Thời gian",
};

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "Mới bắt đầu",
  intermediate: "Trung cấp",
  expert: "Nâng cao",
};

/**
 * Exercise Library (spec §16) — read-only, backed entirely by the existing
 * catalog endpoints (GET /exercises, /exercises/filter-options). No
 * duplicated domain data, no STAGING/private rows (the backend's own
 * PUBLISHED+SYSTEM gate already excludes those — see exercise.service.ts).
 */
export function ExerciseLibraryPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get("search") ?? "";
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState("");
  const [bodyPart, setBodyPart] = useState("");
  const [equipment, setEquipment] = useState("");
  const [activityType, setActivityType] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [loggingMode, setLoggingMode] = useState("");
  const [onlyWithMedia, setOnlyWithMedia] = useState(false);
  const [page, setPage] = useState(1);

  // Debounced search — avoids firing a request per keystroke against the
  // catalog (spec §29 "debounced search").
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [bodyPart, equipment, activityType, difficulty, loggingMode, onlyWithMedia]);

  const { data: filterOptions } = useQuery({
    queryKey: ["exercise-filter-options"],
    queryFn: () => workoutService.getExerciseFilterOptions(),
    staleTime: 5 * 60_000,
  });

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["exercise-library", { search, bodyPart, equipment, activityType, difficulty, loggingMode, onlyWithMedia, page }],
    queryFn: () =>
      workoutService.getExercises({
        search: search || undefined,
        bodyPart: bodyPart || undefined,
        equipment: equipment || undefined,
        activityType: activityType || undefined,
        difficulty: difficulty || undefined,
        loggingMode: loggingMode || undefined,
        hasVideo: onlyWithMedia || undefined,
        page,
        limit: PAGE_SIZE,
      }),
  });

  const exercises: any[] = Array.isArray(data) ? data : [];
  const filters = filterOptions?.data ?? filterOptions;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Dumbbell className="w-5 h-5 text-emerald-400" /> Thư viện bài tập
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">Tra cứu bài tập trong hệ thống</p>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          data-testid="exercise-library-search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Tìm bài tập..."
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-zinc-700/60 bg-zinc-900 text-sm text-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <select
          data-testid="exercise-library-filter-bodypart"
          value={bodyPart}
          onChange={(e) => setBodyPart(e.target.value)}
          className="flex-shrink-0 text-xs bg-zinc-900 border border-zinc-700/60 rounded-lg px-2.5 py-2 text-zinc-300"
        >
          <option value="">Mọi vùng cơ thể</option>
          {(filters?.bodyParts ?? []).map((v: string) => (
            <option key={v} value={v}>
              {BODY_PART_LABELS[v] ?? v}
            </option>
          ))}
        </select>
        <select
          data-testid="exercise-library-filter-equipment"
          value={equipment}
          onChange={(e) => setEquipment(e.target.value)}
          className="flex-shrink-0 text-xs bg-zinc-900 border border-zinc-700/60 rounded-lg px-2.5 py-2 text-zinc-300"
        >
          <option value="">Mọi thiết bị</option>
          {(filters?.equipments ?? []).map((v: string) => (
            <option key={v} value={v}>
              {v.replace(/_/g, " ").toLowerCase()}
            </option>
          ))}
        </select>
        <select
          data-testid="exercise-library-filter-activity"
          value={activityType}
          onChange={(e) => setActivityType(e.target.value)}
          className="flex-shrink-0 text-xs bg-zinc-900 border border-zinc-700/60 rounded-lg px-2.5 py-2 text-zinc-300"
        >
          <option value="">Mọi loại hoạt động</option>
          {(filters?.activityTypes ?? []).map((v: string) => (
            <option key={v} value={v}>
              {v.replace(/_/g, " ").toLowerCase()}
            </option>
          ))}
        </select>
        <select
          data-testid="exercise-library-filter-difficulty"
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value)}
          className="flex-shrink-0 text-xs bg-zinc-900 border border-zinc-700/60 rounded-lg px-2.5 py-2 text-zinc-300"
        >
          <option value="">Mọi mức độ</option>
          {(filters?.difficultyLevels ?? []).map((v: string) => (
            <option key={v} value={v}>
              {DIFFICULTY_LABELS[v.toLowerCase()] ?? v}
            </option>
          ))}
        </select>
        <select
          data-testid="exercise-library-filter-logging-mode"
          value={loggingMode}
          onChange={(e) => setLoggingMode(e.target.value)}
          className="flex-shrink-0 text-xs bg-zinc-900 border border-zinc-700/60 rounded-lg px-2.5 py-2 text-zinc-300"
        >
          <option value="">Mọi cách ghi</option>
          {(filters?.loggingModes ?? []).map((v: string) => (
            <option key={v} value={v}>
              {LOGGING_MODE_LABELS[v] ?? v}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="exercise-library-filter-has-media"
          onClick={() => setOnlyWithMedia((value) => !value)}
          className={`flex-shrink-0 text-xs px-3 py-2 rounded-lg border transition-colors ${
            onlyWithMedia
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
              : "border-zinc-700/60 bg-zinc-900 text-zinc-400 hover:border-zinc-600"
          }`}
        >
          Co media
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Đang tải...
        </div>
      ) : exercises.length === 0 ? (
        <div className="text-center py-16 text-sm text-zinc-500">
          Không tìm thấy bài tập phù hợp.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" data-testid="exercise-library-results">
          {exercises.map((ex) => (
            <button
              key={ex.id}
              type="button"
              data-testid={`exercise-card-${ex.id}`}
              onClick={() => navigate(`/client/exercises/${ex.id}`)}
              className="text-left bg-zinc-900 border border-zinc-800/60 hover:border-zinc-700 rounded-xl overflow-hidden transition-all"
            >
              <ExerciseMediaPreview
                videoUrl={ex.videoUrl}
                title={ex.exerciseName}
                compact
                className="h-32 border-b border-zinc-800/60"
              />
              <div className="p-3.5">
                <p className="text-sm font-semibold text-zinc-200">{ex.exerciseName}</p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
                    {BODY_PART_LABELS[ex.bodyPart] ?? ex.bodyPart}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
                    {String(ex.typeOfEquipment).replace(/_/g, " ").toLowerCase()}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
                    {LOGGING_MODE_LABELS[ex.loggingMode] ?? ex.loggingMode}
                  </span>
                  {ex.difficultyLevel && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 capitalize">
                      {DIFFICULTY_LABELS[String(ex.difficultyLevel).toLowerCase()] ?? ex.difficultyLevel}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          data-testid="exercise-library-prev-page"
          disabled={page <= 1 || isFetching}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-zinc-400 border border-zinc-800 disabled:opacity-30"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Trước
        </button>
        <span className="text-xs text-zinc-600">Trang {page}</span>
        <button
          type="button"
          data-testid="exercise-library-next-page"
          disabled={exercises.length < PAGE_SIZE || isFetching}
          onClick={() => setPage((p) => p + 1)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-zinc-400 border border-zinc-800 disabled:opacity-30"
        >
          Sau <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
