import { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarPlus,
  ChevronLeft,
  Clock,
  MapPin,
  MessageSquare,
  Star,
  TriangleAlert,
} from "lucide-react-native";

import {
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  Input,
  Segmented,
  Stagger,
  StaggerItem,
  Tappable,
  useToast,
} from "../../../src/components/ui";
import { availabilityService, contractService, sessionService } from "../../../src/services/api";
import { usePullToRefresh } from "../../../src/hooks/usePullToRefresh";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { normalizeContracts, sessionsLeft } from "../../../src/features/services/contracts";
import {
  bookableSlots,
  bookingBlockedReason,
  buildBookingPayload,
  buildReschedulePayload,
  cancelWarning,
  clientActions,
  confirmDeadlineText,
  groupOf,
  incomingReschedule,
  mergeSessionSources,
  normalizeSessions,
  normalizeSlots,
  outgoingReschedule,
  pendingReschedule,
  proposalOutcomeText,
  proposalSummary,
  rescheduleBlockedReason,
  reviewBlockedReason,
  sessionStatus,
  type SessionAction,
  type SessionRow,
} from "../../../src/features/services/sessions";

const SEGMENTS = ["Cần xử lý", "Sắp tới", "Đã qua"];

function toDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function timeLabel(iso: string | null): string {
  if (!iso) return "--:--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function dateLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const weekday = ["CN", "Th 2", "Th 3", "Th 4", "Th 5", "Th 6", "Th 7"][d.getDay()];
  return `${weekday}, ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * CL-06 (sessions), CL-07 (one session's actions) and CL-08 (booking) — one screen, because on a
 * phone they are one task: see what is coming, deal with what needs dealing with, book the next one.
 *
 * "Cần xử lý" leads deliberately: a session the trainer has filed as delivered auto-confirms if the
 * client says nothing, so it is the only group with a deadline running against them.
 *
 * Every action offered is one the server would accept in that exact state — cancelling is warned
 * about with the real 24-hour rule BEFORE the tap, and a PT no-show cannot be reported until the
 * session has actually started plus the grace period.
 */
export default function BookingScreen() {
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [segment, setSegment] = useState(SEGMENTS[0]);
  const [detail, setDetail] = useState<SessionRow | null>(null);
  const [action, setAction] = useState<SessionAction | null>(null);
  const [reason, setReason] = useState("");
  const [booking, setBooking] = useState(false);

  const contractsQuery = useQuery({
    queryKey: ["client-contracts"],
    queryFn: () => contractService.getByClient(),
  });
  const contracts = useMemo(() => normalizeContracts(contractsQuery.data), [contractsQuery.data]);
  const activeContracts = contracts.filter((c) => c.status === "ACTIVE");
  // History lives per contract, so it is read from the contracts that can still have any: the two
  // list endpoints below only ever answer with what is upcoming or waiting on the client.
  const historyContracts = contracts.filter((c) => ["ACTIVE", "COMPLETED", "EXPIRED"].includes(c.status));

  const upcomingQuery = useQuery({
    queryKey: ["sessions-upcoming"],
    queryFn: () => sessionService.getMyUpcoming(),
  });
  const pendingQuery = useQuery({
    queryKey: ["sessions-pending-confirmation"],
    queryFn: () => sessionService.listPendingConfirmation(),
  });
  const historyQueries = useQueries({
    queries: historyContracts.map((contract) => ({
      queryKey: ["contract-sessions", contract.id],
      queryFn: () => sessionService.getContractSessions(contract.id),
    })),
  });

  // Order matters: the two list endpoints carry the open reschedule proposals, the per-contract
  // history does not — see mergeSessionSources.
  const sessions = useMemo(
    () =>
      mergeSessionSources(
        normalizeSessions(upcomingQuery.data),
        normalizeSessions(pendingQuery.data),
        ...historyQueries.map((query) => normalizeSessions(query.data)),
      ),
    [upcomingQuery.data, pendingQuery.data, historyQueries],
  );

  const groups = useMemo(
    () => ({
      "Cần xử lý": sessions.filter((s) => groupOf(s) === "action"),
      "Sắp tới": sessions.filter((s) => groupOf(s) === "upcoming"),
      "Đã qua": sessions.filter((s) => groupOf(s) === "past").reverse(),
    }),
    [sessions],
  );

  const { refreshing, onRefresh } = usePullToRefresh([
    ["sessions-upcoming"],
    ["sessions-pending-confirmation"],
    ["client-contracts"],
  ]);

  const refreshSessions = () => {
    void queryClient.invalidateQueries({ queryKey: ["sessions-upcoming"] });
    void queryClient.invalidateQueries({ queryKey: ["sessions-pending-confirmation"] });
    void queryClient.invalidateQueries({ queryKey: ["contract-sessions"] });
    void queryClient.invalidateQueries({ queryKey: ["client-contracts"] });
  };

  const actionMutation = useMutation({
    mutationFn: async (input: { session: SessionRow; action: SessionAction; reason: string }) => {
      switch (input.action) {
        case "cancel":
          return sessionService.cancelSession(input.session.id, input.reason || "Khách huỷ buổi");
        case "confirm":
          return sessionService.clientConfirmSession(input.session.id);
        case "dispute":
          return sessionService.disputeSession(input.session.id, input.reason);
        case "report-no-show":
          return sessionService.reportPtNoShow(input.session.id, input.reason);
        default:
          throw new Error("unsupported");
      }
    },
    onSuccess: () => {
      setAction(null);
      setDetail(null);
      setReason("");
      refreshSessions();
      toast.show("Đã cập nhật buổi tập.", "success");
    },
    onError: (error: any) => {
      toast.show(
        error?.response?.data?.error ?? error?.response?.data?.message ?? "Không thực hiện được",
        "danger",
      );
    },
  });

  const loading =
    upcomingQuery.isLoading || pendingQuery.isLoading || contractsQuery.isLoading;

  return (
    <View className="flex-1 bg-background">
      <View style={{ paddingTop: insets.top + 12 }} className="gap-3 px-5 pb-2">
        <View className="flex-row items-center gap-2">
          <Tappable
            className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/client/services");
            }}
          >
            <ChevronLeft size={20} color="#8b9299" />
          </Tappable>
          <Text className="flex-1 font-display text-xl text-foreground">Buổi tập</Text>
        </View>
        <Segmented options={SEGMENTS} value={segment} onChange={setSegment} />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 120, paddingTop: 8 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent.primary} />
        }
      >
        {activeContracts.length > 0 ? (
          <View className="px-5 pb-3">
            <Button full icon={CalendarPlus} onPress={() => setBooking(true)}>
              Đặt buổi tập mới
            </Button>
          </View>
        ) : null}

        {loading ? (
          <View className="items-center py-16">
            <ActivityIndicator color={accent.primary} />
          </View>
        ) : groups[segment as keyof typeof groups].length === 0 ? (
          <EmptyState
            icon={Clock}
            title={
              segment === "Cần xử lý"
                ? "Không có buổi nào cần bạn xử lý"
                : segment === "Sắp tới"
                  ? "Chưa có buổi tập nào sắp tới"
                  : "Chưa có buổi tập nào đã qua"
            }
            description={
              activeContracts.length > 0
                ? "Đặt một buổi mới với huấn luyện viên của bạn."
                : "Bạn cần một hợp đồng đang hiệu lực để đặt buổi tập."
            }
          />
        ) : (
          <Stagger className="gap-3 px-5">
            {groups[segment as keyof typeof groups].map((session) => (
              <StaggerItem key={session.id}>
                <SessionCard session={session} onPress={() => setDetail(session)} />
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </ScrollView>

      {/* CL-07 — one session, its state, and only the actions that state allows. */}
      <BottomSheet open={!!detail && !action} onClose={() => setDetail(null)} title="Buổi tập">
        {detail ? (
          <View className="gap-3 pb-2">
            <View className="flex-row items-center justify-between">
              <Text className="font-display text-base text-foreground">
                {`${dateLabel(detail.startAt)} · ${timeLabel(detail.startAt)}–${timeLabel(detail.endAt)}`}
              </Text>
              <Badge tone={sessionStatus(detail.status).tone}>
                {sessionStatus(detail.status).label}
              </Badge>
            </View>

            {sessionStatus(detail.status).note ? (
              <Text className="font-body text-xs text-muted-foreground">
                {sessionStatus(detail.status).note}
              </Text>
            ) : null}
            {confirmDeadlineText(detail) ? (
              <Text className="font-body text-xs text-warning">{confirmDeadlineText(detail)}</Text>
            ) : null}

            {pendingReschedule(detail) ? (
              <View className="gap-1 rounded-xl border border-border bg-panel p-3">
                <Text className="font-body-medium text-sm text-foreground">
                  {proposalSummary(pendingReschedule(detail)!)}
                </Text>
                {pendingReschedule(detail)!.reason ? (
                  <Text className="font-body text-xs text-muted-foreground">
                    {`Lý do: ${pendingReschedule(detail)!.reason}`}
                  </Text>
                ) : null}
                {outgoingReschedule(detail) ? (
                  <Text className="font-body text-xs text-muted-foreground">
                    Đang chờ huấn luyện viên trả lời đề nghị của bạn.
                  </Text>
                ) : null}
              </View>
            ) : null}
            {detail.location ? (
              <View className="flex-row items-center gap-1.5">
                <MapPin size={13} color="#8b9299" />
                <Text className="font-body text-xs text-muted-foreground">{detail.location}</Text>
              </View>
            ) : null}
            {detail.notes ? (
              <Text className="font-body text-xs text-muted-foreground">{detail.notes}</Text>
            ) : null}
            {detail.deducted ? (
              <Text className="font-body text-xs text-muted-foreground">
                Buổi này đã được tính vào gói.
              </Text>
            ) : null}

            <View className="gap-2 pt-1">
              {clientActions(detail).map((item) => (
                <Button
                  key={item}
                  full
                  variant={item === "confirm" || item === "answer-reschedule" ? "primary" : "secondary"}
                  onPress={() => {
                    setReason("");
                    setAction(item);
                  }}
                >
                  {item === "answer-reschedule"
                    ? "Trả lời đề nghị đổi lịch"
                    : item === "cancel"
                    ? "Huỷ buổi tập"
                    : item === "reschedule"
                      ? "Đổi lịch"
                      : item === "confirm"
                        ? "Xác nhận đã tập"
                        : item === "dispute"
                          ? "Khiếu nại buổi này"
                          : item === "report-no-show"
                            ? "Báo PT vắng mặt"
                            : "Đánh giá buổi tập"}
                </Button>
              ))}
              {/* If đổi lịch is missing, say why rather than leaving the user to wonder. */}
              {["REQUESTED", "CONFIRMED"].includes(detail.status) && rescheduleBlockedReason(detail) ? (
                <Text className="font-body text-xs text-muted-foreground">
                  {rescheduleBlockedReason(detail)}
                </Text>
              ) : null}
              {clientActions(detail).length === 0 ? (
                <Text className="font-body text-xs text-muted-foreground">
                  Buổi này không còn thao tác nào cho bạn.
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}
      </BottomSheet>

      {/* Answering the trainer's proposal. Only the other side may answer one, so this sheet exists
          for exactly the PT-raised case — a client answering their own would be a 403. */}
      <AnswerRescheduleSheet
        key={action === "answer-reschedule" ? "answer-open" : "answer-closed"}
        open={action === "answer-reschedule"}
        session={detail}
        onClose={() => setAction(null)}
        onDone={(accepted) => {
          setAction(null);
          setDetail(null);
          refreshSessions();
          toast.show(
            accepted ? "Đã đồng ý đổi lịch — buổi tập chuyển sang giờ mới." : "Đã từ chối đề nghị đổi lịch.",
            "success",
          );
        }}
      />

      {/* Rescheduling reuses the same day/slot picker as booking — a proposal the PT then answers. */}
      <RescheduleSheet
        key={action === "reschedule" ? "reschedule-open" : "reschedule-closed"}
        open={action === "reschedule"}
        session={detail}
        onClose={() => setAction(null)}
        onDone={() => {
          setAction(null);
          setDetail(null);
          refreshSessions();
          toast.show("Đã gửi đề nghị đổi lịch — chờ huấn luyện viên trả lời.", "success");
        }}
      />

      <ReviewSheet
        key={action === "review" ? "review-open" : "review-closed"}
        open={action === "review"}
        session={detail}
        onClose={() => setAction(null)}
        onDone={() => {
          setAction(null);
          setDetail(null);
          refreshSessions();
          toast.show("Cảm ơn bạn đã đánh giá buổi tập.", "success");
        }}
      />

      {/* The confirm step for an action that costs something or needs a reason. */}
      <BottomSheet
        open={
          !!action && action !== "reschedule" && action !== "review" && action !== "answer-reschedule"
        }
        onClose={() => setAction(null)}
        title={
          action === "cancel"
            ? "Huỷ buổi tập"
            : action === "confirm"
              ? "Xác nhận đã tập"
              : action === "dispute"
                ? "Khiếu nại buổi tập"
                : "Báo huấn luyện viên vắng mặt"
        }
      >
        <View className="gap-3 pb-2">
          {action === "cancel" && detail ? (
            <View className="flex-row items-start gap-2 rounded-xl border border-border bg-panel p-3">
              <TriangleAlert size={16} color="#f59e0b" />
              <Text className="flex-1 font-body text-xs text-foreground">{cancelWarning(detail)}</Text>
            </View>
          ) : null}
          {action === "confirm" ? (
            <Text className="font-body text-sm leading-6 text-foreground">
              Xác nhận là buổi này đã diễn ra. Buổi sẽ được tính vào gói và phần tiền tương ứng được
              giải ngân cho huấn luyện viên.
            </Text>
          ) : null}
          {action === "dispute" || action === "report-no-show" ? (
            <Input
              value={reason}
              onChangeText={setReason}
              placeholder={
                action === "dispute"
                  ? "Buổi tập không diễn ra như PT báo vì..."
                  : "Huấn luyện viên không có mặt, bạn đã chờ..."
              }
              multiline
              numberOfLines={3}
              icon={MessageSquare}
            />
          ) : null}
          {action === "cancel" ? (
            <Input
              value={reason}
              onChangeText={setReason}
              placeholder="Lý do huỷ (tuỳ chọn)"
              icon={MessageSquare}
            />
          ) : null}

          <View className="flex-row gap-2">
            <Button variant="secondary" className="flex-1" onPress={() => setAction(null)}>
              Để sau
            </Button>
            <Button
              className="flex-1"
              disabled={
                actionMutation.isPending ||
                ((action === "dispute" || action === "report-no-show") && reason.trim().length < 5)
              }
              onPress={() =>
                detail && action && actionMutation.mutate({ session: detail, action, reason })
              }
            >
              Xác nhận
            </Button>
          </View>
        </View>
      </BottomSheet>

      {/* CL-08 — booking. */}
      <BookingSheet
        key={booking ? "booking-open" : "booking-closed"}
        open={booking}
        contracts={activeContracts}
        onClose={() => setBooking(false)}
        onBooked={() => {
          setBooking(false);
          refreshSessions();
          toast.show("Đã gửi yêu cầu đặt buổi — chờ huấn luyện viên xác nhận.", "success");
        }}
      />
    </View>
  );
}

function SessionCard({ session, onPress }: { session: SessionRow; onPress: () => void }) {
  const status = sessionStatus(session.status);
  return (
    <Tappable onPress={onPress}>
      <Card className="gap-1.5 p-4">
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1">
            <Text className="font-display text-base text-foreground">
              {dateLabel(session.startAt)}
            </Text>
            <View className="mt-0.5 flex-row items-center gap-1.5">
              <Clock size={12} color="#8b9299" />
              <Text className="font-body text-xs text-muted-foreground">
                {`${timeLabel(session.startAt)}–${timeLabel(session.endAt)}`}
                {session.sessionMode === "ONLINE" ? " · Online" : ""}
              </Text>
            </View>
          </View>
          <Badge tone={status.tone}>{status.label}</Badge>
        </View>
        {confirmDeadlineText(session) ? (
          <Text className="font-body text-xs text-warning">{confirmDeadlineText(session)}</Text>
        ) : null}
        {/* A proposal from the trainer needs an answer; one the client sent is just news. */}
        {incomingReschedule(session) ? (
          <Text className="font-body-medium text-xs text-warning">
            {proposalSummary(incomingReschedule(session)!)}
          </Text>
        ) : outgoingReschedule(session) ? (
          <Text className="font-body text-xs text-muted-foreground">
            {`${proposalSummary(outgoingReschedule(session)!)} — chờ huấn luyện viên trả lời`}
          </Text>
        ) : null}
        {session.location ? (
          <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
            {session.location}
          </Text>
        ) : null}
      </Card>
    </Tappable>
  );
}

/**
 * Answering a proposal raised by the trainer.
 *
 * Accepting moves the session to the proposed time and leaves it CONFIRMED; rejecting closes the
 * proposal and the original time stands. That difference is spelled out before either tap, because
 * "Từ chối" reads to a lot of people like "huỷ buổi tập", which it is not.
 */
function AnswerRescheduleSheet({
  open,
  session,
  onClose,
  onDone,
}: {
  open: boolean;
  session: SessionRow | null;
  onClose: () => void;
  onDone: (accepted: boolean) => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const request = session ? incomingReschedule(session) : null;

  const mutation = useMutation({
    mutationFn: (choice: "ACCEPT" | "REJECT") =>
      sessionService.respondToReschedule(request!.id, choice, note.trim() || undefined),
    onSuccess: (_data, choice) => onDone(choice === "ACCEPT"),
    onError: (error: any) => {
      toast.show(
        error?.response?.data?.error ?? error?.response?.data?.message ?? "Không gửi được trả lời",
        "danger",
      );
    },
  });

  return (
    <BottomSheet open={open} onClose={onClose} title="Đề nghị đổi lịch từ huấn luyện viên">
      <View className="gap-3 pb-2">
        {request ? (
          <>
            <View className="gap-1 rounded-xl border border-border bg-panel p-3">
              <Text className="font-body text-xs text-muted-foreground">
                {`Giờ hiện tại: ${dateLabel(request.originalStartAt)} · ${timeLabel(request.originalStartAt)}–${timeLabel(request.originalEndAt)}`}
              </Text>
              <Text className="font-body-medium text-sm text-foreground">
                {`Giờ đề nghị: ${dateLabel(request.proposedStartAt)} · ${timeLabel(request.proposedStartAt)}–${timeLabel(request.proposedEndAt)}`}
              </Text>
              {request.reason ? (
                <Text className="font-body text-xs text-muted-foreground">
                  {`Lý do: ${request.reason}`}
                </Text>
              ) : null}
            </View>

            <Text className="font-body text-xs text-muted-foreground">
              {proposalOutcomeText("ACCEPT")}
            </Text>
            <Text className="font-body text-xs text-muted-foreground">
              {proposalOutcomeText("REJECT")}
            </Text>

            <Input
              value={note}
              onChangeText={setNote}
              placeholder="Nhắn kèm cho huấn luyện viên (tuỳ chọn)"
              icon={MessageSquare}
            />

            <View className="flex-row gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                disabled={mutation.isPending}
                onPress={() => mutation.mutate("REJECT")}
              >
                Từ chối
              </Button>
              <Button
                className="flex-1"
                disabled={mutation.isPending}
                onPress={() => mutation.mutate("ACCEPT")}
              >
                Đồng ý đổi
              </Button>
            </View>
          </>
        ) : (
          <Text className="font-body text-sm text-muted-foreground">
            Đề nghị này không còn nữa — có thể huấn luyện viên đã thu hồi.
          </Text>
        )}
      </View>
    </BottomSheet>
  );
}

/**
 * Proposing a new time. The server takes two ISO instants, so the local day + slot the client picks
 * is converted here — and the session keeps its own length rather than being silently made an hour.
 */
function RescheduleSheet({
  open,
  session,
  onClose,
  onDone,
}: {
  open: boolean;
  session: SessionRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const accent = useWorkspaceAccent();
  const toast = useToast();

  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 14 }, (_, index) => {
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + index);
      return { key: toDateKey(day), label: dateLabel(day.toISOString()) };
    });
  }, []);

  const slotsQuery = useQuery({
    queryKey: ["pt-slots", session?.ptUserId, date],
    queryFn: () => availabilityService.getAvailableSlots(session!.ptUserId, date!),
    enabled: !!session?.ptUserId && !!date,
  });
  const slots = useMemo(
    () => (date ? bookableSlots(normalizeSlots(slotsQuery.data), date) : []),
    [slotsQuery.data, date],
  );

  const payload = session && date && time ? buildReschedulePayload(session, date, time) : null;

  const mutation = useMutation({
    mutationFn: () =>
      sessionService.requestReschedule(
        session!.id,
        payload!.proposedStartAt,
        payload!.proposedEndAt,
        reason.trim(),
      ),
    onSuccess: onDone,
    onError: (error: any) => {
      toast.show(
        error?.response?.data?.error ?? error?.response?.data?.message ?? "Không gửi được đề nghị",
        "danger",
      );
    },
  });

  return (
    <BottomSheet open={open} onClose={onClose} title="Đổi lịch buổi tập">
      <ScrollView style={{ maxHeight: 500 }} showsVerticalScrollIndicator={false}>
        <View className="gap-4 pb-2">
          <Text className="font-body text-xs text-muted-foreground">
            {session
              ? `Hiện tại: ${dateLabel(session.startAt)} · ${timeLabel(session.startAt)}–${timeLabel(session.endAt)}`
              : ""}
          </Text>

          <View className="gap-2">
            <Text className="font-body-medium text-xs text-muted-foreground">Ngày đề nghị</Text>
            <View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {days.map((day) => {
                  const active = day.key === date;
                  return (
                    <Tappable
                      key={day.key}
                      className={`rounded-xl border px-3.5 py-2.5 ${
                        active ? "border-primary" : "border-border bg-panel"
                      }`}
                      style={active ? { backgroundColor: accent.primary } : undefined}
                      onPress={() => {
                        setDate(day.key);
                        setTime(null);
                      }}
                    >
                      <Text
                        className={`font-body-medium text-xs ${
                          active ? "text-background" : "text-muted-foreground"
                        }`}
                      >
                        {day.label}
                      </Text>
                    </Tappable>
                  );
                })}
              </ScrollView>
            </View>
          </View>

          {date ? (
            <View className="gap-2">
              <Text className="font-body-medium text-xs text-muted-foreground">Khung giờ trống</Text>
              {slotsQuery.isLoading ? (
                <ActivityIndicator color={accent.primary} />
              ) : slots.length === 0 ? (
                <Text className="font-body text-xs text-muted-foreground">
                  Huấn luyện viên không còn khung giờ trống trong ngày này.
                </Text>
              ) : (
                <View className="flex-row flex-wrap gap-2">
                  {slots.map((slot) => {
                    const active = slot === time;
                    return (
                      <Tappable
                        key={slot}
                        className={`rounded-xl border px-3.5 py-2 ${
                          active ? "border-primary" : "border-border bg-panel"
                        }`}
                        style={active ? { backgroundColor: accent.primary } : undefined}
                        onPress={() => setTime(slot)}
                      >
                        <Text
                          className={`font-body-medium text-sm ${
                            active ? "text-background" : "text-foreground"
                          }`}
                        >
                          {slot}
                        </Text>
                      </Tappable>
                    );
                  })}
                </View>
              )}
            </View>
          ) : null}

          <Input
            value={reason}
            onChangeText={setReason}
            placeholder="Lý do đổi lịch"
            multiline
            numberOfLines={2}
            icon={MessageSquare}
          />

          <View className="flex-row gap-2">
            <Button variant="secondary" className="flex-1" onPress={onClose}>
              Để sau
            </Button>
            <Button
              className="flex-1"
              disabled={!payload || reason.trim().length < 5 || mutation.isPending}
              onPress={() => mutation.mutate()}
            >
              Gửi đề nghị
            </Button>
          </View>
          {!payload ? (
            <Text className="text-center font-body text-xs text-muted-foreground">
              Chọn ngày và khung giờ mới.
            </Text>
          ) : reason.trim().length < 5 ? (
            <Text className="text-center font-body text-xs text-muted-foreground">
              Viết ngắn gọn lý do để huấn luyện viên dễ đồng ý.
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

/** Rating a finished session: stars are the whole point, the comment is optional. */
function ReviewSheet({
  open,
  session,
  onClose,
  onDone,
}: {
  open: boolean;
  session: SessionRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const accent = useWorkspaceAccent();
  const toast = useToast();

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const blocked = reviewBlockedReason(rating);

  const mutation = useMutation({
    mutationFn: () => sessionService.reviewSession(session!.id, rating, comment.trim() || undefined),
    onSuccess: onDone,
    onError: (error: any) => {
      toast.show(
        error?.response?.data?.error ?? error?.response?.data?.message ?? "Không gửi được đánh giá",
        "danger",
      );
    },
  });

  return (
    <BottomSheet open={open} onClose={onClose} title="Đánh giá buổi tập">
      <View className="gap-4 pb-2">
        <View className="flex-row justify-center gap-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <Tappable key={star} onPress={() => setRating(star)} accessibilityLabel={`${star} sao`}>
              <Star
                size={34}
                color={star <= rating ? "#f59e0b" : "#3f3f46"}
                fill={star <= rating ? "#f59e0b" : "transparent"}
              />
            </Tappable>
          ))}
        </View>

        <Input
          value={comment}
          onChangeText={setComment}
          placeholder="Nhận xét cho huấn luyện viên (tuỳ chọn)"
          multiline
          numberOfLines={3}
          icon={MessageSquare}
        />

        <View className="flex-row gap-2">
          <Button variant="secondary" className="flex-1" onPress={onClose}>
            Để sau
          </Button>
          <Button
            className="flex-1"
            disabled={!!blocked || mutation.isPending}
            onPress={() => mutation.mutate()}
          >
            Gửi đánh giá
          </Button>
        </View>
        {blocked ? (
          <Text className="text-center font-body text-xs text-muted-foreground">{blocked}</Text>
        ) : (
          <Text className="text-center font-body text-xs" style={{ color: accent.primary }}>
            {`${rating}/5 sao`}
          </Text>
        )}
      </View>
    </BottomSheet>
  );
}

/** The booking flow: which contract, which day, which of the trainer's free slots. */
function BookingSheet({
  open,
  contracts,
  onClose,
  onBooked,
}: {
  open: boolean;
  contracts: ReturnType<typeof normalizeContracts>;
  onClose: () => void;
  onBooked: () => void;
}) {
  const accent = useWorkspaceAccent();
  const toast = useToast();

  const [contractId, setContractId] = useState<string | null>(contracts[0]?.id ?? null);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");

  const contract = contracts.find((c) => c.id === contractId) ?? contracts[0] ?? null;

  // Fourteen days is what fits a phone without a full calendar, and matches how far ahead the
  // availability endpoint is useful in practice.
  const days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 14 }, (_, index) => {
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + index);
      return { key: toDateKey(day), label: dateLabel(day.toISOString()) };
    });
  }, []);

  const slotsQuery = useQuery({
    queryKey: ["pt-slots", contract?.ptUserId, date],
    queryFn: () => availabilityService.getAvailableSlots(contract!.ptUserId, date!),
    enabled: !!contract?.ptUserId && !!date,
  });

  const slots = useMemo(
    () => (date ? bookableSlots(normalizeSlots(slotsQuery.data), date) : []),
    [slotsQuery.data, date],
  );

  const blocked = contract
    ? bookingBlockedReason({
        contractStatus: contract.status,
        sessionsLeft: sessionsLeft(contract),
        date,
        time,
      })
    : "Bạn chưa có hợp đồng đang hiệu lực.";

  const bookMutation = useMutation({
    mutationFn: () =>
      sessionService.bookSession(
        contract!.id,
        buildBookingPayload({
          date: date!,
          time: time!,
          sessionMode: contract!.sessionMode,
          location,
          notes,
        }),
      ),
    onSuccess: onBooked,
    onError: (error: any) => {
      toast.show(
        error?.response?.data?.error ?? error?.response?.data?.message ?? "Không đặt được buổi",
        "danger",
      );
    },
  });

  return (
    <BottomSheet open={open} onClose={onClose} title="Đặt buổi tập">
      <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
        <View className="gap-4 pb-2">
          {contracts.length > 1 ? (
            <View className="gap-2">
              <Text className="font-body-medium text-xs text-muted-foreground">Hợp đồng</Text>
              {contracts.map((item) => {
                const active = item.id === contractId;
                return (
                  <Tappable
                    key={item.id}
                    className={`rounded-xl border p-3 ${
                      active ? "border-primary bg-primary/10" : "border-border bg-panel"
                    }`}
                    onPress={() => {
                      setContractId(item.id);
                      setTime(null);
                    }}
                  >
                    <Text className="font-body-medium text-sm text-foreground" numberOfLines={1}>
                      {item.packageName}
                    </Text>
                    <Text className="font-body text-xs text-muted-foreground">
                      {`${item.ptName} · còn ${sessionsLeft(item)} buổi`}
                    </Text>
                  </Tappable>
                );
              })}
            </View>
          ) : contract ? (
            <Text className="font-body text-xs text-muted-foreground">
              {`${contract.packageName} · ${contract.ptName} · còn ${sessionsLeft(contract)} buổi`}
            </Text>
          ) : null}

          <View className="gap-2">
            <Text className="font-body-medium text-xs text-muted-foreground">Ngày tập</Text>
            <View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
              >
                {days.map((day) => {
                  const active = day.key === date;
                  return (
                    <Tappable
                      key={day.key}
                      className={`rounded-xl border px-3.5 py-2.5 ${
                        active ? "border-primary" : "border-border bg-panel"
                      }`}
                      style={active ? { backgroundColor: accent.primary } : undefined}
                      onPress={() => {
                        setDate(day.key);
                        setTime(null);
                      }}
                    >
                      <Text
                        className={`font-body-medium text-xs ${
                          active ? "text-background" : "text-muted-foreground"
                        }`}
                      >
                        {day.label}
                      </Text>
                    </Tappable>
                  );
                })}
              </ScrollView>
            </View>
          </View>

          {date ? (
            <View className="gap-2">
              <Text className="font-body-medium text-xs text-muted-foreground">Khung giờ trống</Text>
              {slotsQuery.isLoading ? (
                <ActivityIndicator color={accent.primary} />
              ) : slots.length === 0 ? (
                <Text className="font-body text-xs text-muted-foreground">
                  Huấn luyện viên không còn khung giờ trống trong ngày này.
                </Text>
              ) : (
                <View className="flex-row flex-wrap gap-2">
                  {slots.map((slot) => {
                    const active = slot === time;
                    return (
                      <Tappable
                        key={slot}
                        className={`rounded-xl border px-3.5 py-2 ${
                          active ? "border-primary" : "border-border bg-panel"
                        }`}
                        style={active ? { backgroundColor: accent.primary } : undefined}
                        onPress={() => setTime(slot)}
                      >
                        <Text
                          className={`font-body-medium text-sm ${
                            active ? "text-background" : "text-foreground"
                          }`}
                        >
                          {slot}
                        </Text>
                      </Tappable>
                    );
                  })}
                </View>
              )}
            </View>
          ) : null}

          {contract?.sessionMode === "OFFLINE" ? (
            <Input
              value={location}
              onChangeText={setLocation}
              placeholder="Địa điểm (tuỳ chọn)"
              icon={MapPin}
            />
          ) : null}
          <Input
            value={notes}
            onChangeText={setNotes}
            placeholder="Ghi chú cho huấn luyện viên (tuỳ chọn)"
            icon={MessageSquare}
          />

          <Button full disabled={!!blocked || bookMutation.isPending} onPress={() => bookMutation.mutate()}>
            {bookMutation.isPending ? "Đang đặt..." : "Đặt buổi tập"}
          </Button>
          {blocked ? (
            <Text className="text-center font-body text-xs text-muted-foreground">{blocked}</Text>
          ) : (
            <Text className="text-center font-body text-xs text-muted-foreground">
              Buổi tập chỉ được tính vào gói sau khi hoàn thành và được xác nhận.
            </Text>
          )}
        </View>
      </ScrollView>
    </BottomSheet>
  );
}
