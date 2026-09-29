import { useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Check, Info, X } from "lucide-react-native";

import {
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  Input,
  Stagger,
  StaggerItem,
  inputPlaceholderColor,
  useToast,
} from "../../src/components/ui";
import { adminService } from "../../src/services/api";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { designTokens } from "../../src/theme/colors";
import { formatVND } from "../../src/utils/currency";
import { money, withdrawalStatus } from "../../src/features/wallet/wallet";
import { friendlyError } from "../../src/features/partnerApplication/partnerApplication";
import {
  bankReferenceError,
  canApprove,
  canMarkPaid,
  canReject,
  ownerDisplay,
  payoutText,
  queueTotal,
  rejectReasonError,
  sortOldestFirst,
  userDirectory,
  withdrawalRows,
  type AdminWithdrawal,
} from "../../src/features/admin/adminWithdrawals";

function when(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} ${d.toLocaleDateString("vi-VN")}`;
}

/**
 * AD-06 "Rút tiền" — hàng chờ yêu cầu rút của PT, phòng gym và khách.
 *
 * Luồng bán thủ công (money-flow 5.3): hệ thống KHÔNG chuyển tiền. Quản trị viên chuyển khoản ngoài
 * hệ thống rồi bấm "Đã chi trả" kèm mã tham chiếu — đó là bước duy nhất trừ tiền khỏi ví. "Duyệt" chỉ
 * là giữ chỗ tuỳ chọn. Luật chi tiết ở `features/admin/adminWithdrawals.ts`.
 *
 * Khác web: hiện TÊN người rút (tra từ danh bạ `/admin/users` và tên chi nhánh), không phải 8 ký tự
 * đầu của id — người duyệt tiền cần biết đang trả cho ai.
 */
export default function AdminWithdrawalsScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();

  const [paying, setPaying] = useState<AdminWithdrawal | null>(null);
  const [bankRef, setBankRef] = useState("");
  const [rejecting, setRejecting] = useState<AdminWithdrawal | null>(null);
  const [reason, setReason] = useState("");

  const key = ["admin-withdrawals"];
  const query = useQuery({ queryKey: key, queryFn: () => adminService.listPendingWithdrawals() });
  const rows = sortOldestFirst(withdrawalRows(query.data));

  // Tên người rút là phụ: tải hỏng thì hàng chờ vẫn dùng được với mã rút gọn.
  const usersQuery = useQuery({
    queryKey: ["admin-user-directory"],
    queryFn: () => adminService.listUserDirectory(),
    enabled: rows.some((r) => r.ownerType !== "GYM"),
    staleTime: 5 * 60_000,
  });
  const gymsQuery = useQuery({
    queryKey: ["admin-gyms-all"],
    queryFn: () => adminService.listGymsForAdmin(),
    enabled: rows.some((r) => r.ownerType === "GYM"),
    staleTime: 5 * 60_000,
  });
  const users = userDirectory(usersQuery.data);
  const gyms = new Map<string, string>(
    (Array.isArray(gymsQuery.data) ? gymsQuery.data : []).map((g: any) => [String(g.id), String(g.approvedName ?? g.name ?? "")]),
  );

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const fail = (e: unknown, fallback: string) => toast.show(friendlyError(e, fallback), "danger");

  const approve = useMutation({
    mutationFn: (id: string) => adminService.approveWithdrawal(id),
    onSuccess: async () => {
      toast.show("Đã giữ chỗ số tiền này", "success");
      await refresh();
    },
    onError: (e) => fail(e, "Không duyệt được yêu cầu"),
  });

  const markPaid = useMutation({
    mutationFn: (v: { id: string; ref: string }) => adminService.markWithdrawalPaid(v.id, v.ref.trim()),
    onSuccess: async () => {
      toast.show("Đã ghi nhận chi trả", "success");
      setPaying(null);
      setBankRef("");
      await refresh();
    },
    onError: (e) => fail(e, "Không ghi nhận được chi trả"),
  });

  const reject = useMutation({
    mutationFn: (v: { id: string; reason: string }) => adminService.rejectWithdrawal(v.id, v.reason.trim()),
    onSuccess: async () => {
      toast.show("Đã từ chối yêu cầu", "success");
      setRejecting(null);
      setReason("");
      await refresh();
    },
    onError: (e) => fail(e, "Không từ chối được yêu cầu"),
  });

  const nameOf = (r: AdminWithdrawal) => ownerDisplay(r, users, gyms);

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor={accent.primary}
            colors={[accent.primary]}
          />
        }
      >
        <View className="px-5">
          <Text className="font-display text-xl text-foreground">Rút tiền</Text>
          <Text className="mt-0.5 font-body text-xs text-muted-foreground">
            {rows.length > 0 ? `${rows.length} yêu cầu · ${formatVND(queueTotal(rows))}` : "Yêu cầu rút tiền đang chờ xử lý"}
          </Text>
        </View>

        <Stagger className="gap-3 px-5 pt-5">
          <StaggerItem>
            <Card className="flex-row gap-2.5 p-3.5">
              <Info size={15} color={designTokens.mutedForeground} />
              <Text className="flex-1 font-body text-xs leading-5 text-muted-foreground">
                Chuyển khoản thủ công bên ngoài hệ thống rồi bấm “Đã chi trả” kèm mã tham chiếu — chỉ bước này mới trừ
                tiền khỏi ví. “Giữ chỗ” là tuỳ chọn, dùng khi việc chuyển khoản sẽ mất thời gian.
              </Text>
            </Card>
          </StaggerItem>

          {query.isLoading ? (
            <ActivityIndicator className="mt-8" color={accent.primary} />
          ) : query.isError ? (
            <StaggerItem>
              <Card className="items-center gap-3 p-6">
                <Text className="text-center font-body text-sm text-destructive">Không tải được hàng chờ rút tiền.</Text>
                <Button variant="secondary" onPress={() => void query.refetch()}>
                  Thử lại
                </Button>
              </Card>
            </StaggerItem>
          ) : rows.length === 0 ? (
            <StaggerItem>
              <EmptyState icon={Banknote} title="Không có yêu cầu nào đang chờ" description="Yêu cầu rút tiền mới sẽ xuất hiện ở đây." />
            </StaggerItem>
          ) : (
            rows.map((r) => {
              const who = nameOf(r);
              const st = withdrawalStatus(r.status);
              return (
                <StaggerItem key={r.id}>
                  <Card className="gap-3 p-4">
                    <View className="flex-row items-start justify-between gap-3">
                      <View className="min-w-0 flex-1">
                        <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                          {who.title}
                        </Text>
                        <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                          {who.subtitle}
                        </Text>
                      </View>
                      <Badge tone={st.tone}>{r.status === "APPROVED" ? "Đã giữ chỗ" : st.label}</Badge>
                    </View>

                    <Text className="font-display text-2xl text-foreground">{formatVND(money(r.amount))}</Text>

                    <View className="gap-1 rounded-xl border border-border bg-panel p-3">
                      <Text className="font-body text-[10px] uppercase tracking-wider text-muted-foreground">Thông tin nhận tiền</Text>
                      <Text className="font-body text-sm text-foreground" selectable>
                        {payoutText(r)}
                      </Text>
                    </View>
                    <Text className="font-body text-[11px] text-muted-foreground">Yêu cầu lúc {when(r.createdAt)}</Text>

                    <View className="flex-row flex-wrap gap-2">
                      {canMarkPaid(r) ? (
                        <Button
                          size="sm"
                          icon={Banknote}
                          onPress={() => {
                            setBankRef("");
                            setPaying(r);
                          }}
                        >
                          Đã chi trả
                        </Button>
                      ) : null}
                      {canApprove(r) ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={Check}
                          disabled={approve.isPending}
                          onPress={() => approve.mutate(r.id)}
                        >
                          Giữ chỗ
                        </Button>
                      ) : null}
                      {canReject(r) ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          icon={X}
                          onPress={() => {
                            setReason("");
                            setRejecting(r);
                          }}
                        >
                          Từ chối
                        </Button>
                      ) : null}
                    </View>
                  </Card>
                </StaggerItem>
              );
            })
          )}
        </Stagger>
      </ScrollView>

      <BottomSheet open={!!paying} onClose={() => setPaying(null)} title="Xác nhận đã chi trả">
        {paying ? (
          <View className="gap-3 pb-2">
            <Text className="font-body text-sm leading-5 text-muted-foreground">
              Bạn đã chuyển khoản{" "}
              <Text className="font-body-semibold text-foreground">{formatVND(money(paying.amount))}</Text> cho{" "}
              <Text className="font-body-semibold text-foreground">{nameOf(paying).title}</Text>. Nhập mã tham chiếu ngân
              hàng — số tiền sẽ được trừ khỏi ví ngay khi xác nhận.
            </Text>
            <Input
              label="Mã tham chiếu"
              value={bankRef}
              onChangeText={setBankRef}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="VD: VCB-TXN-20260928-001"
              placeholderTextColor={inputPlaceholderColor}
            />
            <Button
              disabled={!!bankReferenceError(bankRef) || markPaid.isPending}
              onPress={() =>
                Alert.alert("Ghi nhận đã chi trả?", "Tiền sẽ bị trừ khỏi ví người rút. Không hoàn tác được.", [
                  { text: "Không", style: "cancel" },
                  { text: "Xác nhận", onPress: () => markPaid.mutate({ id: paying.id, ref: bankRef }) },
                ])
              }
            >
              {markPaid.isPending ? "Đang ghi nhận…" : "Xác nhận đã chi trả"}
            </Button>
            {bankReferenceError(bankRef) && bankRef.length > 0 ? (
              <Text className="font-body text-xs text-muted-foreground">{bankReferenceError(bankRef)}</Text>
            ) : null}
          </View>
        ) : null}
      </BottomSheet>

      <BottomSheet open={!!rejecting} onClose={() => setRejecting(null)} title="Từ chối yêu cầu rút tiền">
        {rejecting ? (
          <View className="gap-3 pb-2">
            <Text className="font-body text-sm leading-5 text-muted-foreground">
              {rejecting.status === "APPROVED"
                ? "Yêu cầu đã được giữ chỗ — từ chối sẽ trả số tiền về số dư khả dụng của người rút."
                : "Số tiền chưa bị trừ, người rút có thể tạo yêu cầu mới."}
            </Text>
            <Input
              label="Lý do (người rút đọc được)"
              value={reason}
              onChangeText={setReason}
              multiline
              numberOfLines={3}
              placeholder="VD: Sai số tài khoản, vui lòng cập nhật rồi gửi lại"
              placeholderTextColor={inputPlaceholderColor}
            />
            <Button
              variant="destructive"
              disabled={!!rejectReasonError(reason) || reject.isPending}
              onPress={() => reject.mutate({ id: rejecting.id, reason })}
            >
              {reject.isPending ? "Đang từ chối…" : "Xác nhận từ chối"}
            </Button>
          </View>
        ) : null}
      </BottomSheet>
    </View>
  );
}
