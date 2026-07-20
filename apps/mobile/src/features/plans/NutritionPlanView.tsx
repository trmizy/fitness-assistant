import { View } from "react-native";
import { Card, Text, spacing, colors } from "../../ui";
import type { NutritionPlan } from "../../api/plans";

const MEAL_TYPE_LABEL: Record<string, string> = {
  BREAKFAST: "Bữa sáng",
  LUNCH: "Bữa trưa",
  DINNER: "Bữa tối",
  SNACK: "Bữa phụ",
};

function MacroStat({ label, grams }: { label: string; grams: number }) {
  return (
    <View style={{ alignItems: "center", flex: 1 }}>
      <Text variant="bodyStrong">{Math.round(grams)}g</Text>
      <Text variant="small">{label}</Text>
    </View>
  );
}

export function NutritionPlanView({ plan }: { plan: NutritionPlan }) {
  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <Text variant="subheading">{plan.name}</Text>
        <View style={{ alignItems: "center", marginTop: spacing.sm }}>
          <Text variant="heading" color={colors.accent}>
            {Math.round(plan.plan.dailyCaloriesTarget)} kcal/ngày
          </Text>
        </View>
        <View style={{ flexDirection: "row", marginTop: spacing.md }}>
          <MacroStat label="Đạm" grams={plan.plan.proteinTargetGrams} />
          <MacroStat label="Tinh bột" grams={plan.plan.carbTargetGrams} />
          <MacroStat label="Béo" grams={plan.plan.fatTargetGrams} />
        </View>
      </Card>

      {plan.plan.weeklySchedule.map((day) => (
        <Card key={day.dayNumber}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text variant="bodyStrong">Ngày {day.dayNumber}</Text>
            <Text variant="caption">{Math.round(day.totalCalories)} kcal</Text>
          </View>
          {day.meals.map((meal, idx) => (
            <View key={idx} style={{ marginTop: spacing.sm }}>
              <Text variant="caption" style={{ fontWeight: "600" }}>
                {MEAL_TYPE_LABEL[meal.mealType] ?? meal.mealType} — {meal.title}
              </Text>
              {meal.items.map((item) => (
                <Text key={item.foodId} variant="small" style={{ marginLeft: spacing.sm }}>
                  {item.name} ({item.quantity}
                  {item.unit})
                </Text>
              ))}
            </View>
          ))}
        </Card>
      ))}
    </View>
  );
}
