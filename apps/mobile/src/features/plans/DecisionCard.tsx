import { View } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Card, Text, Badge, colors, spacing } from "../../ui";
import type { CycleDecision, TrainingCycle } from "../../api/trainingCycles";

const DECISION_CONFIG: Record<
  CycleDecision,
  { label: string; tone: "success" | "warning" | "danger"; icon: keyof typeof Feather.glyphMap }
> = {
  KEEP: { label: "Giữ nguyên kế hoạch", tone: "success", icon: "check-circle" },
  ADJUST: { label: "Điều chỉnh kế hoạch", tone: "warning", icon: "sliders" },
  NEW_PLAN: { label: "Cần kế hoạch mới", tone: "danger", icon: "refresh-cw" },
};

interface DecisionCardProps {
  cycle: TrainingCycle;
}

// Card quyết định 3 nhánh sau khi chu kỳ ANALYZED (xanh KEEP / vàng
// ADJUST / đỏ NEW_PLAN) — chỉ hiện khi chưa approve (nextPlanId chưa có).
export function DecisionCard({ cycle }: DecisionCardProps) {
  const router = useRouter();
  if (!cycle.decision) return null;
  const cfg = DECISION_CONFIG[cycle.decision];

  return (
    <Card onPress={() => router.push(`/(app)/(tabs)/plans/decision?cycleId=${cycle.id}`)}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Feather name={cfg.icon} size={20} color={colors[cfg.tone]} />
          <Text variant="bodyStrong">Chu kỳ #{cycle.cycleIndex} đã phân tích xong</Text>
        </View>
        <Badge label={cfg.label} tone={cfg.tone} />
      </View>
      <Text variant="caption" style={{ marginTop: spacing.xs }}>
        Xem đề xuất chi tiết từ AI và xác nhận áp dụng
      </Text>
    </Card>
  );
}
