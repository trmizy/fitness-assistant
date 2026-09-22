import { useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleAlert, CreditCard, ShieldCheck, Sparkles } from "lucide-react-native";

import { Badge, BottomSheet, Button, Card, EmptyState, ScreenHeader, Tappable, useToast } from "../../../../src/components/ui";
import { paymentService, personalizedServiceApi } from "../../../../src/services/api";
import { useApp } from "../../../../src/context/AppContext";
import { useWorkspaceAccent } from "../../../../src/theme/workspace";
import { formatVND } from "../../../../src/utils/currency";
import { apiErrorMessage } from "../../../../src/features/plans/aiPlans";
import { SERVICE_TYPE_LABELS } from "../../../../src/features/plans/marketplace";
import { StarRow } from "../../../../src/features/plans/PlanWidgets";

type PaymentMethod = { provider: string; label?: string; name?: string; description?: string; configured: boolean };

/**
 * CL-12, before purchase — the design's PersonalizedService "PURCHASE" stage (Bạn nhận được gì,
 * "Mua & thanh toán", payment sheet), filled with the real service (web's
 * PersonalizedServiceDetailModal): seller credibility, deliverables, delivery days, revision
 * policy, buyer protection.
 *
 * Buying creates the order (PENDING_PAYMENT) plus a gateway checkout for the chosen provider — the
 * list of providers is the server's (`/me/payments/methods`, configured ones only). Opening the
 * gateway and coming back is Phase 14's work, exactly like Phase 7's membership and contract
 * payments: here the client lands on the order, which says it is waiting for payment and can be
 * cancelled. The order only moves on when the gateway webhook confirms payment — never on this.
 */
export default function PersonalizedServiceScreen() {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const serviceId = String(id ?? "");
  const [payOpen, setPayOpen] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  // A double tap must not open two checkouts (web hit exactly this race) — a ref, not state.
  const submitted = useRef(false);

  const query = useQuery({
    queryKey: ["personalized-service", serviceId],
    queryFn: () => personalizedServiceApi.getDetail(serviceId),
    enabled: !!serviceId,
  });
  const svc = query.data;
  const reviewsQuery = useQuery({
    queryKey: ["personalized-service-seller-reviews", svc?.sellerId],
    queryFn: () => personalizedServiceApi.getSellerReviewSummary(svc!.sellerId),
    enabled: !!svc?.sellerId,
  });
  const methodsQuery = useQuery<{ methods: PaymentMethod[]; defaultProvider: string | null }>({
    queryKey: ["payment-methods"],
    queryFn: () => paymentService.getMethods(),
    enabled: payOpen,
    staleTime: 5 * 60_000,
  });
  const usable = (methodsQuery.data?.methods ?? []).filter((m) => m.configured);
  // The server's suggested gateway is pre-selected until the client picks one.
  const chosen = provider ?? methodsQuery.data?.defaultProvider ?? null;

  const purchase = useMutation({
    mutationFn: (p: string) => personalizedServiceApi.purchase(serviceId, p),
    onSuccess: (res) => {
      setPayOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["personalized-service-orders"] });
      toast.show("Đã tạo đơn — đơn đang chờ thanh toán.", "success");
      router.replace(`/client/plans/orders/${res.order.id}`);
    },
    onError: (e) => {
      submitted.current = false;
      toast.show(apiErrorMessage(e, "Không thể mua dịch vụ này."), "danger");
    },
  });

  if (query.isLoading) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Dịch vụ 1-1" onBack={() => router.back()} />
        <View className="items-center py-16">
          <ActivityIndicator color={accent.primary} />
        </View>
      </View>
    );
  }
  if (!svc) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Dịch vụ 1-1" onBack={() => router.back()} />
        <EmptyState icon={CircleAlert} title="Dịch vụ không còn được bán" />
      </View>
    );
  }
  const own = svc.sellerId === user?.id;
  const summary = reviewsQuery.data;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Dịch vụ 1-1" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 16 }}>
        <Card className="p-5">
          <Badge tone="warning">{SERVICE_TYPE_LABELS[svc.serviceType] ?? "Cá nhân hoá"}</Badge>
          <Text className="mt-2 font-display text-lg text-foreground">{svc.title}</Text>
          <View className="mt-1 flex-row flex-wrap items-center gap-2">
            {svc.seller?.isApprovedPt ? (
              <View className="flex-row items-center gap-1">
                <ShieldCheck size={14} color={accent.primary} />
                <Text className="font-body-semibold text-xs text-primary">PT đã xác minh</Text>
              </View>
            ) : null}
            {svc.seller?.displayName ? <Text className="font-body text-sm text-muted-foreground">{`với ${svc.seller.displayName}`}</Text> : null}
          </View>
          {summary && summary.reviewCount > 0 ? (
            <View className="mt-2 flex-row items-center gap-2">
              <StarRow value={Math.round(summary.averageRating)} />
              <Text className="font-body text-xs text-muted-foreground">{`${summary.averageRating.toFixed(1)} · ${summary.reviewCount} đánh giá`}</Text>
            </View>
          ) : null}
          {svc.seller?.professionalBio ? <Text className="mt-2 font-body text-xs text-muted-foreground">{svc.seller.professionalBio}</Text> : null}
          {svc.description ? <Text className="mt-2 font-body text-sm text-muted-foreground">{svc.description}</Text> : null}
        </Card>

        <Card className="p-5">
          <View className="mb-3 flex-row items-center gap-2">
            <Sparkles size={18} color={accent.primary} />
            <Text className="font-display text-base text-foreground">Bạn nhận được gì</Text>
          </View>
          {svc.deliverables.map((d) => (
            <Text key={d} className="mb-1 font-body text-sm text-muted-foreground">{`• ${d}`}</Text>
          ))}
          <View className="mt-3 flex-row gap-2">
            <View className="flex-1 rounded-xl bg-panel p-3">
              <Text className="font-body text-[11px] text-muted-foreground">Giao bản đầu</Text>
              <Text className="font-body-semibold text-sm text-foreground">{`${svc.initialDeliveryDays} ngày sau phiếu Intake`}</Text>
            </View>
            <View className="flex-1 rounded-xl bg-panel p-3">
              <Text className="font-body text-[11px] text-muted-foreground">Chỉnh sửa</Text>
              <Text className="font-body-semibold text-sm text-foreground">
                {svc.revisionLimit == null ? "Không giới hạn" : `Tối đa ${svc.revisionLimit} lần`}
              </Text>
            </View>
          </View>
          {svc.supportWeeks ? (
            <Text className="mt-2 font-body text-xs text-muted-foreground">{`Đồng hành ${svc.supportWeeks} tuần, check-in hằng tuần.`}</Text>
          ) : null}
        </Card>

        <Card className="p-4">
          <Text className="mb-1 font-body-semibold text-xs text-muted-foreground">Bảo vệ người mua</Text>
          <Text className="font-body text-xs text-muted-foreground">
            PT đã xác minh · chính sách chỉnh sửa rõ ràng · hạn giao có thời hạn · lịch sử trò chuyện · hỗ trợ khiếu nại.
          </Text>
        </Card>

        {own ? (
          <Text className="text-center font-body text-sm text-muted-foreground">Đây là dịch vụ của bạn.</Text>
        ) : (
          <>
            <Button full size="lg" icon={CreditCard} onPress={() => setPayOpen(true)}>
              {`Mua & thanh toán · ${formatVND(svc.price)}`}
            </Button>
            <Text className="text-center font-body text-xs text-muted-foreground">
              Hoàn 100% nếu huỷ trước khi PT bắt đầu soạn giáo án.
            </Text>
          </>
        )}
      </ScrollView>

      <BottomSheet open={payOpen} onClose={() => setPayOpen(false)} title="Thanh toán dịch vụ 1-1">
        <View className="mb-4 flex-row items-center justify-between rounded-xl bg-panel p-3.5">
          <Text className="flex-1 font-body text-sm text-muted-foreground" numberOfLines={1}>
            {svc.title}
          </Text>
          <Text className="font-display text-lg text-foreground">{formatVND(svc.price)}</Text>
        </View>
        {methodsQuery.isLoading ? (
          <ActivityIndicator color={accent.primary} />
        ) : methodsQuery.isError ? (
          <Text className="font-body text-sm text-destructive">Không tải được danh sách cổng thanh toán. Thử lại sau.</Text>
        ) : usable.length === 0 ? (
          <Text className="font-body text-sm text-muted-foreground">Hiện chưa có cổng thanh toán nào khả dụng.</Text>
        ) : (
          <View className="gap-2.5">
            {usable.map((m) => {
              const on = chosen === m.provider;
              return (
                <Tappable
                  key={m.provider}
                  onPress={() => setProvider(m.provider)}
                  className={`flex-row items-center gap-3 rounded-xl border p-3.5 ${on ? "border-primary bg-primary/5" : "border-border bg-panel"}`}
                >
                  <View className="h-10 w-10 items-center justify-center rounded-lg bg-card">
                    <CreditCard size={18} color="#8b9299" />
                  </View>
                  <View className="flex-1">
                    <Text className="font-body-semibold text-sm text-foreground">{m.label ?? m.name ?? m.provider}</Text>
                    {m.description ? <Text className="font-body text-xs text-muted-foreground">{m.description}</Text> : null}
                  </View>
                  {on ? <Check size={18} strokeWidth={3} color={accent.primary} /> : null}
                </Tappable>
              );
            })}
          </View>
        )}
        <Text className="mt-3 font-body text-[11px] text-muted-foreground">
          Đơn được tạo ở trạng thái chờ thanh toán. Mở cổng thanh toán ngay trong ứng dụng sẽ có ở bản cập nhật tới.
        </Text>
        <View className="mt-4">
          <Button
            full
            size="lg"
            disabled={!chosen || purchase.isPending || usable.length === 0}
            onPress={() => {
              if (submitted.current || !chosen) return;
              submitted.current = true;
              purchase.mutate(chosen);
            }}
          >
            {purchase.isPending ? "Đang tạo đơn…" : "Tạo đơn thanh toán"}
          </Button>
        </View>
      </BottomSheet>
    </View>
  );
}
