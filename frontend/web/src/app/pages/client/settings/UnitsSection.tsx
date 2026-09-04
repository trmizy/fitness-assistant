import { RulerIcon as Ruler } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "../../../context/AppContext";
import { profileService } from "../../../services/api";
import { SectionCard } from "./components/SectionCard";
import { lbFromKg, feetInchesFromCm } from "../../../utils/units";

/**
 * Settings → Units. Persisted account-scoped preference (UserProfile
 * .unitSystem/.energyUnit — new columns, additive migration, see impact
 * analysis §9), not localStorage — a user's unit choice should follow them
 * across devices. Canonical storage (heightCm, currentWeight, ...) never
 * changes; this only flips which unit ProfilePage's height/weight fields
 * display and accept (wired there), and which unit Food Library/Detail
 * shows calories in (wired there).
 */
export function UnitsSection() {
  const { user } = useApp();
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => (await profileService.getProfile()).profile,
    enabled: !!user?.id,
  });

  const unitSystem: "metric" | "imperial" = profile?.unitSystem ?? "metric";
  const energyUnit: "kcal" | "kj" = profile?.energyUnit ?? "kcal";

  const mutation = useMutation({
    mutationFn: (patch: { unitSystem?: string; energyUnit?: string }) =>
      profileService.updateProfile(patch),
    onSuccess: (res) => {
      queryClient.setQueryData(["profile", user?.id], res.profile);
      toast.success("Đã cập nhật đơn vị hiển thị");
    },
    onError: () => toast.error("Không thể cập nhật — thử lại sau"),
  });

  const sampleHeightCm = profile?.heightCm ?? 175;
  const sampleWeightKg = profile?.currentWeight ?? 70;
  const { feet, inches } = feetInchesFromCm(sampleHeightCm);

  return (
    <SectionCard
      id="units"
      icon={Ruler}
      iconColor="text-sky-400"
      iconBg="bg-sky-500/10 border-sky-500/20"
      title="Đơn vị đo"
      description="Chiều cao, cân nặng và năng lượng — dữ liệu gốc luôn lưu ở hệ mét, chỉ đổi cách hiển thị"
    >
      <div>
        <p className="text-[11px] text-zinc-500 mb-2">Hệ đo lường (chiều cao / cân nặng)</p>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { value: "metric", label: "Mét (cm / kg)" },
              { value: "imperial", label: "Anh-Mỹ (ft-in / lb)" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              data-testid={`settings-unit-system-${opt.value}`}
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ unitSystem: opt.value })}
              className={`rounded-lg border py-2.5 text-xs font-semibold transition-all disabled:opacity-50 ${
                unitSystem === opt.value
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                  : "border-zinc-800/60 bg-zinc-950/40 text-zinc-400 hover:border-zinc-700"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-zinc-500 mt-2" data-testid="settings-unit-preview">
          Xem trước — Hồ sơ của bạn:{" "}
          {unitSystem === "metric"
            ? `${sampleHeightCm} cm, ${sampleWeightKg} kg`
            : `${feet}'${inches}", ${lbFromKg(sampleWeightKg)} lb`}
        </p>
      </div>

      <div>
        <p className="text-[11px] text-zinc-500 mb-2">Năng lượng (calo)</p>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { value: "kcal", label: "kcal" },
              { value: "kj", label: "kJ" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              data-testid={`settings-energy-unit-${opt.value}`}
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ energyUnit: opt.value })}
              className={`rounded-lg border py-2.5 text-xs font-semibold transition-all disabled:opacity-50 ${
                energyUnit === opt.value
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                  : "border-zinc-800/60 bg-zinc-950/40 text-zinc-400 hover:border-zinc-700"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-zinc-600 mt-2">
          Áp dụng cho lượng calo hiển thị trong Thư viện thực phẩm. Mục tiêu calo do
          hệ thống tính vẫn giữ nguyên đơn vị kcal gốc.
        </p>
      </div>
    </SectionCard>
  );
}
