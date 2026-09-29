import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Info, Lock, Wallet as WalletIcon } from "lucide-react-native";

import {
  Badge,
  BottomSheet,
  Button,
  Card,
  CountUp,
  EmptyState,
  Input,
  Stagger,
  StaggerItem,
  useToast,
} from "../../src/components/ui";
import { walletService } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { designTokens } from "../../src/theme/colors";
import { formatVND } from "../../src/utils/currency";
import { money, parseAmountInput, shortDate, withdrawFormError, withdrawableCeiling, withdrawalStatus } from "../../src/features/wallet/wallet";
import { ptTransactionLabel } from "../../src/features/pt/pt";

/**
 * PT-05 — "Ví thu nhập". Visual: the design's PTWallet. Behaviour: web's PTWalletPage — the PT
 * wallet's own three reads (`/me/pt-wallet`, its transactions) plus the shared withdrawal list
 * and the one write, `POST /me/withdrawals`, which only ever creates a PENDING request.
 *
 * The locked/pending line is not decoration: a settled session's fee lands in the PENDING bucket
 * first and is released to available later, so a trainer who only sees "available" would think
 * money went missing. The ledger labels name those internal moves — see ptTransactionLabel.
 */
export default function PtWalletScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const uid = user?.id ?? "guest";

  const walletQuery = useQuery({ queryKey: ["pt-wallet", uid], queryFn: () => walletService.getPtWallet() });
  const txQuery = useQuery({ queryKey: ["pt-wallet-transactions", uid], queryFn: () => walletService.getPtTransactions() });
  const wdQuery = useQuery({ queryKey: ["pt-withdrawals", uid], queryFn: () => walletService.getMyWithdrawals() });

  const wallet: any = walletQuery.data;
  // Trần rút = số dư khả dụng trừ các yêu cầu còn PENDING, đúng như payment-service tính.
  // Thiếu bước trừ này thì biểu mẫu mời rút một số tiền máy chủ chắc chắn từ chối bằng 400.
  const available = withdrawableCeiling(wallet, wdQuery.data);
  const held = money(wallet?.lockedBalance) + money(wallet?.pendingBalance);
  const transactions: any[] = Array.isArray(txQuery.data) ? txQuery.data : [];
  const withdrawals: any[] = Array.isArray(wdQuery.data) ? wdQuery.data : [];

  const [sheet, setSheet] = useState(false);
  const [amount, setAmount] = useState("");
  const [payoutInfo, setPayoutInfo] = useState("");
  const formError = withdrawFormError(amount, payoutInfo, available);

  const withdraw = useMutation({
    mutationFn: () => walletService.requestWithdrawal(amount, payoutInfo.trim()),
    onSuccess: () => {
      toast.show("Đã gửi yêu cầu rút tiền", "success");
      setSheet(false);
      setAmount("");
      setPayoutInfo("");
      void queryClient.invalidateQueries({ queryKey: ["pt-withdrawals", uid] });
      void queryClient.invalidateQueries({ queryKey: ["pt-wallet", uid] });
    },
    onError: (e: any) => toast.show(e?.response?.data?.error?.message || "Không thể tạo yêu cầu rút tiền", "danger"),
  });

  const refreshing = walletQuery.isRefetching || txQuery.isRefetching || wdQuery.isRefetching;
  const refresh = () => {
    void walletQuery.refetch();
    void txQuery.refetch();
    void wdQuery.refetch();
  };

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, padding: 20, paddingBottom: insets.bottom + 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={accent.primary} colors={[accent.primary]} />}
      >
        <Text className="mb-4 font-display text-2xl text-foreground">Ví thu nhập</Text>

        <Stagger className="gap-5">
          <StaggerItem>
            <Card className="overflow-hidden p-5">
              <View className="absolute -right-8 -top-10 h-40 w-40 rounded-full bg-primary/10" />
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
              <View className="mt-4 flex-row items-center gap-2 rounded-xl bg-panel px-3.5 py-2.5">
                <Lock size={14} color={designTokens.mutedForeground} />
                <Text className="flex-1 font-body text-sm text-muted-foreground">Đang tạm giữ</Text>
                <Text className="font-body-semibold text-sm text-foreground">{formatVND(held)}</Text>
              </View>
            </Card>
          </StaggerItem>

          <StaggerItem>
            <Card className="flex-row items-start gap-2.5 border-warning/30 bg-warning/5 p-4">
              <Info size={17} color={designTokens.warning} />
              <Text className="flex-1 font-body text-sm leading-5 text-muted-foreground">
                Tiền mỗi buổi dạy được <Text className="font-body-semibold text-foreground">tạm giữ</Text> rồi mới chuyển
                sang số dư khả dụng. Mỗi yêu cầu rút được xét rồi chuyển khoản thủ công.
              </Text>
            </Card>
          </StaggerItem>

          <StaggerItem>
            <Button full size="lg" icon={ArrowUpRight} disabled={available <= 0} onPress={() => setSheet(true)}>
              Yêu cầu rút tiền
            </Button>
          </StaggerItem>

          {withdrawals.length > 0 ? (
            <StaggerItem>
              <Text className="mb-3 px-1 font-display text-lg text-foreground">Yêu cầu rút tiền</Text>
              <Card className="overflow-hidden">
                {withdrawals.map((w, i) => {
                  const st = withdrawalStatus(w.status);
                  return (
                    <View key={w.id} className={`flex-row items-center gap-3 p-4 ${i > 0 ? "border-t border-border" : ""}`}>
                      <View className="h-10 w-10 items-center justify-center rounded-xl bg-panel">
                        <ArrowUpRight size={18} color={designTokens.mutedForeground} />
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="font-display text-sm text-foreground">{formatVND(money(w.amount))}</Text>
                        <Text className="font-body text-xs text-muted-foreground">{st.hint || `Gửi ngày ${shortDate(w.createdAt)}`}</Text>
                        {w.status === "REJECTED" && w.rejectionReason ? (
                          <Text className="font-body text-xs text-destructive">Lý do: {w.rejectionReason}</Text>
                        ) : null}
                      </View>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </View>
                  );
                })}
              </Card>
            </StaggerItem>
          ) : null}

          <StaggerItem>
            <Text className="mb-3 px-1 font-display text-lg text-foreground">Lịch sử giao dịch</Text>
            {txQuery.isLoading ? (
              <ActivityIndicator color={accent.primary} />
            ) : txQuery.isError ? (
              <Text className="font-body text-sm text-destructive">
                Không tải được lịch sử giao dịch. Kéo xuống để thử lại.
              </Text>
            ) : transactions.length === 0 ? (
              <EmptyState icon={WalletIcon} title="Chưa có giao dịch" description="Thu nhập từ mỗi buổi dạy sẽ hiện ở đây." />
            ) : (
              <Card className="overflow-hidden">
                {transactions.map((t, i) => {
                  const credit = t.entryType === "CREDIT";
                  return (
                    <View key={t.id} className={`flex-row items-center gap-3 p-4 ${i > 0 ? "border-t border-border" : ""}`}>
                      <View className={`h-10 w-10 items-center justify-center rounded-xl ${credit ? "bg-primary/15" : "bg-panel"}`}>
                        {credit ? <ArrowDownLeft size={18} color={accent.primary} /> : <ArrowUpRight size={18} color={designTokens.mutedForeground} />}
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                          {ptTransactionLabel(t.description, t.entryType)}
                        </Text>
                        <Text className="font-body text-xs text-muted-foreground">{shortDate(t.createdAt)}</Text>
                      </View>
                      <Text className={`font-display text-sm ${credit ? "text-primary" : "text-foreground"}`}>
                        {credit ? "+" : "-"}
                        {formatVND(money(t.amount))}
                      </Text>
                    </View>
                  );
                })}
              </Card>
            )}
          </StaggerItem>
        </Stagger>
      </ScrollView>

      <BottomSheet open={sheet} onClose={() => setSheet(false)} title="Yêu cầu rút tiền">
        <View className="gap-3 pb-2">
          <Input
            label={`Số tiền (tối đa ${formatVND(available)})`}
            value={amount ? Number(amount).toLocaleString("vi-VN") : ""}
            onChangeText={(t) => setAmount(parseAmountInput(t))}
            keyboardType="number-pad"
            placeholder="0"
          />
          <Input
            label="Tài khoản nhận tiền"
            value={payoutInfo}
            onChangeText={setPayoutInfo}
            placeholder="Số tài khoản – Ngân hàng – Tên chủ tài khoản"
          />
          {amount || payoutInfo ? (formError ? <Text className="font-body text-xs text-destructive">{formError}</Text> : null) : null}
          <Text className="font-body text-xs text-muted-foreground">
            Yêu cầu chỉ được tạo ở trạng thái chờ duyệt — tiền được chuyển khi quản trị viên xác nhận chuyển khoản.
          </Text>
          <Button full disabled={!!formError || withdraw.isPending} onPress={() => withdraw.mutate()}>
            {withdraw.isPending ? "Đang gửi…" : "Gửi yêu cầu"}
          </Button>
        </View>
      </BottomSheet>
    </View>
  );
}
