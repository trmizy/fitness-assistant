import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { MagnifyingGlassIcon as Search, OrangeSliceIcon as Apple, CaretLeftIcon as ChevronLeft, CaretRightIcon as ChevronRight, CircleNotchIcon as Loader2 } from "@phosphor-icons/react";
import { foodService } from "../../../services/api";
import { useApp } from "../../../context/AppContext";
import { profileService } from "../../../services/api";
import { useNutritionDisplaySettings } from "../../../hooks/useNutritionDisplaySettings";
import { kjFromKcal } from "../../../utils/units";

const PAGE_SIZE = 24;

/**
 * Food Library (spec §18). Reuses the real USDA-backed Food catalog —
 * search (existing) + the new paginated browse (GET /food, additive, see
 * impact analysis §7). No category filter: no food-group field exists on
 * the Food model (verified), so none is fabricated here.
 */
export function FoodLibraryPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useApp();
  const { settings } = useNutritionDisplaySettings();
  const initialSearch = searchParams.get("search") ?? "";
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "protein" | "carbs" | "fats">("name");
  const [sourceFilter, setSourceFilter] = useState("");
  const [formFilter, setFormFilter] = useState("");
  const [supplementFilter, setSupplementFilter] = useState<"all" | "true" | "false">("all");
  const [onlyWithImage, setOnlyWithImage] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [sortBy, sourceFilter, formFilter, supplementFilter, onlyWithImage]);

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => (await profileService.getProfile()).profile,
    enabled: !!user?.id,
  });
  const energyUnit: "kcal" | "kj" = profile?.energyUnit ?? "kcal";

  const searchQuery = useQuery({
    queryKey: ["food-search", search],
    queryFn: () => foodService.search(search),
    enabled: search.length >= 2,
  });

  const browseQuery = useQuery({
    queryKey: ["food-browse", page, sortBy, sourceFilter, formFilter, supplementFilter, onlyWithImage],
    queryFn: () =>
      foodService.list({
        page,
        limit: PAGE_SIZE,
        sortBy,
        source: sourceFilter || undefined,
        foodForm: formFilter || undefined,
        isSupplement:
          supplementFilter === "all"
            ? undefined
            : supplementFilter === "true",
        hasImage: onlyWithImage || undefined,
      }),
    enabled: search.length < 2,
  });

  const filterOptionsQuery = useQuery({
    queryKey: ["food-filter-options"],
    queryFn: () => foodService.getFilterOptions(),
    enabled: search.length < 2,
  });

  const isSearching = search.length >= 2;
  const foods = isSearching ? (searchQuery.data ?? []) : (browseQuery.data?.foods ?? []);
  const isLoading = isSearching ? searchQuery.isLoading : browseQuery.isLoading;
  const total = browseQuery.data?.pagination.total;

  function formatCalories(kcal: number) {
    return energyUnit === "kj" ? `${kjFromKcal(kcal)} kJ` : `${Math.round(kcal)} kcal`;
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Apple className="w-5 h-5 text-rose-400" /> Thư viện thực phẩm
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Tra cứu calo và dinh dưỡng (theo 100g) {total ? `· ${total.toLocaleString("vi-VN")} thực phẩm` : ""}
        </p>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          data-testid="food-library-search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Tìm thực phẩm..."
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-zinc-700/60 bg-zinc-900 text-sm text-zinc-200 outline-none focus:ring-2 focus:ring-rose-500/40"
        />
      </div>

      {/* Sort by macro (spec §18's real, computable "protein-rich / carb-rich
          / fat-rich" allowance — not a fabricated food-group filter). Only
          meaningful for the browse list, not the fuzzy search results. */}
      {!isSearching && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(
            [
              { value: "name", label: "Tên A-Z" },
              { value: "protein", label: "Nhiều protein nhất" },
              { value: "carbs", label: "Nhiều carb nhất" },
              { value: "fats", label: "Nhiều chất béo nhất" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              data-testid={`food-library-sort-${opt.value}`}
              onClick={() => setSortBy(opt.value)}
              className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                sortBy === opt.value
                  ? "border-rose-500/50 bg-rose-500/10 text-rose-300"
                  : "border-zinc-700/60 bg-zinc-900 text-zinc-400 hover:border-zinc-600"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {!isSearching && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <select
            data-testid="food-library-source-filter"
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
            className="px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-900 text-xs text-zinc-300 outline-none focus:ring-2 focus:ring-rose-500/40"
          >
            <option value="">Tat ca nguon</option>
            {(filterOptionsQuery.data?.sources ?? []).map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
          <select
            data-testid="food-library-form-filter"
            value={formFilter}
            onChange={(event) => setFormFilter(event.target.value)}
            className="px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-900 text-xs text-zinc-300 outline-none focus:ring-2 focus:ring-rose-500/40"
          >
            <option value="">Tat ca dang</option>
            {(filterOptionsQuery.data?.foodForms ?? []).map((foodForm) => (
              <option key={foodForm} value={foodForm}>
                {foodForm}
              </option>
            ))}
          </select>
          <select
            data-testid="food-library-supplement-filter"
            value={supplementFilter}
            onChange={(event) =>
              setSupplementFilter(event.target.value as "all" | "true" | "false")
            }
            className="px-3 py-2 rounded-lg border border-zinc-700/60 bg-zinc-900 text-xs text-zinc-300 outline-none focus:ring-2 focus:ring-rose-500/40"
          >
            <option value="all">Tat ca loai</option>
            <option value="false">Thuc pham thong thuong</option>
            <option value="true">Supplement</option>
          </select>
          <button
            type="button"
            data-testid="food-library-filter-has-image"
            onClick={() => setOnlyWithImage((value) => !value)}
            className={`px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${
              onlyWithImage
                ? "border-rose-500/50 bg-rose-500/10 text-rose-300"
                : "border-zinc-700/60 bg-zinc-900 text-zinc-400 hover:border-zinc-600"
            }`}
          >
            Co anh
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Đang tải...
        </div>
      ) : foods.length === 0 ? (
        <div className="text-center py-16 text-sm text-zinc-500">
          {isSearching ? "Không tìm thấy thực phẩm phù hợp." : "Không có dữ liệu."}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" data-testid="food-library-results">
          {foods.map((food) => (
            <button
              key={food.id}
              type="button"
              data-testid={`food-card-${food.id}`}
              onClick={() => navigate(`/client/foods/${food.id}`)}
              className="flex items-center gap-3 text-left bg-zinc-900 border border-zinc-800/60 hover:border-zinc-700 rounded-xl p-3 transition-all"
            >
              {food.imageUrl ? (
                <img src={food.imageUrl} alt="" className="w-11 h-11 rounded-lg object-cover flex-shrink-0" />
              ) : (
                <div className="w-11 h-11 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
                  <Apple className="w-5 h-5 text-zinc-600" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-200 truncate">{food.name}</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {formatCalories(food.calories)}
                  {settings.showMacros &&
                    ` · P${Math.round(food.protein)}g · C${Math.round(food.carbs)}g · F${Math.round(food.fats)}g`}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {!isSearching && (
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            data-testid="food-library-prev-page"
            disabled={page <= 1 || browseQuery.isFetching}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-zinc-400 border border-zinc-800 disabled:opacity-30"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Trước
          </button>
          <span className="text-xs text-zinc-600">Trang {page}</span>
          <button
            type="button"
            data-testid="food-library-next-page"
            disabled={foods.length < PAGE_SIZE || browseQuery.isFetching}
            onClick={() => setPage((p) => p + 1)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-zinc-400 border border-zinc-800 disabled:opacity-30"
          >
            Sau <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
