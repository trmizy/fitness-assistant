import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon as ArrowLeft, BarbellIcon as Dumbbell, CircleNotchIcon as Loader2, FloppyDiskIcon as Save } from "@phosphor-icons/react";
import { toast } from "sonner";
import { equipmentService, profileService, type EquipmentCatalogItem } from "../../services/api";
import { EquipmentPicker, TrainingLocationPresetRow, preselectFromLegacyEquipment } from "../../components/EquipmentPicker";
import { useApp } from "../../context/AppContext";

/**
 * Profile → Training Setup → Available Equipment (gym-onboarding project
 * §26) — lets a user change gyms / update what they own AFTER onboarding,
 * without touching any historical workout data. Reuses the exact same
 * picker component the onboarding wizard's equipment step uses, so the two
 * never drift out of sync.
 */
export function TrainingEquipmentSettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useApp();

  const catalogQuery = useQuery({
    queryKey: ["equipment", "catalog"],
    queryFn: () => equipmentService.getCatalog(),
  });
  const myEquipmentQuery = useQuery({
    queryKey: ["equipment", "mine"],
    queryFn: () => equipmentService.getMyEquipment(),
  });
  // Gym-onboarding project follow-up §11 — existing-user upgrade path: if
  // this account has never saved granular equipment, offer to preselect
  // from their OLD free-text availableEquipment answers via a strict,
  // unambiguous alias dictionary (never fuzzy-matched) — still requires
  // pressing "Save" below before it becomes real UserEquipment truth.
  const profileQuery = useQuery({
    // Must match the key InBodyModule's upload flow invalidates
    // (["profile", user.id]) — the previous ["profile", "me"] key was a
    // distinct cache entry that never got refreshed after an InBody
    // upload. See docs/body-state-and-adaptive-planning.md.
    queryKey: ["profile", user?.id],
    queryFn: () => profileService.getProfile().then((r) => r.profile),
    enabled: !!user?.id,
  });
  const catalog: EquipmentCatalogItem[] = catalogQuery.data ?? [];

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);
  const [preselectedFromLegacy, setPreselectedFromLegacy] = useState(false);

  useEffect(() => {
    if (initialized || !catalogQuery.data || !myEquipmentQuery.data || !profileQuery.data) return;
    const idToSlug = new Map(catalogQuery.data.map((eq) => [eq.id, eq.slug]));
    const slugs = myEquipmentQuery.data.map((id) => idToSlug.get(id)).filter((s): s is string => !!s);
    if (slugs.length > 0) {
      setSelected(new Set(slugs));
    } else if (Array.isArray(profileQuery.data.availableEquipment) && profileQuery.data.availableEquipment.length > 0) {
      const legacyPreselect = preselectFromLegacyEquipment(profileQuery.data.availableEquipment);
      if (legacyPreselect.size > 0) {
        setSelected(legacyPreselect);
        setPreselectedFromLegacy(true);
      }
    }
    setInitialized(true);
  }, [catalogQuery.data, myEquipmentQuery.data, profileQuery.data, initialized]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const ids = catalog.filter((eq) => selected.has(eq.slug)).map((eq) => eq.id);
      return equipmentService.setMyEquipment(ids);
    },
    onSuccess: () => {
      toast.success("Đã cập nhật thiết bị tập luyện — áp dụng cho các kế hoạch mới từ giờ trở đi.");
      queryClient.invalidateQueries({ queryKey: ["equipment", "mine"] });
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error ?? "Không thể lưu thiết bị");
    },
  });

  const loading = catalogQuery.isLoading || myEquipmentQuery.isLoading || profileQuery.isLoading;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate("/client/profile")}
          className="p-2 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2">
            <Dumbbell className="w-5 h-5 text-green-400" /> Thiết bị tập luyện
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">
            Đổi phòng gym hoặc cập nhật thiết bị bạn có — không ảnh hưởng đến lịch sử tập đã ghi nhận,
            chỉ áp dụng cho các kế hoạch được tạo mới từ bây giờ.
          </p>
        </div>
      </div>

      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-5 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
          </div>
        ) : (
          <>
            {preselectedFromLegacy && (
              <div className="rounded-lg border border-sky-700/30 bg-sky-950/20 px-3 py-2 text-[11px] text-sky-200/80">
                Đã tự động đánh dấu sẵn theo lựa chọn cũ của bạn — kiểm tra lại và bấm "Lưu thiết bị" để xác nhận.
              </div>
            )}
            <TrainingLocationPresetRow
              onApply={(slugs) => {
                setSelected(new Set(slugs));
                setPreselectedFromLegacy(false);
              }}
            />
            <EquipmentPicker
              catalog={catalog}
              selectedSlugs={selected}
              onChange={(next) => {
                setSelected(next);
                setPreselectedFromLegacy(false);
              }}
            />
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending || loading}
        className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-bold bg-green-500 text-black hover:bg-green-400 shadow-lg shadow-green-500/25 disabled:opacity-60 transition-all"
      >
        {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Lưu thiết bị
      </button>
    </div>
  );
}
