import { useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Plus, Trash2 } from "lucide-react-native";

import { Badge, BottomSheet, Button, Card, Input, Tappable, inputPlaceholderColor, useToast } from "../../components/ui";
import { marketplaceService, trainingPackageService, type TrainingPackage } from "../../services/api";
import { designTokens } from "../../theme/colors";
import { useWorkspaceAccent } from "../../theme/workspace";
import { formatVND } from "../../utils/currency";
import { apiErrorMessage } from "./aiPlans";
import { packageFormError, packagePayload, type PackageForm } from "./packageForm";

/**
 * 14B.6 (PG-B7) — web PlanMarketplacePage's "Gói bán" tab for a PT: turn one of their APPROVED
 * published plans into a paid package, list their packages, and take one off sale. ai-service
 * re-checks that the plan is approved and that the seller may set a price.
 */
const EMPTY: PackageForm = { name: "", price: "", durationWeeks: "", description: "" };

export function SellPackagesSection() {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const plansQuery = useQuery({ queryKey: ["marketplace", "mine"], queryFn: () => marketplaceService.listMine() });
  const packagesQuery = useQuery({ queryKey: ["packages", "mine"], queryFn: () => trainingPackageService.listMine() });
  const approved = (plansQuery.data ?? []).filter((p) => p.moderationStatus === "APPROVED");
  const [forPlan, setForPlan] = useState<{ id: string; title: string } | null>(null);
  const [form, setForm] = useState<PackageForm>(EMPTY);
  const error = packageFormError(form);

  const create = useMutation({
    mutationFn: () => trainingPackageService.create(packagePayload(forPlan!.id, form)),
    onSuccess: () => {
      toast.show("Đã tạo gói bán", "success");
      setForPlan(null);
      setForm(EMPTY);
      void qc.invalidateQueries({ queryKey: ["packages"] });
    },
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể tạo gói bán"), "danger"),
  });
  const archive = useMutation({
    mutationFn: (id: string) => trainingPackageService.archive(id),
    onSuccess: () => {
      toast.show("Đã gỡ gói bán", "success");
      void qc.invalidateQueries({ queryKey: ["packages"] });
    },
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể gỡ gói bán"), "danger"),
  });

  const packages: TrainingPackage[] = packagesQuery.data ?? [];
  return (
    <View className="mt-6 gap-3">
      <Text className="font-display text-base text-foreground">Gói bán của tôi</Text>
      <Card className="gap-2 p-4">
        <Text className="font-body-semibold text-sm text-foreground">Tạo gói bán từ kế hoạch đã duyệt</Text>
        {plansQuery.isLoading ? (
          <ActivityIndicator color={accent.primary} />
        ) : approved.length === 0 ? (
          <Text className="font-body text-xs text-muted-foreground">Cần ít nhất một kế hoạch đã được admin duyệt trước khi tạo gói bán.</Text>
        ) : (
          approved.map((p) => (
            <Tappable
              key={p.id}
              onPress={() => {
                setForm(EMPTY);
                setForPlan({ id: p.id, title: p.title });
              }}
              className="flex-row items-center justify-between rounded-xl border border-border bg-panel px-3 py-3"
            >
              <Text className="min-w-0 flex-1 font-body-semibold text-sm text-foreground" numberOfLines={1}>
                {p.title}
              </Text>
              <View className="flex-row items-center gap-1">
                <Plus size={14} color={accent.primary} />
                <Text className="font-body-semibold text-xs text-primary">Tạo gói bán</Text>
              </View>
            </Tappable>
          ))
        )}
      </Card>

      {packagesQuery.isLoading ? (
        <ActivityIndicator color={accent.primary} />
      ) : packages.length === 0 ? (
        <View className="items-center gap-2 py-6">
          <Package size={28} color={designTokens.mutedForeground} />
          <Text className="font-body text-sm text-muted-foreground">Bạn chưa có gói bán nào.</Text>
        </View>
      ) : (
        packages.map((pkg) => (
          <Card key={pkg.id} className="flex-row items-center gap-3 p-4">
            <View className="min-w-0 flex-1 gap-1">
              <View className="flex-row items-center gap-2">
                <Text className="min-w-0 flex-shrink font-body-semibold text-sm text-foreground" numberOfLines={1}>
                  {pkg.name}
                </Text>
                <Badge tone={pkg.status === "ACTIVE" ? "success" : "neutral"}>{pkg.status === "ACTIVE" ? "Đang bán" : "Đã gỡ"}</Badge>
              </View>
              <Text className="font-body-semibold text-xs text-primary">
                {formatVND(pkg.price)}
                {pkg.durationWeeks ? ` · ${pkg.durationWeeks} tuần` : ""}
              </Text>
              {pkg.publishedPlan?.title ? (
                <Text className="font-body text-[11px] text-muted-foreground" numberOfLines={1}>{`Từ kế hoạch: ${pkg.publishedPlan.title}`}</Text>
              ) : null}
            </View>
            {pkg.status === "ACTIVE" ? (
              <Tappable
                accessibilityLabel="Gỡ gói bán"
                disabled={archive.isPending}
                hitSlop={8}
                className="p-2"
                onPress={() =>
                  Alert.alert("Gỡ gói bán?", `"${pkg.name}" sẽ không còn hiện trên chợ. Người đã mua vẫn giữ quyền dùng.`, [
                    { text: "Không", style: "cancel" },
                    { text: "Gỡ", style: "destructive", onPress: () => archive.mutate(pkg.id) },
                  ])
                }
              >
                <Trash2 size={18} color={designTokens.mutedForeground} />
              </Tappable>
            ) : null}
          </Card>
        ))
      )}

      <BottomSheet open={forPlan != null} onClose={() => setForPlan(null)} title="Tạo gói bán">
        <View className="gap-3 pb-2">
          <Text className="font-body text-xs text-muted-foreground">{`Từ kế hoạch: ${forPlan?.title ?? ""}`}</Text>
          <Input label="Tên gói bán" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} maxLength={120} />
          <View className="flex-row gap-2">
            <Input className="flex-1" label="Giá (VND)" value={form.price} onChangeText={(v) => setForm((f) => ({ ...f, price: v.replace(/[^\d]/g, "") }))} keyboardType="number-pad" />
            <Input className="flex-1" label="Số tuần (tuỳ chọn)" value={form.durationWeeks} onChangeText={(v) => setForm((f) => ({ ...f, durationWeeks: v.replace(/[^\d]/g, "") }))} keyboardType="number-pad" />
          </View>
          <Input
            label="Mô tả (tuỳ chọn)"
            value={form.description}
            onChangeText={(v) => setForm((f) => ({ ...f, description: v }))}
            placeholder="Ai nên mua, gói gồm những gì…"
            placeholderTextColor={inputPlaceholderColor}
            multiline
            style={{ height: 80, paddingTop: 10, paddingBottom: 10, textAlignVertical: "top" }}
            maxLength={2000}
          />
          <Button full disabled={!!error || create.isPending} onPress={() => create.mutate()}>
            {create.isPending ? "Đang tạo…" : "Tạo gói bán"}
          </Button>
          {error ? <Text className="text-center font-body text-xs text-muted-foreground">{error}</Text> : null}
        </View>
      </BottomSheet>
    </View>
  );
}
