import { useState } from "react";
import { Dumbbell, MapPin, Loader2, Search } from "lucide-react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { gymService } from "../../services/api";
import type { Gym } from "../../types";
import { Stars } from "../../components/gym/Stars";

export function GymsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const { data: gyms = [], isLoading } = useQuery<Gym[]>({
    queryKey: ["gyms"],
    queryFn: () => gymService.listGyms(),
  });

  const filtered = gyms.filter((g) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return g.name.toLowerCase().includes(q) || (g.city ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Dumbbell className="w-5 h-5 text-green-400" /> Browse Gyms
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">Find a gym and buy a membership</p>
      </div>

      <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700/60 rounded-xl px-4 py-2.5">
        <Search className="w-4 h-4 text-zinc-500" />
        <input
          aria-label="Search gyms"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or city..."
          className="flex-1 text-sm outline-none bg-transparent text-zinc-300 placeholder-zinc-600"
        />
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-20 text-center">
          <Dumbbell className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
          <h3 className="text-zinc-200 font-bold mb-1">No gyms found</h3>
          <p className="text-sm text-zinc-500">Check back later — new gyms are approved regularly.</p>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((g) => (
            <button
              type="button"
              key={g.id}
              onClick={() => navigate(`/client/gyms/${g.id}`)}
              className="text-left bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 hover:border-green-500/40 transition-colors"
            >
              <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center mb-3">
                <Dumbbell className="w-5 h-5 text-green-400" />
              </div>
              <div className="text-sm font-bold text-zinc-200 mb-1">{g.name}</div>
              <div className="flex items-center gap-1 text-xs text-zinc-500">
                <MapPin className="w-3 h-3" /> {g.address}{g.city ? `, ${g.city}` : ""}
              </div>
              {typeof g.reviewCount === "number" && g.reviewCount > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-1.5">
                  <Stars value={g.averageRating ?? 0} /> {(g.averageRating ?? 0).toFixed(1)} ({g.reviewCount})
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
