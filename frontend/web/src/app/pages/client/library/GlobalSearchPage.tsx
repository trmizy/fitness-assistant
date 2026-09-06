import { useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { OrangeSliceIcon as Apple, BookOpenIcon as BookOpen, BarbellIcon as Dumbbell, CircleNotchIcon as Loader2, PersonSimpleIcon as PersonStanding, MagnifyingGlassIcon as Search } from "@phosphor-icons/react";
import { foodService, workoutService } from "../../../services/api";
import type { FoodCatalogItem } from "../../../services/api";
import { NUTRITION_ARTICLES } from "./nutritionKnowledge";
import { ExerciseMediaPreview } from "./ExerciseMediaPreview";

type MuscleTaxonomyEntry = {
  code: string;
  nameVi: string;
  nameEn: string | null;
  anatomyRegion: string | null;
};

const MAX_GROUP_RESULTS = 6;

function textMatches(query: string, values: Array<string | null | undefined>) {
  const q = query.trim().toLowerCase();
  return values.some((value) => (value ?? "").toLowerCase().includes(q));
}

function macroLine(food: FoodCatalogItem) {
  return `${Math.round(food.calories)} kcal / P${Math.round(food.protein)}g / C${Math.round(food.carbs)}g / F${Math.round(food.fats)}g`;
}

export function GlobalSearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = (searchParams.get("q") ?? "").trim();
  const [input, setInput] = useState(q);
  const canSearch = q.length >= 2;

  const remoteQuery = useQuery({
    queryKey: ["global-search", q],
    queryFn: async () => {
      const [exercises, foods, muscles] = await Promise.all([
        workoutService.getExercises({ search: q, page: 1, limit: MAX_GROUP_RESULTS }),
        foodService.search(q),
        workoutService.getMuscleTaxonomy(),
      ]);
      return {
        exercises: (Array.isArray(exercises) ? exercises : []).slice(0, MAX_GROUP_RESULTS),
        foods: (Array.isArray(foods) ? foods : []).slice(0, MAX_GROUP_RESULTS),
        muscles: (Array.isArray(muscles) ? muscles : [])
          .filter((muscle: MuscleTaxonomyEntry) =>
            textMatches(q, [muscle.code, muscle.nameVi, muscle.nameEn, muscle.anatomyRegion]),
          )
          .slice(0, MAX_GROUP_RESULTS),
      };
    },
    enabled: canSearch,
    staleTime: 60_000,
  });

  const articles = useMemo(() => {
    if (!canSearch) return [];
    return NUTRITION_ARTICLES.filter((article) =>
      textMatches(q, [
        article.slug,
        article.title,
        article.summary,
        article.category,
        ...article.sections.flatMap((section) => [section.heading, section.body]),
      ]),
    ).slice(0, MAX_GROUP_RESULTS);
  }, [canSearch, q]);

  const exercises = remoteQuery.data?.exercises ?? [];
  const foods = remoteQuery.data?.foods ?? [];
  const muscles = remoteQuery.data?.muscles ?? [];
  const totalCount = exercises.length + foods.length + muscles.length + articles.length;

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = input.trim();
    if (!next) return;
    setSearchParams({ q: next });
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Search className="w-5 h-5 text-emerald-400" /> Tim kiem
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Tim bai tap, thuc pham, kien thuc dinh duong va nhom co trong cac thu vien hien co.
        </p>
      </div>

      <form onSubmit={submitSearch} className="relative">
        <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          data-testid="global-search-page-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Nhap tu khoa..."
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-zinc-700/60 bg-zinc-900 text-sm text-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
      </form>

      {!canSearch ? (
        <div className="text-center py-16 text-sm text-zinc-500">
          Nhap it nhat 2 ky tu de tim trong cac thu vien.
        </div>
      ) : remoteQuery.isLoading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Dang tim...
        </div>
      ) : remoteQuery.isError ? (
        <div className="text-center py-16 text-sm text-rose-300">
          Khong tai duoc ket qua tim kiem. Hay thu lai.
        </div>
      ) : totalCount === 0 ? (
        <div className="text-center py-16 text-sm text-zinc-500">
          Khong co ket qua phu hop voi "{q}".
        </div>
      ) : (
        <div className="space-y-5" data-testid="global-search-results">
          <ResultGroup
            title="Bai tap"
            icon={<Dumbbell className="w-4 h-4 text-emerald-400" />}
            count={exercises.length}
            viewAll={() => navigate(`/client/exercises?search=${encodeURIComponent(q)}`)}
          >
            {exercises.map((exercise: any) => (
              <ResultItem
                key={exercise.id}
                title={exercise.exerciseName}
                subtitle={[exercise.bodyPart, exercise.typeOfEquipment].filter(Boolean).join(" / ")}
                onClick={() => navigate(`/client/exercises/${exercise.id}`)}
                media={
                  <ExerciseMediaPreview
                    videoUrl={exercise.videoUrl}
                    title={exercise.exerciseName}
                    compact
                    className="h-full w-20 rounded-lg flex-shrink-0"
                  />
                }
              />
            ))}
          </ResultGroup>

          <ResultGroup
            title="Thuc pham"
            icon={<Apple className="w-4 h-4 text-rose-400" />}
            count={foods.length}
            viewAll={() => navigate(`/client/foods?search=${encodeURIComponent(q)}`)}
          >
            {foods.map((food) => (
              <ResultItem
                key={food.id}
                title={food.name}
                subtitle={macroLine(food)}
                onClick={() => navigate(`/client/foods/${food.id}`)}
              />
            ))}
          </ResultGroup>

          <ResultGroup
            title="Kien thuc"
            icon={<BookOpen className="w-4 h-4 text-amber-400" />}
            count={articles.length}
            viewAll={() => navigate("/client/learn/nutrition")}
          >
            {articles.map((article) => (
              <ResultItem
                key={article.slug}
                title={article.title}
                subtitle={article.summary}
                onClick={() => navigate(`/client/learn/nutrition/${article.slug}`)}
              />
            ))}
          </ResultGroup>

          <ResultGroup
            title="Nhom co"
            icon={<PersonStanding className="w-4 h-4 text-sky-400" />}
            count={muscles.length}
            viewAll={() => navigate(`/client/muscles?search=${encodeURIComponent(q)}`)}
          >
            {muscles.map((muscle: MuscleTaxonomyEntry) => (
              <ResultItem
                key={muscle.code}
                title={muscle.nameVi}
                subtitle={[muscle.nameEn, muscle.anatomyRegion].filter(Boolean).join(" / ")}
                onClick={() => navigate(`/client/muscles/${muscle.code}`)}
              />
            ))}
          </ResultGroup>
        </div>
      )}
    </div>
  );
}

function ResultGroup(props: {
  title: string;
  icon: ReactNode;
  count: number;
  viewAll: () => void;
  children: ReactNode;
}) {
  if (props.count === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
          {props.icon}
          {props.title}
          <span className="text-xs text-zinc-500">({props.count})</span>
        </h2>
        <button
          type="button"
          onClick={props.viewAll}
          className="text-xs font-semibold text-zinc-400 hover:text-zinc-200"
        >
          Xem them
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">{props.children}</div>
    </section>
  );
}

function ResultItem(props: {
  title: string;
  subtitle?: string;
  media?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex min-h-20 gap-3 text-left bg-zinc-900 border border-zinc-800/60 hover:border-zinc-700 rounded-xl p-3 transition-all"
    >
      {props.media}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-200 truncate">{props.title}</p>
        {props.subtitle && (
          <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{props.subtitle}</p>
        )}
      </div>
    </button>
  );
}
