import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Wallet as WalletIcon,
  Users,
  QrCode,
  Star,
  ChevronDown,
  Settings,
  Plus,
  Building2,
  UserCheck,
  ClipboardList,
  UsersRound,
} from "lucide-react";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../context/AppContext";
import { gymService, collaborationService } from "../../services/api";
import { formatVND } from "../../utils/currency";
import { KpiCard } from "../../components/ui/KpiCard";
import {
  SkeletonRow,
  SkeletonChart,
  EmptyState,
  ErrorState,
} from "../../components/dashboard/DashboardStates";
import type {
  Gym,
  GymMembershipContract,
  GymMembershipContractStatus,
} from "../../types";

type Collaboration = { id: string; gymId: string; ptUserId: string; status: string };

const STAGGER_DELAYS = ["", "delay-75", "delay-150", "delay-200"] as const;

const chartTooltipStyle = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid #27272a",
  backgroundColor: "#111111",
  color: "#f4f4f5",
} as const;

const chartLegendStyle = { fontSize: 11, color: "#71717a" } as const;

const MEMBERSHIP_STATUS_LABEL: Record<GymMembershipContractStatus, string> = {
  ACTIVE: "Đang hoạt động",
  PENDING_PAYMENT: "Chờ thanh toán",
  EXPIRED: "Hết hạn",
  CANCELLED: "Đã huỷ",
};

const MEMBERSHIP_STATUS_BADGE: Record<GymMembershipContractStatus, string> = {
  ACTIVE: "bg-green-500/10 text-green-400",
  PENDING_PAYMENT: "bg-amber-500/10 text-amber-400",
  EXPIRED: "bg-zinc-700/50 text-zinc-400",
  CANCELLED: "bg-zinc-700/50 text-zinc-400",
};

const MEMBERSHIP_PIE_COLORS: Record<GymMembershipContractStatus, string> = {
  ACTIVE: "#22c55e",
  PENDING_PAYMENT: "#f59e0b",
  EXPIRED: "#71717a",
  CANCELLED: "#3f3f46",
};

function shortenClientId(clientId: string): string {
  return `Khách #${clientId.slice(0, 8)}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function buildCheckinTrend(checkins: { createdAt: string }[]): { day: string; count: number }[] {
  const today = new Date();
  const days: { day: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const count = checkins.filter((c) => isSameDay(new Date(c.createdAt), date)).length;
    days.push({ day: date.toLocaleDateString("vi-VN", { weekday: "short" }), count });
  }
  return days;
}

function buildMembershipDistribution(memberships: GymMembershipContract[]) {
  const counts: Record<GymMembershipContractStatus, number> = {
    ACTIVE: 0,
    PENDING_PAYMENT: 0,
    EXPIRED: 0,
    CANCELLED: 0,
  };
  for (const m of memberships) counts[m.status] += 1;
  return (Object.keys(counts) as GymMembershipContractStatus[])
    .filter((status) => counts[status] > 0)
    .map((status) => ({
      status,
      label: MEMBERSHIP_STATUS_LABEL[status],
      value: counts[status],
      color: MEMBERSHIP_PIE_COLORS[status],
    }));
}

/** Branches (brand set) grouped under their brand name, everything else flat — mirrors the
 * grouping MyGymsPage uses for the owner's gym list, so the same chain reads the same way
 * in both places. */
function groupGymsByBrand(gyms: Gym[]): { brandName: string | null; gyms: Gym[] }[] {
  const order: string[] = [];
  const byBrand = new Map<string, Gym[]>();
  const standalone: Gym[] = [];
  for (const g of gyms) {
    if (!g.brand) {
      standalone.push(g);
      continue;
    }
    if (!byBrand.has(g.brand.id)) order.push(g.brand.id);
    const list = byBrand.get(g.brand.id) ?? [];
    list.push(g);
    byBrand.set(g.brand.id, list);
  }
  const groups = order.map((brandId) => {
    const branchList = byBrand.get(brandId)!;
    return { brandName: branchList[0].brand!.name, gyms: branchList };
  });
  if (standalone.length > 0) groups.push({ brandName: null, gyms: standalone });
  return groups;
}

function GymSelector({
  gyms,
  selectedGymId,
  onChange,
}: {
  gyms: Gym[];
  selectedGymId: string;
  onChange: (gymId: string) => void;
}) {
  const groups = groupGymsByBrand(gyms);
  return (
    <div className="relative">
      <select
        value={selectedGymId}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Chọn phòng gym"
        className="w-full appearance-none rounded-xl border border-zinc-700/60 bg-zinc-900 py-2.5 pl-4 pr-9 text-sm font-semibold text-zinc-200 outline-none transition-colors focus:border-green-500/50 sm:w-64"
      >
        {groups.map((group) =>
          group.brandName ? (
            <optgroup key={group.brandName} label={group.brandName}>
              {group.gyms.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.address}
                </option>
              ))}
            </optgroup>
          ) : (
            group.gyms.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))
          ),
        )}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
    </div>
  );
}

export function GymOwnerDashboard() {
  const navigate = useNavigate();
  const { user } = useApp();
  const today = new Date().toLocaleDateString("vi-VN", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const [selectedGymId, setSelectedGymId] = useState<string>("");

  const { data: gyms = [], isLoading: gymsLoading } = useQuery<Gym[]>({
    queryKey: ["owned-gyms"],
    queryFn: () => gymService.listOwnedGyms(),
  });

  const activeGymId = selectedGymId || gyms[0]?.id || "";

  const { data: wallet, isLoading: walletLoading } = useQuery({
    queryKey: ["owned-gym-wallet", activeGymId],
    queryFn: () => gymService.getOwnedWallet(activeGymId),
    enabled: !!activeGymId,
  });

  const { data: plans = [], isLoading: plansLoading } = useQuery({
    queryKey: ["owned-gym-plans", activeGymId],
    queryFn: () => gymService.listOwnedPlans(activeGymId),
    enabled: !!activeGymId,
  });

  const {
    data: memberships = [],
    isLoading: membershipsLoading,
    isError: membershipsError,
  } = useQuery<GymMembershipContract[]>({
    queryKey: ["owned-gym-memberships", activeGymId],
    queryFn: () => gymService.listOwnedMemberships(activeGymId),
    enabled: !!activeGymId,
  });

  const {
    data: checkins = [],
    isLoading: checkinsLoading,
    isError: checkinsError,
  } = useQuery<{ id: string; createdAt: string }[]>({
    queryKey: ["owned-gym-checkins", activeGymId],
    queryFn: () => gymService.listCheckins(activeGymId),
    enabled: !!activeGymId,
  });

  const { data: reviews, isLoading: reviewsLoading } = useQuery({
    queryKey: ["owned-gym-reviews", activeGymId],
    queryFn: () => gymService.getGymReviews(activeGymId),
    enabled: !!activeGymId,
  });

  const { data: collaborations = [] } = useQuery<Collaboration[]>({
    queryKey: ["owner-collaborations"],
    queryFn: () => collaborationService.listForOwner(),
  });

  const isInitialLoading = gymsLoading;
  const availableBalance = Number(wallet?.availableBalance ?? 0);
  const activeMembersCount = memberships.filter((m) => m.status === "ACTIVE").length;
  const todaysCheckinsCount = checkins.filter((c) => isSameDay(new Date(c.createdAt), new Date())).length;
  const averageRating = reviews?.averageRating ?? 0;
  const activePlansCount = plans.filter((p) => p.status === "ACTIVE").length;
  const partneredPtCount = collaborations.filter(
    (c) => c.gymId === activeGymId && c.status === "ACCEPTED",
  ).length;

  const kpis = [
    {
      label: "Doanh thu ví Gym",
      value: formatVND(availableBalance),
      change: "Khả dụng",
      icon: WalletIcon,
      color: "text-green-400",
      bg: "bg-green-500/10",
      iconBg: "bg-green-500/15",
      border: "border-green-500/20",
      loading: walletLoading,
    },
    {
      label: "Tổng hội viên Active",
      value: String(activeMembersCount),
      change: "Đang hoạt động",
      icon: Users,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      iconBg: "bg-blue-500/15",
      border: "border-blue-500/20",
      loading: membershipsLoading,
    },
    {
      label: "Lượt Check-in hôm nay",
      value: String(todaysCheckinsCount),
      change: "Hôm nay",
      icon: QrCode,
      color: "text-violet-400",
      bg: "bg-violet-500/10",
      iconBg: "bg-violet-500/15",
      border: "border-violet-500/20",
      loading: checkinsLoading,
    },
    {
      label: "Điểm đánh giá trung bình",
      value: averageRating.toFixed(1),
      change: `${reviews?.count ?? 0} đánh giá`,
      icon: Star,
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      iconBg: "bg-amber-500/15",
      border: "border-amber-500/20",
      loading: reviewsLoading,
    },
  ];

  const membershipDistribution = buildMembershipDistribution(memberships);
  const checkinTrend = buildCheckinTrend(checkins);
  const recentMemberships = [...memberships]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6);

  if (isInitialLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
        <div className="h-16 animate-pulse rounded-xl bg-zinc-900" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-900" />
          ))}
        </div>
      </div>
    );
  }

  if (gyms.length === 0) {
    return (
      <div className="mx-auto max-w-7xl p-4 md:p-6">
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900 p-20 text-center">
          <Building2 className="mx-auto mb-4 h-12 w-12 text-zinc-800" />
          <h3 className="mb-1 font-bold text-zinc-200">Chưa có phòng gym nào</h3>
          <p className="mb-6 text-sm text-zinc-500">Tạo phòng gym đầu tiên để bắt đầu bán gói hội viên.</p>
          <button
            onClick={() => navigate("/gym-owner/gyms")}
            className="inline-flex items-center gap-2 rounded-xl bg-green-500 px-4 py-2.5 text-sm font-bold text-black transition-[transform,background-color] active:scale-[0.98] hover:bg-green-400"
          >
            <Plus className="h-4 w-4" /> Tạo Gym mới
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-zinc-100">Xin chào, {user?.firstName || "Chủ phòng gym"}</h1>
          <p className="mt-0.5 text-sm text-zinc-500">{today}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <GymSelector gyms={gyms} selectedGymId={activeGymId} onChange={setSelectedGymId} />
          <div className="flex gap-2">
            <button
              onClick={() => navigate(`/gym-owner/gyms/${activeGymId}`)}
              className="flex items-center gap-2 rounded-xl border border-zinc-700/60 bg-zinc-900 px-4 py-2.5 text-sm font-bold text-zinc-200 transition-[transform,border-color] active:scale-[0.98] hover:border-zinc-600"
            >
              <Settings className="h-4 w-4" /> Quản lý Gym
            </button>
            <button
              onClick={() => navigate("/gym-owner/gyms")}
              className="flex items-center gap-2 rounded-xl bg-green-500 px-4 py-2.5 text-sm font-bold text-black shadow-lg shadow-green-500/20 transition-[transform,background-color] active:scale-[0.98] hover:bg-green-400"
            >
              <Plus className="h-4 w-4" /> Tạo Gym mới
            </button>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k, i) => (
          <KpiCard key={k.label} {...k} animationDelayClass={STAGGER_DELAYS[i]} />
        ))}
      </div>

      {/* Charts — asymmetric 2fr/3fr split, mirrored from the PT dashboard's 3fr/2fr for variety */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-500 delay-150 fill-mode-both rounded-xl border border-zinc-800/60 bg-zinc-900 p-4 lg:col-span-2">
          <h4 className="mb-3 text-sm font-bold text-zinc-200">Phân bổ hội viên</h4>
          {membershipsLoading ? (
            <SkeletonChart />
          ) : membershipsError ? (
            <ErrorState message="Không tải được dữ liệu hội viên. Thử tải lại trang." />
          ) : membershipDistribution.length === 0 ? (
            <EmptyState icon={UsersRound} title="Chưa có hội viên" hint="Hội viên xuất hiện sau khi có người mua gói." />
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie
                  data={membershipDistribution}
                  dataKey="value"
                  nameKey="label"
                  innerRadius={35}
                  outerRadius={55}
                  paddingAngle={2}
                >
                  {membershipDistribution.map((entry) => (
                    <Cell key={entry.status} fill={entry.color} stroke="none" />
                  ))}
                </Pie>
                <Tooltip contentStyle={chartTooltipStyle} />
                <Legend
                  wrapperStyle={chartLegendStyle}
                  formatter={(value: string) => <span className="text-zinc-400">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-500 delay-200 fill-mode-both rounded-xl border border-zinc-800/60 bg-zinc-900 p-4 lg:col-span-3">
          <h4 className="mb-3 text-sm font-bold text-zinc-200">Lượt Check-in 7 ngày qua</h4>
          {checkinsLoading ? (
            <SkeletonChart />
          ) : checkinsError ? (
            <ErrorState message="Không tải được dữ liệu check-in. Thử tải lại trang." />
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={checkinTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Bar dataKey="count" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Recent memberships */}
        <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-500 delay-300 fill-mode-both rounded-xl border border-zinc-800/60 bg-zinc-900 lg:col-span-2">
          <div className="flex items-center justify-between border-b border-zinc-800/60 px-4 py-3">
            <h4 className="text-sm font-bold text-zinc-200">Hội viên gần đây</h4>
            <button
              onClick={() => navigate(`/gym-owner/gyms/${activeGymId}`)}
              className="text-xs text-green-400 transition-colors hover:text-green-300"
            >
              Xem tất cả
            </button>
          </div>
          {membershipsLoading ? (
            <div className="divide-y divide-zinc-800/40">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : recentMemberships.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              title="Chưa có hội viên nào"
              hint="Danh sách sẽ hiện ở đây khi có người mua gói hội viên."
            />
          ) : (
            <div className="divide-y divide-zinc-800/40">
              {recentMemberships.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-zinc-800/30"
                >
                  <div>
                    <div className="text-sm font-bold text-zinc-200">{shortenClientId(m.clientId)}</div>
                    <div className="text-xs text-zinc-600">
                      {m.usedVisits} / {m.totalVisits ?? "∞"} lượt dùng
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-zinc-400">
                      {formatVND(Number(m.priceAtPurchase))}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${MEMBERSHIP_STATUS_BADGE[m.status]}`}>
                      {MEMBERSHIP_STATUS_LABEL[m.status]}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick info */}
        <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-500 delay-300 fill-mode-both rounded-xl border border-zinc-800/60 bg-zinc-900">
          <div className="flex items-center gap-2 border-b border-zinc-800/60 px-4 py-3">
            <ClipboardList className="h-4 w-4 text-green-400" />
            <h4 className="text-sm font-bold text-zinc-200">Thông tin nhanh</h4>
          </div>
          <div className="divide-y divide-zinc-800/40">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-xs text-zinc-400">Gói hội viên đang bán</span>
              <span className="text-sm font-bold text-zinc-200">{activePlansCount}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-xs text-zinc-400">PT đang hợp tác</span>
              <span className="text-sm font-bold text-zinc-200">{partneredPtCount}</span>
            </div>
            <div className="px-4 py-3">
              <button
                onClick={() => navigate(`/gym-owner/gyms/${activeGymId}`)}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700/60 py-2 text-xs font-semibold text-zinc-300 transition-[transform,background-color] active:scale-[0.98] hover:bg-zinc-800"
              >
                <UserCheck className="h-3.5 w-3.5" /> Xem chi tiết phòng gym
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
