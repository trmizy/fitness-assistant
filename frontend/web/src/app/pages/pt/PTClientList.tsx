import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Search, TrendingDown, TrendingUp, ChevronRight, AlertCircle } from "lucide-react";
import { contractService } from "../../services/api";

type Contract = {
  id: string;
  clientUserId: string;
  status: string;
  packageName: string;
  totalSessions: number;
  usedSessions: number;
  price?: number;
  startDate?: string;
  endDate?: string;
  clientProfile?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    goal?: string;
    currentWeight?: number;
    targetWeight?: number;
  } | null;
};

function initials(firstName?: string, lastName?: string): string {
  const f = firstName?.[0] ?? "";
  const l = lastName?.[0] ?? "";
  return (f + l).toUpperCase() || "?";
}

function contractStatusLabel(status: string) {
  if (status === "ACTIVE") return "Active";
  if (status === "PENDING_REVIEW") return "Pending";
  if (status === "COMPLETED") return "Completed";
  if (status === "EXPIRED") return "Expired";
  if (status === "CANCELLED") return "Cancelled";
  return status;
}

function goalLabel(goal?: string): string {
  if (!goal) return "—";
  return goal.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

const FILTER_OPTIONS = ["All", "Active", "Pending", "Completed", "Expired"];

export function PTClientList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");

  const { data: contracts = [], isLoading, isError, refetch } = useQuery<Contract[]>({
    queryKey: ["pt-contracts"],
    queryFn: () => contractService.getByPT(),
  });

  const filtered = contracts.filter(c => {
    const name = `${c.clientProfile?.firstName ?? ""} ${c.clientProfile?.lastName ?? ""}`.toLowerCase();
    const matchSearch = !search || name.includes(search.toLowerCase()) || c.packageName.toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      filter === "All" ||
      contractStatusLabel(c.status) === filter;
    return matchSearch && matchFilter;
  });

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100">My Clients</h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          {isLoading ? "Loading…" : `${contracts.length} coaching relationship${contracts.length !== 1 ? "s" : ""}`}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700/60 rounded-xl px-4 py-2.5 flex-1">
          <Search className="w-4 h-4 text-zinc-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search clients…"
            className="flex-1 text-sm outline-none bg-transparent text-zinc-300 placeholder-zinc-600"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {FILTER_OPTIONS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${filter === f ? "bg-green-500 text-black shadow-lg shadow-green-500/20" : "bg-zinc-900 border border-zinc-700/60 text-zinc-400 hover:text-zinc-200"}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Error state */}
      {isError && (
        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-300">Failed to load clients</p>
            <button onClick={() => refetch()} className="text-xs text-red-400 hover:text-red-300 mt-0.5 underline">Try again</button>
          </div>
        </div>
      )}

      {/* Desktop table */}
      {!isError && (
        <div className="hidden md:block bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-zinc-600 bg-zinc-800/30 border-b border-zinc-800/60 uppercase tracking-wider">
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Goal</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Sessions</th>
                <th className="px-4 py-3">Package</th>
                <th className="px-4 py-3">Progress</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b border-zinc-800/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-zinc-800 rounded-full animate-pulse" />
                        <div className="h-4 w-28 bg-zinc-800 rounded animate-pulse" />
                      </div>
                    </td>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 w-16 bg-zinc-800 rounded animate-pulse" />
                      </td>
                    ))}
                    <td className="px-4 py-3" />
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-zinc-600 text-sm">
                    {search || filter !== "All" ? "No clients match your filters." : "No clients yet."}
                  </td>
                </tr>
              ) : (
                filtered.map(c => {
                  const progress = c.totalSessions > 0 ? Math.round((c.usedSessions / c.totalSessions) * 100) : 0;
                  const statusLabel = contractStatusLabel(c.status);
                  const isActive = c.status === "ACTIVE";
                  const isPending = c.status === "PENDING_REVIEW";
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/30 transition-colors cursor-pointer"
                      onClick={() => navigate(`/pt/clients/${c.clientUserId}`)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center text-xs font-bold text-green-400">
                            {initials(c.clientProfile?.firstName, c.clientProfile?.lastName)}
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-zinc-200">
                              {c.clientProfile?.firstName && c.clientProfile?.lastName
                                ? `${c.clientProfile.firstName} ${c.clientProfile.lastName}`
                                : c.clientProfile?.email ?? c.clientUserId.slice(0, 8)}
                            </div>
                            {c.clientProfile?.email && (
                              <div className="text-xs text-zinc-600">{c.clientProfile.email}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-400">{goalLabel(c.clientProfile?.goal)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${
                          isActive ? "bg-green-500/10 text-green-400 border-green-500/20" :
                          isPending ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                          "bg-zinc-700/30 text-zinc-400 border-zinc-700/40"
                        }`}>
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-400">{c.usedSessions}/{c.totalSessions}</td>
                      <td className="px-4 py-3 text-sm text-zinc-400 max-w-[140px] truncate">{c.packageName}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-zinc-800 rounded-full max-w-[60px]">
                            <div
                              className={`h-full rounded-full ${progress >= 80 ? "bg-amber-500" : "bg-green-500"}`}
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-zinc-500">{progress}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ChevronRight className="w-4 h-4 text-zinc-600" />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Mobile cards */}
      {!isError && (
        <div className="md:hidden space-y-3">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-zinc-800 rounded-full animate-pulse" />
                  <div className="space-y-1.5">
                    <div className="h-4 w-28 bg-zinc-800 rounded animate-pulse" />
                    <div className="h-3 w-16 bg-zinc-800 rounded animate-pulse" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className="h-8 bg-zinc-800 rounded animate-pulse" />
                  ))}
                </div>
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-zinc-600 text-sm">
              {search || filter !== "All" ? "No clients match your filters." : "No clients yet."}
            </div>
          ) : (
            filtered.map(c => {
              const progress = c.totalSessions > 0 ? Math.round((c.usedSessions / c.totalSessions) * 100) : 0;
              const statusLabel = contractStatusLabel(c.status);
              const isActive = c.status === "ACTIVE";
              const isPending = c.status === "PENDING_REVIEW";
              return (
                <button
                  key={c.id}
                  onClick={() => navigate(`/pt/clients/${c.clientUserId}`)}
                  className="w-full bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 text-left hover:border-zinc-700 transition-colors"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center font-bold text-green-400">
                      {initials(c.clientProfile?.firstName, c.clientProfile?.lastName)}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-zinc-200">
                        {c.clientProfile?.firstName && c.clientProfile?.lastName
                          ? `${c.clientProfile.firstName} ${c.clientProfile.lastName}`
                          : c.clientProfile?.email ?? c.clientUserId.slice(0, 8)}
                      </div>
                      <div className="text-xs text-zinc-500">{goalLabel(c.clientProfile?.goal)}</div>
                    </div>
                    <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-semibold border ${
                      isActive ? "bg-green-500/10 text-green-400 border-green-500/20" :
                      isPending ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                      "bg-zinc-700/30 text-zinc-400 border-zinc-700/40"
                    }`}>
                      {statusLabel}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div><div className="text-zinc-600">Sessions</div><div className="text-zinc-300 font-semibold">{c.usedSessions}/{c.totalSessions}</div></div>
                    <div><div className="text-zinc-600">Progress</div><div className={`font-bold ${progress >= 80 ? "text-amber-400" : "text-green-400"}`}>{progress}%</div></div>
                    <div><div className="text-zinc-600">Package</div><div className="text-zinc-300 font-semibold truncate">{c.packageName}</div></div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
