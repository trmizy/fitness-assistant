import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, FileText } from "lucide-react-native";

import { EmptyState, ScreenHeader } from "../../../src/components/ui";
import { contractService, ptCoachService } from "../../../src/services/api";
import { useApp } from "../../../src/context/AppContext";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { PlanDraftBuilder } from "../../../src/features/pt/PlanDraftBuilder";
import { clientName, type PtContract } from "../../../src/features/pt/pt";

/**
 * 14B.2 (PG-A6) — "Giao kế hoạch": web `AssignPlanModal`, as its own screen because the builder is
 * long. The coach creates AND assigns a training plan to one student; fitness-service creates the
 * program and its schedule through the same manual-program path the client uses, and re-checks the
 * ACTIVE contract itself. The route carries the contract id, like the student screen.
 */
export default function AssignPlanScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const { contractId } = useLocalSearchParams<{ contractId: string }>();

  const contractsQuery = useQuery({
    queryKey: ["pt-contracts", user?.id ?? "guest"],
    queryFn: () => contractService.getByPT(),
  });
  const contracts: PtContract[] = Array.isArray(contractsQuery.data) ? (contractsQuery.data as PtContract[]) : [];
  const contract = contracts.find((c) => c.id === String(contractId ?? "")) ?? null;
  const back = () => (router.canGoBack() ? router.back() : router.replace("/pt/students"));

  if (contractsQuery.isLoading) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Giao kế hoạch" onBack={back} />
        <ActivityIndicator className="mt-12" color={accent.primary} />
      </View>
    );
  }

  if (!contract || contract.status !== "ACTIVE") {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Giao kế hoạch" onBack={back} />
        <View className="p-5">
          <EmptyState
            icon={contract ? ClipboardList : FileText}
            title={contract ? "Hợp đồng chưa hoạt động" : "Không tìm thấy hợp đồng"}
            description="Chỉ giao kế hoạch được cho học viên có hợp đồng đang hoạt động."
          />
        </View>
      </View>
    );
  }

  const name = clientName(contract);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Giao kế hoạch" onBack={back} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32, gap: 16 }} keyboardShouldPersistTaps="handled">
        {/* The server replaces the student's unfinished schedule (createManualProgram's default
            replaceExisting); web assigns silently — the trainer should know before pressing. */}
        <Text className="rounded-xl border border-warning/30 bg-warning/10 p-3 font-body text-xs leading-5 text-foreground">
          Kế hoạch mới sẽ thay các buổi chưa tập trong lịch hiện tại của {name}. Buổi đã tập giữ nguyên. Học viên nhận thông báo
          khi kế hoạch được giao.
        </Text>
        <PlanDraftBuilder
          clientUserId={contract.clientUserId}
          title={`Kế hoạch tập cho ${name}`}
          initialName={`Kế hoạch cho ${name}`}
          showGoal
          defaultWeeks={4}
          submitLabel="Tạo & giao kế hoạch"
          submittingLabel="Đang giao…"
          submitIcon={ClipboardList}
          successMessage="Đã tạo và giao kế hoạch cho học viên"
          errorFallback="Không thể tạo kế hoạch"
          onSubmit={(payload) => ptCoachService.createAndAssignPlan(contract.clientUserId, payload)}
          onDone={() => {
            void queryClient.invalidateQueries({ queryKey: ["pt-client-fitness-summary", contract.clientUserId] });
            back();
          }}
        />
      </ScrollView>
    </View>
  );
}
