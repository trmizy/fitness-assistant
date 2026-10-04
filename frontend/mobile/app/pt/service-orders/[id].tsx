import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Send } from "lucide-react-native";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  ScreenHeader,
  Stagger,
  StaggerItem,
  useToast,
} from "../../../src/components/ui";
import { personalizedServiceApi } from "../../../src/services/api";
import { PlanDraftBuilder } from "../../../src/features/pt/PlanDraftBuilder";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { formatVND } from "../../../src/utils/currency";
import { ORDER_STATUS_LABEL, orderStatusTone } from "../../../src/features/plans/personalizedOrder";
import { sellerOrderAction, sellerOrderLabel } from "../../../src/features/pt/pt";

/**
 * PT-09 — one 1-1 service order, seller side. Behaviour: web's PTServiceOrderPage.
 *
 * The state machine belongs to ai-service; nothing here advances it on its own. Each status
 * offers at most the one action the server accepts (`sellerOrderAction`), so a trainer is never
 * shown a button that is certain to be refused, and a status where the ball is in the client's
 * court says so instead.
 *
 * The AI draft is advisory: `generatePlanDraft` fills the day list, the trainer edits it, and the
 * plan is only delivered by their own action — the same framing web uses, kept because the
 * trainer, not the model, is answerable for what the client receives.
 */
export default function PtServiceOrderScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = String(id ?? "");

  const orderQuery = useQuery({
    queryKey: ["pt-selling-order", orderId],
    queryFn: () => personalizedServiceApi.getOrder(orderId),
    enabled: !!orderId,
  });
  const order: any = orderQuery.data;
  const action = order ? sellerOrderAction(order.status) : null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["pt-selling-order", orderId] });
    void queryClient.invalidateQueries({ queryKey: ["pt-selling-orders"] });
  };
  const fail = (e: any, fallback: string) =>
    toast.show(e?.response?.data?.error?.message || e?.response?.data?.error || fallback, "danger");

  const startReview = useMutation({
    mutationFn: () => personalizedServiceApi.startReview(orderId),
    onSuccess: () => {
      toast.show("Đã bắt đầu — soạn giáo án cho khách", "success");
      refresh();
    },
    onError: (e) => fail(e, "Không bắt đầu được"),
  });
  const startRevision = useMutation({
    mutationFn: () => personalizedServiceApi.startRevisionWork(orderId),
    onSuccess: () => {
      toast.show("Đã bắt đầu chỉnh sửa", "success");
      refresh();
    },
    onError: (e) => fail(e, "Không bắt đầu chỉnh sửa được"),
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace("/pt/service-orders"));

  if (orderQuery.isLoading) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Đơn dịch vụ" onBack={back} />
        <ActivityIndicator className="mt-12" color={accent.primary} />
      </View>
    );
  }
  if (!order) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Đơn dịch vụ" onBack={back} />
        <View className="p-5">
          <EmptyState icon={ClipboardList} title="Không tìm thấy đơn" description="Đơn này không còn trong danh sách của bạn." />
        </View>
      </View>
    );
  }

  const label = sellerOrderLabel(order.status, ORDER_STATUS_LABEL[order.status as never] ?? order.status);
  const intake = order.intakeData ?? {};

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Đơn dịch vụ" onBack={back} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        <Stagger className="gap-5">
          <StaggerItem>
            <Card className="gap-2 p-5">
              <Text className="font-display text-xl text-foreground">{order.titleSnapshot || "Đơn dịch vụ"}</Text>
              {order.priceSnapshot != null ? (
                <Text className="font-display text-sm text-primary">{formatVND(Number(order.priceSnapshot))}</Text>
              ) : null}
              <View className="flex-row">
                <Badge tone={action ? "warning" : orderStatusTone(order.status)}>{label}</Badge>
              </View>
            </Card>
          </StaggerItem>

          {Object.keys(intake).length > 0 ? (
            <StaggerItem>
              <Text className="mb-2 px-1 font-display text-lg text-foreground">Phiếu khách đã gửi</Text>
              <Card className="gap-2 p-4">
                <Text className="font-body text-xs text-muted-foreground">
                  Chỉ hiện những mục khách đồng ý chia sẻ.
                </Text>
                {Object.entries(intake).map(([k, v]) => (
                  <View key={k} className="flex-row items-start justify-between gap-3">
                    <Text className="font-body text-xs text-muted-foreground">{k}</Text>
                    <Text className="max-w-[60%] text-right font-body-semibold text-xs text-foreground">
                      {Array.isArray(v) ? v.join(", ") : String(v)}
                    </Text>
                  </View>
                ))}
              </Card>
            </StaggerItem>
          ) : null}

          {order.status === "REVISION_REQUESTED" && Array.isArray(order.revisionRequests) && order.revisionRequests.length > 0 ? (
            <StaggerItem>
              <Card className="gap-1 border-warning/30 bg-warning/5 p-4">
                <Text className="font-body-semibold text-sm text-foreground">Khách yêu cầu chỉnh sửa</Text>
                <Text className="font-body text-sm text-muted-foreground">
                  {order.revisionRequests[0]?.comment ?? "Khách muốn điều chỉnh bản nháp."}
                </Text>
              </Card>
            </StaggerItem>
          ) : null}

          {action === "startReview" ? (
            <StaggerItem>
              <Button full disabled={startReview.isPending} onPress={() => startReview.mutate()}>
                {startReview.isPending ? "Đang bắt đầu…" : "Bắt đầu phân tích & soạn giáo án"}
              </Button>
            </StaggerItem>
          ) : null}

          {action === "startRevision" ? (
            <StaggerItem>
              <Button full disabled={startRevision.isPending} onPress={() => startRevision.mutate()}>
                {startRevision.isPending ? "Đang bắt đầu…" : "Bắt đầu chỉnh sửa"}
              </Button>
            </StaggerItem>
          ) : null}

          {action === "deliver" ? (
            <StaggerItem>
              <DraftBuilder order={order} onDelivered={refresh} />
            </StaggerItem>
          ) : null}

          {!action ? (
            <StaggerItem>
              <Card className="p-4">
                <Text className="font-body text-sm text-muted-foreground">
                  {order.status === "DRAFT_DELIVERED"
                    ? "Đã gửi bản nháp — đang chờ khách xem xét."
                    : "Hiện chưa có việc gì cần bạn xử lý ở đơn này."}
                </Text>
              </Card>
            </StaggerItem>
          ) : null}
        </Stagger>
      </ScrollView>
    </View>
  );
}

/**
 * The order's plan draft — the shared coach builder (14B.2), delivered through ai-service's order
 * flow; goal comes from the client's intake.
 */
function DraftBuilder({ order, onDelivered }: { order: any; onDelivered: () => void }) {
  return (
    <PlanDraftBuilder
      clientUserId={order.buyerId}
      title="Soạn giáo án"
      nameLabel="Tên giáo án *"
      initialName={order.titleSnapshot || "Giáo án cá nhân hoá"}
      goal={order.intakeData?.goal ?? undefined}
      defaultWeeks={8}
      submitLabel="Gửi bản nháp cho khách"
      submittingLabel="Đang gửi…"
      submitIcon={Send}
      successMessage="Đã gửi bản nháp cho khách xem"
      errorFallback="Không gửi được bản nháp"
      onSubmit={(payload) => personalizedServiceApi.deliverDraft(order.id, payload)}
      onDone={onDelivered}
    />
  );
}
