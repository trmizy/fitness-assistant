import { useState } from "react";
import { useNavigate } from "react-router";
import { Search, Filter, TrendingDown, TrendingUp, ChevronRight } from "lucide-react";

const clients = [
  { id: 1, name: "Alex Johnson", goal: "Lose Fat", avatar: "AJ", contract: "Active", sessions: "7/12", bfp: "18.2%", bfpTrend: "down", adherence: 85, lastInBody: "Jun 15", muscle: "36.5kg" },
  { id: 2, name: "Maria Chen", goal: "Gain Muscle", avatar: "MC", contract: "Active", sessions: "2/8", bfp: "22.1%", bfpTrend: "down", adherence: 72, lastInBody: "Jun 10", muscle: "28.1kg" },
  { id: 3, name: "Ryan Park", goal: "Improve Health", avatar: "RP", contract: "Active", sessions: "4/12", bfp: "20.5%", bfpTrend: "up", adherence: 60, lastInBody: "Jun 5", muscle: "34.2kg" },
  { id: 4, name: "Tom Wallace", goal: "Gain Muscle", avatar: "TW", contract: "Active", sessions: "1/6", bfp: "15.3%", bfpTrend: "same", adherence: 40, lastInBody: "May 28", muscle: "38.9kg" },
  { id: 5, name: "Lisa Morgan", goal: "Lose Fat", avatar: "LM", contract: "Expiring", sessions: "10/12", bfp: "26.3%", bfpTrend: "down", adherence: 90, lastInBody: "Jun 12", muscle: "30.5kg" },
  { id: 6, name: "Sam Lee", goal: "Maintain Body", avatar: "SL", contract: "Active", sessions: "5/10", bfp: "17.8%", bfpTrend: "same", adherence: 78, lastInBody: "Jun 1", muscle: "37.1kg" },
];

export function PTClientList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) &&
    (filter === "All" || c.goal === filter || c.contract === filter)
  );

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100">My Clients</h1>
        <p className="text-zinc-500 text-sm mt-0.5">{clients.length} active coaching relationships</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700/60 rounded-xl px-4 py-2.5 flex-1">
          <Search className="w-4 h-4 text-zinc-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients…" className="flex-1 text-sm outline-none bg-transparent text-zinc-300 placeholder-zinc-600" />
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {["All", "Lose Fat", "Gain Muscle", "Expiring"].map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${filter === f ? "bg-green-500 text-black shadow-lg shadow-green-500/20" : "bg-zinc-900 border border-zinc-700/60 text-zinc-400 hover:text-zinc-200"}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs text-zinc-600 bg-zinc-800/30 border-b border-zinc-800/60 uppercase tracking-wider">
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Goal</th>
              <th className="px-4 py-3">Contract</th>
              <th className="px-4 py-3">Sessions</th>
              <th className="px-4 py-3">Body Fat</th>
              <th className="px-4 py-3">Adherence</th>
              <th className="px-4 py-3">Last InBody</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id} className="border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/30 transition-colors cursor-pointer" onClick={() => navigate(`/pt/clients/${c.id}`)}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center text-xs font-bold text-green-400">{c.avatar}</div>
                    <span className="text-sm font-semibold text-zinc-200">{c.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-zinc-400">{c.goal}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${c.contract === "Active" ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20"}`}>{c.contract}</span>
                </td>
                <td className="px-4 py-3 text-sm text-zinc-400">{c.sessions}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 text-sm">
                    {c.bfpTrend === "down" ? <TrendingDown className="w-3 h-3 text-green-400" /> : c.bfpTrend === "up" ? <TrendingUp className="w-3 h-3 text-red-400" /> : null}
                    <span className="text-zinc-300">{c.bfp}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-zinc-800 rounded-full max-w-[60px]">
                      <div className={`h-full rounded-full ${c.adherence >= 80 ? "bg-green-500" : c.adherence >= 60 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${c.adherence}%` }} />
                    </div>
                    <span className="text-xs text-zinc-500">{c.adherence}%</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-zinc-500">{c.lastInBody}</td>
                <td className="px-4 py-3">
                  <ChevronRight className="w-4 h-4 text-zinc-600" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {filtered.map(c => (
          <button key={c.id} onClick={() => navigate(`/pt/clients/${c.id}`)} className="w-full bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 text-left hover:border-zinc-700 transition-colors">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center font-bold text-green-400">{c.avatar}</div>
              <div>
                <div className="text-sm font-bold text-zinc-200">{c.name}</div>
                <div className="text-xs text-zinc-500">{c.goal}</div>
              </div>
              <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-semibold border ${c.contract === "Active" ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20"}`}>{c.contract}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div><div className="text-zinc-600">Sessions</div><div className="text-zinc-300 font-semibold">{c.sessions}</div></div>
              <div><div className="text-zinc-600">BF%</div><div className="text-zinc-300 font-semibold">{c.bfp}</div></div>
              <div><div className="text-zinc-600">Adherence</div><div className={`font-bold ${c.adherence >= 80 ? "text-green-400" : c.adherence >= 60 ? "text-amber-400" : "text-red-400"}`}>{c.adherence}%</div></div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}