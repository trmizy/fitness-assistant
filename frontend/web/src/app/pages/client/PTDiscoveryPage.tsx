import { useState } from "react";
import { Search, Star, MapPin, Award, Filter, ChevronRight, Check, Loader2, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { profileService } from "../../services/api";

// Mock data removed, now using profileService.listPTs()

const filters = ["All", "Fat Loss", "Muscle Gain", "Strength", "Yoga", "HIIT", "Powerlifting"];

export function PTDiscoveryPage() {
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: ptsData, isLoading } = useQuery({
    queryKey: ["pts-list"],
    queryFn: profileService.listPTs
  });

  if (isLoading) {
    return (
       <div className="flex h-64 items-center justify-center">
         <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
       </div>
    );
  }

  const ptsList = ptsData?.pts || [];

  const filtered = ptsList.filter((pt: any) => {
     const matchesSearch = (pt.firstName + " " + pt.lastName).toLowerCase().includes(search.toLowerCase());
     return matchesSearch;
  });

  const selectedPT = ptsList.find((pt: any) => pt.userId === selectedId);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2"><Search className="w-5 h-5 text-green-400" /> Find a Coach</h1>
        <p className="text-zinc-500 text-sm mt-0.5">Browse certified personal trainers and start your coaching journey</p>
      </div>

      {/* Search & filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700/60 rounded-xl px-4 py-2.5 flex-1">
          <Search className="w-4 h-4 text-zinc-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or specialty…" className="flex-1 text-sm outline-none text-zinc-300 placeholder-zinc-600 bg-transparent" />
        </div>
        <button className="flex items-center gap-2 px-4 py-2.5 border border-zinc-700/60 rounded-xl text-sm text-zinc-400 bg-zinc-900 hover:bg-zinc-800 hover:text-zinc-200 transition-colors">
          <Filter className="w-4 h-4" /> Filters
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {filters.map(f => (
          <button key={f} onClick={() => setActiveFilter(f)} className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all border ${activeFilter === f ? "bg-green-500 text-black border-green-500 shadow-lg shadow-green-500/20" : "bg-zinc-900 border-zinc-700/60 text-zinc-400 hover:border-green-500/40 hover:text-zinc-200"}`}>
            {f}
          </button>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* PT cards */}
        <div className={`space-y-3 ${selectedId ? "lg:w-96 flex-shrink-0" : "flex-1"}`}>
          {filtered.length > 0 ? filtered.map((pt: any) => (
            <button 
              key={pt.userId} 
              onClick={() => setSelectedId(selectedId === pt.userId ? null : pt.userId)} 
              className={`w-full text-left bg-zinc-900 rounded-xl border-2 p-4 transition-all ${selectedId === pt.userId ? "border-green-500 bg-green-500/5" : "border-zinc-800/60 hover:border-zinc-700"}`}
            >
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 bg-emerald-500/15 border border-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-400 font-bold text-sm flex-shrink-0">
                   {pt.firstName?.[0]}{pt.lastName?.[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-zinc-200">{pt.firstName} {pt.lastName}</span>
                        <Award className="w-3.5 h-3.5 text-green-400" />
                      </div>
                      <div className="flex items-center gap-1 text-xs text-zinc-600 mt-0.5">
                        <MapPin className="w-3 h-3" /> Bangkok · Certified exp.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </button>
          )) : (
            <div className="py-20 text-center bg-zinc-900/50 rounded-2xl border border-zinc-800/60">
               <Users className="w-12 h-12 text-zinc-800 mx-auto mb-3" />
               <p className="text-zinc-500">No trainers found matching your search.</p>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedPT && (
          <div className="flex-1 bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden self-start">
            <div className="p-5 border-b border-zinc-800/60">
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 bg-emerald-500/15 border border-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-400 font-bold text-xl flex-shrink-0">
                   {selectedPT.firstName?.[0]}{selectedPT.lastName?.[0]}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-zinc-100">{selectedPT.firstName} {selectedPT.lastName}</h2>
                    <span className="flex items-center gap-1 text-xs bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full border border-green-500/20"><Award className="w-3 h-3" /> Verified</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-zinc-500 mt-1">
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> Bangkok</span>
                    <span>Certified Trainer</span>
                  </div>
                </div>
              </div>
              <p className="text-sm text-zinc-400 mt-3 leading-relaxed">Expert fitness coaching available. Connect with this trainer to start your personalized journey.</p>
            </div>

            <div className="p-5">
              <h4 className="text-sm font-bold text-zinc-200 mb-3">Service Packages</h4>
              <div className="space-y-3">
                  <div className="border-2 rounded-xl p-4 border-green-500 bg-green-500/5">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-zinc-200">Personal Coaching</span>
                          <span className="text-xs bg-green-500 text-black px-2 py-0.5 rounded-full font-bold">Recommended</span>
                        </div>
                        <div className="text-xs text-zinc-500">Subscription based</div>
                      </div>
                      <span className="text-base font-bold text-green-400">Custom Price</span>
                    </div>
                    <ul className="space-y-1 mb-3">
                         <li className="flex items-center gap-1.5 text-xs text-zinc-400">
                           <Check className="w-3.5 h-3.5 text-green-500" /> Customized AI Workout Plan
                         </li>
                         <li className="flex items-center gap-1.5 text-xs text-zinc-400">
                           <Check className="w-3.5 h-3.5 text-green-500" /> Direct Chat Support
                         </li>
                    </ul>
                    <button className="w-full py-2.5 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20">
                      Request Coaching
                    </button>
                  </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}