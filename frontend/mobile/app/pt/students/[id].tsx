import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Dumbbell, FileText, MessageCircle } from "lucide-react-native";

import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ScreenHeader,
  Stagger,
  StaggerItem,
} from "../../../src/components/ui";
import { contractService, sessionService } from "../../../src/services/api";
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
