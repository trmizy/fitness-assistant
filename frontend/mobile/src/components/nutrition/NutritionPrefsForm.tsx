import { Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Tappable, useToast } from "../ui";
import { profileService, type NutritionBudgetLevel, type NutritionRegion } from "../../services/api";
import { useApp } from "../../context/AppContext";
import {
  BUDGET_OPTIONS,
  REGION_OPTIONS,
  normalizeBudgetLevel,
  normalizeRegion,
  regionToSend,
} from "../../features/nutrition/foodSuggestions";

/**
 * WB-14 — web's Settings › Dinh dưỡng: food budget + optional regional cooking style. Both write
 * the same UserProfile fields (`PUT /profile/me`) and feed food suggestions / nutrition plans.
 * Rendered in Settings (its web home) and inside the nutrition card's sheet — one component so the
 * two can never disagree.
 */
export function NutritionPrefsForm() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();

  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => (await profileService.getProfile()).profile,
    enabled: !!user?.id,
  });
  const budgetLevel = normalizeBudgetLevel(profileQuery.data?.nutritionBudgetLevel);
  const region = normalizeRegion(profileQuery.data?.region);

  const mutation = useMutation({
    mutationFn: (patch: { nutritionBudgetLevel?: NutritionBudgetLevel; region?: NutritionRegion }) => profileService.updateProfile(patch),
    onSuccess: (res, patch) => {
      if (res?.profile) queryClient.setQueryData(["profile", user?.id], res.profile);
      else void queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
      void queryClient.invalidateQueries({ queryKey: ["food-suggestions"] });
      toast.show(patch.region ? "Đã cập nhật vùng miền" : "Đã cập nhật ngân sách thực phẩm", "success");
    },
    onError: () => toast.show("Không thể cập nhật — thử lại sau", "danger"),
  });

  return (
    <View className="gap-4">
      <View>
        <Text className="mb-2 font-body text-[11px] text-muted-foreground">Ngân sách thực phẩm</Text>
        <View className="gap-2">
          {BUDGET_OPTIONS.map((opt) => (
            <PrefOption
              key={opt.value}
              label={opt.label}
              hint={opt.hint}
              selected={budgetLevel === opt.value}
              disabled={mutation.isPending}
              onPress={() => {
                if (budgetLevel !== opt.value) mutation.mutate({ nutritionBudgetLevel: opt.value });
              }}
            />
          ))}
        </View>
        <Text className="mt-2 font-body text-xs text-muted-foreground">
          Gymini ưu tiên gợi ý món ăn và tạo kế hoạch dinh dưỡng phù hợp với ngân sách này.
        </Text>
      </View>

      <View>
        <Text className="mb-2 font-body text-[11px] text-muted-foreground">Vùng miền (tuỳ chọn)</Text>
        <View className="gap-2">
          {REGION_OPTIONS.map((opt) => (
            <PrefOption
              key={opt.value}
              label={opt.label}
              hint={opt.hint}
              selected={region === opt.value}
              disabled={mutation.isPending}
              onPress={() => {
                const next = regionToSend(region, opt.value);
                if (next) mutation.mutate({ region: next });
              }}
            />
          ))}
        </View>
        <Text className="mt-2 font-body text-xs text-muted-foreground">
          Gymini sẽ ưu tiên gợi ý và đề xuất đổi món theo phong cách nấu ăn vùng miền này — không bắt buộc, để trống thì dùng gợi
          ý chung toàn quốc.
        </Text>
      </View>
    </View>
  );
}

function PrefOption({
  label,
  hint,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  hint: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Tappable
      disabled={disabled}
      onPress={onPress}
      className={`rounded-xl border px-3 py-2.5 ${selected ? "border-primary/50 bg-primary/10" : "border-border bg-panel"} ${disabled ? "opacity-50" : ""}`}
    >
      <Text className={`font-body-semibold text-xs ${selected ? "text-primary" : "text-foreground"}`}>{label}</Text>
      <Text className="mt-0.5 font-body text-[10px] text-muted-foreground">{hint}</Text>
    </Tappable>
  );
}
