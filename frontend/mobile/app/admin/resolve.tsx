import { useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gavel, HandCoins, MessageSquareWarning, ReceiptText, TriangleAlert } from "lucide-react-native";

import {
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  Input,
  Tappable,
  inputPlaceholderColor,
  useToast,
} from "../../src/components/ui";
import { adminService, personalizedServiceApi } from "../../src/services/api";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { designTokens } from "../../src/theme/colors";
import { formatVND } from "../../src/utils/currency";
import { friendlyError } from "../../src/features/partnerApplication/partnerApplication";
import { money, parseAmountInput } from "../../src/features/wallet/wallet";
import { gymRows } from "../../src/features/admin/adminGyms";
import { ComplaintSheet } from "../../src/features/admin/ComplaintSheet";
import {
  COMPLAINT_FILTERS,
  COMPLAINT_ISSUE_LABEL,
  COMPLAINT_SOURCE_LABEL,
  COMPLAINT_STATUS,
  DISPUTE_TYPE_LABEL,
  MEMBERSHIP_REFUND_REASONS,
  RULINGS,
  complaintRows,
  disputeRows,
  membershipIdError,
  refundAmountError,
  refundCalc,
  refundNoteError,
  refundRows,
  rulingNoteError,
  type Complaint,
  type DisputeRuling,
  type DisputedSession,
  type RefundOrder,
} from "../../src/features/admin/adminResolve";

type Section = "disputes" | "refunds" | "complaints" | "membership";

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" }) : "");

function Chip({ label, on, count, onPress }: { label: string; on: boolean; count?: number; onPress: () => void }) {
  return (
    <Tappable
      accessibilityLabel={label}
      onPress={onPress}
      className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 ${on ? "border-primary bg-primary/15" : "border-border bg-panel"}`}
    >
      <Text className={`font-body text-xs ${on ? "text-primary" : "text-muted-foreground"}`}>{label}</Text>
      {count && count > 0 ? (
        <View className="rounded-full bg-warning/20 px-1.5">
          <Text className="font-body-semibold text-[10px] text-warning">{count}</Text>
        </View>
      ) : null}
    </Tappable>
  );
}

function useFail() {
  const toast = useToast();
  return (e: unknown, fallback: string) => toast.show(friendlyError(e, fallback), "danger");
}

// ── 1. Tranh chấp buổi tập ────────────────────────────────────────────────────────────────────

function Disputes({ rows }: { rows: DisputedSession[] }) {
  const toast = useToast();
  const fail = useFail();
  const qc = useQueryClient();
  const [target, setTarget] = useState<{ s: DisputedSession; ruling: DisputeRuling } | null>(null);
  const [note, setNote] = useState("");

  const resolve = useMutation({
    mutationFn: () => adminService.resolveSessionDispute(target!.s.id, target!.ruling, note.trim()),
    onSuccess: async () => {
      toast.show("Đã phân xử", "success");
      setTarget(null);
      await qc.invalidateQueries({ queryKey: ["admin-disputes"] });
    },
    onError: (e) => fail(e, "Không phân xử được"),
  });

  const ruling = target ? RULINGS.find((r) => r.value === target.ruling) : null;

  return (
    <>
      <Text className="font-body text-xs leading-5 text-muted-foreground">
        Khách phản đối báo cáo của huấn luyện viên — buổi tập chưa bị trừ và tiền chưa quyết toán cho tới khi có kết luận.
      </Text>
      {rows.length === 0 ? (
        <EmptyState icon={Gavel} title="Không có tranh chấp nào đang chờ" />
      ) : (
        rows.map((s) => (
          <Card key={s.id} className="gap-3 p-4">
            <View className="flex-row items-start justify-between gap-2">
              <View className="min-w-0 flex-1">
                <Text className="font-body-semibold text-sm text-foreground">Buổi tập {when(s.scheduledStartAt)}</Text>
                <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                  {s.contract?.packageName ?? `Hợp đồng ${String(s.contractId ?? "").slice(0, 8)}`}
                </Text>
              </View>
              <Badge tone="danger">Đang tranh chấp</Badge>
            </View>
            {s.disputeType && DISPUTE_TYPE_LABEL[s.disputeType] ? <Badge tone="neutral">{DISPUTE_TYPE_LABEL[s.disputeType]}</Badge> : null}
            <View className="gap-1 rounded-xl border border-border bg-panel p-3">
              <Text className="font-body text-[10px] uppercase tracking-wider text-muted-foreground">Huấn luyện viên báo cáo</Text>
              <Text className="font-body text-xs text-foreground">{s.ptNotes || "(không có ghi chú)"}</Text>
            </View>
            <View className="gap-1 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <Text className="font-body text-[10px] uppercase tracking-wider text-destructive">Khách phản đối</Text>
              <Text className="font-body text-xs text-foreground">{s.disputeReason || "(không có lý do)"}</Text>
            </View>
            <View className="gap-2">
              {RULINGS.map((r) => (
                <Button
                  key={r.value}
                  size="sm"
                  variant={r.value === "CANCELLED" ? "destructive" : "secondary"}
                  onPress={() => {
                    setNote("");
                    setTarget({ s, ruling: r.value });
                  }}
                >
                  {r.label}
                </Button>
              ))}
            </View>
          </Card>
        ))
      )}

      <BottomSheet open={!!target} onClose={() => setTarget(null)} title={ruling?.label ?? "Phân xử"}>
        {ruling ? (
          <View className="gap-3 pb-2">
            <View className="flex-row gap-2 rounded-xl border border-warning/30 bg-warning/5 p-3">
              <TriangleAlert size={14} color={designTokens.warning} />
              <Text className="flex-1 font-body text-xs leading-5 text-muted-foreground">{ruling.consequence} Không đảo ngược được.</Text>
            </View>
            <Input
              label="Căn cứ phân xử"
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={3}
              placeholder="Cả khách và huấn luyện viên sẽ thấy"
              placeholderTextColor={inputPlaceholderColor}
            />
            <Button disabled={!!rulingNoteError(note) || resolve.isPending} onPress={() => resolve.mutate()}>
              {resolve.isPending ? "Đang lưu…" : "Xác nhận kết luận"}
            </Button>
          </View>
        ) : null}
      </BottomSheet>
    </>
  );
}

// ── 2. Hoàn tiền đơn dịch vụ 1-1 ──────────────────────────────────────────────────────────────

function Milestone({ ok, label }: { ok: boolean; label: string }) {
  return <Badge tone={ok ? "success" : "neutral"}>{`${ok ? "✓" : "—"} ${label}`}</Badge>;
}

function RefundCase({ order }: { order: RefundOrder }) {
  const toast = useToast();
  const fail = useFail();
  const qc = useQueryClient();
  const accent = useWorkspaceAccent();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const calcQuery = useQuery({
    queryKey: ["admin-refund-calc", order.id],
    queryFn: () => personalizedServiceApi.getRefundCalculation(order.id),
    enabled: open,
  });
  const calc = refundCalc(calcQuery.data);

  const done = async (msg: string) => {
    toast.show(msg, "success");
    setOpen(false);
    await qc.invalidateQueries({ queryKey: ["admin-refund-requests"] });
  };
  const approve = useMutation({
    mutationFn: () =>
      personalizedServiceApi.adminResolveRefund(order.id, { decision: "APPROVE", refundAmount: Number(parseAmountInput(amount)), note: note.trim() }),
    onSuccess: (r: any) => done(r?.status === "REFUNDED" ? "Đã hoàn tiền toàn bộ" : "Đã hoàn tiền một phần — đơn tiếp tục"),
    onError: (e) => fail(e, "Không hoàn tiền được"),
  });
  const deny = useMutation({
    mutationFn: () => personalizedServiceApi.adminResolveRefund(order.id, { decision: "DENY", note: note.trim() }),
    onSuccess: () => done("Đã từ chối yêu cầu hoàn tiền"),
    onError: (e) => fail(e, "Không từ chối được"),
  });

  return (
    <Card className="gap-3 p-4">
      <View className="gap-0.5">
        <Text className="font-body-semibold text-sm text-foreground">{order.titleSnapshot ?? "Đơn dịch vụ"}</Text>
        <Text className="font-body text-xs text-muted-foreground">
          Đơn #{order.id.slice(0, 8)} · {formatVND(money(order.priceAtPurchase))}
        </Text>
        {order.disputeReason ? <Text className="font-body text-xs text-warning">Lý do khách: “{order.disputeReason}”</Text> : null}
      </View>
      <Button size="sm" variant="secondary" onPress={() => setOpen(!open)}>
        {open ? "Thu gọn" : "Xem số liệu & xử lý"}
      </Button>
      {open ? (
        calcQuery.isLoading ? (
          <ActivityIndicator className="self-start" color={accent.primary} />
        ) : !calc ? (
          <Text className="font-body text-xs text-destructive">Không tải được số liệu hoàn tiền.</Text>
        ) : (
          <View className="gap-3">
            <View className="flex-row gap-2">
              {[
                { label: "Đã trả", v: calc.totalPaid },
                { label: "Đã hoàn trước", v: calc.alreadyRefunded },
                { label: "Còn hoàn được", v: calc.refundableCeiling },
              ].map((x) => (
                <View key={x.label} className="flex-1 rounded-lg bg-panel p-2.5">
                  <Text className="font-body text-[10px] text-muted-foreground">{x.label}</Text>
                  <Text className="font-body-semibold text-xs text-foreground">{formatVND(x.v)}</Text>
                </View>
              ))}
            </View>
            <View className="flex-row flex-wrap gap-1.5">
              <Milestone ok={calc.milestones.intakeSubmitted} label="Khách đã gửi thông tin" />
              <Milestone ok={calc.milestones.draftDelivered} label="Đã giao bản nháp" />
              <Milestone ok={calc.milestones.accepted} label="Khách đã chấp nhận" />
            </View>
            <Text className="font-body text-[11px] leading-4 text-muted-foreground">
              Tiền đơn này đã vào thẳng ví huấn luyện viên, hệ thống không tự tính phần họ “xứng đáng nhận” — bạn quyết số tiền dựa
              trên các mốc trên.
            </Text>
            <Input
              label="Số tiền hoàn"
              value={amount}
              onChangeText={setAmount}
              keyboardType="number-pad"
              placeholder={`Tối đa ${calc.refundableCeiling.toLocaleString("vi-VN")}`}
              placeholderTextColor={inputPlaceholderColor}
            />
            <Tappable accessibilityLabel="Dùng toàn bộ" onPress={() => setAmount(String(calc.refundableCeiling))}>
              <Text className="font-body-semibold text-xs text-primary">Dùng toàn bộ số còn hoàn được</Text>
            </Tappable>
            <Input
              label="Ghi chú quyết định (lưu vào nhật ký)"
              value={note}
              onChangeText={setNote}
              multiline
              placeholderTextColor={inputPlaceholderColor}
            />
            <View className="flex-row gap-2">
              <Button
                size="sm"
                disabled={!!refundAmountError(amount, calc.refundableCeiling) || !!refundNoteError(note) || approve.isPending}
                onPress={() =>
                  Alert.alert("Hoàn tiền?", `Chuyển ${formatVND(Number(parseAmountInput(amount)))} thật cho khách. Không hoàn tác được.`, [
                    { text: "Không", style: "cancel" },
                    { text: "Hoàn tiền", onPress: () => approve.mutate() },
                  ])
                }
              >
                Duyệt hoàn tiền
              </Button>
              <Button size="sm" variant="destructive" disabled={!!refundNoteError(note) || deny.isPending} onPress={() => deny.mutate()}>
                Từ chối
              </Button>
            </View>
          </View>
        )
      ) : null}
    </Card>
  );
}

// ── 3. Khiếu nại phòng gym ────────────────────────────────────────────────────────────────────

function Complaints() {
  const qc = useQueryClient();
  const accent = useWorkspaceAccent();
  const [filter, setFilter] = useState("OPEN");
  const [selected, setSelected] = useState<Complaint | null>(null);

  const q = useQuery({
    queryKey: ["admin-complaints", filter],
    queryFn: () => adminService.listComplaints(filter === "ALL" ? undefined : filter),
  });
  const gymsQuery = useQuery({ queryKey: ["admin-gyms-all"], queryFn: () => adminService.listGymsForAdmin() });
  const gymName = new Map(gymRows(gymsQuery.data).map((g) => [g.id, g.approvedName ?? g.name]));
  const rows = complaintRows(q.data);

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {COMPLAINT_FILTERS.map((f) => (
          <Chip key={f.value} label={f.label} on={f.value === filter} onPress={() => setFilter(f.value)} />
        ))}
      </ScrollView>
      {q.isLoading ? (
        <ActivityIndicator className="mt-6" color={accent.primary} />
      ) : rows.length === 0 ? (
        <EmptyState icon={MessageSquareWarning} title={filter === "OPEN" ? "Không có khiếu nại mới" : "Không có khiếu nại nào"} />
      ) : (
        rows.map((c) => {
          const st = COMPLAINT_STATUS[c.status] ?? { label: c.status, tone: "neutral" as const };
          return (
            <Tappable
              key={c.id}
              accessibilityLabel="Mở khiếu nại"
              onPress={() => setSelected(c)}
            >
              <Card className="gap-1.5 p-4">
                <View className="flex-row items-start justify-between gap-2">
                  <Text className="min-w-0 flex-1 font-body-semibold text-sm text-foreground" numberOfLines={1}>
                    {gymName.get(c.gymId) ?? "Phòng gym"}
                  </Text>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </View>
                <Text className="font-body text-xs text-muted-foreground">
                  {COMPLAINT_ISSUE_LABEL[c.issueType] ?? c.issueType} · {COMPLAINT_SOURCE_LABEL[c.source] ?? c.source} · {when(c.createdAt)}
                </Text>
                <Text className="font-body text-xs text-foreground" numberOfLines={2}>
                  {c.description}
                </Text>
              </Card>
            </Tappable>
          );
        })
      )}

      <ComplaintSheet
        complaint={selected}
        gymName={selected ? gymName.get(selected.gymId) : undefined}
        onClose={() => setSelected(null)}
        onUpdated={() => qc.invalidateQueries({ queryKey: ["admin-complaints"] })}
      />
    </>
  );
}

// ── 4. Hoàn tiền gói hội viên ngoại lệ ─────────────────────────────────────────────────────────

function MembershipRefund() {
  const toast = useToast();
  const fail = useFail();
  const [id, setId] = useState("");
  const [reason, setReason] = useState<(typeof MEMBERSHIP_REFUND_REASONS)[number]["value"] | "">("");

  const refund = useMutation({
    mutationFn: () => adminService.refundGymMembership(id.trim(), reason as any),
    onSuccess: (r: any) => {
      const amount = money(r?.data?.refundAmount ?? r?.refundAmount);
      toast.show(amount > 0 ? `Đã hoàn ${formatVND(amount)} cho khách` : "Đã hoàn tiền", "success");
      setId("");
      setReason("");
    },
    onError: (e) => fail(e, "Hoàn tiền thất bại"),
  });

  return (
    <Card className="gap-3 p-4">
      <Text className="font-body text-xs leading-5 text-muted-foreground">
        Chỉ dùng khi phòng tập vi phạm/đóng cửa hoặc lỗi giao dịch — khách tự huỷ không được hoàn và không đi qua đây. Chưa có danh
        sách gói để chọn, nên cần mã gói (lấy từ khiếu nại hoặc từ đối tác).
      </Text>
      <Input
        label="Mã gói hội viên"
        value={id}
        onChangeText={setId}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        placeholderTextColor={inputPlaceholderColor}
      />
      <View className="gap-2">
        {MEMBERSHIP_REFUND_REASONS.map((r) => (
          <Chip key={r.value} label={r.label} on={reason === r.value} onPress={() => setReason(r.value)} />
        ))}
      </View>
      <Button
        variant="destructive"
        disabled={!!membershipIdError(id) || !reason || refund.isPending}
        onPress={() =>
          Alert.alert("Hoàn tiền gói hội viên?", "Tiền thật được trả lại cho khách theo số ngày còn lại. Không hoàn tác được.", [
            { text: "Không", style: "cancel" },
            { text: "Hoàn tiền", style: "destructive", onPress: () => refund.mutate() },
          ])
        }
      >
        {refund.isPending ? "Đang hoàn…" : "Hoàn tiền"}
      </Button>
      {id.length > 0 && membershipIdError(id) ? <Text className="font-body text-xs text-destructive">{membershipIdError(id)}</Text> : null}
    </Card>
  );
}

/**
 * AD-04 "Xử lý" — bốn hàng việc có tiền hoặc khiếu nại dính vào, gom vào một tab (web tách ra 3 trang +
 * một form trên dashboard). Luật và nhãn ở `features/admin/adminResolve.ts`.
 */
export default function AdminResolveScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const [section, setSection] = useState<Section>("disputes");

  const disputesQuery = useQuery({ queryKey: ["admin-disputes"], queryFn: () => adminService.listDisputedSessions() });
  const refundsQuery = useQuery({ queryKey: ["admin-refund-requests"], queryFn: () => personalizedServiceApi.listRefundRequests() });
  const openComplaints = useQuery({ queryKey: ["admin-complaints", "OPEN"], queryFn: () => adminService.listComplaints("OPEN") });

  const disputes = disputeRows(disputesQuery.data);
  const refunds = refundRows(refundsQuery.data);
  const complaintCount = complaintRows(openComplaints.data).length;

  const sections: { key: Section; label: string; count?: number; icon: typeof Gavel }[] = [
    { key: "disputes", label: "Tranh chấp buổi tập", count: disputes.length, icon: Gavel },
    { key: "refunds", label: "Hoàn tiền dịch vụ 1-1", count: refunds.length, icon: HandCoins },
    { key: "complaints", label: "Khiếu nại phòng gym", count: complaintCount, icon: MessageSquareWarning },
    { key: "membership", label: "Hoàn tiền gói hội viên", icon: ReceiptText },
  ];

  const refresh = () => [disputesQuery, refundsQuery, openComplaints].forEach((q) => void q.refetch());
  const loading = (section === "disputes" && disputesQuery.isLoading) || (section === "refunds" && refundsQuery.isLoading);

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl refreshing={disputesQuery.isRefetching} onRefresh={refresh} tintColor={accent.primary} colors={[accent.primary]} />
        }
      >
        <View className="px-5">
          <Text className="font-display text-xl text-foreground">Xử lý</Text>
          <Text className="mt-0.5 font-body text-xs text-muted-foreground">Tranh chấp, hoàn tiền và khiếu nại</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, padding: 20, paddingBottom: 12 }}>
          {sections.map((s) => (
            <Chip key={s.key} label={s.label} count={s.count} on={s.key === section} onPress={() => setSection(s.key)} />
          ))}
        </ScrollView>

        <View className="gap-3 px-5">
          {loading ? (
            <ActivityIndicator className="mt-8" color={accent.primary} />
          ) : section === "disputes" ? (
            disputesQuery.isError ? (
              <Text className="font-body text-sm text-destructive">Không tải được danh sách tranh chấp.</Text>
            ) : (
              <Disputes rows={disputes} />
            )
          ) : section === "refunds" ? (
            refundsQuery.isError ? (
              <Text className="font-body text-sm text-destructive">Không tải được yêu cầu hoàn tiền.</Text>
            ) : refunds.length === 0 ? (
              <EmptyState icon={HandCoins} title="Không có yêu cầu hoàn tiền nào" />
            ) : (
              <>
                <Text className="font-body text-xs leading-5 text-muted-foreground">
                  Đơn dịch vụ cá nhân hoá khách xin hoàn tiền. Duyệt là chuyển tiền thật.
                </Text>
                {refunds.map((o) => (
                  <RefundCase key={o.id} order={o} />
                ))}
              </>
            )
          ) : section === "complaints" ? (
            <Complaints />
          ) : (
            <MembershipRefund />
          )}
        </View>
      </ScrollView>
    </View>
  );
}
