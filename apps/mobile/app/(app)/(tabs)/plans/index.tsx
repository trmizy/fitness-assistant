import { useState } from "react";
import { Pressable, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Screen, Text, EmptyState, SkeletonCard, colors, radius, spacing } from "../../../../src/ui";
import {
  useCurrentWorkoutPlansQuery,
  useCurrentNutritionPlansQuery,
  useCycleListQuery,
} from "../../../../src/api/queries";
import { WorkoutPlanView } from "../../../../src/features/plans/WorkoutPlanView";
import { NutritionPlanView } from "../../../../src/features/plans/NutritionPlanView";
import { DecisionCard } from "../../../../src/features/plans/DecisionCard";
import { env } from "../../../../src/config/env";

type TabKey = "workout" | "nutrition";

export default function PlansHubScreen() {
  const [tab, setTab] = useState<TabKey>("workout");
  const { data: workoutPlans, isLoading: loadingWorkout } = useCurrentWorkoutPlansQuery();
  const { data: nutritionPlans, isLoading: loadingNutrition } = useCurrentNutritionPlansQuery();
  const { data: cycles } = useCycleListQuery();

  const pendingDecisionCycle = cycles?.find((c) => c.status === "ANALYZED" && !c.nextPlanId);
  const latestWorkoutPlan = workoutPlans?.find((p) => p.status === "COMPLETED");
  const latestNutritionPlan = nutritionPlans?.find((p) => p.status === "COMPLETED");

  return (
    <Screen scroll>
      {env.featureCycles && pendingDecisionCycle ? <DecisionCard cycle={pendingDecisionCycle} /> : null}

      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        {(
          [
            { key: "workout", label: "Tập luyện" },
            { key: "nutrition", label: "Dinh dưỡng" },
          ] as { key: TabKey; label: string }[]
        ).map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={{
                flex: 1,
                paddingVertical: spacing.sm,
                borderRadius: radius.full,
                alignItems: "center",
                borderWidth: 1,
                borderColor: active ? colors.accent : colors.border,
                backgroundColor: active ? colors.accent : "transparent",
              }}
            >
              <Text variant="bodyStrong" color={active ? colors.onAccent : colors.textSecondary}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {tab === "workout" ? (
        loadingWorkout ? (
          <SkeletonCard lines={3} />
        ) : latestWorkoutPlan ? (
          <WorkoutPlanView plan={latestWorkoutPlan} />
        ) : (
          <EmptyState
            icon={(p) => <Feather name="clipboard" {...p} />}
            title="Chưa có kế hoạch tập"
            description="Tạo kế hoạch tập luyện từ AI Coach để bắt đầu."
          />
        )
      ) : loadingNutrition ? (
        <SkeletonCard lines={3} />
      ) : latestNutritionPlan ? (
        <NutritionPlanView plan={latestNutritionPlan} />
      ) : (
        <EmptyState
          icon={(p) => <Feather name="pie-chart" {...p} />}
          title="Chưa có kế hoạch dinh dưỡng"
          description="Tạo kế hoạch dinh dưỡng từ AI Coach để bắt đầu."
        />
      )}
    </Screen>
  );
}
