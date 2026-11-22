import { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Redirect } from "expo-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Building2, Download, Handshake, Lock, Receipt, Wallet as WalletIcon } from "lucide-react-native";

import { Badge, Card, EmptyState, Stagger, StaggerItem, Tappable, useToast } from "../../src/components/ui";
import { shareLocalFile, writeLocalFile } from "../../src/services/files";
import { SelectField } from "../../src/components/SelectSheet";
import { gymService } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { designTokens } from "../../src/theme/colors";
import { formatVND } from "../../src/utils/currency";
import { branchName, ownedGyms } from "../../src/features/gymOwner/gymOwner";
import { rejectionReasonLine } from "../../src/features/gymOwner/gymWithdrawal";
import {
  COMMISSION_PRESET_LABEL,
  SALE_STATUS_LABEL,
  WITHDRAWAL_STATUS_LABEL,
  commissionCsv,
  commissionRangeFor,
  dateLabel,
  monthLabel,
  newestFirst,
  normalizePtCommission,
  recognizedSales,
  salesCsv,
  withBom,
  withdrawalsCsv,
  walletTotals,
  withdrawalTone,
  type CommissionPreset,
  type SalesRow,
  type WalletLike,
} from "../../src/features/gymOwner/finance";
import { STAFF_ROLE_LABEL, staffHomeRoute } from "../../src/features/gymOwner/staffRoles";

/**
 * N15M-10 — "Tài chính": the accountant's home (web: `GymFinancePage`, D15 / D15b). READ-ONLY by design: sales of
 * cards (no member identity — the server drops it), branch wallet balances, withdrawal history (bank account masked
 * by the server) and the TOTAL of PT referral commission per period. No withdraw / approve / refund control exists
 * here, and the server refuses every write for this role anyway.
 *
 * Scope = the branches the owner assigned to the accountant (empty = the whole brand); `GET /owner/gyms` already
 * returns only those.
 */
const PRESETS = Object.keys(COMMISSION_PRESET_LABEL) as CommissionPreset[];
const SALES_SHOWN = 30;

/** Web downloads a Blob; on the phone the CSV (UTF-8 BOM, same columns) goes to a cache file and the OS share sheet. */
async function exportCsv(fileName: string, csv: string): Promise<void> {
  const uri = writeLocalFile(fileName, withBom(csv));
  await shareLocalFile(uri, "text/csv");
}

export default function FinanceScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const { user } = useApp();
  const uid = user?.id ?? "guest";
  const [scope, setScope] = useState("ALL");
  const [preset, setPreset] = useState<CommissionPreset>("LAST_6");
  const toast = useToast();
  const runExport = (fileName: string, build: () => string) => {
    exportCsv(fileName, build()).catch((e: unknown) => toast.show((e as Error)?.message || "Không xuất được tệp CSV.", "danger"));
  };

  const statusQuery = useQuery({
    queryKey: ["partner-onboarding-status", uid],
    queryFn: () => gymService.getOnboardingStatus(),
  });
  const role = (statusQuery.data as { role?: string } | undefined)?.role;
  const allowed = role === "ACCOUNTANT" || role === "OWNER";

  const gymsQuery = useQuery({
    queryKey: ["finance-gyms", uid],
    queryFn: () => gymService.listOwnedGyms(),
    enabled: allowed,
  });
  const gyms = useMemo(() => ownedGyms(gymsQuery.data).filter((g) => g.status !== "DRAFT"), [gymsQuery.data]);
  const selected = useMemo(() => (scope === "ALL" ? gyms : gyms.filter((g) => g.id === scope)), [gyms, scope]);
  const brandIds = useMemo(() => [...new Set(selected.map((g) => g.brandId).filter(Boolean) as string[])], [selected]);

  const salesQs = useQueries({
    queries: selected.map((g) => ({
      queryKey: ["finance-sales", uid, g.id],
      queryFn: async () => {
        const r = await gymService.listOwnedMemberships(g.id);
        return (Array.isArray(r) ? r : []) as SalesRow[];
      },
    })),
  });
  const walletQs = useQueries({
    queries: selected.map((g) => ({
      queryKey: ["finance-wallet", uid, g.id],
      queryFn: async () => (await gymService.getOwnedWallet(g.id)) as WalletLike,
    })),
  });
  const withdrawalQs = useQueries({
    queries: selected.map((g) => ({
      queryKey: ["finance-withdrawals", uid, g.id],
      queryFn: async () => {
        const r = await gymService.listGymWithdrawals(g.id);
        return (Array.isArray(r) ? r : []) as { id: string; amount?: string | number; status?: string; createdAt?: string; bankReference?: string; payoutInfo?: string; rejectionReason?: string | null }[];
      },
    })),
  });
  const planQs = useQueries({
    queries: brandIds.map((b) => ({
      queryKey: ["finance-plans", uid, b],
      queryFn: async () => {
        const r = await gymService.listOwnedPlans(b);
        return (Array.isArray(r) ? r : []) as { id: string; name: string }[];
      },
    })),
  });

  // One owner = one brand: the commission total is read for the brand of the branches in scope.
  const commissionBrandId = gyms.find((g) => g.brandId)?.brandId ?? "";
  const commissionQuery = useQuery({
    queryKey: ["finance-pt-commission", uid, commissionBrandId, scope, preset],
    enabled: allowed && !!commissionBrandId,
    queryFn: async () =>
      normalizePtCommission(
        await gymService.getPtCommissionSummary(commissionBrandId, { ...commissionRangeFor(preset), ...(scope === "ALL" ? {} : { gymId: scope }) }),
      ),
  });
  const commission = commissionQuery.data;

  if (statusQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={accent.primary} />
      </View>
    );
  }
  if (statusQuery.isSuccess && !allowed) return <Redirect href={staffHomeRoute(statusQuery.data) as never} />;
  if (statusQuery.isError) {
    return (
      <View className="flex-1 bg-background px-5" style={{ paddingTop: insets.top + 24 }}>
        <EmptyState icon={Building2} title="Chưa kiểm tra được quyền" description="Kéo xuống hoặc mở lại ứng dụng để thử lại." />
      </View>
    );
  }

  const allQs = [...salesQs, ...walletQs, ...withdrawalQs];
  const loading = allQs.some((q) => q.isLoading);
  const failed = allQs.some((q) => q.isError);
  const gymName = (id: string) => {
    const g = gyms.find((x) => x.id === id);
    return g ? branchName(g) : "—";
  };
  const planName = (id: string) => {
    for (const q of planQs) {
      const hit = q.data?.find((p) => p.id === id);
      if (hit) return hit.name;
    }
    return "Gói";
  };

  const sales = newestFirst(salesQs.flatMap((q) => q.data ?? []));
  const withdrawals = newestFirst(
    withdrawalQs.flatMap((q, i) => (q.data ?? []).map((w) => ({ ...w, gymName: selected[i] ? branchName(selected[i]) : "" }))),
  );
  const recognized = recognizedSales(sales);
  const totals = walletTotals(walletQs.map((q) => q.data).filter(Boolean) as WalletLike[]);
  const debtEntries = walletQs
    .flatMap((q, i) => (q.data?.gymDebt?.recent ?? []).map((r) => ({ ...r, gymName: selected[i] ? branchName(selected[i]) : "" })))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 10);
  const stamp = new Date().toISOString().slice(0, 10);
  const hasDebt = totals.debtOpen > 0 || totals.debtRecovered > 0;

  const refresh = () => {
    void gymsQuery.refetch();
    allQs.forEach((q) => void q.refetch());
    void commissionQuery.refetch();
  };

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl refreshing={gymsQuery.isRefetching} onRefresh={refresh} tintColor={accent.primary} colors={[accent.primary]} />
        }
      >
        <View className="flex-row items-start justify-between gap-3 px-5">
          <View className="min-w-0 flex-1">
            <Text className="font-display text-xl text-foreground">Tài chính</Text>
            <Text className="mt-0.5 font-body text-xs text-muted-foreground">
              {STAFF_ROLE_LABEL[role as keyof typeof STAFF_ROLE_LABEL] ?? ""} · số liệu của các chi nhánh được giao
            </Text>
          </View>
          <View className="flex-row items-center gap-1 rounded-full border border-border px-2.5 py-1">
            <Lock size={11} color={designTokens.mutedForeground} />
            <Text className="font-body text-[11px] text-muted-foreground">Chỉ xem</Text>
          </View>
        </View>

        {gymsQuery.isLoading ? (
          <ActivityIndicator className="mt-10" color={accent.primary} />
        ) : gymsQuery.isError ? (
          <Text className="mt-6 px-5 font-body text-sm text-destructive">Không tải được danh sách chi nhánh. Kéo xuống để thử lại.</Text>
        ) : gyms.length === 0 ? (
          <View className="px-5 pt-8">
            <EmptyState
              icon={WalletIcon}
              title="Chưa có chi nhánh trong phạm vi"
              description="Hãy nhờ chủ phòng gym kiểm tra phạm vi được giao cho tài khoản kế toán."
            />
          </View>
        ) : (
          <Stagger className="gap-5 px-5 pt-5">
            {gyms.length > 1 ? (
              <StaggerItem>
                <SelectField
                  label="Phạm vi chi nhánh"
                  value={scope}
                  options={[{ value: "ALL", label: `Tất cả chi nhánh được giao (${gyms.length})` }, ...gyms.map((g) => ({ value: g.id, label: branchName(g) }))]}
                  onChange={setScope}
                />
              </StaggerItem>
            ) : null}

            {failed ? (
              <StaggerItem>
                <Text className="font-body text-xs text-destructive">Một số số liệu chưa tải được. Kéo xuống để thử lại.</Text>
              </StaggerItem>
            ) : null}

            <StaggerItem>
              <View className="flex-row flex-wrap gap-3">
                <Kpi label="Doanh số đã thanh toán" value={loading ? "…" : formatVND(recognized.total)} hint={`${recognized.count} thẻ (đang dùng + hết hạn)`} />
                <Kpi
                  label="Có thể rút"
                  value={loading ? "…" : formatVND(totals.withdrawable)}
                  hint={totals.reserved > 0 ? `Đã trừ ${formatVND(totals.reserved)} yêu cầu đang chờ duyệt` : "Đã trừ yêu cầu chờ duyệt và nợ nền tảng"}
                />
                <Kpi label="Chờ ghi nhận" value={loading ? "…" : formatVND(totals.pending)} hint="Giữ tới khi thẻ kết thúc" />
                <Kpi label="Lượt rút tiền" value={loading ? "…" : String(withdrawals.length)} hint="Tất cả trạng thái" />
              </View>
            </StaggerItem>

            {hasDebt ? (
              <StaggerItem>
                <Card className="gap-3 p-4">
                  <SectionTitle icon={WalletIcon} title="Nợ nền tảng" />
                  <Text className="font-body text-xs leading-5 text-muted-foreground">
                    Khi hoàn thêm tiền cho hội viên thắng khiếu nại mà ví chi nhánh chưa đủ, nền tảng ứng trước phần thiếu. Khoản đó được tự động trừ vào thu nhập tiếp theo của chi nhánh.
                  </Text>
                  <View className="flex-row gap-3">
                    <Kpi label="Còn nợ nền tảng" value={formatVND(totals.debtOpen)} hint={totals.debtOpen > 0 ? "Sẽ trừ vào thu nhập mới" : "Đã trả đủ"} />
                    <Kpi label="Đã trừ nợ nền tảng" value={formatVND(totals.debtRecovered)} hint="Tổng các lần đã trừ" />
                  </View>
                  {debtEntries.map((r, i) => (
                    <View key={`${r.at}-${i}`} className="rounded-lg bg-panel px-3 py-2">
                      <Text className="font-body text-sm text-foreground">Đã trừ nợ nền tảng: {formatVND(Number(r.amount))}</Text>
                      <Text className="font-body text-[11px] text-muted-foreground" numberOfLines={2}>
                        {dateLabel(r.at)}
                        {r.gymName ? ` · ${r.gymName}` : ""} · {Number(r.unpaidAfter) > 0 ? `còn nợ ${formatVND(Number(r.unpaidAfter))}` : "đã trả đủ"}
                      </Text>
                    </View>
                  ))}
                </Card>
              </StaggerItem>
            ) : null}

            <StaggerItem>
              <Card className="gap-3 p-4">
                <View className="flex-row items-center justify-between gap-3">
                  <SectionTitle icon={Receipt} title="Doanh số bán thẻ" />
                  <ExportButton
                    disabled={sales.length === 0}
                    label="Xuất CSV doanh số bán thẻ"
                    onPress={() => runExport(`gymini-doanh-so-${stamp}.csv`, () => salesCsv(sales, { gym: gymName, plan: planName }))}
                  />
                </View>
                {sales.length === 0 ? (
                  <Text className="font-body text-xs text-muted-foreground">{loading ? "Đang tải…" : "Chưa có thẻ nào được bán."}</Text>
                ) : (
                  <>
                    {sales.slice(0, SALES_SHOWN).map((s) => (
                      <View key={s.id} className="min-h-12 flex-row items-center justify-between gap-3 rounded-lg bg-panel px-3 py-2">
                        <View className="min-w-0 flex-1">
                          <Text className="font-body text-sm text-foreground" numberOfLines={1}>
                            {planName(s.planId)} · {gymName(s.gymId)}
                          </Text>
                          <Text className="font-body text-[11px] text-muted-foreground" numberOfLines={1}>
                            {dateLabel(s.createdAt)} · {SALE_STATUS_LABEL[s.status] ?? s.status}
                          </Text>
                        </View>
                        <Text className="font-body-semibold text-sm text-foreground">{formatVND(Number(s.priceAtPurchase || 0))}</Text>
                      </View>
                    ))}
                    {sales.length > SALES_SHOWN ? (
                      <Text className="text-center font-body text-[11px] text-muted-foreground">
                        Hiện {SALES_SHOWN} giao dịch mới nhất trong tổng {sales.length}.
                      </Text>
                    ) : null}
                  </>
                )}
              </Card>
            </StaggerItem>

            <StaggerItem>
              <Card className="gap-3 p-4">
                <View className="flex-row items-center justify-between gap-3">
                  <SectionTitle icon={Handshake} title="Hoa hồng giới thiệu PT" />
                  <ExportButton
                    disabled={!commission || commission.byMonth.length === 0}
                    label="Xuất CSV hoa hồng PT"
                    onPress={() => commission && runExport(`gymini-hoa-hong-pt-${stamp}.csv`, () => commissionCsv(commission))}
                  />
                </View>
                <Text className="font-body text-[11px] text-muted-foreground">Chỉ hiển thị tổng theo kỳ, không chi tiết từng PT.</Text>
                <SelectField
                  label="Kỳ hoa hồng"
                  value={preset}
                  options={PRESETS.map((k) => ({ value: k, label: COMMISSION_PRESET_LABEL[k] }))}
                  onChange={(v) => setPreset(v as CommissionPreset)}
                />
                {commissionQuery.isLoading ? (
                  <ActivityIndicator color={accent.primary} />
                ) : commissionQuery.isError || !commission ? (
                  <Text className="font-body text-xs text-destructive">Không tải được hoa hồng PT.</Text>
                ) : (
                  <>
                    <View className="flex-row flex-wrap gap-3">
                      <Kpi label="Dự kiến" value={formatVND(commission.totals.expected)} hint="Chưa chuyển cho PT" />
                      <Kpi label="Đã ghi nhận" value={formatVND(commission.totals.recorded)} hint="Đã vào số dư chờ của PT" />
                      <Kpi label="Đã chi" value={formatVND(commission.totals.paid)} hint="Đã sang số dư khả dụng của PT" />
                    </View>
                    {commission.totals.clawedBack > 0 ? (
                      <Text className="font-body text-[11px] text-muted-foreground">
                        Đã thu hồi do hoàn tiền thẻ: {formatVND(commission.totals.clawedBack)} (đã trừ khỏi các số trên).
                      </Text>
                    ) : null}
                    {commission.byMonth.length === 0 ? (
                      <Text className="font-body text-xs text-muted-foreground">Chưa có hoa hồng giới thiệu trong kỳ này.</Text>
                    ) : (
                      commission.byMonth.map((m) => (
                        <View key={m.month} className="rounded-lg bg-panel px-3 py-2">
                          <View className="flex-row items-center justify-between gap-3">
                            <Text className="font-body text-sm text-foreground">{monthLabel(m.month)}</Text>
                            <Text className="font-body text-[11px] text-muted-foreground">{m.referralCount} hoa hồng</Text>
                          </View>
                          <Text className="font-body text-[11px] text-muted-foreground">
                            Dự kiến {formatVND(m.expected)} · ghi nhận {formatVND(m.recorded)} · đã chi {formatVND(m.paid)}
                          </Text>
                        </View>
                      ))
                    )}
                  </>
                )}
              </Card>
            </StaggerItem>

            <StaggerItem>
              <Card className="gap-3 p-4">
                <View className="flex-row items-center justify-between gap-3">
                  <SectionTitle icon={WalletIcon} title="Lịch sử rút tiền" />
                  <ExportButton
                    disabled={withdrawals.length === 0}
                    label="Xuất CSV lịch sử rút tiền"
                    onPress={() => runExport(`gymini-rut-tien-${stamp}.csv`, () => withdrawalsCsv(withdrawals))}
                  />
                </View>
                {withdrawals.length === 0 ? (
                  <Text className="font-body text-xs text-muted-foreground">{loading ? "Đang tải…" : "Chưa có yêu cầu rút tiền."}</Text>
                ) : (
                  withdrawals.map((w) => (
                    <View key={w.id} className="gap-1 rounded-lg bg-panel px-3 py-2">
                      <View className="flex-row items-center justify-between gap-3">
                        <Text className="min-w-0 flex-1 font-body text-sm text-foreground" numberOfLines={1}>
                          {w.gymName}
                        </Text>
                        <Text className="font-body-semibold text-sm text-foreground">{formatVND(Number(w.amount || 0))}</Text>
                      </View>
                      <View className="flex-row items-center justify-between gap-3">
                        <Text className="font-body text-[11px] text-muted-foreground">
                          {dateLabel(w.createdAt)}
                          {w.bankReference ? ` · mã ${w.bankReference}` : ""}
                        </Text>
                        <Badge tone={withdrawalTone(w.status)}>{WITHDRAWAL_STATUS_LABEL[w.status ?? ""] ?? w.status ?? "—"}</Badge>
                      </View>
                      {rejectionReasonLine(w) ? (
                        <Text className="font-body text-[11px] text-destructive" testID="finance-withdrawal-rejection-reason">
                          {rejectionReasonLine(w)}
                        </Text>
                      ) : null}
                      {w.payoutInfo ? <Text className="font-body text-[11px] text-muted-foreground">{w.payoutInfo}</Text> : null}
                    </View>
                  ))
                )}
              </Card>
            </StaggerItem>
          </Stagger>
        )}
      </ScrollView>
    </View>
  );
}

function ExportButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Tappable
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-10 flex-row items-center gap-1.5 rounded-xl border border-border bg-panel px-3 ${disabled ? "opacity-40" : ""}`}
    >
      <Download size={14} color={designTokens.mutedForeground} />
      <Text className="font-body-medium text-xs text-foreground">Xuất CSV</Text>
    </Tappable>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: typeof Receipt; title: string }) {
  const accent = useWorkspaceAccent();
  return (
    <View className="flex-row items-center gap-2">
      <Icon size={16} color={accent.primary} />
      <Text className="font-body-semibold text-sm text-foreground">{title}</Text>
    </View>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="min-w-[45%] flex-1 p-3">
      <Text className="font-body text-[11px] text-muted-foreground">{label}</Text>
      <Text className="mt-1 font-display text-base text-foreground" numberOfLines={1}>
        {value}
      </Text>
      <Text className="mt-0.5 font-body text-[10px] text-muted-foreground">{hint}</Text>
    </Card>
  );
}
