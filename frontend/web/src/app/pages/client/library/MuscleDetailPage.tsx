import { useMemo } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon as ArrowLeft, BarbellIcon as Dumbbell, CircleNotchIcon as Loader2, PersonSimpleIcon as PersonStanding } from "@phosphor-icons/react";
import { statsService, workoutService } from "../../../services/api";
import SingleMuscleMap from "../../../components/SingleMuscleMap";

const PAGE_SIZE = 12;

function describeFunction(region: string | null | undefined) {
  const r = (region ?? "").toLowerCase();
  if (r.includes("chest")) return "Giúp đẩy cánh tay về phía trước và ngang qua thân người.";
  if (r.includes("back")) return "Giúp kéo cánh tay và ổn định thân trên.";
  if (r.includes("shoulder")) return "Giúp di chuyển và ổn định khớp vai.";
  if (r.includes("arm")) return "Hỗ trợ chuyển động khuỷu tay và lực nắm khi tập thân trên.";
  if (r.includes("leg") || r.includes("lower")) return "Hỗ trợ chuyển động thân dưới, giữ thăng bằng và tạo lực.";
  if (r.includes("core")) return "Giúp gồng, xoay và ổn định vùng thân (core).";
  return "Hỗ trợ chuyển động và ổn định trong quá trình tập luyện.";
}

export function MuscleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: muscles = [] } = useQuery({
    queryKey: ["muscle-taxonomy"],
    queryFn: () => workoutService.getMuscleTaxonomy(),
    staleTime: 5 * 60_000,
  });

  const muscleFromList = useMemo(
    () => muscles.find((m) => m.code === id),
    [id, muscles],
  );

  const { data: related, isLoading } = useQuery({
    queryKey: ["muscle-related-exercises", id],
    queryFn: () => workoutService.getExercisesByMuscle(id!, { page: 1, limit: PAGE_SIZE }),
    enabled: !!id,
  });

  const { data: heatmap } = useQuery({
    queryKey: ["muscle-heatmap", "7d"],
    queryFn: () => statsService.getMuscleHeatmap({ range: "7d" }),
    retry: false,
    throwOnError: false,
  });

  const muscle = related?.muscle ?? muscleFromList;
  const heatmapEntry = heatmap?.muscles.find((m) => m.code === id);

  if (isLoading && !muscle) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 text-sky-500 animate-spin" />
      </div>
    );
  }

  if (!muscle) {
    return <div className="p-6 text-center text-sm text-zinc-500">Không tìm thấy nhóm cơ này.</div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <button
        type="button"
        onClick={() => navigate("/client/muscles")}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Quay lại Thư viện nhóm cơ
      </button>

      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <PersonStanding className="w-5 h-5 text-sky-400" /> {muscle.nameVi}
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">{muscle.nameEn ?? muscle.code}</p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-zinc-200 mb-1">Vị trí trên cơ thể</h2>
        <p className="text-xs text-zinc-500 mb-3">{muscle.anatomyRegion ?? "Chưa phân loại"}</p>
        <SingleMuscleMap muscleCode={muscle.code} />
      </div>

      <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4">
        <p className="text-xs text-zinc-500">Số set tuần này</p>
        <p className="text-sm font-semibold text-zinc-200 mt-1">
          {heatmapEntry ? `${Math.round(heatmapEntry.score)} set (đã tính trọng số)` : "Chưa có set nào gần đây"}
        </p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-zinc-200">Chức năng cơ bản</h2>
        <p className="text-sm text-zinc-400 mt-2">{describeFunction(muscle.anatomyRegion)}</p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
          <Dumbbell className="w-4 h-4 text-emerald-400" /> Bài tập liên quan
        </h2>
        <div className="mt-3 space-y-2" data-testid="muscle-related-exercises">
          {(related?.exercises ?? []).map((exercise) => (
            <button
              key={exercise.id}
              type="button"
              onClick={() => navigate(`/client/exercises/${exercise.id}`)}
              className="w-full flex items-center justify-between gap-3 text-left rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2.5 hover:border-zinc-700 transition-colors"
            >
              <span className="text-sm font-semibold text-zinc-200 truncate">{exercise.exerciseName}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 flex-shrink-0">
                {exercise.muscleRole === "primary" ? "chính" : exercise.muscleRole === "secondary" ? "phụ" : "đã ánh xạ"}
              </span>
            </button>
          ))}
          {!isLoading && (related?.exercises ?? []).length === 0 && (
            <p className="text-sm text-zinc-500">Chưa có bài tập nào được công bố ánh xạ tới nhóm cơ này.</p>
          )}
        </div>
      </div>
    </div>
  );
}
