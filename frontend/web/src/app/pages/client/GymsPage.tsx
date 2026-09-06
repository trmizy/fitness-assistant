import { useState } from "react";
import { BarbellIcon as Dumbbell, MapPinIcon as MapPin, CircleNotchIcon as Loader2, MagnifyingGlassIcon as Search, BuildingsIcon as Building2, CaretDownIcon as ChevronDown } from "@phosphor-icons/react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { gymService } from "../../services/api";
import type { Gym } from "../../types";
import { Stars } from "../../components/gym/Stars";

interface StandaloneEntry {
  kind: "standalone";
  gym: Gym;
}
interface BrandEntry {
  kind: "brand";
  brandId: string;
  brandName: string;
  branches: Gym[];
}
type SearchEntry = StandaloneEntry | BrandEntry;

/** One entry per brand (2+ branches share it), one entry per everything else — a lone gym
 * with a brandId but no sibling branches visible yet is shown standalone too, since a
 * dropdown with a single option has nothing to pick between. */
function groupByBrand(gyms: Gym[]): SearchEntry[] {
  const byBrand = new Map<string, Gym[]>();
  const standalone: Gym[] = [];
  for (const g of gyms) {
    if (!g.brand) {
      standalone.push(g);
      continue;
    }
    const list = byBrand.get(g.brand.id) ?? [];
    list.push(g);
    byBrand.set(g.brand.id, list);
  }

  const entries: SearchEntry[] = [];
  for (const [brandId, branches] of byBrand) {
    if (branches.length >= 2) {
      entries.push({ kind: "brand", brandId, brandName: branches[0].brand!.name, branches });
    } else {
      standalone.push(...branches);
    }
  }
  for (const gym of standalone) entries.push({ kind: "standalone", gym });
  return entries;
}

function matchesSearch(entry: SearchEntry, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (entry.kind === "standalone") {
    return entry.gym.name.toLowerCase().includes(q) || (entry.gym.city ?? "").toLowerCase().includes(q);
  }
  return (
    entry.brandName.toLowerCase().includes(q) ||
    entry.branches.some((b) => b.name.toLowerCase().includes(q) || (b.city ?? "").toLowerCase().includes(q))
  );
}

function GymResultCard({ gym }: { gym: Gym }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(`/client/gyms/${gym.id}`)}
      className="text-left bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 hover:border-green-500/40 transition-colors"
    >
      <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center mb-3">
        <Dumbbell className="w-5 h-5 text-green-400" />
      </div>
      <div className="text-sm font-bold text-zinc-200 mb-1">{gym.name}</div>
      <div className="flex items-center gap-1 text-xs text-zinc-500">
        <MapPin className="w-3 h-3" /> {gym.address}{gym.city ? `, ${gym.city}` : ""}
      </div>
      {typeof gym.reviewCount === "number" && gym.reviewCount > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-1.5">
          <Stars value={gym.averageRating ?? 0} /> {(gym.averageRating ?? 0).toFixed(1)} ({gym.reviewCount})
        </div>
      )}
    </button>
  );
}

function BrandResultCard({ entry }: { entry: BrandEntry }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left p-4 hover:bg-zinc-800/30 transition-colors"
      >
        <div className="flex items-start justify-between">
          <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center mb-3">
            <Building2 className="w-5 h-5 text-green-400" />
          </div>
          <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
        <div className="text-sm font-bold text-zinc-200 mb-1">{entry.brandName}</div>
        <div className="text-xs text-zinc-500">{entry.branches.length} chi nhánh — bấm để xem</div>
      </button>
      {open && (
        <div className="divide-y divide-zinc-800/60 border-t border-zinc-800/60">
          {entry.branches.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => navigate(`/client/gyms/${b.id}`)}
              className="w-full text-left px-4 py-3 hover:bg-zinc-800/30 transition-colors flex items-center gap-2"
            >
              <MapPin className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
              <div>
                <div className="text-xs font-semibold text-zinc-300">{b.address}{b.city ? `, ${b.city}` : ""}</div>
                {typeof b.reviewCount === "number" && b.reviewCount > 0 && (
                  <div className="flex items-center gap-1 text-[11px] text-zinc-500 mt-0.5">
                    <Stars value={b.averageRating ?? 0} /> {(b.averageRating ?? 0).toFixed(1)}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function GymsPage() {
  const [search, setSearch] = useState("");

  const { data: gyms = [], isLoading } = useQuery<Gym[]>({
    queryKey: ["gyms"],
    queryFn: () => gymService.listGyms(),
  });

  const entries = groupByBrand(gyms).filter((e) => matchesSearch(e, search));

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

      {!isLoading && entries.length === 0 && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-20 text-center">
          <Dumbbell className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
          <h3 className="text-zinc-200 font-bold mb-1">No gyms found</h3>
          <p className="text-sm text-zinc-500">Check back later — new gyms are approved regularly.</p>
        </div>
      )}

      {!isLoading && entries.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map((entry) =>
            entry.kind === "brand" ? (
              <BrandResultCard key={entry.brandId} entry={entry} />
            ) : (
              <GymResultCard key={entry.gym.id} gym={entry.gym} />
            ),
          )}
        </div>
      )}
    </div>
  );
}
