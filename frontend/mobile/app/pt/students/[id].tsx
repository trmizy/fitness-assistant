import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Dumbbell, FileText, MessageCircle, Route, Sparkles } from "lucide-react-native";

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
  useToast,
} from "../../../src/components/ui";
import { contractService, ptCoachService, sessionService } from "../../../src/services/api";
import { useApp } from "../../../src/context/AppContext";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { formatVND } from "../../../src/utils/currency";
import {
  clientName,
  goalLabel,
  ptContractStatus,
  ptSessionStatus,
  relativeDayLabel,
  sessionTimeLabel,
  type PtContract,
} from "../../../src/features/pt/pt";
import { shortDate } from "../../../src/features/wallet/wallet";

/**
 * PT-03 — one student. Web routes this by clientUserId and then guesses which contract is meant
 * (most recent ACTIVE, else newest); here the route carries the CONTRACT id, because the roster
 * row the trainer tapped IS a contract and a client with two packages must not collapse into one
 * screen. clientUserId is read back off the contract for the calls that need it.
 *
 * Phase 10 shows the coaching relationship and its sessions. The client's roadmap, fitness
 * summary and plan assignment (web's other four tabs, WB-13) belong to Phase 11 — no placeholder
 * card pretends otherwise.
 */
export default function PtStudentDetailScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const { user } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const contractId = String(id ?? "");

  const contractsQuery = useQuery({
    queryKey: ["pt-contracts", user?.id ?? "guest"],
    queryFn: () => contractService.getByPT(),
  });
  const contracts: PtContract[] = Array.isArray(contractsQuery.data) ? (contractsQuery.data as PtContract[]) : [];
  const contract = contracts.find((c) => c.id === contractId) ?? null;

  const sessionsQuery = useQuery({
    queryKey: ["pt-contract-sessions", contractId],
    queryFn: () => sessionService.getContractSessions(contractId),
    enabled: !!contract,
  });
  const sessions = (Array.isArray(sessionsQuery.data) ? sessionsQuery.data : [])
    .filter((s: any) => s?.id)
    .sort((a: any, b: any) => String(b.scheduledStartAt ?? "").localeCompare(String(a.scheduledStartAt ?? "")));

  const back = () => (router.canGoBack() ? router.back() : router.replace("/pt/students"));

  if (contractsQuery.isLoading) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Học viên" onBack={back} />
        <ActivityIndicator className="mt-12" color={accent.primary} />
      </View>
    );
  }

  if (!contract) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Học viên" onBack={back} />
        <View className="p-5">
          <EmptyState
            icon={FileText}
            title="Không tìm thấy hợp đồng"
            description="Hợp đồng này không còn trong danh sách của bạn."
          />
        </View>
      </View>
    );
  }

  const name = clientName(contract);
  const st = ptContractStatus(contract.status);
  const used = Number(contract.usedSessions ?? 0);
  const total = Number(contract.totalSessions ?? 0);
  const remaining = Math.max(0, total - used);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Học viên" onBack={back} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }}>
        <Stagger className="gap-5">
          <StaggerItem>
            <Card className="gap-4 p-5">
              <View className="flex-row items-center gap-4">
                <Avatar name={name} size={60} />
                <View className="min-w-0 flex-1">
                  <Text className="font-display text-xl text-foreground" numberOfLines={1}>
                    {name}
                  </Text>
                  <Text className="mt-0.5 font-body text-sm text-muted-foreground" numberOfLines={1}>
                    {goalLabel(contract.clientProfile?.goal)}
                  </Text>
                  <View className="mt-2 flex-row flex-wrap items-center gap-2">
                    <Badge tone={st.tone === "neutral" ? "info" : st.tone}>{st.label}</Badge>
                    {total > 0 ? <Badge tone="info">{`${used}/${total} buổi`}</Badge> : null}
                  </View>
                </View>
              </View>
              {st.note ? <Text className="font-body text-xs text-muted-foreground">{st.note}</Text> : null}
              <View className="flex-row gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={MessageCircle}
                  className="flex-1"
                  onPress={() => router.push("/client/messages")}
                >
                  Nhắn tin
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={CalendarDays}
                  className="flex-1"
                  onPress={() => router.push("/pt/schedule")}
                >
                  Lịch dạy
                </Button>
              </View>
            </Card>
          </StaggerItem>

          <StaggerItem>
            <Text className="mb-3 px-1 font-display text-lg text-foreground">Hợp đồng</Text>
            <Card className="gap-2.5 p-4">
              <Row label="Gói dịch vụ" value={contract.packageName?.trim() || "Gói huấn luyện"} />
              <Row label="Trạng thái" value={st.label} />
              <Row label="Buổi tập" value={total > 0 ? `${used} / ${total}` : `${used} buổi`} />
              {total > 0 ? <Row label="Còn lại" value={`${remaining} buổi`} /> : null}
              <Row label="Bắt đầu" value={shortDate(contract.startDate) || "—"} />
              <Row label="Hết hạn" value={shortDate(contract.endDate) || "—"} />
              {contract.price != null ? <Row label="Giá trị" value={formatVND(Number(contract.price))} /> : null}
              {total > 0 ? (
                <View className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel">
                  <View
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.min(100, Math.round((used / total) * 100))}%` }}
                  />
                </View>
              ) : null}
            </Card>
          </StaggerItem>

          {contract.status === "ACTIVE" ? (
            <StaggerItem>
              <ClientRoadmapCard clientUserId={contract.clientUserId} clientName={name} />
            </StaggerItem>
          ) : null}

          <StaggerItem>
            <View className="mb-3 flex-row items-center justify-between px-1">
              <Text className="font-display text-lg text-foreground">Buổi tập</Text>
              <Text className="font-body text-sm text-muted-foreground">{sessions.length}</Text>
            </View>
            {sessionsQuery.isLoading ? (
              <ActivityIndicator color={accent.primary} />
            ) : sessionsQuery.isError ? (
              <Text className="font-body text-sm text-destructive">Không tải được danh sách buổi tập.</Text>
            ) : sessions.length === 0 ? (
              <EmptyState
                icon={Dumbbell}
                title="Chưa có buổi nào"
                description="Buổi tập sẽ hiện ở đây khi học viên đặt lịch."
              />
            ) : (
              <Card className="overflow-hidden">
                {sessions.map((s: any, i: number) => {
                  const ss = ptSessionStatus(s.status);
                  return (
                    <View key={s.id} className={`flex-row items-center gap-3 p-4 ${i > 0 ? "border-t border-border" : ""}`}>
                      <View className="min-w-0 flex-1">
                        <Text className="font-body-semibold text-sm text-foreground">
                          {relativeDayLabel(s.scheduledStartAt)} · {sessionTimeLabel(s.scheduledStartAt)}
                        </Text>
                        {s.sessionMode ? (
                          <Text className="font-body text-xs text-muted-foreground">
                            {s.sessionMode === "ONLINE" ? "Online" : "Trực tiếp"}
                          </Text>
                        ) : null}
                      </View>
                      <Badge tone={ss.tone === "neutral" ? "info" : ss.tone}>{ss.label}</Badge>
                    </View>
                  );
                })}
              </Card>
            )}
          </StaggerItem>
        </Stagger>
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="font-body text-sm text-muted-foreground">{label}</Text>
      <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/**
 * WB-13 - the client's fitness roadmap, seen from the coach's chair.
 *
 * The boundary is the one Phase 0.3 settled and fitness-service enforces: the CLIENT is the only
 * one who activates, advances, rebuilds or archives a roadmap; a coach may only read it and
 * propose a DRAFT the client then reviews. So this card has exactly one write, and it says out
 * loud that the client decides.
 *
 * `getClientRoadmap` deliberately returns the active roadmap and any pending draft separately, so
 * a draft already waiting on the client is not mistaken for "no roadmap" and offered a second one.
 */
function ClientRoadmapCard({ clientUserId, clientName }: { clientUserId: string; clientName: string }) {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [goalType, setGoalType] = useState("MUSCLE_GAIN");

  const query = useQuery({
    queryKey: ["pt-client-roadmap", clientUserId],
    queryFn: () => ptCoachService.getClientRoadmap(clientUserId),
  });
  const active = query.data?.activeRoadmap ?? null;
  const pending = query.data?.pendingDraft ?? null;

  const draft = useMutation({
    mutationFn: () =>
      ptCoachService.createRoadmapDraft(clientUserId, {
        name: name.trim(),
        goalType,
        plannedStartAt: new Date().toISOString(),
      }),
    onSuccess: () => {
      toast.show("\u0110\u00e3 g\u1eedi l\u1ed9 tr\u00ecnh \u0111\u1ec1 xu\u1ea5t \u2014 ch\u1edd h\u1ecdc vi\u00ean duy\u1ec7t", "success");
      setOpen(false);
      setName("");
      void queryClient.invalidateQueries({ queryKey: ["pt-client-roadmap", clientUserId] });
    },
    onError: (e: any) =>
      toast.show(
        e?.response?.data?.error?.message || e?.response?.data?.error || "Kh\u00f4ng g\u1eedi \u0111\u01b0\u1ee3c l\u1ed9 tr\u00ecnh \u0111\u1ec1 xu\u1ea5t",
        "danger",
      ),
  });

  return (
    <View>
      <View className="mb-3 flex-row items-center gap-2 px-1">
        <Route size={16} color={accent.primary} />
        <Text className="font-display text-lg text-foreground">L\u1ed9 tr\u00ecnh</Text>
      </View>
      <Card className="gap-2.5 p-4">
        {query.isLoading ? (
          <ActivityIndicator className="self-start" color={accent.primary} />
        ) : query.isError ? (
          <Text className="font-body text-sm text-muted-foreground">
            Ch\u01b0a xem \u0111\u01b0\u1ee3c l\u1ed9 tr\u00ecnh c\u1ee7a h\u1ecdc vi\u00ean n\u00e0y.
          </Text>
        ) : active ? (
          <>
            <Text className="font-body-semibold text-sm text-foreground">{(active as any).name ?? "L\u1ed9 tr\u00ecnh \u0111ang ch\u1ea1y"}</Text>
            <Text className="font-body text-xs text-muted-foreground">
              H\u1ecdc vi\u00ean \u0111ang theo m\u1ed9t l\u1ed9 tr\u00ecnh. Ch\u1ec9 h\u1ecdc vi\u00ean m\u1edbi \u0111\u1ed5i \u0111\u01b0\u1ee3c giai \u0111o\u1ea1n.
            </Text>
          </>
        ) : pending ? (
          <>
            <Badge tone="warning">Ch\u1edd h\u1ecdc vi\u00ean duy\u1ec7t</Badge>
            <Text className="font-body text-xs text-muted-foreground">
              \u0110\u00e3 c\u00f3 m\u1ed9t l\u1ed9 tr\u00ecnh \u0111\u1ec1 xu\u1ea5t \u0111ang ch\u1edd {clientName} xem. Kh\u00f4ng c\u1ea7n g\u1eedi th\u00eam.
            </Text>
          </>
        ) : (
          <>
            <Text className="font-body text-sm text-muted-foreground">
              H\u1ecdc vi\u00ean ch\u01b0a c\u00f3 l\u1ed9 tr\u00ecnh n\u00e0o. B\u1ea1n c\u00f3 th\u1ec3 \u0111\u1ec1 xu\u1ea5t m\u1ed9t b\u1ea3n nh\u00e1p \u2014 h\u1ecdc vi\u00ean quy\u1ebft \u0111\u1ecbnh c\u00f3 k\u00edch ho\u1ea1t hay kh\u00f4ng.
            </Text>
            <Button size="sm" icon={Sparkles} onPress={() => setOpen(true)}>
              \u0110\u1ec1 xu\u1ea5t l\u1ed9 tr\u00ecnh
            </Button>
          </>
        )}
      </Card>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="\u0110\u1ec1 xu\u1ea5t l\u1ed9 tr\u00ecnh">
        <View className="gap-3 pb-2">
          <Text className="font-body text-sm text-muted-foreground">
            B\u1ea3n nh\u00e1p n\u00e0y g\u1eedi t\u1edbi {clientName} \u0111\u1ec3 xem x\u00e9t. B\u1ea1n kh\u00f4ng k\u00edch ho\u1ea1t thay h\u1ecd \u0111\u01b0\u1ee3c.
          </Text>
          <Input label="T\u00ean l\u1ed9 tr\u00ecnh *" value={name} onChangeText={setName} placeholder="12 tu\u1ea7n t\u0103ng c\u01a1" />
          <Segmented
            options={["T\u0103ng c\u01a1", "Gi\u1ea3m m\u1ee1", "Duy tr\u00ec"]}
            value={goalType === "MUSCLE_GAIN" ? "T\u0103ng c\u01a1" : goalType === "WEIGHT_LOSS" ? "Gi\u1ea3m m\u1ee1" : "Duy tr\u00ec"}
            onChange={(v) =>
              setGoalType(v === "T\u0103ng c\u01a1" ? "MUSCLE_GAIN" : v === "Gi\u1ea3m m\u1ee1" ? "WEIGHT_LOSS" : "MAINTENANCE")
            }
          />
          <Button full disabled={!name.trim() || draft.isPending} onPress={() => draft.mutate()}>
            {draft.isPending ? "\u0110ang g\u1eedi\u2026" : "G\u1eedi \u0111\u1ec1 xu\u1ea5t"}
          </Button>
        </View>
      </BottomSheet>
    </View>
  );
}
