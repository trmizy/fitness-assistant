import { useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { OrangeSliceIcon as Apple, ArrowLeftIcon as ArrowLeft, CircleNotchIcon as Loader2 } from "@phosphor-icons/react";
import { foodService, profileService } from "../../../services/api";
import { useApp } from "../../../context/AppContext";
import { useNutritionDisplaySettings } from "../../../hooks/useNutritionDisplaySettings";
import { kjFromKcal } from "../../../utils/units";

function macro(value: number | null | undefined) {
  return `${Math.round(value ?? 0)} g`;
}

export function FoodDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useApp();
  const { settings } = useNutritionDisplaySettings();

  const { data: food, isLoading } = useQuery({
    queryKey: ["food-detail", id],
    queryFn: () => foodService.getById(id!),
    enabled: !!id,
  });

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => (await profileService.getProfile()).profile,
    enabled: !!user?.id,
  });
  const energyUnit: "kcal" | "kj" = profile?.energyUnit ?? "kcal";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 text-rose-500 animate-spin" />
      </div>
    );
  }

  if (!food) {
    return <div className="p-6 text-center text-sm text-zinc-500">Không tìm thấy thực phẩm này.</div>;
  }

  const energy = energyUnit === "kj" ? `${kjFromKcal(food.calories)} kJ` : `${Math.round(food.calories)} kcal`;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Quay lại
      </button>

      <div className="flex gap-3 items-start">
        {food.imageUrl ? (
          <img src={food.imageUrl} alt="" className="w-16 h-16 rounded-xl object-cover flex-shrink-0" />
        ) : (
          <div className="w-16 h-16 rounded-xl bg-zinc-900 border border-zinc-800/60 flex items-center justify-center flex-shrink-0">
            <Apple className="w-7 h-7 text-rose-400" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-zinc-100 text-xl font-bold">{food.name}</h1>
          <p className="text-zinc-500 text-sm mt-0.5">Dinh dưỡng theo 100g</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {food.source && (
              <span className="text-[11px] px-2 py-1 rounded-full bg-zinc-800 text-zinc-400">
                {food.source}
              </span>
            )}
            {food.foodForm && (
              <span className="text-[11px] px-2 py-1 rounded-full bg-zinc-800 text-zinc-400">
                {food.foodForm}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4">
          <p className="text-xs text-zinc-500">Năng lượng</p>
          <p className="text-lg font-bold text-zinc-100 mt-1">{energy}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4">
          <p className="text-xs text-zinc-500">Ghi chú khẩu phần</p>
          <p className="text-sm font-semibold text-zinc-200 mt-1">
            {food.isSupplement ? "Thực phẩm bổ sung" : "Thực phẩm trong danh mục"}
          </p>
        </div>
      </div>

      {settings.showMacros && (
        <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-zinc-200 mb-3">Chi tiết macro</h2>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <p className="text-xs text-zinc-500">Protein</p>
              <p className="text-base font-bold text-zinc-100">{macro(food.protein)}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Carb</p>
              <p className="text-base font-bold text-zinc-100">{macro(food.carbs)}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Fat</p>
              <p className="text-base font-bold text-zinc-100">{macro(food.fats)}</p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-zinc-200">Nguồn dữ liệu</h2>
        <p className="text-sm text-zinc-500 mt-2">
          Trang này đọc từ danh mục thực phẩm hiện có, cùng nguồn với tìm kiếm thực phẩm
          trong phần Dinh dưỡng. Việc ghi nhật ký bữa ăn chưa liên kết trực tiếp với ID
          thực phẩm trong danh mục, nên trang chi tiết này chỉ ở chế độ xem.
        </p>
      </div>
    </div>
  );
}
