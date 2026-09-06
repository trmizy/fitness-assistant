import { useNavigate } from "react-router";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { OrangeSliceIcon as Apple, BookOpenIcon as BookOpen, CaretRightIcon as ChevronRight, CompassIcon as Compass, BarbellIcon as Dumbbell, CircleNotchIcon as Loader2, PersonSimpleIcon as PersonStanding, MagnifyingGlassIcon as Search } from "@phosphor-icons/react";
import { foodService, workoutService } from "../../../services/api";
import type { FoodCatalogItem } from "../../../services/api";
import { NUTRITION_ARTICLES } from "./nutritionKnowledge";
import { ExerciseMediaPreview } from "./ExerciseMediaPreview";

const CARDS = [
  {
    to: "/client/exercises",
    icon: Dumbbell,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/20",
    title: "Bai tap",
    description: "Catalog bai tap co huong dan, nhom co, thiet bi va media minh hoa",
    testId: "library-card-exercises",
  },
  {
    to: "/client/foods",
    icon: Apple,
    color: "text-rose-400",
    bg: "bg-rose-500/10 border-rose-500/20",
    title: "Thuc pham",
    description: "Tra cuu calo, protein, carb, fat theo 100g tu bang food hien co",
    testId: "library-card-foods",
  },
  {
    to: "/client/learn/nutrition",
    icon: BookOpen,
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
    title: "Kien thuc",
    description: "Cac bai viet ngan ve calo, macro, BMR, TDEE va hieu suat tap",
    testId: "library-card-nutrition-knowledge",
  },
  {
    to: "/client/muscles",
    icon: PersonStanding,
    color: "text-sky-400",
    bg: "bg-sky-500/10 border-sky-500/20",
    title: "Nhom co",
    description: "Bang taxonomy nhom co va bai tap lien quan tu mapping canonical",
    testId: "library-card-muscles",
  },
];

export function LibraryPage() {
  const navigate = useNavigate();

  const exercisesQuery = useQuery({
    queryKey: ["library-preview-exercises-with-media"],
    queryFn: () => workoutService.getExercises({ hasVideo: true, page: 1, limit: 6 }),
    staleTime: 5 * 60_000,
  });

  const foodsQuery = useQuery({
    queryKey: ["library-preview-foods-with-images"],
    queryFn: () => foodService.list({ hasImage: true, page: 1, limit: 6 }),
    staleTime: 5 * 60_000,
  });

  const musclesQuery = useQuery({
    queryKey: ["library-preview-muscles"],
    queryFn: () => workoutService.getMuscleTaxonomy(),
    staleTime: 5 * 60_000,
  });

  const exercises = Array.isArray(exercisesQuery.data) ? exercisesQuery.data : [];
  const foods = foodsQuery.data?.foods ?? [];
  const muscles = (musclesQuery.data ?? []).slice(0, 6);
  const articles = NUTRITION_ARTICLES.slice(0, 4);
  const isLoading = exercisesQuery.isLoading || foodsQuery.isLoading || musclesQuery.isLoading;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
            <Compass className="w-5 h-5 text-emerald-400" /> Kham pha
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">
            Du lieu that tu thu vien bai tap, thuc pham, kien thuc dinh duong va nhom co.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/client/search")}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-300 hover:border-zinc-600"
        >
          <Search className="w-4 h-4" />
          Tim kiem
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {CARDS.map((card) => (
          <button
            key={card.to}
            type="button"
            data-testid={card.testId}
            onClick={() => navigate(card.to)}
            className="flex items-center justify-between gap-3 bg-zinc-900 border border-zinc-800/60 hover:border-zinc-700 rounded-xl p-4 transition-all text-left"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-11 h-11 rounded-xl border flex items-center justify-center flex-shrink-0 ${card.bg}`}>
                <card.icon className={`w-5 h-5 ${card.color}`} />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-200">{card.title}</div>
                <div className="text-xs text-zinc-600 mt-0.5 line-clamp-2">{card.description}</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-600 flex-shrink-0" />
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Dang tai...
        </div>
      ) : (
        <>
          <PreviewSection
            title="Bai tap co media"
            actionLabel="Xem thu vien bai tap"
            onAction={() => navigate("/client/exercises")}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {exercises.map((exercise: any) => (
                <button
                  key={exercise.id}
                  type="button"
                  onClick={() => navigate(`/client/exercises/${exercise.id}`)}
                  className="overflow-hidden rounded-xl border border-zinc-800/60 bg-zinc-900 text-left hover:border-zinc-700"
                >
                  <ExerciseMediaPreview
                    videoUrl={exercise.videoUrl}
                    title={exercise.exerciseName}
                    compact
                    className="h-36 border-b border-zinc-800/60"
                  />
                  <div className="p-3">
                    <p className="text-sm font-semibold text-zinc-200 truncate">{exercise.exerciseName}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {[exercise.bodyPart, exercise.typeOfEquipment].filter(Boolean).join(" / ")}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </PreviewSection>

          <PreviewSection
            title="Thuc pham co anh"
            actionLabel="Xem thu vien thuc pham"
            onAction={() => navigate("/client/foods")}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {foods.map((food: FoodCatalogItem) => (
                <button
                  key={food.id}
                  type="button"
                  onClick={() => navigate(`/client/foods/${food.id}`)}
                  className="flex items-center gap-3 rounded-xl border border-zinc-800/60 bg-zinc-900 p-3 text-left hover:border-zinc-700"
                >
                  {food.imageUrl ? (
                    <img src={food.imageUrl} alt="" loading="lazy" className="h-16 w-16 rounded-lg object-cover" />
                  ) : (
                    <div className="h-16 w-16 rounded-lg bg-zinc-800 flex items-center justify-center">
                      <Apple className="w-6 h-6 text-rose-400" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-200 truncate">{food.name}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {Math.round(food.calories)} kcal / P{Math.round(food.protein)}g
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </PreviewSection>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <PreviewSection
              title="Kien thuc dinh duong"
              actionLabel="Xem bai viet"
              onAction={() => navigate("/client/learn/nutrition")}
            >
              <div className="grid grid-cols-1 gap-2.5">
                {articles.map((article) => (
                  <button
                    key={article.slug}
                    type="button"
                    onClick={() => navigate(`/client/learn/nutrition/${article.slug}`)}
                    className="rounded-xl border border-zinc-800/60 bg-zinc-900 p-3 text-left hover:border-zinc-700"
                  >
                    <p className="text-sm font-semibold text-zinc-200">{article.title}</p>
                    <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{article.summary}</p>
                  </button>
                ))}
              </div>
            </PreviewSection>

            <PreviewSection
              title="Nhom co"
              actionLabel="Xem taxonomy"
              onAction={() => navigate("/client/muscles")}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {muscles.map((muscle: any) => (
                  <button
                    key={muscle.code}
                    type="button"
                    onClick={() => navigate(`/client/muscles/${muscle.code}`)}
                    className="rounded-xl border border-zinc-800/60 bg-zinc-900 p-3 text-left hover:border-zinc-700"
                  >
                    <p className="text-sm font-semibold text-zinc-200">{muscle.nameVi}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{muscle.nameEn ?? muscle.code}</p>
                  </button>
                ))}
              </div>
            </PreviewSection>
          </div>
        </>
      )}
    </div>
  );
}

function PreviewSection({
  title,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  actionLabel: string;
  onAction: () => void;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
        <button
          type="button"
          onClick={onAction}
          className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-400 hover:text-zinc-200"
        >
          {actionLabel}
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
      {children}
    </section>
  );
}
