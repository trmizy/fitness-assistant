import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback } from "react";
import { router, useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  BellRing,
  Brain,
  CalendarDays,
  ChevronRight,
  Clock,
  FileSignature,
  Package,
  Sparkles,
  TrendingUp,
  Users,
  Wallet as WalletIcon,
} from "lucide-react-native";

import {
  Avatar,
  Badge,
  Card,
  CountUp,
  EmptyState,
  Stagger,
  StaggerItem,
  Tappable,
} from "../../src/components/ui";
import { contractService, personalizedServiceApi, ptPlanReviewService, sessionService, walletService } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { designTokens } from "../../src/theme/colors";
import { formatVND } from "../../src/utils/currency";
import { money } from "../../src/features/wallet/wallet";
import {
  DAY_LABELS,
  clientName,
  liveSessionCount,
  mondayOf,
  sellerNeedsAction,
  ptAlerts,
  ptSessionStatus,
  relativeDayLabel,
  sessionTimeLabel,
  sessionsOf,
  studentsFromContracts,
  weekSessionCounts,
} from "../../src/features/pt/pt";

/**
 * PT-01 — "Tổng quan". Visual: the design's PTDashboard (workspace switch in the header, a hero
 * money card with a count-up and a three-cell mini-stat row, action tiles, "Buổi sắp tới", "Học
 * viên mới"). Behaviour and numbers: web's PTDashboard — the same five reads.
 *
 * One honest deviation from both: the hero is the PT WALLET's available balance, not web's
 * "Tổng thu nhập". `/contracts/pt/earnings` sums the PRICE of completed contracts, which is gross
 * contract value before the platform's commission and before any session has settled — it is not
 * money the trainer has. payment-service's wallet is the only authority for that, so it takes the
 * hero and the contract figure keeps its real name below.
 *
 * The design's "Thu nhập tháng 9" is not drawn: no endpoint returns a per-month figure and
 * inventing one from contract dates would be a second, drifting source of truth.
 *
 * 14B.7 (PG-C6) — web's two charts: "Tổng quan doanh thu" (completed vs running contract value, the
 * same two `/contracts/pt/earnings` figures, labelled as pre-commission) and "Buổi tập tuần này"
 * (sessions per weekday from the upcoming list, so days already past read 0 — as on web). Web's
 * "Cảnh báo học viên" was already here as "Cần bạn xử lý" (a superset: it also lists sessions to confirm).
 */
export default function PtDashboardScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const { user, setActiveView } = useApp();
  const uid = user?.id ?? "guest";

  const walletQuery = useQuery({ queryKey: ["pt-wallet", uid], queryFn: () => walletService.getPtWallet() });
  const earningsQuery = useQuery({ queryKey: ["pt-earnings", uid], queryFn: () => contractService.getEarnings() });
  const contractsQuery = useQuery({ queryKey: ["pt-contracts", uid], queryFn: () => contractService.getByPT() });
  const sessionsQuery = useQuery({ queryKey: ["pt-sessions-upcoming", uid], queryFn: () => sessionService.getMyUpcoming() });
  const plansQuery = useQuery({ queryKey: ["pt-pending-plans", uid], queryFn: () => ptPlanReviewService.getPendingReviews() });
  const sellingQuery = useQuery({ queryKey: ["pt-selling-orders", uid], queryFn: () => personalizedServiceApi.listOrdersForSeller() });

  // A tab root never remounts, so its counts would stay as they were when the app opened — the
  // "Hợp đồng" tile went on reading "Không có yêu cầu" after a request had arrived (7/10).
  const queryClient = useQueryClient();
  useFocusEffect(
    useCallback(() => {
      for (const name of ["pt-contracts", "pt-sessions-upcoming", "pt-selling-orders"]) {
        void queryClient.refetchQueries({ queryKey: [name, uid], type: "active" }, { cancelRefetch: false });
      }
    }, [queryClient, uid]),
  );

  const available = money((walletQuery.data as any)?.availableBalance);
  const earnings: any = earningsQuery.data ?? {};
  const sessions = sessionsOf(sessionsQuery.data);
  const students = studentsFromContracts(contractsQuery.data);
  const activeStudents = students.filter((s) => s.status === "ACTIVE");
  const newStudents = activeStudents.filter((s) => s.used === 0);
  const pendingContracts = students.filter((s) => s.status === "PENDING_REVIEW").length;
  const sellingNeedsAction = sellerNeedsAction(sellingQuery.data).length;
  const pendingPlans = Array.isArray(plansQuery.data) ? plansQuery.data.length : 0;
  const alerts = ptAlerts(contractsQuery.data, sessions);

  const weekCounts = weekSessionCounts(sessions, mondayOf(new Date()));
  const weekMax = Math.max(1, ...weekCounts);
  const todayIndex = (new Date().getDay() + 6) % 7;
  const completedValue = Number(earnings.totalEarned ?? 0);
  const activeValue = Number(earnings.activeRevenue ?? 0);
  const revenueMax = Math.max(completedValue, activeValue, 1);

  const upcoming = [...sessions]
    .filter((s) => s.status === "REQUESTED" || s.status === "CONFIRMED")
    .sort((a, b) => a.scheduledStartAt.localeCompare(b.scheduledStartAt))
    .slice(0, 5);

  const refreshing =
    walletQuery.isRefetching || earningsQuery.isRefetching || contractsQuery.isRefetching || sessionsQuery.isRefetching;
  const refresh = () => {
    void walletQuery.refetch();
    void earningsQuery.refetch();
    void contractsQuery.refetch();
    void sessionsQuery.refetch();
    void plansQuery.refetch();
  };

  const toClientSpace = () => {
    setActiveView("client");
    router.replace("/client/dashboard");
  };

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={accent.primary} colors={[accent.primary]} />}
      >
        {/* Header + workspace switch */}
        <View className="flex-row items-center gap-3 px-5">
          <Avatar name={user?.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : "PT"} size={44} />
          <View className="min-w-0 flex-1">
            <Text className="font-body text-xs text-muted-foreground">Không gian Huấn luyện viên</Text>
            <Text className="font-display text-lg text-foreground" numberOfLines={1}>
              {user?.firstName ? `PT ${user.firstName}` : "Huấn luyện viên"}
            </Text>
          </View>
          <Tappable
            accessibilityLabel="Về không gian cá nhân"
            onPress={toClientSpace}
            className="flex-row items-center gap-1.5 rounded-full border border-border bg-panel px-3 py-2"
          >
            <ArrowLeftRight size={14} color={accent.primary} />
            <Text className="font-body-semibold text-xs text-foreground">Cá nhân</Text>
          </Tappable>
        </View>

        <Stagger className="gap-5 px-5 pt-5">
          {/* Money hero */}
          <StaggerItem>
            <Card className="overflow-hidden p-5">
              <View className="absolute -right-8 -top-10 h-40 w-40 rounded-full bg-primary/15" />
              <View className="flex-row items-center gap-1.5">
                <WalletIcon size={15} color={designTokens.mutedForeground} />
                <Text className="font-body text-sm text-muted-foreground">Số dư khả dụng</Text>
              </View>
              {walletQuery.isLoading ? (
                <ActivityIndicator className="mt-3 self-start" color={accent.primary} />
              ) : walletQuery.isError ? (
                <Text className="mt-2 font-body text-sm text-destructive">Không tải được ví. Kéo xuống để thử lại.</Text>
              ) : (
                <CountUp to={available} suffix=" ₫" locale="vi-VN" className="mt-1 font-display text-4xl text-foreground" />
              )}
              <View className="mt-4 flex-row divide-x divide-border rounded-xl bg-panel py-3">
                <MiniStat value={liveSessionCount(sessions)} label="Buổi sắp tới" />
                <MiniStat value={activeStudents.length} label="Học viên" />
                <MiniStat value={Number(earnings.completedContracts ?? 0)} label="HĐ hoàn thành" />
              </View>
            </Card>
          </StaggerItem>

          {/* 14B.7 (PG-C6) — web "Tổng quan doanh thu" + "Buổi tập tuần này". */}
          <StaggerItem>
            <Card className="gap-4 p-4">
              <View className="flex-row items-center gap-2">
                <TrendingUp size={16} color={accent.primary} />
                <Text className="font-display text-base text-foreground">Tổng quan doanh thu</Text>
              </View>
              {earningsQuery.isLoading ? (
                <ActivityIndicator color={accent.primary} />
              ) : earningsQuery.isError ? (
                <Text className="font-body text-sm text-destructive">Không tải được doanh thu. Kéo xuống để thử lại.</Text>
              ) : (
                <View className="gap-3">
                  <RevenueBar label="Đã hoàn thành" value={completedValue} max={revenueMax} color={accent.primary} />
                  <RevenueBar label="Đang hoạt động" value={activeValue} max={revenueMax} color={accent.chart2} />
                  <Text className="font-body text-[11px] text-muted-foreground">
                    Giá trị hợp đồng, trước phí nền tảng. Số tiền bạn thực nhận nằm ở ví.
                  </Text>
                </View>
              )}

              <View className="border-t border-border pt-4">
                <View className="mb-3 flex-row items-center justify-between">
                  <Text className="font-body-semibold text-sm text-foreground">Buổi tập tuần này</Text>
                  <Text className="font-body text-xs text-muted-foreground">
                    {`${weekCounts.reduce((a, b) => a + b, 0)} buổi còn lại`}
                  </Text>
                </View>
                {sessionsQuery.isLoading ? (
                  <ActivityIndicator color={accent.primary} />
                ) : (
                  <View className="h-24 flex-row items-end gap-2">
                    {weekCounts.map((n, i) => (
                      <View key={DAY_LABELS[i]} className="flex-1 items-center gap-1.5">
                        <Text className="font-body text-[10px] text-muted-foreground">{n > 0 ? n : ""}</Text>
                        <View className="w-full flex-1 justify-end">
                          <View
                            className={`w-full rounded-md ${n > 0 ? "bg-primary" : "bg-primary/20"}`}
                            style={{ height: `${Math.max((n / weekMax) * 100, 6)}%` }}
                          />
                        </View>
                        <Text
                          className={`font-body text-[11px] ${i === todayIndex ? "text-primary" : "text-muted-foreground"}`}
                        >
                          {DAY_LABELS[i]}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </Card>
          </StaggerItem>

          {/* Quick actions */}
          <StaggerItem>
            <View className="flex-row gap-3">
              <ActionTile
                icon={FileSignature}
                label="Hợp đồng"
                hint={pendingContracts > 0 ? `${pendingContracts} chờ duyệt` : "Không có yêu cầu"}
                badge={pendingContracts}
                onPress={() => router.push("/pt/contracts")}
              />
              <ActionTile
                icon={Users}
                label="Học viên"
                hint={`${activeStudents.length} đang tập`}
                onPress={() => router.push("/pt/students")}
              />
              <ActionTile
                icon={CalendarDays}
                label="Lịch dạy"
                hint={`${liveSessionCount(sessions)} buổi tới`}
                onPress={() => router.push("/pt/schedule")}
              />
            </View>
            <View className="mt-3 flex-row gap-3">
              <ActionTile
                icon={Package}
                label="Đơn dịch vụ"
                hint={sellingNeedsAction > 0 ? `${sellingNeedsAction} cần xử lý` : "Đơn 1-1 của bạn"}
                badge={sellingNeedsAction}
                onPress={() => router.push("/pt/service-orders")}
              />
              <ActionTile
                icon={Brain}
                label="Duyệt giáo án"
                hint={pendingPlans > 0 ? `${pendingPlans} chờ duyệt` : "Không có giáo án chờ"}
                badge={pendingPlans}
                onPress={() => router.push("/pt/plan-review")}
              />
            </View>
          </StaggerItem>

          {/* Alerts */}
          {alerts.length > 0 || pendingPlans > 0 ? (
            <StaggerItem>
              <View className="mb-3 flex-row items-center gap-2 px-1">
                <BellRing size={16} color={designTokens.warning} />
                <Text className="font-display text-lg text-foreground">Cần bạn xử lý</Text>
              </View>
              <Card className="overflow-hidden">
                {pendingPlans > 0 ? (
                  <Tappable
                    accessibilityLabel={`${pendingPlans} giáo án AI đang chờ bạn duyệt`}
                    onPress={() => router.push("/pt/plan-review")}
                    className="flex-row items-center gap-2.5 p-4"
                  >
                    <Brain size={16} color={accent.primary} />
                    <Text className="flex-1 font-body text-sm text-muted-foreground">
                      {pendingPlans} giáo án AI đang chờ bạn duyệt
                    </Text>
                    <ChevronRight size={16} color={designTokens.mutedForeground} />
                  </Tappable>
                ) : null}
                {alerts.map((a, i) => (
                  <Tappable
                    key={a.key}
                    accessibilityLabel={a.text}
                    onPress={() => a.route && router.push(a.route as never)}
                    className={`flex-row items-center gap-2.5 p-4 ${i > 0 || pendingPlans > 0 ? "border-t border-border" : ""}`}
                  >
                    <FileSignature size={16} color={a.tone === "warning" ? designTokens.warning : designTokens.mutedForeground} />
                    <Text className="flex-1 font-body text-sm text-muted-foreground">{a.text}</Text>
                    <ChevronRight size={16} color={designTokens.mutedForeground} />
                  </Tappable>
                ))}
              </Card>
            </StaggerItem>
          ) : null}

          {/* Upcoming sessions */}
          <StaggerItem>
            <View className="mb-3 flex-row items-center justify-between px-1">
              <Text className="font-display text-lg text-foreground">Buổi sắp tới</Text>
              <View className="flex-row items-center gap-1">
                <Clock size={14} color={designTokens.mutedForeground} />
                <Text className="font-body text-sm text-muted-foreground">{upcoming.length}</Text>
              </View>
            </View>
            {sessionsQuery.isLoading ? (
              <ActivityIndicator color={accent.primary} />
            ) : sessionsQuery.isError ? (
              <Text className="font-body text-sm text-destructive">Không tải được lịch dạy. Kéo xuống để thử lại.</Text>
            ) : upcoming.length === 0 ? (
              <EmptyState
                icon={CalendarDays}
                title="Chưa có buổi nào sắp tới"
                description="Buổi tập mới sẽ hiện ở đây khi học viên đặt lịch."
              />
            ) : (
              <Card className="overflow-hidden">
                {upcoming.map((s, i) => {
                  const st = ptSessionStatus(s.status);
                  return (
                    <Tappable
                      key={s.id}
                      accessibilityLabel={`Buổi với ${clientName(s)}`}
                      onPress={() => router.push("/pt/schedule")}
                      className={`flex-row items-center gap-3 p-4 ${i > 0 ? "border-t border-border" : ""}`}
                    >
                      <Avatar name={clientName(s)} size={40} />
                      <View className="min-w-0 flex-1">
                        <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                          {clientName(s)}
                        </Text>
                        <Text className="font-body text-xs text-muted-foreground">
                          {relativeDayLabel(s.scheduledStartAt)} · {sessionTimeLabel(s.scheduledStartAt)}
                        </Text>
                      </View>
                      <Badge tone={st.tone === "neutral" ? "info" : st.tone}>{st.label}</Badge>
                    </Tappable>
                  );
                })}
              </Card>
            )}
          </StaggerItem>

          {/* Students who have not trained yet */}
          {newStudents.length > 0 ? (
            <StaggerItem>
              <View className="mb-3 flex-row items-center gap-2 px-1">
                <Sparkles size={16} color={accent.primary} />
                <Text className="font-display text-lg text-foreground">Học viên mới</Text>
              </View>
              <Card className="overflow-hidden">
                {newStudents.slice(0, 5).map((s, i) => (
                  <Tappable
                    key={s.contractId}
                    accessibilityLabel={s.name}
                    onPress={() => router.push(`/pt/students/${s.contractId}` as never)}
                    className={`flex-row items-center gap-3 p-4 ${i > 0 ? "border-t border-border" : ""}`}
                  >
                    <Avatar name={s.name} size={40} />
                    <View className="min-w-0 flex-1">
                      <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                        {s.name}
                      </Text>
                      <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                        {s.packageName} · chưa tập buổi nào
                      </Text>
                    </View>
                    <ChevronRight size={16} color={designTokens.mutedForeground} />
                  </Tappable>
                ))}
              </Card>
            </StaggerItem>
          ) : null}
        </Stagger>
      </ScrollView>
    </View>
  );
}

function RevenueBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <View className="gap-1">
      <View className="flex-row items-center justify-between">
        <Text className="font-body text-xs text-muted-foreground">{label}</Text>
        <Text className="font-body-semibold text-xs text-foreground">{formatVND(value)}</Text>
      </View>
      <View className="h-2.5 overflow-hidden rounded-full bg-panel">
        <View className="h-full rounded-full" style={{ width: `${(value / max) * 100}%`, backgroundColor: color }} />
      </View>
    </View>
  );
}

function MiniStat({ value, label }: { value: number; label: string }) {
  return (
    <View className="flex-1 items-center">
      <CountUp to={value} className="font-display text-lg text-foreground" />
      <Text className="font-body text-[11px] text-muted-foreground">{label}</Text>
    </View>
  );
}

function ActionTile({
  icon: Icon,
  label,
  hint,
  badge,
  onPress,
}: {
  icon: typeof Users;
  label: string;
  hint: string;
  badge?: number;
  onPress: () => void;
}) {
  const accent = useWorkspaceAccent();
  return (
    <Card className="flex-1 p-3.5" onPress={onPress}>
      {badge ? (
        <View className="absolute right-2.5 top-2.5 h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5">
          <Text className="font-body-semibold text-[11px] text-on-primary">{badge}</Text>
        </View>
      ) : null}
      <View className="h-9 w-9 items-center justify-center rounded-xl bg-primary/15">
        <Icon size={18} color={accent.primary} />
      </View>
      <Text className="mt-2.5 font-body-semibold text-sm text-foreground" numberOfLines={1}>
        {label}
      </Text>
      <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
        {hint}
      </Text>
    </Card>
  );
}
