import { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Animated, { useAnimatedStyle, withSpring } from "react-native-reanimated";
import {
  AlertTriangle,
  Banknote,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock,
  CreditCard,
  FileText,
  History,
  MessageSquare,
  RotateCcw,
  ShieldCheck,
  Star,
  Trophy,
  XCircle,
} from "lucide-react-native";

import { Badge, BottomSheet, Button, Card, EmptyState, Input, ScreenHeader, Tappable, useToast } from "../../../../src/components/ui";
import {
  chatService,
  CONSENT_CATEGORY_LABELS,
  personalizedServiceApi,
  profileService,
  workoutService,
} from "../../../../src/services/api";
import { useWorkspaceAccent } from "../../../../src/theme/workspace";
import { darkColors, designTokens } from "../../../../src/theme/colors";
import { formatVND } from "../../../../src/utils/currency";
import { apiErrorMessage } from "../../../../src/features/plans/aiPlans";
import {
  buildCheckInPayload,
  buildIntakePayload,
  canCancel,
  // canDispute, canRequestRefund — TẠM TẮT 22/9 theo lệnh Ngài — xem MOBILE_BACKEND_GAPS.md GAP-13 (chờ bàn với partner)
  canRequestRevision,
  checkInBlockedReason,
  DEFAULT_CONSENT,
  defaultCheckIn,
  draftExerciseIds,
  EXPERIENCE_OPTIONS,
  GENDER_OPTIONS,
  GOAL_OPTIONS,
  INTAKE_LOCATION_OPTIONS,
  intakeBlockedReason,
  intakeFromProfile,
  isPtWorking,
  ORDER_STATUS_LABEL,
  ORDER_TIMELINE,
  orderStatusTone,
  REVISION_CATEGORIES,
  revisionsLabel,
  timelineHint,
  timelineIndex,
  type CheckInForm,
  type IntakeForm,
} from "../../../../src/features/plans/personalizedOrder";
import { Chip, FieldLabel, StarInput, StarRow, Stepper, TextArea } from "../../../../src/features/plans/PlanWidgets";

type Sheet = null | "intake" | "revision" | "cancel" | "refund" | "dispute" | "checkin" | "complete";

/**
 * CL-12 — the buyer's whole 1-1 order in one place (web's PersonalizedServiceOrderPage, shaped as
 * the design's PersonalizedService screen: status header, 4-step timeline, stage actions, and the
 * secondary doors Nhắn PT / Huỷ đơn / Yêu cầu hoàn tiền / Khiếu nại as bottom sheets).
 *
 * Every button maps to one server transition and is only shown where the server allows it
 * (personalizedOrder.ts mirrors personalized-service.service.ts). Refund and dispute are two
 * separate doors here, as in the design and the API — web folds them into one "hoàn tiền /
 * khiếu nại" button that only ever calls refund.
 *
 * The page re-polls every 8s (web does the same) because the PT moves the order on their side.
 */
export default function PersonalizedOrderScreen() {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = String(id ?? "");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [reason, setReason] = useState("");
  const [revisionCategory, setRevisionCategory] = useState("EXERCISE");
  const [revisionComment, setRevisionComment] = useState("");
  const [intake, setIntake] = useState<IntakeForm | null>(null);
  const [consent, setConsent] = useState<string[]>(DEFAULT_CONSENT);
  const [checkIn, setCheckIn] = useState<CheckInForm>(defaultCheckIn());
  const [rating, setRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewed, setReviewed] = useState(false);

  const orderKey = ["personalized-service-order", orderId];
  const query = useQuery({
    queryKey: orderKey,
    queryFn: () => personalizedServiceApi.getOrder(orderId),
    enabled: !!orderId,
    refetchInterval: 8000,
  });
  const order = query.data;
  const status = order?.status;

  const profileQuery = useQuery({
    queryKey: ["profile", "for-intake-prefill"],
    queryFn: () => profileService.getProfile().then((r: any) => r?.profile ?? null),
    enabled: sheet === "intake",
  });
  const checkInsQuery = useQuery({
    queryKey: ["personalized-service-checkins", orderId],
    queryFn: () => personalizedServiceApi.listCheckIns(orderId),
    enabled: status === "ACCEPTED" || status === "ACTIVE",
  });
  const versionsQuery = useQuery({
    queryKey: ["personalized-service-versions", orderId],
    queryFn: () => personalizedServiceApi.listVersions(orderId),
    enabled: !!status && ["ACCEPTED", "ACTIVE", "COMPLETED"].includes(status),
  });
  const draftIds = useMemo(() => draftExerciseIds(order?.draftContent), [order?.draftContent]);
  const namesQuery = useQuery({
    queryKey: ["exercise-names", draftIds],
    queryFn: () => workoutService.getExercisesByIds(draftIds),
    enabled: draftIds.length > 0,
  });
  const nameById = useMemo(
    () => new Map(((namesQuery.data as any[]) ?? []).map((e) => [e.id, e.exerciseName ?? e.name])),
    [namesQuery.data],
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: orderKey });
    void queryClient.invalidateQueries({ queryKey: ["personalized-service-orders"] });
  };
  const close = () => {
    setSheet(null);
    setReason("");
  };
  const act = (fn: () => Promise<unknown>, ok: string, fail: string) => ({
    mutationFn: fn,
    onSuccess: () => {
      close();
      toast.show(ok, "success");
      refresh();
    },
    onError: (e: unknown) => toast.show(apiErrorMessage(e, fail), "danger"),
  });

  const submitIntake = useMutation({
    mutationFn: (form: IntakeForm) => personalizedServiceApi.submitIntake(orderId, buildIntakePayload(form, consent)),
    onSuccess: () => {
      close();
      toast.show("Đã nộp phiếu Intake — PT sẽ bắt đầu phân tích.", "success");
      refresh();
    },
    onError: (e: unknown) => toast.show(apiErrorMessage(e, "Không thể gửi phiếu Intake."), "danger"),
  });
  const accept = useMutation(act(() => personalizedServiceApi.accept(orderId), "Đã chấp nhận giáo án! Buổi tập đã sẵn sàng trong lịch.", "Không thể chấp nhận giáo án."));
  const revision = useMutation(
    act(() => personalizedServiceApi.requestRevision(orderId, { category: revisionCategory, comment: revisionComment.trim() }), "Đã gửi yêu cầu chỉnh sửa cho PT.", "Không thể gửi yêu cầu chỉnh sửa."),
  );
  const cancel = useMutation(act(() => personalizedServiceApi.cancel(orderId, reason.trim() || "Khách hàng huỷ đơn"), "Đã huỷ đơn.", "Không thể huỷ đơn."));
  // TẠM TẮT 22/9 theo lệnh Ngài — xem MOBILE_BACKEND_GAPS.md GAP-13 (chờ bàn với partner). Giữ nguyên code, bật lại bằng cách bỏ comment ở đây, ở hai nút và hai sheet bên dưới.
  // const refund = useMutation(act(() => personalizedServiceApi.requestRefund(orderId, reason.trim()), "Đã gửi yêu cầu hoàn tiền — chờ Admin xem xét.", "Không thể gửi yêu cầu hoàn tiền."));
  // const dispute = useMutation(act(() => personalizedServiceApi.openDispute(orderId, reason.trim()), "Đã gửi khiếu nại — Admin sẽ phân xử.", "Không thể gửi khiếu nại."));
  const complete = useMutation(act(() => personalizedServiceApi.complete(orderId), "Đã đánh dấu dịch vụ hoàn thành.", "Không thể hoàn thành dịch vụ."));
  const submitCheckIn = useMutation({
    mutationFn: () => personalizedServiceApi.submitCheckIn(orderId, buildCheckInPayload(checkIn)),
    onSuccess: (c: any) => {
      close();
      setCheckIn(defaultCheckIn());
      toast.show(c?.requiresAttention ? "Đã gửi check-in — PT sẽ chú ý mức đau bạn báo." : "Đã gửi check-in tuần này.", "success");
      void queryClient.invalidateQueries({ queryKey: ["personalized-service-checkins", orderId] });
    },
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể gửi check-in."), "danger"),
  });
  const review = useMutation({
    mutationFn: () => personalizedServiceApi.submitReview(orderId, { overallRating: rating, comment: reviewComment.trim() || undefined }),
    onSuccess: () => {
      setReviewed(true);
      toast.show("Cảm ơn bạn đã đánh giá!", "success");
    },
    onError: (e: any) => {
      if (e?.response?.data?.error?.code === "PERSONALIZED_SERVICE_REVIEW_ALREADY_EXISTS") {
        setReviewed(true);
        return;
      }
      toast.show(apiErrorMessage(e, "Không thể gửi đánh giá."), "danger");
    },
  });
  const chat = useMutation({
    mutationFn: () => chatService.createDirectConversation(order!.sellerId),
    onSuccess: (conv: any) => {
      const conversationId = conv?.id ?? conv?.data?.id;
      router.push({ pathname: "/client/messages", params: conversationId ? { conversationId } : {} });
    },
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể mở đoạn chat."), "danger"),
  });

  const openIntake = () => {
    setIntake(null);
    setSheet("intake");
  };
  // Pre-fill once the profile arrives (Onboarding/Profile already collected most of this).
  const intakeForm =
    intake ?? (profileQuery.data !== undefined || profileQuery.isError ? intakeFromProfile(profileQuery.data ?? null) : null);
  const setIntakeField = (k: keyof IntakeForm, v: string) => setIntake({ ...(intakeForm ?? intakeFromProfile(null)), [k]: v });

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
  if (!order || !status) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Dịch vụ 1-1" onBack={() => router.back()} />
        <EmptyState icon={CircleAlert} title="Không tìm thấy đơn" description={apiErrorMessage(query.error, "Đơn không tồn tại hoặc không thuộc về bạn.")} />
      </View>
    );
  }

  const step = timelineIndex(status);
  const flag = status === "REFUND_REQUESTED" || status === "DISPUTED" ? status : null;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title="Dịch vụ 1-1"
        onBack={() => (router.canGoBack() ? router.back() : router.replace({ pathname: "/client/plans", params: { tab: "market", market: "my-orders" } }))}
      />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 16 }}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={accent.primary} colors={[accent.primary]} />}
      >
        <Card className="p-5">
          <View className="mb-2 flex-row items-center justify-between">
            <Badge tone={orderStatusTone(status)}>{ORDER_STATUS_LABEL[status]}</Badge>
            <Text className="font-body text-xs text-muted-foreground">{`#${order.id.slice(0, 8).toUpperCase()}`}</Text>
          </View>
          <Text className="font-display text-lg text-foreground">{order.titleSnapshot}</Text>
          <Text className="font-body text-sm text-muted-foreground">
            {[formatVND(order.priceAtPurchase), order.supportWeeksSnapshot ? `${order.supportWeeksSnapshot} tuần đồng hành` : null].filter(Boolean).join(" · ")}
          </Text>
        </Card>

        {flag ? (
          <Card className={`flex-row items-start gap-3 p-4 ${flag === "DISPUTED" ? "border-destructive/40 bg-destructive/5" : "border-warning/40 bg-warning/5"}`}>
            {flag === "DISPUTED" ? <AlertTriangle size={18} color={darkColors.destructive} /> : <Banknote size={18} color={designTokens.warning} />}
            <View className="flex-1">
              <Text className="font-body-semibold text-sm text-foreground">
                {flag === "DISPUTED" ? "Khiếu nại đang được xử lý" : "Yêu cầu hoàn tiền đang chờ duyệt"}
              </Text>
              <Text className="mt-0.5 font-body text-xs text-muted-foreground">Admin đang xem xét · bạn sẽ nhận thông báo khi có kết quả.</Text>
            </View>
          </Card>
        ) : null}

        {status === "CANCELLED" || status === "REFUNDED" ? (
          <Card className="flex-row items-center gap-3 p-4">
            <XCircle size={18} color="#8b9299" />
            <Text className="flex-1 font-body text-sm text-muted-foreground">
              {status === "CANCELLED" ? "Đơn đã huỷ. Nếu đã thanh toán, tiền được hoàn theo chính sách." : "Đơn đã được hoàn tiền."}
            </Text>
          </Card>
        ) : null}

        {status === "PENDING_PAYMENT" ? (
          <Card className="items-center gap-2 border-warning/40 bg-warning/5 p-5">
            <CreditCard size={28} color={designTokens.warning} />
            <Text className="text-center font-body-semibold text-sm text-foreground">Đơn đang chờ thanh toán</Text>
            <Text className="text-center font-body text-xs text-muted-foreground">
              Đơn chỉ chuyển sang bước tiếp theo khi cổng thanh toán xác nhận. Mở cổng thanh toán ngay trong ứng dụng sẽ có ở bản cập nhật tới — nếu bạn không muốn tiếp tục, hãy huỷ đơn bên dưới.
            </Text>
          </Card>
        ) : null}

        {step != null ? (
          <Card className="p-5">
            {ORDER_TIMELINE.map((t, i) => {
              const done = i < step;
              const current = i === step;
              return (
                <View key={t.key} className="flex-row gap-3">
                  <View className="items-center">
                    <TimelineDot done={done} current={current} index={i} />
                    {i < ORDER_TIMELINE.length - 1 ? <View className={`my-1 w-0.5 flex-1 ${done ? "bg-primary" : "bg-border"}`} style={{ minHeight: 28 }} /> : null}
                  </View>
                  <View className="flex-1 pb-6">
                    <Text className={`font-body-semibold text-sm ${current ? "text-primary" : done ? "text-foreground" : "text-muted-foreground"}`}>{t.label}</Text>
                    {current && timelineHint(status) ? <Text className="mt-0.5 font-body text-xs text-muted-foreground">{timelineHint(status)}</Text> : null}
                  </View>
                </View>
              );
            })}
          </Card>
        ) : null}

        {status === "INTAKE_PENDING" || status === "PURCHASED" ? (
          <Button full size="lg" icon={FileText} onPress={openIntake}>
            Điền phiếu Intake
          </Button>
        ) : null}

        {isPtWorking(status) ? (
          <Card className="flex-row items-center gap-3 p-4">
            <Clock size={18} color={status.startsWith("REVISION") ? designTokens.warning : accent.primary} />
            <View className="flex-1">
              <Text className="font-body text-sm text-muted-foreground">
                {status.startsWith("REVISION") ? "Đã gửi yêu cầu chỉnh sửa. Chờ PT giao bản mới." : "PT đang xử lý yêu cầu của bạn."}
              </Text>
              {order.initialDeliveryDeadline ? (
                <Text className="font-body text-xs text-muted-foreground">{`Hạn giao lần đầu: ${new Date(order.initialDeliveryDeadline).toLocaleString("vi-VN")}`}</Text>
              ) : null}
            </View>
          </Card>
        ) : null}

        {status === "DRAFT_DELIVERED" && order.draftContent ? (
          <>
            <Card className="p-4">
              <View className="mb-3 flex-row items-center gap-2">
                <FileText size={18} color={accent.primary} />
                <Text className="flex-1 font-display text-base text-foreground">{`${order.draftContent.name} · v${order.draftVersion}`}</Text>
              </View>
              {order.draftContent.days.map((day) => (
                <View key={day.dayNumber} className="mb-3 rounded-xl bg-panel p-3">
                  <Text className="mb-1 font-body-semibold text-xs text-primary">{`Ngày ${day.dayNumber} — ${day.title}`}</Text>
                  {day.exercises.map((ex, i) => (
                    <Text key={i} className="font-body text-xs text-muted-foreground">
                      {`${nameById.get(ex.exerciseId) ?? (namesQuery.isLoading ? "Đang tải…" : "Bài tập")} · ${ex.sets}×${ex.reps} · nghỉ ${ex.restSeconds}s${ex.notes ? ` — ${ex.notes}` : ""}`}
                    </Text>
                  ))}
                </View>
              ))}
            </Card>
            <View className="rounded-xl bg-panel p-3">
              <Text className="font-body text-xs text-muted-foreground">{revisionsLabel(order)}</Text>
            </View>
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button variant="secondary" full icon={RotateCcw} disabled={!canRequestRevision(order)} onPress={() => setSheet("revision")}>
                  Yêu cầu sửa
                </Button>
              </View>
              <View className="flex-1">
                <Button full icon={CheckCircle2} disabled={accept.isPending} onPress={() => accept.mutate()}>
                  {accept.isPending ? "Đang lưu…" : "Chấp nhận"}
                </Button>
              </View>
            </View>
          </>
        ) : null}

        {status === "ACCEPTED" || status === "ACTIVE" ? (
          <>
            <Card className="items-center gap-2 border-primary/30 bg-primary/5 p-5">
              <CheckCircle2 size={32} color={accent.primary} />
              <Text className="text-center font-body-semibold text-sm text-foreground">Giáo án cá nhân hoá của bạn đã sẵn sàng!</Text>
              <Button size="sm" onPress={() => router.push("/client/workout")}>
                Bắt đầu tập luyện
              </Button>
            </Card>
            <Button full size="lg" icon={ShieldCheck} onPress={() => setSheet("checkin")}>
              Gửi check-in tuần này
            </Button>
            <CheckInHistory items={(checkInsQuery.data as any[]) ?? []} />
            <VersionHistory versions={(versionsQuery.data as any[]) ?? []} />
            <Button variant="secondary" full icon={Trophy} onPress={() => setSheet("complete")}>
              Kết thúc dịch vụ
            </Button>
          </>
        ) : null}

        {status === "COMPLETED" ? (
          <>
            <Card className="items-center p-5">
              <View className="mb-3 h-14 w-14 items-center justify-center rounded-full bg-primary/15">
                <Trophy size={26} color={accent.primary} />
              </View>
              <Text className="font-display text-lg text-foreground">Đã hoàn thành dịch vụ!</Text>
              <Text className="mt-1 text-center font-body text-sm text-muted-foreground">Cảm ơn bạn đã đồng hành cùng PT.</Text>
            </Card>
            {reviewed ? (
              <Card className="items-center gap-2 p-4">
                <StarRow value={rating} size={20} />
                <Text className="font-body text-xs text-muted-foreground">Bạn đã đánh giá dịch vụ này. Cảm ơn!</Text>
              </Card>
            ) : (
              <Card className="gap-3 p-4">
                <Text className="font-body-semibold text-sm text-foreground">Đánh giá PT & dịch vụ này</Text>
                <StarInput value={rating} onChange={setRating} />
                <TextArea value={reviewComment} onChangeText={setReviewComment} rows={3} placeholder="Chia sẻ cảm nhận của bạn (không bắt buộc)…" />
                <Button full icon={Star} disabled={review.isPending} onPress={() => review.mutate()}>
                  {review.isPending ? "Đang gửi…" : "Gửi đánh giá"}
                </Button>
              </Card>
            )}
            <VersionHistory versions={(versionsQuery.data as any[]) ?? []} />
          </>
        ) : null}

        {status !== "PENDING_PAYMENT" && status !== "CANCELLED" ? (
          <View className="gap-2.5 pt-1">
            <Button variant="ghost" full icon={MessageSquare} disabled={chat.isPending} onPress={() => chat.mutate()}>
              Nhắn PT
            </Button>
          </View>
        ) : null}
        <View className="gap-2.5">
          {canCancel(status) ? (
            <Button variant="destructive" full icon={XCircle} onPress={() => setSheet("cancel")}>
              Huỷ đơn
            </Button>
          ) : null}
          {/* TẠM TẮT 22/9 theo lệnh Ngài — xem MOBILE_BACKEND_GAPS.md GAP-13 (chờ bàn với partner)
          {canRequestRefund(status) ? (
            <Button variant="secondary" full icon={Banknote} onPress={() => setSheet("refund")}>
              Yêu cầu hoàn tiền
            </Button>
          ) : null}
          {canDispute(status) ? (
            <Button variant="ghost" full icon={AlertTriangle} onPress={() => setSheet("dispute")}>
              Khiếu nại
            </Button>
          ) : null}
          */}
        </View>
      </ScrollView>

      {/* ── Sheets ── */}
      <BottomSheet open={sheet === "cancel"} onClose={close} title="Huỷ đơn?">
        <View className="rounded-xl bg-primary/10 p-3.5">
          <Text className="font-body text-sm text-muted-foreground">
            {status === "PENDING_PAYMENT"
              ? "Đơn chưa thanh toán nên huỷ là xong — không có khoản nào phải hoàn."
              : "PT chưa bắt đầu làm việc nên bạn được hoàn 100% tự động."}
          </Text>
        </View>
        <View className="mt-4">
          <Button variant="destructive" full size="lg" disabled={cancel.isPending} onPress={() => cancel.mutate()}>
            {cancel.isPending ? "Đang huỷ…" : "Xác nhận huỷ đơn"}
          </Button>
        </View>
        <View className="mt-1">
          <Button variant="ghost" full onPress={close}>
            Giữ đơn
          </Button>
        </View>
      </BottomSheet>

      {/* TẠM TẮT 22/9 theo lệnh Ngài — xem MOBILE_BACKEND_GAPS.md GAP-13 (chờ bàn với partner)
      <BottomSheet open={sheet === "refund"} onClose={close} title="Yêu cầu hoàn tiền">
        <View className="mb-3 rounded-xl bg-panel p-3.5">
          <Text className="font-body text-sm text-muted-foreground">
            PT đã bắt đầu làm việc — yêu cầu sẽ chuyển tới Admin xem xét, không hoàn tự động.
          </Text>
        </View>
        <TextArea value={reason} onChangeText={setReason} placeholder="Lý do bạn muốn hoàn tiền…" />
        <View className="mt-4">
          <Button full size="lg" disabled={!reason.trim() || refund.isPending} onPress={() => refund.mutate()}>
            {refund.isPending ? "Đang gửi…" : "Gửi yêu cầu"}
          </Button>
        </View>
      </BottomSheet>

      <BottomSheet open={sheet === "dispute"} onClose={close} title="Khiếu nại">
        <TextArea value={reason} onChangeText={setReason} placeholder="Mô tả vấn đề để Admin phân xử…" />
        <View className="mt-4">
          <Button variant="destructive" full size="lg" disabled={!reason.trim() || dispute.isPending} onPress={() => dispute.mutate()}>
            {dispute.isPending ? "Đang gửi…" : "Gửi khiếu nại"}
          </Button>
        </View>
      </BottomSheet>
      */}

      <BottomSheet open={sheet === "complete"} onClose={close} title="Kết thúc dịch vụ?">
        <Text className="mb-4 text-center font-body text-sm text-muted-foreground">
          Đánh dấu dịch vụ đã hoàn thành. Sau đó bạn có thể đánh giá PT; check-in sẽ đóng lại.
        </Text>
        <Button full size="lg" icon={Trophy} disabled={complete.isPending} onPress={() => complete.mutate()}>
          {complete.isPending ? "Đang lưu…" : "Đánh dấu hoàn thành"}
        </Button>
      </BottomSheet>

      <BottomSheet open={sheet === "revision"} onClose={close} title="Yêu cầu chỉnh sửa">
        <FieldLabel>Phần cần sửa</FieldLabel>
        <View className="mb-3 flex-row flex-wrap gap-2">
          {REVISION_CATEGORIES.map((c) => (
            <Chip key={c.value} label={c.label} active={revisionCategory === c.value} onPress={() => setRevisionCategory(c.value)} />
          ))}
        </View>
        <TextArea value={revisionComment} onChangeText={setRevisionComment} placeholder="Mô tả phần bạn muốn PT điều chỉnh…" />
        <Text className="mt-2 font-body text-xs text-muted-foreground">{revisionsLabel(order)}</Text>
        <View className="mt-4">
          <Button full size="lg" disabled={!revisionComment.trim() || revision.isPending} onPress={() => revision.mutate()}>
            {revision.isPending ? "Đang gửi…" : "Gửi yêu cầu"}
          </Button>
        </View>
      </BottomSheet>

      <BottomSheet open={sheet === "checkin"} onClose={close} title="Check-in tuần này">
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled">
          <ScaleRow label="Năng lượng" value={checkIn.energyLevel} max={5} onChange={(n) => setCheckIn({ ...checkIn, energyLevel: n })} />
          <ScaleRow label="Chất lượng giấc ngủ" value={checkIn.sleepQuality} max={5} onChange={(n) => setCheckIn({ ...checkIn, sleepQuality: n })} />
          <ScaleRow label="Mức căng thẳng" value={checkIn.stressLevel} max={5} onChange={(n) => setCheckIn({ ...checkIn, stressLevel: n })} />
          <View>
            <FieldLabel>{`Đau / khó chịu (0 = không, 10 = rất đau): ${checkIn.painOrDiscomfort}/10`}</FieldLabel>
            <Stepper value={checkIn.painOrDiscomfort} min={0} max={10} onChange={(n) => setCheckIn({ ...checkIn, painOrDiscomfort: n })} />
          </View>
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Input label="RPE (1-10)" keyboardType="number-pad" value={checkIn.overallRpe} onChangeText={(v) => setCheckIn({ ...checkIn, overallRpe: v })} />
            </View>
            <View className="flex-1">
              <Input label="% tuân thủ tập" keyboardType="number-pad" value={checkIn.workoutAdherence} onChangeText={(v) => setCheckIn({ ...checkIn, workoutAdherence: v })} />
            </View>
            <View className="flex-1">
              <Input label="% tuân thủ ăn" keyboardType="number-pad" value={checkIn.nutritionAdherence} onChangeText={(v) => setCheckIn({ ...checkIn, nutritionAdherence: v })} />
            </View>
          </View>
          <TextArea value={checkIn.notes} onChangeText={(v) => setCheckIn({ ...checkIn, notes: v })} rows={2} placeholder="Ghi chú thêm cho PT…" />
          {checkInBlockedReason(checkIn) ? <Text className="font-body text-xs text-destructive">{checkInBlockedReason(checkIn)}</Text> : null}
          <Button full size="lg" icon={ShieldCheck} disabled={!!checkInBlockedReason(checkIn) || submitCheckIn.isPending} onPress={() => submitCheckIn.mutate()}>
            {submitCheckIn.isPending ? "Đang gửi…" : "Gửi check-in"}
          </Button>
        </ScrollView>
      </BottomSheet>

      <BottomSheet open={sheet === "intake"} onClose={close} title="Phiếu Intake">
        {!intakeForm ? (
          <ActivityIndicator color={accent.primary} />
        ) : (
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled">
            <Text className="font-body text-[11px] text-muted-foreground">
              Đã tự điền từ hồ sơ của bạn — sửa mục nào cần khác riêng cho dịch vụ này.
            </Text>
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Input label="Tuổi" keyboardType="number-pad" value={intakeForm.age} onChangeText={(v) => setIntakeField("age", v)} />
              </View>
              <View className="flex-1">
                <Input label="Chiều cao (cm)" keyboardType="decimal-pad" value={intakeForm.heightCm} onChangeText={(v) => setIntakeField("heightCm", v)} />
              </View>
            </View>
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Input label="Cân nặng (kg)" keyboardType="decimal-pad" value={intakeForm.weight} onChangeText={(v) => setIntakeField("weight", v)} />
              </View>
              <View className="flex-1">
                <Input label="Cân nặng mục tiêu" keyboardType="decimal-pad" value={intakeForm.targetWeight} onChangeText={(v) => setIntakeField("targetWeight", v)} />
              </View>
            </View>
            <ChoiceRow label="Giới tính" options={GENDER_OPTIONS} value={intakeForm.gender} onChange={(v) => setIntakeField("gender", v)} />
            <ChoiceRow label="Mục tiêu" options={GOAL_OPTIONS} value={intakeForm.goal} onChange={(v) => setIntakeField("goal", v)} />
            <ChoiceRow label="Trình độ" options={EXPERIENCE_OPTIONS} value={intakeForm.experienceLevel} onChange={(v) => setIntakeField("experienceLevel", v)} />
            <View>
              <FieldLabel>Số ngày tập mỗi tuần cho dịch vụ này</FieldLabel>
              <Stepper value={Number(intakeForm.daysPerWeek) || 1} min={1} max={7} onChange={(n) => setIntakeField("daysPerWeek", String(n))} suffix="ngày" />
            </View>
            <ChoiceRow label="Nơi tập" options={INTAKE_LOCATION_OPTIONS} value={intakeForm.trainingLocation} onChange={(v) => setIntakeField("trainingLocation", v)} />
            <Input label="Chấn thương (cách nhau bằng dấu phẩy)" value={intakeForm.injuries} onChangeText={(v) => setIntakeField("injuries", v)} placeholder="Không có" />
            <View>
              <FieldLabel>Ghi chú thêm cho PT</FieldLabel>
              <TextArea value={intakeForm.notes} onChangeText={(v) => setIntakeField("notes", v)} rows={2} placeholder="Kỳ vọng cụ thể với dịch vụ này…" />
            </View>
            <View>
              <FieldLabel>Chọn nhóm dữ liệu bạn đồng ý cho PT xem</FieldLabel>
              <View className="gap-2">
                {Object.entries(CONSENT_CATEGORY_LABELS).map(([key, label]) => {
                  const on = consent.includes(key);
                  return (
                    <Tappable
                      key={key}
                      onPress={() => setConsent((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))}
                      className={`flex-row items-center gap-3 rounded-xl border p-3.5 ${on ? "border-primary bg-primary/5" : "border-border bg-panel"}`}
                    >
                      <Text className="flex-1 font-body-medium text-sm text-foreground">{label}</Text>
                      <View className={`h-6 w-6 items-center justify-center rounded-full ${on ? "bg-primary" : "border-2 border-border"}`}>
                        {on ? <Check size={14} strokeWidth={3} color={accent.onPrimary} /> : null}
                      </View>
                    </Tappable>
                  );
                })}
              </View>
            </View>
            {intakeBlockedReason(intakeForm, consent) ? (
              <Text className="font-body text-xs text-destructive">{intakeBlockedReason(intakeForm, consent)}</Text>
            ) : null}
            <Button
              full
              size="lg"
              disabled={!!intakeBlockedReason(intakeForm, consent) || submitIntake.isPending}
              onPress={() => submitIntake.mutate(intakeForm)}
            >
              {submitIntake.isPending ? "Đang gửi…" : `Đồng ý chia sẻ & nộp phiếu (${consent.length} nhóm)`}
            </Button>
          </ScrollView>
        )}
      </BottomSheet>
    </View>
  );
}

function TimelineDot({ done, current, index }: { done: boolean; current: boolean; index: number }) {
  const accent = useWorkspaceAccent();
  const style = useAnimatedStyle(() => ({ transform: [{ scale: withSpring(current ? 1.1 : 1) }] }), [current]);
  return (
    <Animated.View style={style} className={`h-7 w-7 items-center justify-center rounded-full ${done || current ? "bg-primary" : "bg-panel"}`}>
      {done ? (
        <Check size={15} strokeWidth={3} color={accent.onPrimary} />
      ) : (
        <Text className={`font-body-semibold text-xs ${current ? "text-on-primary" : "text-muted-foreground"}`}>{index + 1}</Text>
      )}
    </Animated.View>
  );
}

function ScaleRow({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (n: number) => void }) {
  return (
    <View>
      <FieldLabel>{`${label}: ${value}/${max}`}</FieldLabel>
      <View className="flex-row gap-1.5">
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <Tappable
            key={n}
            onPress={() => onChange(n)}
            className={`h-10 flex-1 items-center justify-center rounded-xl border ${n === value ? "border-primary bg-primary" : "border-border bg-panel"}`}
          >
            <Text className={`font-body-semibold text-sm ${n === value ? "text-on-primary" : "text-muted-foreground"}`}>{n}</Text>
          </Tappable>
        ))}
      </View>
    </View>
  );
}

function ChoiceRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View>
      <FieldLabel>{label}</FieldLabel>
      <View className="flex-row flex-wrap gap-2">
        {options.map((o) => (
          <Chip key={o.value} label={o.label} active={value === o.value} onPress={() => onChange(o.value)} />
        ))}
      </View>
    </View>
  );
}

function CheckInHistory({ items }: { items: any[] }) {
  const accent = useWorkspaceAccent();
  if (items.length === 0) return null;
  return (
    <Card>
      {items.map((c, i) => (
        <View key={c.id} className={`flex-row items-center gap-3 p-4 ${i > 0 ? "border-t border-border" : ""}`}>
          <Check size={16} color={accent.primary} />
          <Text className="flex-1 font-body text-sm text-foreground">
            {`${new Date(c.createdAt).toLocaleDateString("vi-VN")} · năng lượng ${c.energyLevel}/5 · RPE ${c.overallRpe} · đau ${c.painOrDiscomfort ?? 0}/10`}
          </Text>
          {c.requiresAttention ? <Badge tone="warning">Cần chú ý</Badge> : null}
        </View>
      ))}
    </Card>
  );
}

function VersionHistory({ versions }: { versions: any[] }) {
  if (versions.length <= 1) return null;
  return (
    <Card className="gap-2 p-4">
      <View className="flex-row items-center gap-1.5">
        <History size={14} color="#8b9299" />
        <Text className="font-body-semibold text-xs text-muted-foreground">Lịch sử phiên bản giáo án</Text>
      </View>
      {versions.map((v) => (
        <View key={v.id} className="flex-row items-center justify-between rounded-lg bg-panel p-2.5">
          <Text className="flex-1 font-body text-xs text-muted-foreground">{`Phiên bản ${v.version}${v.changeReason ? ` — "${v.changeReason}"` : ""}`}</Text>
          <Text className={`font-body-semibold text-xs ${v.status === "ACCEPTED" ? "text-primary" : "text-muted-foreground"}`}>
            {v.status === "ACCEPTED" ? "Đã chấp nhận" : v.status === "SUPERSEDED" ? "Đã thay thế" : v.status}
          </Text>
        </View>
      ))}
    </Card>
  );
}

