import { useState } from "react";
import { useNavigate } from "react-router";
import { Users, Calendar, FileText, TrendingUp, AlertCircle, Clock, Brain } from "lucide-react";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "../../context/AppContext";
import { useCall } from "../../context/CallContext";
import { contractService, sessionService, ptPlanReviewService } from "../../services/api";
import { getJoinSessionState } from "../../utils/sessionUtils";
import { formatVND } from "../../utils/currency";

// clientProfile (from testai-v4 service) or clientName string (legacy compat)
type ClientRef = {
  clientProfile?: { firstName?: string; lastName?: string } | null;
  clientName?: string | null;
};

type Session = ClientRef & {
  id: string;
  clientUserId: string;
  ptUserId: string;
  scheduledStartAt: string;
  status: string;
  sessionMode?: string;
};

type Contract = ClientRef & {
  id: string;
  clientUserId: string;
  status: string;
  packageName?: string;
  endDate?: string;
};

function resolveClientName(ref: ClientRef, fallback = "Học viên"): string {
  if (ref.clientProfile) {
    const name = `${ref.clientProfile.firstName ?? ""} ${ref.clientProfile.lastName ?? ""}`.trim();
    return name || fallback;
  }
  return ref.clientName || fallback;
}

function getInitials(ref: ClientRef): string {
  if (ref.clientProfile) {
    const f = ref.clientProfile.firstName?.[0] ?? "";
    const l = ref.clientProfile.lastName?.[0] ?? "";
    return (f + l).toUpperCase() || "?";
  }
  const name = ref.clientName?.trim();
  if (!name) return "?";
  const parts = name.split(" ");
  return parts.length >= 2
    ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    : parts[0].slice(0, 2).toUpperCase();
}

function getMonday(d: Date) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatSessionTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleString("vi-VN", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: false });
}

const dayLabels = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const statusLabel: Record<string, string> = { CONFIRMED: "Đã xác nhận", REQUESTED: "Chờ xác nhận" };

export function PTDashboard() {
  const navigate = useNavigate();
  const { user } = useApp();
  const today = new Date().toLocaleDateString("vi-VN", { weekday: "long", month: "long", day: "numeric" });

  const { data: earnings, isLoading: earningsLoading } = useQuery({
    queryKey: ["pt-earnings"],
    queryFn: () => contractService.getEarnings(),
  });

  const { data: contracts = [], isLoading: contractsLoading } = useQuery({
    queryKey: ["pt-contracts"],
    queryFn: () => contractService.getByPT(),
  });

  const { data: upcomingSessions = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ["sessions-upcoming"],
    queryFn: () => sessionService.getMyUpcoming(),
  });

  const { data: pendingPlans = [] } = useQuery({
    queryKey: ["pt-pending-plans-count"],
    queryFn: () => ptPlanReviewService.getPendingReviews(),
  });

  const isLoading = earningsLoading || contractsLoading || sessionsLoading;

  const { joinCoachingSession } = useCall();
  const [joiningSessionId, setJoiningSessionId] = useState<string | null>(null);

  const handleJoinSession = async (s: Session) => {
    if (joiningSessionId) return;
    setJoiningSessionId(s.id);
    try {
      const result = await sessionService.joinSession(s.id);
      await joinCoachingSession({ id: result.sessionId, otherUserId: result.otherUserId, joinToken: result.joinToken });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Không thể tham gia buổi học");
    } finally {
      setJoiningSessionId(null);
    }
  };

  const activeContracts: number = earnings?.activeContracts ?? 0;
  const totalEarned: number = earnings?.totalEarned ?? 0;
  const activeRevenue: number = earnings?.activeRevenue ?? 0;
  const upcomingCount = (upcomingSessions as Session[]).filter(s =>
    ["REQUESTED", "CONFIRMED"].includes(s.status)
  ).length;

  const kpis = [
    { label: "Học viên", value: isLoading ? "–" : String(activeContracts), change: "Hợp đồng", icon: Users, color: "text-green-400", bg: "bg-green-500/10", iconBg: "bg-green-500/15", border: "border-green-500/20" },
    { label: "Buổi tập sắp tới", value: isLoading ? "–" : String(upcomingCount), change: "Tuần này", icon: Calendar, color: "text-blue-400", bg: "bg-blue-500/10", iconBg: "bg-blue-500/15", border: "border-blue-500/20" },
    { label: "Hợp đồng đang hoạt động", value: isLoading ? "–" : String(activeContracts), change: "Đang hoạt động", icon: FileText, color: "text-violet-400", bg: "bg-violet-500/10", iconBg: "bg-violet-500/15", border: "border-violet-500/20" },
    { label: "Tổng thu nhập", value: isLoading ? "–" : formatVND(totalEarned), change: "Tổng cộng", icon: TrendingUp, color: "text-amber-400", bg: "bg-amber-500/10", iconBg: "bg-amber-500/15", border: "border-amber-500/20" },
  ];

  const revenueData = [
    { label: "Đã hoàn thành", revenue: totalEarned },
    { label: "Đang hoạt động", revenue: activeRevenue },
  ];

  const monday = getMonday(new Date());
  const sessionTrend = dayLabels.map((day, i) => ({
    day,
    sessions: (upcomingSessions as Session[]).filter(s => {
      const d = new Date(s.scheduledStartAt);
      const dayOffset = new Date(monday);
      dayOffset.setDate(monday.getDate() + i);
      return d >= dayOffset && d < new Date(dayOffset.getTime() + 86400000);
    }).length,
  }));

  const sortedSessions = (upcomingSessions as Session[])
    .toSorted((a, b) => new Date(a.scheduledStartAt).getTime() - new Date(b.scheduledStartAt).getTime())
    .slice(0, 5);

  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const alerts: { type: string; text: string }[] = [
    ...(contracts as Contract[])
      .flatMap(c => c.status === "ACTIVE" && c.endDate && new Date(c.endDate) <= in7Days
        ? [{ type: "warning", text: `Hợp đồng "${c.packageName ?? "Package"}" sắp hết hạn trong vòng 7 ngày` }]
        : []),
    ...(contracts as Contract[])
      .flatMap(c => c.status === "PENDING_REVIEW"
        ? [{ type: "info", text: "Yêu cầu hợp đồng mới đang chờ xét duyệt" }]
        : []),
  ];

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100">Xin chào, {user?.firstName || "Coach"} 👋</h1>
          <p className="text-zinc-500 text-sm mt-0.5">{today}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => navigate("/pt/clients")} className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-500/20">
            <Users className="w-4 h-4" /> Xem học viên
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map(k => (
          <div key={k.label} className={`${k.bg} rounded-xl p-4 border ${k.border}`}>
            <div className="flex items-start justify-between mb-3">
              <div className={`w-9 h-9 ${k.iconBg} rounded-lg flex items-center justify-center`}>
                <k.icon className={`w-4 h-4 ${k.color}`} />
              </div>
              <span className={`text-xs font-bold ${k.color} bg-black/20 px-2 py-0.5 rounded-full`}>{k.change}</span>
            </div>
            <div className="text-xl font-bold text-zinc-100">{k.value}</div>
            <div className="text-xs text-zinc-500 mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-bold text-zinc-200">Tổng quan doanh thu</h4>
          </div>
          {earningsLoading ? (
            <div className="h-[140px] flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #27272a", backgroundColor: "#111111", color: "#f4f4f5" }} formatter={(v: number) => [formatVND(v)]} />
                <Bar dataKey="revenue" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
          <h4 className="text-sm font-bold text-zinc-200 mb-3">Buổi tập tuần này</h4>
          {sessionsLoading ? (
            <div className="h-[140px] flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={sessionTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #27272a", backgroundColor: "#111111", color: "#f4f4f5" }} />
                <Line type="monotone" dataKey="sessions" stroke="#22c55e" strokeWidth={2} dot={{ fill: "#22c55e", r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Upcoming sessions */}
        <div className="lg:col-span-2 bg-zinc-900 rounded-xl border border-zinc-800/60">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
            <h4 className="text-sm font-bold text-zinc-200">Buổi tập sắp tới</h4>
            <button type="button" onClick={() => navigate("/pt/schedule")} className="text-xs text-green-400 hover:text-green-300 transition-colors">Xem tất cả</button>
          </div>
          {sessionsLoading ? (
            <div className="px-4 py-8 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : sortedSessions.length === 0 ? (
            <div className="px-4 py-8 text-center text-zinc-500 text-sm">Không có buổi tập sắp tới</div>
          ) : (
            <div className="divide-y divide-zinc-800/40">
              {sortedSessions.map(s => (
                <div key={s.id} className="flex items-center justify-between px-4 py-3 hover:bg-zinc-800/30 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center text-xs font-bold text-green-400">
                      {getInitials(s)}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-zinc-200">{resolveClientName(s)}</div>
                      <div className="text-xs text-zinc-600 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {formatSessionTime(s.scheduledStartAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      s.status === "CONFIRMED" ? "bg-green-500/10 text-green-400" :
                      s.status === "REQUESTED" ? "bg-amber-500/10 text-amber-400" :
                      "bg-zinc-800 text-zinc-500"
                    }`}>{statusLabel[s.status] ?? s.status}</span>
                    {(() => {
                      const joinState = getJoinSessionState(s, user?.id);
                      if (!joinState.visible) return null;
                      const isJoining = joiningSessionId === s.id;
                      return (
                        <div className="flex flex-col items-end gap-0.5">
                          <button
                            type="button"
                            onClick={() => joinState.enabled && handleJoinSession(s)}
                            disabled={!joinState.enabled || isJoining}
                            title={joinState.reason}
                            className={`text-xs px-2.5 py-1 rounded-lg font-bold transition-all ${
                              joinState.enabled && !isJoining
                                ? "bg-green-500 hover:bg-green-400 text-black shadow-sm shadow-green-500/20 cursor-pointer"
                                : "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                            }`}
                          >
                            {isJoining ? "Đang vào..." : joinState.label}
                          </button>
                          {joinState.reason && !joinState.enabled && (
                            <span className="text-[10px] text-zinc-600 text-right max-w-[120px] leading-tight">{joinState.reason}</span>
                          )}
                        </div>
                      );
                    })()}
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
            <h4 className="text-sm font-bold text-zinc-200">Cảnh báo học viên</h4>
          </div>
          {contractsLoading ? (
            <div className="px-4 py-8 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (pendingPlans as any[]).length === 0 && alerts.length === 0 ? (
            <div className="px-4 py-8 text-center text-zinc-500 text-sm">Không có cảnh báo</div>
          ) : (
            <div className="divide-y divide-zinc-800/40">
              {(pendingPlans as any[]).length > 0 && (
                <div className="px-4 py-3 bg-violet-500/5">
                  <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4 text-violet-400 flex-shrink-0" />
                    <p className="text-xs text-zinc-300 leading-relaxed flex-1">
                      {(pendingPlans as any[]).length} kế hoạch AI đang chờ bạn duyệt
                    </p>
                    <button
                      type="button"
                      onClick={() => navigate("/pt/plans")}
                      className="text-xs text-violet-400 hover:text-violet-300 font-semibold whitespace-nowrap"
                    >
                      Xem ngay →
                    </button>
                  </div>
                </div>
              )}
              {alerts.map((a) => (
                <div key={a.text} className={`px-4 py-3 ${a.type === "warning" ? "bg-amber-500/5" : "bg-blue-500/5"}`}>
                  <p className="text-xs text-zinc-400 leading-relaxed">{a.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
