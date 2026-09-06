import { ForkKnifeIcon as Utensils } from "@phosphor-icons/react";
import { SectionCard } from "./components/SectionCard";
import { ToggleRow } from "./components/ToggleRow";
import { useNutritionDisplaySettings } from "../../../hooks/useNutritionDisplaySettings";

export function NutritionSection() {
  const { settings, update } = useNutritionDisplaySettings();

  return (
    <SectionCard
      id="nutrition"
      icon={Utensils}
      iconColor="text-lime-400"
      iconBg="bg-lime-500/10 border-lime-500/20"
      title="Dinh dưỡng"
      description="Hiển thị dinh dưỡng — đơn vị năng lượng (kcal/kJ) nằm ở mục Đơn vị đo"
    >
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
