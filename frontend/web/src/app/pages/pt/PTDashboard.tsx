import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Users, Calendar, FileText, ClipboardList, AlertCircle, ChevronRight, Clock } from "lucide-react";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useApp } from "../../context/AppContext";
import { contractService, sessionService } from "../../services/api";
import { KpiCard } from "../../components/ui/KpiCard";

type Session = {
  id: string;
  clientUserId: string;
  scheduledStartAt: string;
  status: string;
  sessionMode?: string;
  clientProfile?: { firstName?: string; lastName?: string } | null;
};

type Contract = {
  id: string;
  clientUserId: string;
  status: string;
  endDate?: string;
  clientProfile?: { firstName?: string; lastName?: string } | null;
};

type Earnings = {
  totalContracts: number;
  activeContracts: number;
  completedContracts: number;
  totalEarned: number;
  activeRevenue: number;
};

function clientName(profile?: { firstName?: string; lastName?: string } | null, fallback = "Client"): string {
  if (profile?.firstName || profile?.lastName) {
    return `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim();
  }
  return fallback;
}

function clientInitials(profile?: { firstName?: string; lastName?: string } | null): string {
  const f = profile?.firstName?.[0] ?? "";
  const l = profile?.lastName?.[0] ?? "";
  return (f + l).toUpperCase() || "?";
}

function formatSessionTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Today, ${timeStr}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${timeStr}`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + `, ${timeStr}`;
}

function daysUntil(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function PTDashboard() {
  const navigate = useNavigate();
  const { user } = useApp();
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const { data: contracts = [], isLoading: contractsLoading } = useQuery<Contract[]>({
    queryKey: ["pt-contracts"],
    queryFn: () => contractService.getByPT(),
  });

  const { data: upcomingSessions = [], isLoading: sessionsLoading } = useQuery<Session[]>({
    queryKey: ["pt-sessions-upcoming"],
    queryFn: () => sessionService.getMyUpcoming(),
  });

  const { data: earnings, isLoading: earningsLoading } = useQuery<Earnings>({
    queryKey: ["pt-earnings"],
    queryFn: () => contractService.getEarnings(),
  });

  const activeContracts = contracts.filter(c => c.status === "ACTIVE");
  const expiringContracts = contracts.filter(c => {
    if (c.status !== "ACTIVE" || !c.endDate) return false;
    return daysUntil(c.endDate) <= 7;
  });
  const pendingContracts = contracts.filter(c => c.status === "PENDING_REVIEW");

  // Build revenue chart from earnings (monthly segments based on completed + active)
  const revenueData = earnings
    ? [
        { label: "Completed", revenue: earnings.totalEarned },
        { label: "Active", revenue: earnings.activeRevenue },
      ]
    : [];

  // Client alerts: expiring contracts + pending reviews
  const alerts: { type: "warning" | "info"; text: string; key: string }[] = [
    ...expiringContracts.map(c => ({
      type: "warning" as const,
      text: `${clientName(c.clientProfile)} — contract expires in ${daysUntil(c.endDate!)} day(s)`,
      key: `exp-${c.id}`,
    })),
    ...pendingContracts.map(c => ({
      type: "info" as const,
      text: `${clientName(c.clientProfile)} — new contract request pending your review`,
      key: `pend-${c.id}`,
    })),
  ];

  const kpisLoading = contractsLoading || earningsLoading;

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100">Good morning, {user?.firstName || "Coach"} 👋</h1>
          <p className="text-zinc-500 text-sm mt-0.5">{today}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate("/pt/clients")}
            className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-500/20"
          >
            <Users className="w-4 h-4" /> View Clients
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Active Clients"
          value={kpisLoading ? "—" : activeContracts.length}
          change={kpisLoading ? undefined : pendingContracts.length > 0 ? `+${pendingContracts.length} pending` : undefined}
          icon={Users}
          color="text-green-400" bg="bg-green-500/10" iconBg="bg-green-500/15" border="border-green-500/20"
          loading={kpisLoading}
        />
        <KpiCard
          label="Upcoming Sessions"
          value={sessionsLoading ? "—" : upcomingSessions.length}
          change="This week"
          icon={Calendar}
          color="text-blue-400" bg="bg-blue-500/10" iconBg="bg-blue-500/15" border="border-blue-500/20"
          loading={sessionsLoading}
        />
        <KpiCard
          label="Active Contracts"
          value={kpisLoading ? "—" : activeContracts.length}
          change={expiringContracts.length > 0 ? `${expiringContracts.length} expiring` : undefined}
          icon={FileText}
          color="text-violet-400" bg="bg-violet-500/10" iconBg="bg-violet-500/15" border="border-violet-500/20"
          loading={kpisLoading}
        />
        <KpiCard
          label="Pending Reviews"
          value={kpisLoading ? "—" : pendingContracts.length}
          change={pendingContracts.length > 0 ? "Needs action" : "All clear"}
          icon={ClipboardList}
          color="text-amber-400" bg="bg-amber-500/10" iconBg="bg-amber-500/15" border="border-amber-500/20"
          loading={kpisLoading}
        />
      </div>

      {/* Revenue chart */}
      {(earnings || earningsLoading) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-zinc-200">Revenue Overview</h4>
              {earnings && (
                <span className="text-xs font-bold text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">
                  {earnings.totalContracts} total contracts
                </span>
              )}
            </div>
            {earningsLoading ? (
              <div className="h-[140px] flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-zinc-700 border-t-green-500 rounded-full animate-spin" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={revenueData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #27272a", backgroundColor: "#111111", color: "#f4f4f5" }}
                    formatter={(v: number) => [`฿${v.toLocaleString()}`]}
                  />
                  <Bar dataKey="revenue" fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Stats summary */}
          <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60 flex flex-col justify-between">
            <h4 className="text-sm font-bold text-zinc-200 mb-4">Earnings Summary</h4>
            {earningsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-8 bg-zinc-800 rounded animate-pulse" />
                ))}
              </div>
            ) : earnings ? (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-zinc-500">Total earned (completed)</span>
                  <span className="text-sm font-bold text-zinc-200">฿{earnings.totalEarned.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-zinc-500">In active contracts</span>
                  <span className="text-sm font-bold text-green-400">฿{earnings.activeRevenue.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-zinc-500">Contracts completed</span>
                  <span className="text-sm font-bold text-zinc-200">{earnings.completedContracts}</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Upcoming sessions */}
        <div className="lg:col-span-2 bg-zinc-900 rounded-xl border border-zinc-800/60">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
            <h4 className="text-sm font-bold text-zinc-200">Upcoming Sessions</h4>
            <button onClick={() => navigate("/pt/schedule")} className="text-xs text-green-400 hover:text-green-300 transition-colors">View all</button>
          </div>
          {sessionsLoading ? (
            <div className="divide-y divide-zinc-800/40">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-9 h-9 bg-zinc-800 rounded-full animate-pulse shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-4 w-32 bg-zinc-800 rounded animate-pulse" />
                    <div className="h-3 w-24 bg-zinc-800 rounded animate-pulse" />
                  </div>
                  <div className="h-7 w-14 bg-zinc-800 rounded-lg animate-pulse" />
                </div>
              ))}
            </div>
          ) : upcomingSessions.length === 0 ? (
            <div className="px-4 py-10 text-center text-zinc-600 text-sm">No upcoming sessions scheduled.</div>
          ) : (
            <div className="divide-y divide-zinc-800/40">
              {upcomingSessions.slice(0, 5).map(s => (
                <div key={s.id} className="flex items-center justify-between px-4 py-3 hover:bg-zinc-800/30 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center text-xs font-bold text-green-400">
                      {clientInitials(s.clientProfile)}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-zinc-200">{clientName(s.clientProfile)}</div>
                      <div className="text-xs text-zinc-600 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {formatSessionTime(s.scheduledStartAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-600">{s.sessionMode ?? "Video"}</span>
                    <button className="text-xs bg-green-500 hover:bg-green-400 text-black px-2.5 py-1 rounded-lg font-bold transition-all shadow-sm shadow-green-500/20">Join</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Alerts */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800/60">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            <h4 className="text-sm font-bold text-zinc-200">Client Alerts</h4>
          </div>
          {contractsLoading ? (
            <div className="divide-y divide-zinc-800/40">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="px-4 py-3 space-y-1.5">
                  <div className="h-3.5 w-20 bg-zinc-800 rounded animate-pulse" />
                  <div className="h-3 w-full bg-zinc-800 rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : alerts.length === 0 ? (
            <div className="px-4 py-10 text-center text-zinc-600 text-sm">No alerts at this time.</div>
          ) : (
            <div className="divide-y divide-zinc-800/40">
              {alerts.map(a => (
                <div key={a.key} className={`px-4 py-3 ${a.type === "warning" ? "bg-amber-500/5" : "bg-blue-500/5"}`}>
                  <p className="text-xs text-zinc-400 leading-relaxed">{a.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pending contract reviews */}
      {(pendingContracts.length > 0 || contractsLoading) && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-violet-400" />
              <h4 className="text-sm font-bold text-zinc-200">Pending Contract Requests</h4>
            </div>
            <button onClick={() => navigate("/pt/contracts")} className="text-xs text-green-400 hover:text-green-300 transition-colors">View all</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[400px]">
              <thead>
                <tr className="text-left text-xs text-zinc-600 border-b border-zinc-800/60 bg-zinc-800/30 uppercase tracking-wider">
                  <th className="px-4 py-2">Client</th>
                  <th className="px-4 py-2">Package</th>
                  <th className="px-4 py-2">Sessions</th>
                  <th className="px-4 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {contractsLoading ? (
                  Array.from({ length: 2 }).map((_, i) => (
                    <tr key={i} className="border-b border-zinc-800/40">
                      {Array.from({ length: 4 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 w-20 bg-zinc-800 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  pendingContracts.map(c => (
                    <tr key={c.id} className="border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center text-xs font-bold text-green-400">
                            {clientInitials(c.clientProfile)}
                          </div>
                          <span className="text-sm font-semibold text-zinc-200">{clientName(c.clientProfile)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-400">{(c as any).packageName}</td>
                      <td className="px-4 py-3 text-sm text-zinc-400">{(c as any).totalSessions}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => navigate("/pt/contracts")}
                          className="flex items-center gap-1 text-xs text-violet-400 bg-violet-500/10 border border-violet-500/20 px-2.5 py-1 rounded-lg hover:bg-violet-500/15 transition-colors"
                        >
                          Review <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
