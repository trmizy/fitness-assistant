import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CircleNotchIcon as Loader2, PersonSimpleIcon as PersonStanding, MagnifyingGlassIcon as Search } from "@phosphor-icons/react";
import { workoutService } from "../../../services/api";

export function MuscleLibraryPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("search") ?? "");

  const { data: muscles = [], isLoading } = useQuery({
    queryKey: ["muscle-taxonomy"],
    queryFn: () => workoutService.getMuscleTaxonomy(),
    staleTime: 5 * 60_000,
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return muscles;
    return muscles.filter(
      (muscle) =>
        muscle.code.toLowerCase().includes(q) ||
        muscle.nameVi.toLowerCase().includes(q) ||
        (muscle.nameEn ?? "").toLowerCase().includes(q) ||
        (muscle.anatomyRegion ?? "").toLowerCase().includes(q),
    );
  }, [muscles, query]);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <PersonStanding className="w-5 h-5 text-sky-400" /> Thư viện nhóm cơ
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Tra cứu bảng phân loại nhóm cơ dùng để ánh xạ bài tập trong hệ thống
        </p>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          data-testid="muscle-library-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm ngực, đùi trước, xô..."
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-zinc-700/60 bg-zinc-900 text-sm text-zinc-200 outline-none focus:ring-2 focus:ring-sky-500/40"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Đang tải...
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" data-testid="muscle-library-results">
          {filtered.map((muscle) => (
            <button
              key={muscle.code}
              type="button"
              data-testid={`muscle-card-${muscle.code}`}
              onClick={() => navigate(`/client/muscles/${muscle.code}`)}
              className="text-left bg-zinc-900 border border-zinc-800/60 hover:border-zinc-700 rounded-xl p-3.5 transition-all"
            >
              <p className="text-sm font-semibold text-zinc-200">{muscle.nameVi}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{muscle.nameEn ?? muscle.code}</p>
              {muscle.anatomyRegion && (
                <span className="inline-block text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/20 mt-2">
                  {muscle.anatomyRegion}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
