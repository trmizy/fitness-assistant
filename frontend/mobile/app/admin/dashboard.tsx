import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CalendarCheck,
  ChevronRight,
  CircleCheck,
  CircleX,
  FileText,
  ScanLine,
  TriangleAlert,
  UserCheck,
  Users,
  Wallet as WalletIcon,
  type LucideIcon,
} from "lucide-react-native";

import { Badge, Button, Card, CountUp, Stagger, StaggerItem, Tappable } from "../../src/components/ui";
import { adminPartnerApplications, adminService } from "../../src/services/api";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { darkColors, designTokens } from "../../src/theme/colors";
import { formatVND } from "../../src/utils/currency";
import {
  dashboardData,
  dashboardKpis,
  healthSummary,
  moneyHeadline,
  ocrStats,
  recentUsers,
  roleBreakdown,
  systemAlerts,
  unclassifiedUsers,
  userGrowth,
} from "../../src/features/admin/adminDashboard";
import { queueTotal, withdrawalRows } from "../../src/features/admin/adminWithdrawals";
import { applicationCounts } from "../../src/features/adminApplications/adminApplications";

function Metric({
  icon: Icon,
  label,
  value,
  hint,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  hint?: string;
  onPress?: () => void;
}) {
  const accent = useWorkspaceAccent();
  const body = (
    <Card className="gap-2 p-4">
      <View className="h-9 w-9 items-center justify-center rounded-xl bg-primary/15">
        <Icon size={17} color={accent.primary} />
      </View>
      <CountUp to={value} locale="vi-VN" className="font-display text-2xl text-foreground" />
      <Text className="font-body text-xs text-muted-foreground">{label}</Text>
      {hint ? <Text className="font-body text-[11px] text-warning">{hint}</Text> : null}
    </Card>
  );
  return onPress ? (
    <Tappable accessibilityLabel={label} onPress={onPress} className="min-w-[46%] flex-1">
      {body}
    </Tappable>
  ) : (
    <View className="min-w-[46%] flex-1">{body}</View>
  );
}

/**
 * AD-01 "Tổng quan" — màn đầu của quản trị viên: tiền có cân không, việc gì đang chờ mình, hệ thống
 * có đang hỏng chỗ nào không. Số liệu từ `GET /admin/dashboard` (gateway tổng hợp); phần thuần và hai
 * chỗ lệch web có chủ ý ở `features/admin/adminDashboard.ts`.
 *
 * Thêm so với web: hàng "việc đang chờ" (hồ sơ đối tác, rút tiền) dẫn thẳng vào hàng chờ tương ứng —
 * trên điện thoại, tổng quan là nơi bắt đầu công việc chứ không phải bảng số để ngắm.
 */
export default function AdminDashboardScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();

  const query = useQuery({ queryKey: ["admin-dashboard"], queryFn: () => adminService.getDashboard() });
  const withdrawalsQuery = useQuery({
    queryKey: ["admin-withdrawals"],
    queryFn: () => adminService.listPendingWithdrawals(),
  });
  const applicationsQuery = useQuery({
    queryKey: ["admin-partner-applications", "IN_REVIEW"],
    queryFn: () => adminPartnerApplications.list("IN_REVIEW"),
  });

  const d = dashboardData(query.data);
  const kpis = dashboardKpis(d);
  const moneyInfo = moneyHeadline(d);
  const health = healthSummary(d);
  const alerts = systemAlerts(d);
  const growth = userGrowth(d);
  const growthMax = Math.max(1, ...growth.map((g) => g.users));
  const roles = roleBreakdown(d);
  const unclassified = unclassifiedUsers(d);
  const ocr = ocrStats(d);
  const recent = recentUsers(d).slice(0, 5);

  const withdrawals = withdrawalRows(withdrawalsQuery.data);
  const applicationsWaiting = applicationCounts(applicationsQuery.data).IN_REVIEW ?? 0;

  const refresh = () => {
    void query.refetch();
    void withdrawalsQuery.refetch();
    void applicationsQuery.refetch();
  };

  const today = new Date().toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={refresh}
            tintColor={accent.primary}
            colors={[accent.primary]}
          />
        }
      >
        <View className="flex-row items-start justify-between gap-3 px-5">
          <View className="min-w-0 flex-1">
            <Text className="font-display text-xl text-foreground">Tổng quan</Text>
            <Text className="mt-0.5 font-body text-xs capitalize text-muted-foreground">{today}</Text>
          </View>
          {health ? <Badge tone={health.tone}>{health.label}</Badge> : null}
        </View>

        {query.isLoading ? (
          <ActivityIndicator className="mt-10" color={accent.primary} />
        ) : query.isError ? (
          <Card className="mx-5 mt-5 items-center gap-3 p-6">
            <Text className="text-center font-body text-sm text-destructive">Không tải được số liệu hệ thống.</Text>
            <Button variant="secondary" onPress={refresh}>
              Thử lại
            </Button>
          </Card>
        ) : (
          <Stagger className="gap-3 px-5 pt-5">
            {/* Việc đang chờ — thứ quản trị viên cần làm, không phải chỉ cần biết. */}
            {applicationsWaiting > 0 || withdrawals.length > 0 ? (
              <StaggerItem>
                <Card className="overflow-hidden p-0">
                  {applicationsWaiting > 0 ? (
                    <Tappable
                      accessibilityLabel="Hồ sơ đối tác chờ duyệt"
                      onPress={() => router.push("/admin/applications")}
                      className="flex-row items-center gap-3 p-4"
                    >
                      <TriangleAlert size={17} color={designTokens.warning} />
                      <Text className="flex-1 font-body-semibold text-sm text-foreground">
                        {applicationsWaiting} hồ sơ đối tác chờ duyệt
                      </Text>
                      <ChevronRight size={16} color={designTokens.mutedForeground} />
                    </Tappable>
                  ) : null}
                  {withdrawals.length > 0 ? (
                    <Tappable
                      accessibilityLabel="Yêu cầu rút tiền đang chờ"
                      onPress={() => router.push("/admin/withdrawals")}
                      className={`flex-row items-center gap-3 p-4 ${applicationsWaiting > 0 ? "border-t border-border" : ""}`}
                    >
                      <WalletIcon size={17} color={designTokens.warning} />
                      <Text className="flex-1 font-body-semibold text-sm text-foreground">
                        {withdrawals.length} yêu cầu rút tiền · {formatVND(queueTotal(withdrawals))}
                      </Text>
                      <ChevronRight size={16} color={designTokens.mutedForeground} />
                    </Tappable>
                  ) : null}
                </Card>
              </StaggerItem>
            ) : null}

            {moneyInfo ? (
              <StaggerItem>
                <Card
                  className={`gap-3 p-5 ${
                    moneyInfo.balanced === false ? "border-destructive/40 bg-destructive/5" : ""
                  }`}
                >
                  <View className="flex-row items-center gap-1.5">
                    <WalletIcon size={15} color={designTokens.mutedForeground} />
                    <Text className="font-body text-sm text-muted-foreground">Tiền nền tảng đang giữ hộ</Text>
                  </View>
                  <CountUp to={moneyInfo.escrow} suffix=" ₫" locale="vi-VN" className="font-display text-3xl text-foreground" />
                  <View className="flex-row items-center justify-between gap-3">
                    <View>
                      <Text className="font-body text-xs text-muted-foreground">Doanh thu nền tảng</Text>
                      <Text className="font-body-semibold text-sm text-foreground">{formatVND(moneyInfo.platformRevenue)}</Text>
                    </View>
                    {moneyInfo.balanced === true ? (
                      <View className="flex-row items-center gap-1.5">
                        <CircleCheck size={14} color={accent.primary} />
                        <Text className="font-body-semibold text-xs text-primary">Sổ sách cân bằng</Text>
                      </View>
                    ) : moneyInfo.balanced === false ? (
                      <View className="flex-row items-center gap-1.5">
                        <CircleX size={14} color={darkColors.destructive} />
                        <Text className="font-body-semibold text-xs text-destructive">Sổ sách đang lệch</Text>
                      </View>
                    ) : (
                      <Text className="font-body text-xs text-muted-foreground">Chưa có số đối soát</Text>
                    )}
                  </View>
                </Card>
              </StaggerItem>
            ) : null}

            <StaggerItem>
              <View className="flex-row flex-wrap gap-3">
                <Metric icon={Users} label="Người dùng" value={kpis.totalUsers} onPress={() => router.push("/admin/users")} />
                <Metric
                  icon={UserCheck}
                  label="Huấn luyện viên đã duyệt"
                  value={kpis.verifiedPTs}
                  hint={kpis.pendingPT > 0 ? `${kpis.pendingPT} đơn chờ duyệt` : undefined}
                />
                <Metric icon={FileText} label="Hợp đồng đang hiệu lực" value={kpis.activeContracts} />
                <Metric icon={CalendarCheck} label="Buổi tập hôm nay" value={kpis.sessionsToday} />
              </View>
            </StaggerItem>

            {alerts.length > 0 ? (
              <StaggerItem>
                <Card className="overflow-hidden p-0">
                  <View className="flex-row items-center gap-2 border-b border-border p-4">
                    <Activity size={15} color={designTokens.warning} />
                    <Text className="font-body-semibold text-sm text-foreground">Cảnh báo hệ thống</Text>
                  </View>
                  {alerts.map((a, i) => (
                    <View key={i} className={`gap-1 p-4 ${i > 0 ? "border-t border-border" : ""}`}>
                      <View className="flex-row items-center justify-between gap-2">
                        <Text className="min-w-0 flex-1 font-body-semibold text-xs text-foreground" numberOfLines={1}>
                          {a.service}
                        </Text>
                        <Badge tone={a.tone}>{a.tone === "danger" ? "Lỗi" : a.tone === "warning" ? "Cảnh báo" : "Thông tin"}</Badge>
                      </View>
                      <Text className="font-body text-xs text-muted-foreground" selectable>
                        {a.message}
                      </Text>
                      {a.time ? <Text className="font-body text-[10px] text-muted-foreground">{a.time}</Text> : null}
                    </View>
                  ))}
                </Card>
              </StaggerItem>
            ) : null}

            {growth.length > 0 ? (
              <StaggerItem>
                <Card className="gap-3 p-4">
                  <Text className="font-body-semibold text-sm text-foreground">Tăng trưởng người dùng</Text>
                  <View className="h-32 flex-row items-end gap-2">
                    {growth.map((g, i) => (
                      <View key={i} className="flex-1 items-center gap-1.5">
                        <Text className="font-body text-[10px] text-muted-foreground">{g.users}</Text>
                        <View
                          className="w-full rounded-t-md bg-primary"
                          style={{ height: Math.max(3, Math.round((g.users / growthMax) * 84)) }}
                        />
                        <Text className="font-body text-[10px] text-muted-foreground">{g.label}</Text>
                      </View>
                    ))}
                  </View>
                </Card>
              </StaggerItem>
            ) : null}

            {roles.length > 0 ? (
              <StaggerItem>
                <Card className="gap-2.5 p-4">
                  <Text className="font-body-semibold text-sm text-foreground">Phân bổ vai trò</Text>
                  {[...roles, ...(unclassified > 0 ? [{ label: "Chưa phân loại", value: unclassified }] : [])].map((r) => (
                    <View key={r.label} className="gap-1">
                      <View className="flex-row justify-between">
                        <Text className="font-body text-xs text-muted-foreground">{r.label}</Text>
                        <Text className="font-body-semibold text-xs text-foreground">{r.value.toLocaleString("vi-VN")}</Text>
                      </View>
                      <View className="h-1.5 overflow-hidden rounded-full bg-panel">
                        <View
                          className={`h-full rounded-full ${r.label === "Chưa phân loại" ? "bg-muted-foreground" : "bg-primary"}`}
                          style={{ width: `${Math.round((r.value / Math.max(1, kpis.totalUsers)) * 100)}%` }}
                        />
                      </View>
                    </View>
                  ))}
                  {unclassified > 0 ? (
                    <Text className="font-body text-[11px] leading-4 text-muted-foreground">
                      “Chưa phân loại” là phần máy chủ chưa tách theo vai trò (chủ phòng gym, quản trị viên).
                    </Text>
                  ) : null}
                </Card>
              </StaggerItem>
            ) : null}

            {ocr ? (
              <StaggerItem>
                <Card className="gap-3 p-4">
                  <View className="flex-row items-center gap-2">
                    <ScanLine size={15} color={designTokens.mutedForeground} />
                    <Text className="font-body-semibold text-sm text-foreground">Quét InBody (7 ngày)</Text>
                  </View>
                  <View className="flex-row justify-between">
                    {[
                      { label: "Tổng lượt", value: ocr.total },
                      { label: "AI đọc được", value: ocr.extracted },
                      { label: "Nhập tay", value: ocr.manual },
                      { label: "Đang xử lý", value: ocr.pending },
                    ].map((s) => (
                      <View key={s.label} className="items-center">
                        <Text className="font-display text-lg text-foreground">{s.value}</Text>
                        <Text className="font-body text-[10px] text-muted-foreground">{s.label}</Text>
                      </View>
                    ))}
                  </View>
                </Card>
              </StaggerItem>
            ) : null}

            {recent.length > 0 ? (
              <StaggerItem>
                <Card className="overflow-hidden p-0">
                  <View className="flex-row items-center justify-between border-b border-border p-4">
                    <Text textBreakStrategy="simple" className="flex-1 font-body-semibold text-sm text-foreground">
                      Đăng ký gần đây
                    </Text>
                    <Tappable accessibilityLabel="Xem tất cả người dùng" hitSlop={8} onPress={() => router.push("/admin/users")}>
                      <Text className="font-body-semibold text-xs text-primary">Xem tất cả</Text>
                    </Tappable>
                  </View>
                  {recent.map((u, i) => (
                    <View key={`${u.email}-${i}`} className={`flex-row items-center gap-3 p-4 ${i > 0 ? "border-t border-border" : ""}`}>
                      <View className="min-w-0 flex-1">
                        <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                          {u.name}
                        </Text>
                        <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                          {u.email} · {u.joined}
                        </Text>
                      </View>
                      <Badge tone={u.active ? "neutral" : "warning"}>{u.role}</Badge>
                    </View>
                  ))}
                </Card>
              </StaggerItem>
            ) : null}
          </Stagger>
        )}
      </ScrollView>
    </View>
  );
}
