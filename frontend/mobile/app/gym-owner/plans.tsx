import { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Lock, LockOpen, Plus, Ticket } from "lucide-react-native";

import {
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  Input,
  ScreenHeader,
  Stagger,
  StaggerItem,
  Tappable,
  inputPlaceholderColor,
  useToast,
} from "../../src/components/ui";

import { gymService } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { designTokens } from "../../src/theme/colors";
import { formatVND } from "../../src/utils/currency";
import {
  EMPTY_PLAN_FORM,
  brandDisplayName,
  isBrandOwner,
  ownedPlans,
  planFormError,
  planLimitText,
  planPayload,
  planStatus,
  saleWindow,
  theBrand,
  type PlanForm,
} from "../../src/features/gymOwner/gymOwner";

/**
 * WB-04 — "Gói hội viên". Figma không vẽ màn này; nó có thật trên web (`GymPlansPage`) và là điều
 * kiện để luồng mua hội viên của khách (CL-09, Phase 7) có thứ gì để mua.
 *
 * Một gói bán bởi **THƯƠNG HIỆU**, không phải một chi nhánh: mua một lần, check-in ở chi nhánh nào
 * cũng trừ chung một hạn mức lượt. Vì thế màn này không có bộ chọn chi nhánh — không còn gì thuộc về
 * riêng một chi nhánh để chọn.
 */
export default function GymOwnerPlansScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useApp();
  const uid = user?.id ?? "guest";

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PlanForm>(EMPTY_PLAN_FORM);

  const brandsQuery = useQuery({ queryKey: ["owned-brands", uid], queryFn: () => gymService.listOwnedBrands() });
  const statusQuery = useQuery({
    queryKey: ["partner-onboarding-status", uid],
    queryFn: () => gymService.getOnboardingStatus(),
  });
  const brand = theBrand(brandsQuery.data);
  const isOwner = isBrandOwner(statusQuery.data);

  const plansQuery = useQuery({
    queryKey: ["owned-brand-plans", brand?.id],
    queryFn: () => gymService.listOwnedPlans(brand!.id),
    enabled: !!brand,
  });
  const plans = ownedPlans(plansQuery.data);

  const error = useMemo(() => planFormError(form), [form]);

  const createPlan = useMutation({
    mutationFn: () => gymService.createPlan(brand!.id, planPayload(form)),
    onSuccess: () => {
      toast.show("Đã tạo gói hội viên", "success");
      setForm(EMPTY_PLAN_FORM);
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["owned-brand-plans", brand?.id] });
    },
    onError: (e: any) => toast.show(e?.response?.data?.error?.message || "Không tạo được gói", "danger"),
  });

  const toggle = useMutation({
    mutationFn: ({ planId, status }: { planId: string; status: "ACTIVE" | "INACTIVE" }) =>
      gymService.updatePlan(brand!.id, planId, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["owned-brand-plans", brand?.id] }),
    onError: (e: any) => toast.show(e?.response?.data?.error?.message || "Không cập nhật được gói", "danger"),
  });

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Gói hội viên" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl
            refreshing={plansQuery.isRefetching}
            onRefresh={() => void plansQuery.refetch()}
            tintColor={accent.primary}
            colors={[accent.primary]}
          />
        }
      >
        {brandsQuery.isLoading ? (
          <ActivityIndicator className="mt-10" color={accent.primary} />
        ) : !brand ? (
          <View className="px-5 pt-8">
            <EmptyState
              icon={Building2}
              title="Chưa có thương hiệu"
              description="Đặt tên thương hiệu trước — mọi gói hội viên đều bán dưới tên thương hiệu và dùng được ở tất cả chi nhánh."
              actionLabel="Đi tới Phòng gym"
              onAction={() => router.replace("/gym-owner/gyms")}
            />
          </View>
        ) : (
          <Stagger className="gap-5 px-5 pt-4">
            <StaggerItem>
              <Card className="gap-3 p-4">
                <Text className="font-body text-xs leading-5 text-muted-foreground">
                  Gói của{" "}
                  <Text className="font-body-semibold text-foreground">{brandDisplayName(brand)}</Text> — áp dụng cho
                  mọi chi nhánh. Khách check-in ở đâu cũng trừ chung một hạn mức lượt.
                </Text>
                {isOwner ? (
                  <Button
                    icon={Plus}
                    onPress={() => {
                      setForm(EMPTY_PLAN_FORM);
                      setOpen(true);
                    }}
                  >
                    Gói mới
                  </Button>
                ) : (
                  <Text className="font-body text-[11px] text-muted-foreground">
                    Chỉ chủ thương hiệu tạo và ngừng bán gói.
                  </Text>
                )}
              </Card>
            </StaggerItem>

            {plansQuery.isLoading ? (
              <ActivityIndicator className="mt-6" color={accent.primary} />
            ) : plans.length === 0 ? (
              <StaggerItem>
                <EmptyState
                  icon={Ticket}
                  title="Chưa có gói nào"
                  description="Tạo gói đầu tiên để khách bắt đầu đăng ký hội viên."
                />
              </StaggerItem>
            ) : (
              plans.map((p) => {
                const st = planStatus(p.status);
                const sale = saleWindow(p);
                const isActive = p.status === "ACTIVE";
                return (
                  <StaggerItem key={p.id}>
                    <Card className="gap-3 p-4">
                      <View className="flex-row items-start gap-3">
                        <View className="min-w-0 flex-1">
                          <Text className="font-body-semibold text-sm text-foreground" numberOfLines={2}>
                            {p.name || "Gói chưa đặt tên"}
                          </Text>
                          <Text className="mt-0.5 font-body text-xs text-muted-foreground">{planLimitText(p)}</Text>
                          {sale ? (
                            <Text
                              className={`mt-0.5 font-body text-[11px] ${
                                sale.tone === "success"
                                  ? "text-primary"
                                  : sale.tone === "info"
                                    ? "text-foreground"
                                    : "text-muted-foreground"
                              }`}
                            >
                              {sale.text}
                            </Text>
                          ) : null}
                        </View>
                        <Text className="font-display text-base text-primary">{formatVND(Number(p.price ?? 0))}</Text>
                      </View>
                      <View className="flex-row items-center justify-between border-t border-border pt-3">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {isOwner ? (
                          <Tappable
                            accessibilityLabel={isActive ? "Ngừng bán gói này" : "Mở bán lại gói này"}
                            disabled={toggle.isPending}
                            hitSlop={10}
                            onPress={() => toggle.mutate({ planId: p.id, status: isActive ? "INACTIVE" : "ACTIVE" })}
                            className="flex-row items-center gap-1.5 rounded-full border border-border px-3 py-1.5"
                          >
                            {isActive ? (
                              <Lock size={12} color={designTokens.mutedForeground} />
                            ) : (
                              <LockOpen size={12} color={accent.primary} />
                            )}
                            <Text className="font-body-semibold text-xs text-muted-foreground">
                              {isActive ? "Ngừng bán" : "Mở bán lại"}
                            </Text>
                          </Tappable>
                        ) : null}
                      </View>
                    </Card>
                  </StaggerItem>
                );
              })
            )}
          </Stagger>
        )}
      </ScrollView>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="Gói hội viên mới">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
          <Input
            label="Tên gói"
            value={form.name}
            onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
            placeholder="Ví dụ: Gói tháng"
            placeholderTextColor={inputPlaceholderColor}
          />
          <Input
            label="Giá (₫)"
            value={form.price}
            onChangeText={(v) => setForm((f) => ({ ...f, price: v.replace(/[^\d]/g, "") }))}
            keyboardType="number-pad"
            placeholder="500000"
            placeholderTextColor={inputPlaceholderColor}
          />
          <Input
            label="Thời hạn (ngày)"
            value={form.durationDays}
            onChangeText={(v) => setForm((f) => ({ ...f, durationDays: v.replace(/[^\d]/g, "") }))}
            keyboardType="number-pad"
            placeholderTextColor={inputPlaceholderColor}
          />
          <Input
            label="Giới hạn lượt vào (để trống = không giới hạn)"
            value={form.visitLimit}
            onChangeText={(v) => setForm((f) => ({ ...f, visitLimit: v.replace(/[^\d]/g, "") }))}
            keyboardType="number-pad"
            placeholder="Không giới hạn"
            placeholderTextColor={inputPlaceholderColor}
          />
          <Text className="font-body text-[11px] leading-4 text-muted-foreground">
            Hạn mức lượt vào dùng chung cho tất cả chi nhánh — khách check-in ở bất kỳ đâu cũng trừ vào cùng
            một con số này.
          </Text>

          <View className="gap-2">
            <Text className="px-1 font-body text-sm text-muted-foreground">
              Thời gian mở bán (tuỳ chọn — dùng cho gói khuyến mãi)
            </Text>
            <View className="flex-row gap-2">
              <Input
                className="flex-1"
                label="Bắt đầu"
                value={form.saleStartAt}
                onChangeText={(v) => setForm((f) => ({ ...f, saleStartAt: v }))}
                placeholder="2026-10-01"
                placeholderTextColor={inputPlaceholderColor}
              />
              <Input
                className="flex-1"
                label="Kết thúc"
                value={form.saleEndAt}
                onChangeText={(v) => setForm((f) => ({ ...f, saleEndAt: v }))}
                placeholder="2026-12-31"
                placeholderTextColor={inputPlaceholderColor}
              />
            </View>
            <Text className="font-body text-[11px] text-muted-foreground">Để trống cả hai = luôn mở bán.</Text>
          </View>

          <Button disabled={!!error || createPlan.isPending} onPress={() => createPlan.mutate()}>
            {createPlan.isPending ? "Đang tạo…" : "Tạo gói"}
          </Button>
          {error ? <Text className="text-center font-body text-xs text-muted-foreground">{error}</Text> : null}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}
