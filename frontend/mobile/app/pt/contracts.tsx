import { useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronUp,
  FileSignature,
  MessageSquare,
  UserX,
  X,
} from "lucide-react-native";

import {
  Avatar,
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  Input,
  ScreenHeader,
  Segmented,
  Stagger,
  StaggerItem,
  Tappable,
  useToast,
} from "../../src/components/ui";
import { contractService, sessionService } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { formatVND } from "../../src/utils/currency";
import { shortDate } from "../../src/features/wallet/wallet";
import {
  CONTRACT_TABS,
  REJECT_REASONS,
  type ContractTabKey,
  type PtContract,
  clientName,
  contractTabCounts,
  contractsInTab,
  ptContractStatus,
  ptSessionStatus,
  relativeDayLabel,
  sessionActions,
  sessionTimeLabel,
} from "../../src/features/pt/pt";

/**
 * PT-07 — "Hợp đồng". Visual: the design's PTContracts (segments, request cards with accept /
 * reject, a reject sheet of canned reasons). Behaviour: web's PTContractsPage — the same reads
 * and the same five writes.
 *
 * Reachable from the dashboard, not a sixth tab: five tabs is the design's bar, and CLAUDE.md's
 * IA rule prefers a drill-down over growing the navigation.
 *
 * The design's "ký hợp đồng" step is deliberately absent — see CONTRACT_TABS in features/pt/pt.ts
 * for why (e-signing is off, so accepting lands straight on PENDING_PAYMENT).
 */
export default function PtContractsScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const uid = user?.id ?? "guest";

  const [tab, setTab] = useState<ContractTabKey>("requests");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<PtContract | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [feedbackFor, setFeedbackFor] = useState<PtContract | null>(null);
  const [feedbackText, setFeedbackText] = useState("");

  const contractsQuery = useQuery({ queryKey: ["pt-contracts", uid], queryFn: () => contractService.getByPT() });
  const counts = contractTabCounts(contractsQuery.data);
  const visible = contractsInTab(contractsQuery.data, tab);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["pt-contracts", uid] });
    void queryClient.invalidateQueries({ queryKey: ["pt-earnings", uid] });
    void queryClient.invalidateQueries({ queryKey: ["pt-sessions-upcoming", uid] });
  };
  const fail = (e: any, fallback: string) =>
    toast.show(e?.response?.data?.error?.message || e?.response?.data?.error || fallback, "danger");

  const accept = useMutation({
    mutationFn: (id: string) => contractService.acceptContract(id),
    onSuccess: () => {
      // e-sign is off, so the server moves this straight to "chờ học viên thanh toán".
      toast.show("Đã nhận hợp đồng — chờ học viên thanh toán", "success");
      setTab("waiting");
      refresh();
    },
    onError: (e) => fail(e, "Không nhận được hợp đồng"),
  });

  const reject = useMutation({
    mutationFn: () => contractService.rejectContract(rejectFor!.id, rejectReason.trim()),
    onSuccess: () => {
      toast.show("Đã từ chối yêu cầu", "success");
      setRejectFor(null);
      setRejectReason("");
      refresh();
    },
    onError: (e) => fail(e, "Không từ chối được yêu cầu"),
  });

  const feedback = useMutation({
    mutationFn: () => contractService.sendFeedback(feedbackFor!.id, feedbackText.trim()),
    onSuccess: () => {
      toast.show("Đã gửi phản hồi cho học viên", "success");
      setFeedbackFor(null);
      setFeedbackText("");
    },
    onError: (e) => fail(e, "Không gửi được phản hồi"),
  });

  const terminate = useMutation({
    mutationFn: (id: string) => contractService.terminateContract(id, "PT_CANCELLED"),
    onSuccess: () => {
      toast.show("Đã chấm dứt hợp đồng", "success");
      refresh();
    },
    onError: (e) => fail(e, "Không chấm dứt được hợp đồng"),
  });

  const askTerminate = (c: PtContract) =>
    Alert.alert(
      "Chấm dứt hợp đồng?",
      `Hợp đồng với ${clientName(c)} sẽ kết thúc và hệ thống tất toán phần buổi chưa dùng theo chính sách. Không thể hoàn tác.`,
      [
        { text: "Không", style: "cancel" },
        { text: "Chấm dứt", style: "destructive", onPress: () => terminate.mutate(c.id) },
      ],
    );

  const busy = accept.isPending || reject.isPending || terminate.isPending;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title="Hợp đồng"
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/pt/dashboard"))}
      />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl
            refreshing={contractsQuery.isRefetching}
            onRefresh={() => void contractsQuery.refetch()}
            tintColor={accent.primary}
            colors={[accent.primary]}
          />
        }
      >
        <Segmented
          options={CONTRACT_TABS.map((t) => `${t.label} · ${counts[t.key]}`)}
          value={`${CONTRACT_TABS.find((t) => t.key === tab)!.label} · ${counts[tab]}`}
          onChange={(v) => {
            const hit = CONTRACT_TABS.find((t) => v.startsWith(t.label));
            if (hit) setTab(hit.key);
          }}
        />

        {contractsQuery.isLoading ? (
          <ActivityIndicator className="mt-10" color={accent.primary} />
        ) : contractsQuery.isError ? (
          <Text className="mt-6 font-body text-sm text-destructive">
            Không tải được hợp đồng. Kéo xuống để thử lại.
          </Text>
        ) : visible.length === 0 ? (
          <View className="pt-6">
            <EmptyState
              icon={FileSignature}
              title="Không có hợp đồng nào"
              description={
                tab === "requests"
                  ? "Yêu cầu mới từ học viên sẽ hiện ở đây."
                  : "Chuyển sang mục khác để xem các hợp đồng còn lại."
              }
            />
          </View>
        ) : (
          <Stagger className="gap-3 pt-5">
            {visible.map((c) => {
              const st = ptContractStatus(c.status);
              const name = clientName(c);
              const used = Number(c.usedSessions ?? 0);
              const total = Number(c.totalSessions ?? 0);
              const isOpen = expanded === c.id;
              return (
                <StaggerItem key={c.id}>
                  <Card className="gap-3 p-4">
                    <View className="flex-row items-center gap-3">
                      <Avatar name={name} size={44} />
                      <View className="min-w-0 flex-1">
                        <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                          {name}
                        </Text>
                        <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                          {c.packageName?.trim() || "Gói huấn luyện"}
                          {total > 0 ? ` · ${used}/${total} buổi` : ""}
                        </Text>
                        {c.price != null ? (
                          <Text className="font-display text-sm text-primary">{formatVND(Number(c.price))}</Text>
                        ) : null}
                      </View>
                      <Badge tone={st.tone === "neutral" ? "info" : st.tone}>{st.label}</Badge>
                    </View>

                    {st.note ? (
                      <Text className="font-body text-xs text-muted-foreground">{st.note}</Text>
                    ) : null}

                    <View className="flex-row items-center gap-3">
                      <Text className="font-body text-xs text-muted-foreground">
                        {c.startDate ? `Bắt đầu ${shortDate(c.startDate)}` : `Gửi ${shortDate(c.createdAt)}`}
                      </Text>
                      {c.endDate ? (
                        <Text className="font-body text-xs text-muted-foreground">
                          Hết hạn {shortDate(c.endDate)}
                        </Text>
                      ) : null}
                    </View>

                    {c.status === "PENDING_REVIEW" ? (
                      <View className="flex-row gap-2">
                        <Button
                          size="sm"
                          icon={Check}
                          className="flex-1"
                          disabled={busy}
                          onPress={() => accept.mutate(c.id)}
                        >
                          Nhận
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={X}
                          className="flex-1"
                          disabled={busy}
                          onPress={() => {
                            setRejectFor(c);
                            setRejectReason("");
                          }}
                        >
                          Từ chối
                        </Button>
                      </View>
                    ) : null}

                    {c.status === "ACTIVE" ? (
                      <View className="flex-row gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={MessageSquare}
                          className="flex-1"
                          disabled={busy}
                          onPress={() => {
                            setFeedbackFor(c);
                            setFeedbackText("");
                          }}
                        >
                          Phản hồi
                        </Button>
                        <Button size="sm" variant="ghost" icon={UserX} disabled={busy} onPress={() => askTerminate(c)}>
                          Chấm dứt
                        </Button>
                      </View>
                    ) : null}

                    <Tappable
                      accessibilityLabel={isOpen ? "Ẩn buổi tập" : "Xem buổi tập"}
                      onPress={() => setExpanded(isOpen ? null : c.id)}
                      className="flex-row items-center justify-center gap-1 border-t border-border pt-3"
                    >
                      <Text className="font-body-semibold text-xs text-primary">
                        {isOpen ? "Ẩn buổi tập" : "Xem buổi tập"}
                      </Text>
                      {isOpen ? (
                        <ChevronUp size={14} color={accent.primary} />
                      ) : (
                        <ChevronDown size={14} color={accent.primary} />
                      )}
                    </Tappable>

                    {isOpen ? <ContractSessions contractId={c.id} onChanged={refresh} /> : null}
                  </Card>
                </StaggerItem>
              );
            })}
          </Stagger>
        )}
      </ScrollView>

      <BottomSheet open={!!rejectFor} onClose={() => setRejectFor(null)} title="Từ chối yêu cầu">
        <View className="gap-3 pb-2">
          <Text className="font-body text-sm text-muted-foreground">
            Học viên sẽ thấy lý do bạn chọn. Hãy nói thẳng để họ tìm được huấn luyện viên phù hợp hơn.
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {REJECT_REASONS.map((r) => (
              <Tappable
                key={r}
                accessibilityLabel={r}
                onPress={() => setRejectReason(r)}
                className={`rounded-full border px-3 py-2 ${rejectReason === r ? "border-primary bg-primary/15" : "border-border bg-panel"}`}
              >
                <Text className={`font-body text-xs ${rejectReason === r ? "text-primary" : "text-muted-foreground"}`}>
                  {r}
                </Text>
              </Tappable>
            ))}
          </View>
          <Input label="Hoặc viết lý do khác" value={rejectReason} onChangeText={setRejectReason} placeholder="Lý do từ chối" />
          <Button full disabled={!rejectReason.trim() || reject.isPending} onPress={() => reject.mutate()}>
            {reject.isPending ? "Đang gửi…" : "Từ chối yêu cầu"}
          </Button>
        </View>
      </BottomSheet>

      <BottomSheet open={!!feedbackFor} onClose={() => setFeedbackFor(null)} title="Gửi phản hồi">
        <View className="gap-3 pb-2">
          <Text className="font-body text-sm text-muted-foreground">
            Phản hồi này tới thẳng {feedbackFor ? clientName(feedbackFor) : "học viên"} dưới dạng thông báo.
          </Text>
          <Input
            label="Nội dung"
            value={feedbackText}
            onChangeText={setFeedbackText}
            placeholder="Buổi vừa rồi em giữ nhịp tốt, tuần sau tăng tạ…"
            multiline
          />
          <Button full disabled={!feedbackText.trim() || feedback.isPending} onPress={() => feedback.mutate()}>
            {feedback.isPending ? "Đang gửi…" : "Gửi phản hồi"}
          </Button>
        </View>
      </BottomSheet>
    </View>
  );
}

/**
 * The sessions of one contract, with the same actions (and the same backend-derived guards) as
 * the Lịch dạy screen — `sessionActions` is the single place those rules live.
 */
function ContractSessions({ contractId, onChanged }: { contractId: string; onChanged: () => void }) {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["pt-contract-sessions", contractId],
    queryFn: () => sessionService.getContractSessions(contractId),
  });
  const sessions = (Array.isArray(query.data) ? query.data : [])
    .filter((s: any) => s?.id && s?.scheduledStartAt)
    .sort((a: any, b: any) => String(b.scheduledStartAt).localeCompare(String(a.scheduledStartAt)));

  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ["pt-contract-sessions", contractId] });
    onChanged();
  };
  const fail = (e: any, fallback: string) =>
    toast.show(e?.response?.data?.error?.message || e?.response?.data?.error || fallback, "danger");

  const confirm = useMutation({
    mutationFn: (id: string) => sessionService.confirmSession(id),
    onSuccess: () => {
      toast.show("Đã xác nhận buổi tập", "success");
      done();
    },
    onError: (e) => fail(e, "Không xác nhận được"),
  });
  const complete = useMutation({
    mutationFn: (id: string) => sessionService.completeSession(id),
    onSuccess: () => {
      toast.show("Đã báo hoàn thành — chờ học viên xác nhận", "success");
      done();
    },
    onError: (e) => fail(e, "Không báo hoàn thành được"),
  });
  const noShow = useMutation({
    mutationFn: (id: string) => sessionService.markNoShow(id, "CLIENT"),
    onSuccess: () => {
      toast.show("Đã báo học viên vắng mặt", "success");
      done();
    },
    onError: (e) => fail(e, "Không báo vắng được"),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => sessionService.cancelSession(id, "PT huỷ buổi tập"),
    onSuccess: () => {
      toast.show("Đã huỷ buổi tập", "success");
      done();
    },
    onError: (e) => fail(e, "Không huỷ được buổi tập"),
  });

  const busy = confirm.isPending || complete.isPending || noShow.isPending || cancel.isPending;

  if (query.isLoading) return <ActivityIndicator className="py-3" color={accent.primary} />;
  if (query.isError) {
    return <Text className="py-2 font-body text-xs text-destructive">Không tải được buổi tập.</Text>;
  }
  if (sessions.length === 0) {
    return <Text className="py-2 font-body text-xs text-muted-foreground">Chưa có buổi tập nào.</Text>;
  }

  return (
    <View className="gap-2.5">
      {sessions.map((s: any) => {
        const st = ptSessionStatus(s.status);
        const actions = sessionActions(s);
        return (
          <View key={s.id} className="gap-2 rounded-xl bg-panel p-3">
            <View className="flex-row items-center gap-2">
              <Text className="min-w-0 flex-1 font-body-semibold text-xs text-foreground">
                {relativeDayLabel(s.scheduledStartAt)} · {sessionTimeLabel(s.scheduledStartAt)}
              </Text>
              <Badge tone={st.tone === "neutral" ? "info" : st.tone}>{st.label}</Badge>
            </View>
            {actions.length > 0 ? (
              <View className="flex-row flex-wrap gap-2">
                {actions.includes("confirm") ? (
                  <Button size="sm" disabled={busy} onPress={() => confirm.mutate(s.id)}>
                    Xác nhận
                  </Button>
                ) : null}
                {actions.includes("complete") ? (
                  <Button size="sm" disabled={busy} onPress={() => complete.mutate(s.id)}>
                    Đã dạy xong
                  </Button>
                ) : null}
                {actions.includes("noShow") ? (
                  <Button size="sm" variant="secondary" disabled={busy} onPress={() => noShow.mutate(s.id)}>
                    Báo vắng
                  </Button>
                ) : null}
                {actions.includes("cancel") ? (
                  <Button size="sm" variant="ghost" disabled={busy} onPress={() => cancel.mutate(s.id)}>
                    Huỷ
                  </Button>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
