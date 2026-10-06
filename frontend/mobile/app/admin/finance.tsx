import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Banknote, ChevronRight, CircleCheck, CircleX, HandCoins, TrendingDown, TrendingUp, Coins } from "lucide-react-native";

import { Button, Card, Input, ScreenHeader, Segmented, Tappable, inputPlaceholderColor } from "../../src/components/ui";
import { adminService } from "../../src/services/api";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { darkColors, designTokens } from "../../src/theme/colors";
import { formatVND } from "../../src/utils/currency";
import {
  GROUP_LABEL,
  bucketLabel,
  compactVND,
  customFinanceRange,
  financeRange,
  financeReport,
  ownerTypeLabel,
  reconciliation,
  toYmd,
  type GroupBy,
} from "../../src/features/admin/adminPartners";

const TABS = ["Tổng quan", "Đối soát"] as const;
const GROUPS = Object.keys(GROUP_LABEL) as GroupBy[];

/**
 * 14B.8 (PG-D2) — web AdminFinancePage. "Tổng quan" = income / expense / platform net revenue per
 * day/week/month/quarter over a chosen window; "Đối soát" = the whole-platform money invariant
 * (escrow vs. everything owed), refreshed every 30 s like web. Web's other two tabs — withdrawals and
 * 1-1 service refunds — already have their own queues on mobile, so they are links here.
 */
export default function AdminFinanceScreen() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Tổng quan");
  const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/dashboard"));
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Tài chính" onBack={back} />
      <View className="px-5 pt-3">
        <Segmented options={[...TABS]} value={tab} onChange={(v) => setTab(v as typeof tab)} />
      </View>
      {tab === "Tổng quan" ? <Overview /> : <Recon />}
    </View>
  );
}

function Overview() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const [groupBy, setGroupBy] = useState<GroupBy>("day");
  const initial = financeRange("day");
  const [fromText, setFromText] = useState(toYmd(initial.fromDay));
  const [toText, setToText] = useState(toYmd(initial.toDay));
  const [range, setRange] = useState<{ from: string; to: string }>({ from: initial.from, to: initial.to });
  const typed = customFinanceRange(fromText, toText);

  const changeGroup = (g: GroupBy) => {
    const r = financeRange(g);
    setGroupBy(g);
    setFromText(toYmd(r.fromDay));
    setToText(toYmd(r.toDay));
    setRange({ from: r.from, to: r.to });
  };

  const q = useQuery({
    queryKey: ["admin", "finance-overview", groupBy, range.from, range.to],
    queryFn: () => adminService.getFinanceOverview({ groupBy, from: range.from, to: range.to }),
  });
  const report = financeReport(q.data);
  const max = Math.max(1, ...(report?.buckets ?? []).flatMap((b) => [b.income, b.expense, b.netRevenue]));

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32, gap: 14 }}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={accent.primary} colors={[accent.primary]} />}
    >
      <Text className="font-body text-xs leading-5 text-muted-foreground">
        Thu = tiền thanh toán thành công qua cổng (gói hội viên, hợp đồng PT, dịch vụ 1-1…). Chi = tiền đã hoàn + tiền đã chi cho yêu cầu rút. Doanh
        thu ròng = hoa hồng nền tảng thực nhận.
      </Text>
      <Segmented options={GROUPS.map((g) => GROUP_LABEL[g])} value={GROUP_LABEL[groupBy]} onChange={(v) => changeGroup(GROUPS.find((g) => GROUP_LABEL[g] === v)!)} />
      <View className="flex-row items-end gap-2">
        <Input className="flex-1" label="Từ" value={fromText} onChangeText={setFromText} placeholder="YYYY-MM-DD" placeholderTextColor={inputPlaceholderColor} keyboardType="numbers-and-punctuation" />
        <Input className="flex-1" label="Đến" value={toText} onChangeText={setToText} placeholder="YYYY-MM-DD" placeholderTextColor={inputPlaceholderColor} keyboardType="numbers-and-punctuation" />
        <Button size="sm" variant="secondary" disabled={"error" in typed} onPress={() => !("error" in typed) && setRange(typed)}>
          Xem
        </Button>
      </View>
      {"error" in typed ? <Text className="font-body text-xs text-destructive">{typed.error}</Text> : null}

      {q.isLoading ? (
        <ActivityIndicator className="mt-6" color={accent.primary} />
      ) : !report ? (
        <Text className="font-body text-sm text-destructive">Không tải được dữ liệu tài chính.</Text>
      ) : (
        <>
          <View className="gap-2.5">
            <Total icon={TrendingUp} color={accent.primary} label="Tổng thu" value={report.totals.income} />
            <Total icon={TrendingDown} color={darkColors.destructive} label="Tổng chi" value={report.totals.expense} />
            <Total icon={Coins} color={designTokens.warning} label="Doanh thu ròng nền tảng" value={report.totals.netRevenue} />
          </View>

          {report.buckets.length === 0 ? (
            <Card className="p-6">
              <Text className="text-center font-body text-xs text-muted-foreground">Không có giao dịch nào trong khoảng thời gian này.</Text>
            </Card>
          ) : (
            <>
              <Card className="gap-3 p-4">
                <View className="flex-row gap-3">
                  <Legend color={accent.primary} label="Thu" />
                  <Legend color={darkColors.destructive} label="Chi" />
                  <Legend color={designTokens.warning} label="Ròng" />
                  <Text className="ml-auto font-body text-[10px] text-muted-foreground">{`đỉnh ${compactVND(max)}`}</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, alignItems: "flex-end" }}>
                  {report.buckets.map((b) => (
                    <View key={b.period} className="items-center gap-1">
                      <View className="h-28 flex-row items-end gap-0.5">
                        {[
                          [b.income, accent.primary],
                          [b.expense, darkColors.destructive],
                          [b.netRevenue, designTokens.warning],
                        ].map(([v, c], i) => (
                          // Absolute heights: a % height inside the horizontal ScrollView rendered as 0.
                          <View key={i} className="w-2.5 rounded-t" style={{ height: Math.max(Number(v) > 0 ? 3 : 0, Math.round((Number(v) / max) * 104)), backgroundColor: String(c) }} />
                        ))}
                      </View>
                      <Text className="font-body text-[10px] text-muted-foreground">{bucketLabel(b.period, groupBy)}</Text>
                    </View>
                  ))}
                </ScrollView>
              </Card>
              <Card className="overflow-hidden p-0">
                {[...report.buckets].reverse().map((b, i) => (
                  <View key={b.period} className={`gap-1 p-3 ${i > 0 ? "border-t border-border" : ""}`}>
                    <View className="flex-row justify-between">
                      <Text className="font-body-semibold text-xs text-foreground">{bucketLabel(b.period, groupBy)}</Text>
                      <Text className="font-body text-[11px] text-muted-foreground">{`${b.transactionCount} giao dịch`}</Text>
                    </View>
                    <View className="flex-row justify-between">
                      <Text className="font-body text-[11px] text-primary">{`Thu ${formatVND(b.income)}`}</Text>
                      <Text className="font-body text-[11px] text-destructive">{`Chi ${formatVND(b.expense)}`}</Text>
                    </View>
                    <Text className="font-body text-[11px] text-warning">{`Ròng ${formatVND(b.netRevenue)}`}</Text>
                  </View>
                ))}
              </Card>
            </>
          )}
        </>
      )}

      <View className="gap-2 pt-2">
        <LinkRow icon={Banknote} label="Yêu cầu rút tiền" onPress={() => router.push("/admin/withdrawals")} />
        <LinkRow icon={HandCoins} label="Hoàn tiền dịch vụ 1-1 & tranh chấp" onPress={() => router.push("/admin/resolve")} />
      </View>
    </ScrollView>
  );
}

function Total({ icon: Icon, color, label, value }: { icon: typeof Coins; color: string; label: string; value: number }) {
  return (
    <Card className="flex-row items-center gap-3 p-4">
      <View className="h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: `${color}26` }}>
        <Icon size={17} color={color} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="font-body text-xs text-muted-foreground">{label}</Text>
        <Text className="font-display text-lg text-foreground">{formatVND(value)}</Text>
      </View>
    </Card>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View className="flex-row items-center gap-1">
      <View className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <Text className="font-body text-[10px] text-muted-foreground">{label}</Text>
    </View>
  );
}

function LinkRow({ icon: Icon, label, onPress }: { icon: typeof Coins; label: string; onPress: () => void }) {
  const accent = useWorkspaceAccent();
  return (
    <Tappable accessibilityLabel={label} onPress={onPress}>
      <Card className="flex-row items-center gap-3 p-4">
        <Icon size={17} color={accent.primary} />
        <Text className="flex-1 font-body-semibold text-sm text-foreground">{label}</Text>
        <ChevronRight size={16} color={designTokens.mutedForeground} />
      </Card>
    </Tappable>
  );
}

function Recon() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  // Web polls every 30 s; the query only runs while this tab is mounted.
  const q = useQuery({ queryKey: ["admin-reconciliation"], queryFn: () => adminService.getReconciliation(), refetchInterval: 30_000 });
  const r = reconciliation(q.data);
  const b = r?.breakdown;
  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32, gap: 14 }}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={accent.primary} colors={[accent.primary]} />}
    >
      {q.isLoading ? (
        <ActivityIndicator className="mt-6" color={accent.primary} />
      ) : !r || !b ? (
        <Text className="font-body text-sm text-destructive">Không tải được dữ liệu đối soát.</Text>
      ) : (
        <>
          <Card className={`gap-3 p-4 ${r.balanced ? "" : "border-destructive/40 bg-destructive/5"}`}>
            <View className="flex-row items-center justify-between">
              <Text className="font-body-semibold text-sm text-foreground">Đối soát toàn nền tảng</Text>
              <View className="flex-row items-center gap-1.5">
                {r.balanced ? <CircleCheck size={14} color={accent.primary} /> : <CircleX size={14} color={darkColors.destructive} />}
                <Text className={`font-body-semibold text-xs ${r.balanced ? "text-primary" : "text-destructive"}`}>{r.balanced ? "Cân bằng" : "Phát hiện lệch"}</Text>
              </View>
            </View>
            <Line label="Tiền giữ hộ (ESCROW)" value={formatVND(r.escrow)} strong />
            <Line label="Tổng các bên nhận quyền lợi" value={formatVND(r.claims)} />
            <Line label="Chênh lệch" value={formatVND(r.drift)} tone={r.drift === 0 ? "good" : "bad"} />
          </Card>
          <Card className="gap-2 p-4">
            <Text className="font-body-semibold text-sm text-foreground">Phân bổ</Text>
            <Line label="Số dư khách hàng" value={formatVND(b.clientBalances)} />
            <Line label="PT — chờ / khả dụng" value={`${formatVND(b.ptPending)} / ${formatVND(b.ptAvailable)}`} />
            {b.ptLocked > 0 ? <Line label="PT — đang khoá" value={formatVND(b.ptLocked)} /> : null}
            <Line label="Phòng gym — chờ / khả dụng" value={`${formatVND(b.gymPending)} / ${formatVND(b.gymAvailable)}`} />
            {b.gymLocked > 0 ? <Line label="Phòng gym — đang khoá" value={formatVND(b.gymLocked)} /> : null}
            <Line label="Nền tảng — chờ / khả dụng" value={`${formatVND(b.platformRevenuePending)} / ${formatVND(b.platformRevenueAvailable)}`} />
          </Card>
          {r.negativeWallets.length > 0 ? (
            <Card className="gap-1.5 border-destructive/40 bg-destructive/5 p-4">
              <Text className="font-body-semibold text-xs text-destructive">{`${r.negativeWallets.length} ví có số dư âm — luôn là lỗi`}</Text>
              {r.negativeWallets.map((w) => (
                <Text key={w.id} className="font-body text-[11px] text-destructive" selectable>
                  {`${ownerTypeLabel(w.ownerType)} ${w.ownerId} — chờ ${formatVND(w.pending)}, khả dụng ${formatVND(w.available)}`}
                </Text>
              ))}
            </Card>
          ) : null}
          <Text className="font-body text-[11px] text-muted-foreground">Tự làm mới mỗi 30 giây khi đang mở.</Text>
        </>
      )}
    </ScrollView>
  );
}

function Line({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "good" | "bad" }) {
  return (
    <View className="flex-row items-start justify-between gap-3">
      <Text className="min-w-0 flex-1 font-body text-xs text-muted-foreground">{label}</Text>
      <Text
        className={`text-right ${strong ? "font-display text-base" : "font-body-semibold text-xs"} ${
          tone === "good" ? "text-primary" : tone === "bad" ? "text-destructive" : "text-foreground"
        }`}
      >
        {value}
      </Text>
    </View>
  );
}
