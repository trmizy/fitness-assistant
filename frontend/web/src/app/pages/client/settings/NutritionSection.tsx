import { ForkKnifeIcon as Utensils } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "../../../context/AppContext";
import { profileService } from "../../../services/api";
import { SectionCard } from "./components/SectionCard";
import { ToggleRow } from "./components/ToggleRow";
import { useNutritionDisplaySettings } from "../../../hooks/useNutritionDisplaySettings";

const BUDGET_OPTIONS = [
  { value: "LOW", label: "Tiết kiệm", hint: "Trứng, đậu hũ, gà, heo nạc, cá phổ thông, gạo, khoai" },
  { value: "NORMAL", label: "Bình thường", hint: "Cân bằng giữa chi phí và đa dạng món ăn" },
  { value: "FLEXIBLE", label: "Thoải mái", hint: "Cá hồi, thịt bò, tôm... không giới hạn ngân sách" },
] as const;

// Smart Substitute region personalization — reorders which affordable food
// Gymini suggests first (never changes the budget tier itself) and adds a
// short regional cooking-style note. Research-grounded, see
// vietnamese-region-food.config.ts (fitness-service) for sources.
const REGION_OPTIONS = [
  { value: "BAC", label: "Miền Bắc", hint: "Đậu hũ, trứng, cá nước ngọt — thanh đạm, ít cay" },
  { value: "TRUNG", label: "Miền Trung", hint: "Hải sản, cay đậm đà — mắm ruốc, mắm nêm" },
  { value: "NAM", label: "Miền Nam", hint: "Cá basa, tôm — vị ngọt, nước dừa" },
] as const;

export function NutritionSection() {
  const { settings, update } = useNutritionDisplaySettings();
  const { user } = useApp();
  const queryClient = useQueryClient();

  // AI Nutrition Cycle Engine (Gymini) — persisted account-scoped
  // preference (UserProfile.nutritionBudgetLevel), same pattern as
  // UnitsSection's unitSystem/energyUnit: follows the user across devices,
  // read by nutrition-food-suggestion.engine.ts and the AI meal-plan
  // generator, not just this page.
  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => (await profileService.getProfile()).profile,
    enabled: !!user?.id,
  });
  const budgetLevel: "LOW" | "NORMAL" | "FLEXIBLE" = profile?.nutritionBudgetLevel ?? "NORMAL";
  const region: "BAC" | "TRUNG" | "NAM" | null = profile?.region ?? null;

  const budgetMutation = useMutation({
    mutationFn: (value: "LOW" | "NORMAL" | "FLEXIBLE") =>
      profileService.updateProfile({ nutritionBudgetLevel: value }),
    onSuccess: (res) => {
      queryClient.setQueryData(["profile", user?.id], res.profile);
      toast.success("Đã cập nhật ngân sách thực phẩm");
    },
    onError: () => toast.error("Không thể cập nhật — thử lại sau"),
  });

  const regionMutation = useMutation({
    mutationFn: (value: "BAC" | "TRUNG" | "NAM" | null) =>
      profileService.updateProfile({ region: value }),
    onSuccess: (res) => {
      queryClient.setQueryData(["profile", user?.id], res.profile);
      toast.success("Đã cập nhật vùng miền");
    },
    onError: () => toast.error("Không thể cập nhật — thử lại sau"),
  });

  return (
    <SectionCard
      id="nutrition"
      icon={Utensils}
      iconColor="text-lime-400"
      iconBg="bg-lime-500/10 border-lime-500/20"
      title="Dinh dưỡng"
      description="Hiển thị dinh dưỡng — đơn vị năng lượng (kcal/kJ) nằm ở mục Đơn vị đo"
    >
      <div>
        <p className="text-[11px] text-zinc-500 mb-2">Ngân sách thực phẩm</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {BUDGET_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              data-testid={`settings-nutrition-budget-${opt.value.toLowerCase()}`}
              disabled={budgetMutation.isPending}
              onClick={() => budgetMutation.mutate(opt.value)}
              className={`rounded-lg border py-2.5 px-2 text-left transition-all disabled:opacity-50 ${
                budgetLevel === opt.value
                  ? "border-emerald-500/50 bg-emerald-500/10"
                  : "border-zinc-800/60 bg-zinc-950/40 hover:border-zinc-700"
              }`}
            >
              <span
                className={`block text-xs font-semibold ${
                  budgetLevel === opt.value ? "text-emerald-300" : "text-zinc-300"
                }`}
              >
                {opt.label}
              </span>
              <span className="block text-[10px] text-zinc-500 mt-0.5">{opt.hint}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-zinc-600 mt-2">
          Gymini ưu tiên gợi ý món ăn và tạo kế hoạch dinh dưỡng phù hợp với ngân
          sách này.
        </p>
      </div>

      <div>
        <p className="text-[11px] text-zinc-500 mb-2">Vùng miền (tuỳ chọn)</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {REGION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              data-testid={`settings-nutrition-region-${opt.value.toLowerCase()}`}
              disabled={regionMutation.isPending}
              onClick={() => regionMutation.mutate(region === opt.value ? null : opt.value)}
              className={`rounded-lg border py-2.5 px-2 text-left transition-all disabled:opacity-50 ${
                region === opt.value
                  ? "border-emerald-500/50 bg-emerald-500/10"
                  : "border-zinc-800/60 bg-zinc-950/40 hover:border-zinc-700"
              }`}
            >
              <span
                className={`block text-xs font-semibold ${
                  region === opt.value ? "text-emerald-300" : "text-zinc-300"
                }`}
              >
                {opt.label}
              </span>
              <span className="block text-[10px] text-zinc-500 mt-0.5">{opt.hint}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-zinc-600 mt-2">
          Chạm lại vào vùng đang chọn để bỏ chọn. Gymini sẽ ưu tiên gợi ý và
          đề xuất đổi món theo phong cách nấu ăn vùng miền này — không bắt
          buộc, để trống thì dùng gợi ý chung toàn quốc.
        </p>
      </div>

      <ToggleRow
        label="Hiện chi tiết macro"
        description="Hiện protein/carb/fat trong Thư viện thực phẩm — calo luôn hiển thị"
        checked={settings.showMacros}
        onChange={() => update({ showMacros: !settings.showMacros })}
        testId="settings-nutrition-show-macros"
      />
      <p className="text-xs text-zinc-600">
        Mục tiêu calo/macro do hệ thống tính không thể chỉnh trong Cài đặt — vào
        trang Dinh dưỡng để đặt mục tiêu tùy chỉnh (goalMode: CUSTOM) nếu cần.
      </p>
      <p className="text-xs text-zinc-600">
        Nhắc bữa ăn / nhắc uống nước: chưa được hỗ trợ trong phiên bản này.
      </p>
    </SectionCard>
  );
}
