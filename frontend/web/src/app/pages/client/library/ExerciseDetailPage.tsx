import { useParams, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon as ArrowLeft, BarbellIcon as Dumbbell, CircleNotchIcon as Loader2, TrophyIcon as Trophy, ClockCounterClockwiseIcon as History } from "@phosphor-icons/react";
import { workoutService } from "../../../services/api";
import ExerciseMuscleMap from "../../../components/ExerciseMuscleMap";
import { ExerciseMediaPreview } from "./ExerciseMediaPreview";

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

/**
 * Exercise Detail (spec §17). Composes existing endpoints/components —
 * GET /exercises/:id (catalog facts), ExerciseMuscleMap (already reuses
 * GET /exercises/:id/muscle-map), and the P3 exercise-history aggregator
 * for the optional personal section. No analytics logic duplicated.
 */
export function ExerciseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: exercise, isLoading } = useQuery({
    queryKey: ["exercise-detail", id],
    queryFn: () => workoutService.getExercise(id!),
    enabled: !!id,
  });

  // Fail-soft: an exercise the user has never logged (or a SYSTEM exercise
  // with no personal data yet) still renders the catalog facts above —
  // only the "Lịch sử của bạn" section is conditionally omitted.
  const { data: history } = useQuery({
    queryKey: ["exercise-history-detail", id],
    queryFn: () => workoutService.getExerciseHistory(id!),
    enabled: !!id,
    retry: false,
    throwOnError: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
      </div>
    );
  }

  if (!exercise) {
    return (
      <div className="p-6 text-center text-sm text-zinc-500">
        Không tìm thấy bài tập này.
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Quay lại
      </button>

      <div>
        <h1 data-testid="exercise-detail-name" className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Dumbbell className="w-5 h-5 text-emerald-400" /> {exercise.exerciseName}
        </h1>
        <div className="flex flex-wrap gap-1.5 mt-2">
          <span className="text-[11px] px-2 py-1 rounded-full bg-zinc-800 text-zinc-400">
            {BODY_PART_LABELS[exercise.bodyPart] ?? exercise.bodyPart}
          </span>
          <span className="text-[11px] px-2 py-1 rounded-full bg-zinc-800 text-zinc-400">
            {String(exercise.typeOfEquipment).replace(/_/g, " ").toLowerCase()}
          </span>
          <span className="text-[11px] px-2 py-1 rounded-full bg-zinc-800 text-zinc-400">
            {LOGGING_MODE_LABELS[exercise.loggingMode] ?? exercise.loggingMode}
          </span>
          {exercise.difficultyLevel && (
            <span className="text-[11px] px-2 py-1 rounded-full bg-zinc-800 text-zinc-400 capitalize">
              {exercise.difficultyLevel}
            </span>
          )}
          {exercise.source === "USER_CUSTOM" && (
            <span className="text-[11px] px-2 py-1 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/20">
              Bài tập tuỳ chỉnh
            </span>
          )}
        </div>
        {/* Aliases (spec §17 "Aliases if available") — ExerciseAlias rows,
            never fabricated; the card simply doesn't render this line for
            an exercise with none. */}
        {exercise.aliases?.length > 0 && (
          <p className="text-xs text-zinc-600 mt-2">
            Tên khác: {exercise.aliases.map((a: any) => a.alias).join(", ")}
          </p>
        )}
      </div>

      <ExerciseMediaPreview
        videoUrl={exercise.videoUrl}
        title={exercise.exerciseName}
        className="aspect-video rounded-xl border border-zinc-800/60"
      />

      <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-zinc-200 mb-2">Hướng dẫn</h2>
        <p className="text-sm text-zinc-400 whitespace-pre-line">{exercise.instructions}</p>
        {exercise.movementPattern && (
          <p className="text-xs text-zinc-600 mt-2">
            Kiểu chuyển động: {exercise.movementPattern.replace(/_/g, " ")}
            {exercise.mechanics ? ` · ${exercise.mechanics}` : ""}
          </p>
        )}
      </div>

      <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-zinc-200 mb-3">Nhóm cơ</h2>
        <ExerciseMuscleMap exerciseId={exercise.id} />
      </div>

      {/* Media/license attribution (spec §17) — real ExerciseSource rows
          only; never shown if this exercise has none (e.g. USER_CUSTOM). */}
      {exercise.sources?.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-zinc-200 mb-2">Nguồn dữ liệu &amp; bản quyền</h2>
          <div className="space-y-1.5">
            {exercise.sources.map((s: any) => (
              <p key={s.id} className="text-xs text-zinc-500">
                {s.sourceName}
                {s.dataLicense ? ` · dữ liệu: ${s.dataLicense}` : ""}
                {s.mediaLicense ? ` · hình ảnh: ${s.mediaLicense}` : ""}
              </p>
            ))}
          </div>
        </div>
      )}

      {history && (history.personalRecord || history.recentSessions?.length > 0) && (
        <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
            <History className="w-4 h-4 text-emerald-400" /> Lịch sử của bạn
          </h2>
          {history.personalRecord && (
            <div className="flex items-center gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/8 p-3">
              <Trophy className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <div>
                <p className="text-xs text-amber-200/80">Kỷ lục cá nhân (PR)</p>
                <p className="text-sm font-semibold text-zinc-100">
                  {history.personalRecord.metric === "e1rm" &&
                    `~${history.personalRecord.value} kg (e1RM)`}
                  {history.personalRecord.metric === "reps" && `${history.personalRecord.value} reps`}
                  {history.personalRecord.metric === "duration" && `${history.personalRecord.value}s`}
                  {history.personalRecord.metric === "distance" && `${history.personalRecord.value} m`}
                </p>
              </div>
            </div>
          )}
          {history.recentSessions?.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-zinc-500">Buổi tập gần đây</p>
              {history.recentSessions.slice(0, 5).map((s: any) => (
                <div
                  key={s.workoutId}
                  className="flex items-center justify-between text-xs text-zinc-400 border-b border-zinc-800/50 py-1.5 last:border-0"
                >
                  <span>{new Date(s.date).toLocaleDateString("vi-VN")}</span>
                  <span className="text-zinc-500">{s.sets?.length ?? 0} set</span>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => navigate(`/client/exercise-progress/${exercise.id}`)}
            className="text-xs text-emerald-400 hover:text-emerald-300"
          >
            Xem biểu đồ tiến độ đầy đủ →
          </button>
        </div>
      )}
    </div>
  );
}
