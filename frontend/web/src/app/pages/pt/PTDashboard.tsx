import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Users,
  Calendar,
  Wallet as WalletIcon,
  TrendingUp,
  AlertCircle,
  Clock,
  Brain,
  CalendarX2,
  CalendarCheck2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "../../context/AppContext";
import { useCall } from "../../context/CallContext";
import {
  contractService,
  sessionService,
  ptPlanReviewService,
  walletService,
} from "../../services/api";
import { getJoinSessionState } from "../../utils/sessionUtils";
import { formatVND } from "../../utils/currency";
import { KpiCard } from "../../components/ui/KpiCard";
import {
  SkeletonRow,
  SkeletonChart,
  EmptyState,
  ErrorState,
} from "../../components/dashboard/DashboardStates";

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
    const name =
      `${ref.clientProfile.firstName ?? ""} ${ref.clientProfile.lastName ?? ""}`.trim();
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
  return d.toLocaleString("vi-VN", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });
}

/** Fixed, literal delay classes — Tailwind's JIT scanner needs the full class string in
 * source, so this can't be built from a template literal with a runtime index. */
const STAGGER_DELAYS = ["", "delay-75", "delay-150", "delay-200"] as const;

const chartTooltipStyle = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid #27272a",
  backgroundColor: "#111111",
  color: "#f4f4f5",
} as const;

const statusLabel: Record<string, string> = {
  CONFIRMED: "Đã xác nhận",
  REQUESTED: "Chờ xác nhận",
};

export function PTDashboard() {
  const navigate = useNavigate();
  const { user } = useApp();
  const today = new Date().toLocaleDateString("vi-VN", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const { data: wallet, isLoading: walletLoading } = useQuery({
    queryKey: ["pt-wallet"],
    queryFn: () => walletService.getPtWallet(),
  });

  const {
    data: earnings,
    isLoading: earningsLoading,
    isError: earningsError,
  } = useQuery({
    queryKey: ["pt-earnings"],
    queryFn: () => contractService.getEarnings(),
  });

  const { data: contracts = [], isLoading: contractsLoading } = useQuery({
    queryKey: ["pt-contracts"],
    queryFn: () => contractService.getByPT(),
  });

  const {
    data: upcomingSessions = [],
    isLoading: sessionsLoading,
    isError: sessionsError,
  } = useQuery({
    queryKey: ["sessions-upcoming"],
    queryFn: () => sessionService.getMyUpcoming(),
  });

  const { data: pendingPlans = [] } = useQuery({
    queryKey: ["pt-pending-plans-count"],
    queryFn: () => ptPlanReviewService.getPendingReviews(),
  });

  const { joinCoachingSession } = useCall();
  const [joiningSessionId, setJoiningSessionId] = useState<string | null>(null);

  const handleJoinSession = async (s: Session) => {
    if (joiningSessionId) return;
    setJoiningSessionId(s.id);
    try {
      const result = await sessionService.joinSession(s.id);
      await joinCoachingSession({
        id: result.sessionId,
        otherUserId: result.otherUserId,
        joinToken: result.joinToken,
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Không thể tham gia buổi học");
    } finally {
      setJoiningSessionId(null);
    }
  };

  const availableBalance = Number(wallet?.availableBalance ?? 0);
  const activeContracts: number = earnings?.activeContracts ?? 0;
  const totalEarned: number = earnings?.totalEarned ?? 0;
  const activeRevenue: number = earnings?.activeRevenue ?? 0;
  const upcomingCount = (upcomingSessions as Session[]).filter((s) =>
    ["REQUESTED", "CONFIRMED"].includes(s.status),
  ).length;

  const kpis = [
    {
      label: "Số dư ví khả dụng",
      value: formatVND(availableBalance),
      change: "Ví PT",
      icon: WalletIcon,
      color: "text-green-400",
      bg: "bg-green-500/10",
      iconBg: "bg-green-500/15",
      border: "border-green-500/20",
      loading: walletLoading,
    },
    {
      label: "Buổi tập sắp tới",
      value: String(upcomingCount),
      change: "Tuần này",
      icon: Calendar,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      iconBg: "bg-blue-500/15",
      border: "border-blue-500/20",
      loading: sessionsLoading,
    },
    {
      label: "Hợp đồng đang hoạt động",
      value: String(activeContracts),
      change: "Đang chạy",
      icon: Users,
      color: "text-violet-400",
      bg: "bg-violet-500/10",
      iconBg: "bg-violet-500/15",
      border: "border-violet-500/20",
      loading: earningsLoading,
    },
    {
      label: "Tổng thu nhập",
      value: formatVND(totalEarned),
      change: "Tổng cộng",
      icon: TrendingUp,
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      iconBg: "bg-amber-500/15",
      border: "border-amber-500/20",
      loading: earningsLoading,
    },
  ];

  const revenueData = [
    { label: "Đã hoàn thành", revenue: totalEarned },
    { label: "Đang hoạt động", revenue: activeRevenue },
  ];

  const dayLabels = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
  const monday = getMonday(new Date());
  const sessionTrend = dayLabels.map((day, i) => ({
    day,
    sessions: (upcomingSessions as Session[]).filter((s) => {
      const d = new Date(s.scheduledStartAt);
      const dayOffset = new Date(monday);
      dayOffset.setDate(monday.getDate() + i);
      return d >= dayOffset && d < new Date(dayOffset.getTime() + 86400000);
    }).length,
  }));

  const sortedSessions = [...(upcomingSessions as Session[])]
    .sort(
      (a, b) =>
        new Date(a.scheduledStartAt).getTime() -
        new Date(b.scheduledStartAt).getTime(),
    )
    .slice(0, 5);

  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const alerts: { type: string; text: string }[] = [
    ...(contracts as Contract[])
      .filter(
        (c) =>
          c.status === "ACTIVE" && c.endDate && new Date(c.endDate) <= in7Days,
      )
      .map((c) => ({
        type: "warning",
        text: `Hợp đồng "${c.packageName ?? "Package"}" sắp hết hạn trong vòng 7 ngày`,
      })),
    ...(contracts as Contract[])
      .filter((c) => c.status === "PENDING_REVIEW")
      .map(() => ({
        type: "info",
        text: "Yêu cầu hợp đồng mới đang chờ xét duyệt",
      })),
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-zinc-100">Xin chào, {user?.firstName || "Coach"}</h1>
          <p className="mt-0.5 text-sm text-zinc-500">{today}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate("/pt/wallet")}
            className="flex items-center gap-2 rounded-xl border border-zinc-700/60 bg-zinc-900 px-4 py-2.5 text-sm font-bold text-zinc-200 transition-[transform,border-color] active:scale-[0.98] hover:border-zinc-600"
          >
            <WalletIcon className="h-4 w-4" /> Ví của tôi
          </button>
          <button
            onClick={() => navigate("/pt/clients")}
            className="flex items-center gap-2 rounded-xl bg-green-500 px-4 py-2.5 text-sm font-bold text-black shadow-lg shadow-green-500/20 transition-[transform,background-color] active:scale-[0.98] hover:bg-green-400"
          >
            <Users className="h-4 w-4" /> Xem học viên
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k, i) => (
          <KpiCard key={k.label} {...k} animationDelayClass={STAGGER_DELAYS[i]} />
        ))}
      </div>

      {/* Charts — asymmetric 3fr/2fr split rather than an even halves grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-500 delay-150 fill-mode-both rounded-xl border border-zinc-800/60 bg-zinc-900 p-4 lg:col-span-3">
          <h4 className="mb-3 text-sm font-bold text-zinc-200">Tổng quan doanh thu</h4>
          {earningsLoading ? (
            <SkeletonChart />
          ) : earningsError ? (
            <ErrorState message="Không tải được doanh thu. Thử tải lại trang." />
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#71717a" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#71717a" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [formatVND(v)]} />
                <Bar dataKey="revenue" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-500 delay-200 fill-mode-both rounded-xl border border-zinc-800/60 bg-zinc-900 p-4 lg:col-span-2">
          <h4 className="mb-3 text-sm font-bold text-zinc-200">Buổi tập tuần này</h4>
          {sessionsLoading ? (
            <SkeletonChart />
          ) : sessionsError ? (
            <ErrorState message="Không tải được lịch tuần. Thử tải lại trang." />
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={sessionTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: "#71717a" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#71717a" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Line
                  type="monotone"
                  dataKey="sessions"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={{ fill: "#22c55e", r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Upcoming sessions */}
        <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-500 delay-300 fill-mode-both rounded-xl border border-zinc-800/60 bg-zinc-900 lg:col-span-2">
          <div className="flex items-center justify-between border-b border-zinc-800/60 px-4 py-3">
            <h4 className="text-sm font-bold text-zinc-200">Buổi tập sắp tới</h4>
            <button
              onClick={() => navigate("/pt/schedule")}
              className="text-xs text-green-400 transition-colors hover:text-green-300"
            >
              Xem tất cả
            </button>
          </div>
          {sessionsLoading ? (
            <div className="divide-y divide-zinc-800/40">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : sortedSessions.length === 0 ? (
            <EmptyState
              icon={CalendarX2}
              title="Không có buổi tập sắp tới"
              hint="Buổi tập mới sẽ hiện ở đây khi học viên đặt lịch."
            />
          ) : (
            <div className="divide-y divide-zinc-800/40">
              {sortedSessions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-zinc-800/30"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full border border-green-500/20 bg-green-500/15 text-xs font-bold text-green-400">
                      {getInitials(s)}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-zinc-200">{resolveClientName(s)}</div>
                      <div className="flex items-center gap-1 text-xs text-zinc-600">
                        <Clock className="h-3 w-3" /> {formatSessionTime(s.scheduledStartAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        s.status === "CONFIRMED"
                          ? "bg-green-500/10 text-green-400"
                          : s.status === "REQUESTED"
                            ? "bg-amber-500/10 text-amber-400"
                            : "bg-zinc-800 text-zinc-500"
                      }`}
                    >
                      {statusLabel[s.status] ?? s.status}
                    </span>
                    {(() => {
                      const joinState = getJoinSessionState(s, user?.id);
                      if (!joinState.visible) return null;
                      const isJoining = joiningSessionId === s.id;
                      return (
                        <div className="flex flex-col items-end gap-0.5">
                          <button
                            onClick={() => joinState.enabled && handleJoinSession(s)}
                            disabled={!joinState.enabled || isJoining}
                            title={joinState.reason}
                            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-[transform,background-color] active:scale-[0.98] ${
                              joinState.enabled && !isJoining
                                ? "cursor-pointer bg-green-500 text-black shadow-sm shadow-green-500/20 hover:bg-green-400"
                                : "cursor-not-allowed bg-zinc-700 text-zinc-500"
                            }`}
                          >
                            {isJoining ? "Đang vào..." : joinState.label}
                          </button>
                          {joinState.reason && !joinState.enabled && (
                            <span className="max-w-[120px] text-right text-[10px] leading-tight text-zinc-600">
                              {joinState.reason}
                            </span>
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
        <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-500 delay-300 fill-mode-both rounded-xl border border-zinc-800/60 bg-zinc-900">
          <div className="flex items-center gap-2 border-b border-zinc-800/60 px-4 py-3">
            <AlertCircle className="h-4 w-4 text-amber-400" />
            <h4 className="text-sm font-bold text-zinc-200">Cảnh báo học viên</h4>
          </div>
          {contractsLoading ? (
            <div className="divide-y divide-zinc-800/40">
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : (pendingPlans as any[]).length === 0 && alerts.length === 0 ? (
            <EmptyState
              icon={CalendarCheck2}
              title="Không có cảnh báo"
              hint="Mọi hợp đồng và kế hoạch đang ổn."
            />
          ) : (
            <div className="divide-y divide-zinc-800/40">
              {(pendingPlans as any[]).length > 0 && (
                <div className="bg-violet-500/5 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Brain className="h-4 w-4 flex-shrink-0 text-violet-400" />
                    <p className="flex-1 text-xs leading-relaxed text-zinc-300">
                      {(pendingPlans as any[]).length} kế hoạch AI đang chờ bạn duyệt
                    </p>
                    <button
                      onClick={() => navigate("/pt/plans")}
                      className="whitespace-nowrap text-xs font-semibold text-violet-400 hover:text-violet-300"
                    >
                      Xem ngay
                    </button>
                  </div>
                </div>
              )}
              {alerts.map((a, i) => (
                <div
                  key={i}
                  className={`px-4 py-3 ${a.type === "warning" ? "bg-amber-500/5" : "bg-blue-500/5"}`}
                >
                  <p className="text-xs leading-relaxed text-zinc-400">{a.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
