import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Building2, Clock, Wallet as WalletIcon } from "lucide-react-native";

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
  Tappable,
  inputPlaceholderColor,
  useToast,
} from "../../src/components/ui";
import { gymService } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { designTokens } from "../../src/theme/colors";
import { formatVND } from "../../src/utils/currency";
import { money, parseAmountInput, withdrawFormError, withdrawalStatus } from "../../src/features/wallet/wallet";
import { BranchSwitcher } from "../../src/features/gymOwner/BranchSwitcher";
import {
  branchName,
  openWithdrawals,
  ownedGyms,
  savedPayoutLine,
  withdrawableCeiling,
  withdrawalRows,
} from "../../src/features/gymOwner/gymOwner";

/**
 * GY-04 — "Ví". Ví thuộc về từng CHI NHÁNH (`/owner/gyms/:gymId/wallet`), không phải thương hiệu,
 * nên màn này có bộ chuyển chi nhánh giống Tổng quan. Trên web nó là một khối nằm trong trang quản
 * lý từng phòng gym; ở đây tách thành tab riêng vì tiền là việc chủ gym mở ra xem thường xuyên nhất,
 * không nên chôn sau hai lần bấm.
 *
 * Yêu cầu rút chỉ tạo một dòng PENDING — **không có đồng nào chuyển đi** cho tới khi quản trị viên
 * chuyển khoản tay và đánh dấu đã trả (money-flow plan 5.3). Màn nói đúng như vậy thay vì để chủ gym
 * tưởng tiền đang trên đường về.
 */
export default function GymOwnerWalletScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useApp();
  const uid = user?.id ?? "guest";

  const [selectedId, setSelectedId] = useState("");
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [payoutInfo, setPayoutInfo] = useState("");

  const gymsQuery = useQuery({ queryKey: ["owned-gyms", uid], queryFn: () => gymService.listOwnedGyms() });
  const gyms = ownedGyms(gymsQuery.data);
  const active = gyms.find((g) => g.id === selectedId) ?? gyms[0] ?? null;
  const activeId = active?.id ?? "";

  const walletQuery = useQuery({
    queryKey: ["owned-gym-wallet", activeId],
    queryFn: () => gymService.getOwnedWallet(activeId),
    enabled: !!activeId,
  });
  const withdrawalsQuery = useQuery({
    queryKey: ["owned-gym-withdrawals", activeId],
    queryFn: () => gymService.listGymWithdrawals(activeId),
    enabled: !!activeId,
  });
  const onboardingQuery = useQuery({
    queryKey: ["partner-onboarding-status", uid],
    queryFn: () => gymService.getOnboardingStatus(),
  });

  const rows = withdrawalRows(withdrawalsQuery.data);
  const openRows = openWithdrawals(rows);
  const ceiling = withdrawableCeiling(walletQuery.data, rows);
  const savedPayout = savedPayoutLine(onboardingQuery.data);

  const error = withdrawFormError(parseAmountInput(amount), payoutInfo, ceiling);

  const request = useMutation({
    mutationFn: () => gymService.requestGymWithdrawal(activeId, parseAmountInput(amount), payoutInfo.trim()),
    onSuccess: () => {
      toast.show("Đã gửi yêu cầu rút tiền", "success");
      setOpen(false);
      setAmount("");
      void qc.invalidateQueries({ queryKey: ["owned-gym-withdrawals", activeId] });
      void qc.invalidateQueries({ queryKey: ["owned-gym-wallet", activeId] });
    },
    onError: (e: any) =>
      toast.show(e?.response?.data?.error?.message || "Không gửi được yêu cầu rút tiền", "danger"),
  });

  const refreshing = walletQuery.isRefetching || withdrawalsQuery.isRefetching;

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void walletQuery.refetch();
              void withdrawalsQuery.refetch();
            }}
            tintColor={accent.primary}
            colors={[accent.primary]}
          />
        }
      >
        <View className="px-5">
          <Text className="font-display text-xl text-foreground">Ví</Text>
          <Text className="mt-0.5 font-body text-xs text-muted-foreground">Số dư và yêu cầu rút tiền theo chi nhánh</Text>
        </View>

        {gymsQuery.isLoading ? (
          <ActivityIndicator className="mt-10" color={accent.primary} />
        ) : gyms.length === 0 ? (
          <View className="px-5 pt-8">
            <EmptyState icon={Building2} title="Chưa có chi nhánh nào" description="Ví xuất hiện khi bạn có chi nhánh." />
          </View>
        ) : (
          <>
            <BranchSwitcher gyms={gyms} activeId={activeId} onChange={setSelectedId} />

            <Stagger className="gap-5 px-5 pt-5">
              <StaggerItem>
                <Card className="overflow-hidden p-5">
                  <View className="absolute -right-8 -top-10 h-40 w-40 rounded-full bg-primary/15" />
                  <View className="flex-row items-center gap-1.5">
                    <WalletIcon size={15} color={designTokens.mutedForeground} />
                    <Text className="font-body text-sm text-muted-foreground">Có thể rút</Text>
                  </View>
                  {walletQuery.isLoading ? (
                    <ActivityIndicator className="mt-3 self-start" color={accent.primary} />
                  ) : walletQuery.isError ? (
                    <Text className="mt-2 font-body text-sm text-destructive">Không tải được ví chi nhánh.</Text>
                  ) : (
                    <CountUp
                      to={money((walletQuery.data as any)?.availableBalance)}
                      suffix=" ₫"
                      locale="vi-VN"
                      className="mt-1 font-display text-4xl text-foreground"
                    />
                  )}
                  <View className="mt-3 flex-row items-center gap-1.5">
                    <Clock size={13} color={designTokens.warning} />
                    <Text className="font-body text-xs text-muted-foreground">
                      Đang chờ (gói hội viên chưa kết thúc):{" "}
                      <Text className="text-warning">{formatVND(money((walletQuery.data as any)?.pendingBalance))}</Text>
                    </Text>
                  </View>
                  {ceiling < money((walletQuery.data as any)?.availableBalance) ? (
                    <Text className="mt-1 font-body text-[11px] text-muted-foreground">
                      Rút được tối đa {formatVND(ceiling)} — phần còn lại đang nằm trong yêu cầu chờ xử lý.
                    </Text>
                  ) : null}
                  <Button
                    className="mt-4"
                    icon={Banknote}
                    disabled={!activeId || ceiling <= 0}
                    onPress={() => {
                      setAmount("");
                      if (!payoutInfo) setPayoutInfo(savedPayout);
                      setOpen(true);
                    }}
                  >
                    Yêu cầu rút tiền
                  </Button>
                  {ceiling <= 0 ? (
                    <Text className="mt-2 text-center font-body text-[11px] text-muted-foreground">
                      Chưa có số dư nào rút được.
                    </Text>
                  ) : null}
                </Card>
              </StaggerItem>

              <StaggerItem>
                <Card className="gap-2 border-border/70 p-4">
                  <Text className="font-body text-xs leading-5 text-muted-foreground">
                    Gửi yêu cầu chỉ tạo một dòng chờ xử lý — tiền chỉ thực sự chuyển khi Gymini chuyển khoản tay
                    và đánh dấu đã chi trả.
                  </Text>
                </Card>
              </StaggerItem>

              {openRows.length > 0 ? (
                <StaggerItem>
                  <Text className="mb-2 px-1 font-body-semibold text-sm text-foreground">Yêu cầu đang xử lý</Text>
                  <Card className="overflow-hidden">
                    {openRows.map((w, i) => {
                      const st = withdrawalStatus(w.status);
                      return (
                        <View key={w.id} className={`flex-row items-center justify-between gap-3 p-4 ${i > 0 ? "border-t border-border" : ""}`}>
                          <Text className="font-body-semibold text-sm text-foreground">{formatVND(money(w.amount))}</Text>
                          <Badge tone={st.tone}>{st.label}</Badge>
                        </View>
                      );
                    })}
                  </Card>
                </StaggerItem>
              ) : null}

              <StaggerItem>
                <Text className="mb-2 px-1 font-display text-lg text-foreground">Lịch sử rút tiền</Text>
                <Card className="overflow-hidden">
                  {withdrawalsQuery.isLoading ? (
                    <ActivityIndicator className="m-5 self-start" color={accent.primary} />
                  ) : rows.length === 0 ? (
                    <Text className="p-5 font-body text-xs text-muted-foreground">Chưa có yêu cầu rút tiền nào.</Text>
                  ) : (
                    rows.map((w, i) => {
                      const st = withdrawalStatus(w.status);
                      return (
                        <View key={w.id} className={`flex-row items-center justify-between gap-3 p-4 ${i > 0 ? "border-t border-border" : ""}`}>
                          <View className="min-w-0 flex-1">
                            <Text className="font-body-semibold text-sm text-foreground">{formatVND(money(w.amount))}</Text>
                            {w.createdAt ? (
                              <Text className="font-body text-xs text-muted-foreground">
                                {new Date(w.createdAt).toLocaleDateString("vi-VN")}
                              </Text>
                            ) : null}
                          </View>
                          <Badge tone={st.tone}>{st.label}</Badge>
                        </View>
                      );
                    })
                  )}
                </Card>
              </StaggerItem>
            </Stagger>
          </>
        )}
      </ScrollView>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="Yêu cầu rút tiền">
        <View className="gap-3">
          <Text className="font-body text-xs text-muted-foreground">
            Rút được tối đa {formatVND(ceiling)} từ {active ? branchName(active) : "chi nhánh này"}.
          </Text>
          <Input
            label="Số tiền (₫)"
            value={amount}
            onChangeText={setAmount}
            keyboardType="number-pad"
            placeholder="500000"
            placeholderTextColor={inputPlaceholderColor}
          />
          <Input
            label="Tài khoản nhận tiền"
            value={payoutInfo}
            onChangeText={setPayoutInfo}
            placeholder="Ngân hàng — số tài khoản — chủ tài khoản"
            placeholderTextColor={inputPlaceholderColor}
          />
          {savedPayout && payoutInfo !== savedPayout ? (
            <Tappable accessibilityLabel="Dùng tài khoản đã lưu" onPress={() => setPayoutInfo(savedPayout)} className="self-start">
              <Text className="font-body-semibold text-xs text-primary">Dùng tài khoản đã lưu</Text>
            </Tappable>
          ) : null}
          <Button disabled={!!error || request.isPending} onPress={() => request.mutate()}>
            {request.isPending ? "Đang gửi…" : "Gửi yêu cầu"}
          </Button>
          {error ? <Text className="text-center font-body text-xs text-muted-foreground">{error}</Text> : null}
        </View>
      </BottomSheet>
    </View>
  );
}
