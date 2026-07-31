import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Screen, Text, Card, Badge, Button, SkeletonCard, ErrorNotice, colors, spacing } from "../../../../src/ui";
import { trainingCyclesApi } from "../../../../src/api/trainingCycles";
import { getApiErrorMessage } from "../../../../src/api/client";
import { queryKeys, useCycleQuery } from "../../../../src/api/queries";

export default function DecisionDetailScreen() {
  const { cycleId } = useLocalSearchParams<{ cycleId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: cycle, isLoading, isError, refetch } = useCycleQuery(cycleId);

  if (isLoading) {
    return (
      <Screen scroll>
        <SkeletonCard lines={4} />
      </Screen>
    );
  }

  if (isError || !cycle) {
    return (
      <Screen scroll>
        <ErrorNotice message={isError ? undefined : "Không tìm thấy chu kỳ"} onRetry={refetch} />
      </Screen>
    );
  }

  const analysis = cycle.aiAnalysis;

  const onApprove = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await trainingCyclesApi.approve(cycle.id, cycle.planId ?? "");
      await queryClient.invalidateQueries({ queryKey: queryKeys.cycleList });
      router.back();
    } catch (err) {
      setError(getApiErrorMessage(err, "Không thể xác nhận"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll>
      <Card>
        <Text variant="subheading">Nhận định chu kỳ #{cycle.cycleIndex}</Text>
        {analysis?.aiFallback ? (
          <Badge label="Kết quả dự phòng (AI không phản hồi)" tone="warning" />
        ) : null}
        {analysis ? (
          <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
            <Text variant="caption">{analysis.cycleReview.bodyCompositionTrend}</Text>
            <Text variant="caption">{analysis.cycleReview.trainingNote}</Text>
            {analysis.cycleReview.laggingMuscleGroups.length > 0 ? (
              <Text variant="caption">
                Nhóm cơ cần chú ý: {analysis.cycleReview.laggingMuscleGroups.join(", ")}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Card>

      {analysis?.keepDetails ? (
        <Card>
          <Text variant="bodyStrong" color={colors.success}>
            Giữ nguyên kế hoạch
          </Text>
          <Text variant="caption" style={{ marginTop: spacing.xs }}>
            Tăng tải: +{analysis.keepDetails.overloadIncreasePct}% · Calo: {analysis.keepDetails.calorieDelta > 0 ? "+" : ""}
            {analysis.keepDetails.calorieDelta} kcal
          </Text>
          <Text variant="caption">{analysis.keepDetails.notes}</Text>
        </Card>
      ) : null}

      {analysis?.adjustDetails ? (
        <Card>
          <Text variant="bodyStrong" color={colors.warning}>
            Điều chỉnh kế hoạch
          </Text>
          <Text variant="caption" style={{ marginTop: spacing.xs }}>
            Tối đa {analysis.adjustDetails.maxPumpSessionsPerWeek} buổi pump/tuần · Calo{" "}
            {analysis.adjustDetails.calorieDeltaPct > 0 ? "+" : ""}
            {analysis.adjustDetails.calorieDeltaPct}%
          </Text>
          {analysis.adjustDetails.pumpSetTargets.length > 0 ? (
            <Text variant="caption">Nhóm cơ tập trung: {analysis.adjustDetails.pumpSetTargets.join(", ")}</Text>
          ) : null}
          <Text variant="caption">{analysis.adjustDetails.notes}</Text>
        </Card>
      ) : null}

      {analysis?.newPlanDraft ? (
        <Card>
          <Text variant="bodyStrong" color={colors.danger}>
            Kế hoạch mới đề xuất
          </Text>
          <Text variant="caption" style={{ marginTop: spacing.xs }}>
            {analysis.newPlanDraft.goal} · {analysis.newPlanDraft.daysPerWeek} ngày/tuần ·{" "}
            {analysis.newPlanDraft.durationDays} ngày
          </Text>
          <Text variant="caption">{analysis.newPlanDraft.splitSuggestion}</Text>
          {analysis.newPlanDraft.deloadWeekFirst ? (
            <Badge label="Nên có tuần deload đầu tiên" tone="warning" />
          ) : null}
          <Text variant="caption">{analysis.newPlanDraft.notes}</Text>
        </Card>
      ) : null}

      {analysis?.mealPlanDraft ? (
        <Card>
          <Text variant="bodyStrong">Gợi ý dinh dưỡng</Text>
          <Text variant="caption" style={{ marginTop: spacing.xs }}>
            TDEE ước tính: {analysis.mealPlanDraft.estimatedTDEE} kcal · Mục tiêu:{" "}
            {analysis.mealPlanDraft.calorieTarget} kcal
          </Text>
          <Text variant="caption">
            Đạm {analysis.mealPlanDraft.macros.proteinG}g · Tinh bột {analysis.mealPlanDraft.macros.carbG}g · Béo{" "}
            {analysis.mealPlanDraft.macros.fatG}g
          </Text>
          <Text variant="caption">{analysis.mealPlanDraft.notes}</Text>
        </Card>
      ) : null}

      {error ? (
        <Text variant="caption" color={colors.danger}>
          {error}
        </Text>
      ) : null}

      {!cycle.nextPlanId ? (
        <Button label="Xác nhận áp dụng" onPress={onApprove} loading={submitting} fullWidth />
      ) : (
        <Badge label="Đã xác nhận" tone="success" />
      )}
    </Screen>
  );
}
