import { useState } from "react";
import { ActivePill } from "../../components/ui/ActivePill";
import { CalendarIcon as Calendar, ClockIcon as Clock, CaretLeftIcon as ChevronLeft, CaretRightIcon as ChevronRight, XIcon as X, PlusIcon as Plus, CircleNotchIcon as Loader2, CheckIcon as Check, CheckCircleIcon as CheckCircle, XCircleIcon as XCircle, WarningOctagonIcon as AlertOctagon, ProhibitIcon as Ban, GearSixIcon as Settings } from "@phosphor-icons/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionService, availabilityService, contractService } from "../../services/api";
import { toast } from "sonner";
import type {
  Session,
  SessionStatus,
  DayOfWeek,
  PTAvailabilitySlot,
  PTScheduleException,
} from "../../types";
import { DateSlotPicker, type DateSlotValue } from "../../components/booking/DateSlotPicker";
import { Modal, ModalTitle } from "../../components/ui/Modal";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { confirmedSessionsOnDate, ptBlockDayNotice, ptCancelDoneMessage, ptCancelNotice } from "./ptCancelNotice";
import { useNavigate } from "react-router";
import { sessionsToClose, sessionWhenLabel } from "./sessionsToClose";
import { formatDateTimeVi } from "../../utils/contractGymOptions"; // "19:00 25/11/2026" - the PT-11 fix: date shown, no seconds
import { fullName } from "../../utils/fullName";
import { rescheduleBlockedReason, rescheduleErrorMessage, rescheduleSubmitHint } from "../../utils/reschedule";
import { useAcceptedMoves } from "../../hooks/useAcceptedMoves";
import { isWebPresentation } from "../../utils/webPresentation";
import { QueryErrorNotice } from "../../components/ui/QueryErrorNotice";
import { listFailed, QUERY_ERROR_TEXT } from "../../utils/queryErrorState";

// WEB UI prototype: web gets the shared navigation patterns; the packaged Capacitor app keeps the previous markup.
const WEB_UI = isWebPresentation();

// Mirrors booking.service.ts's own NO_SHOW_GRACE_MINUTES default (env-overridable server-side,
// so this can drift by a few minutes from whatever the server actually enforces — harmless:
// this only decides when the button appears, the server call it triggers is re-checked there
// regardless).
const NO_SHOW_GRACE_MIN = 15;

const DAYS_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const MONTHS = [
  "Tháng 1",
  "Tháng 2",
  "Tháng 3",
  "Tháng 4",
  "Tháng 5",
  "Tháng 6",
  "Tháng 7",
  "Tháng 8",
  "Tháng 9",
  "Tháng 10",
  "Tháng 11",
  "Tháng 12",
];
const WEEK_DAYS: DayOfWeek[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];
const DAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: "Thứ 2",
  TUESDAY: "Thứ 3",
  WEDNESDAY: "Thứ 4",
  THURSDAY: "Thứ 5",
  FRIDAY: "Thứ 6",
  SATURDAY: "Thứ 7",
  SUNDAY: "CN",
};

const SESSION_STATUS_CFG: Record<
  SessionStatus,
  { label: string; color: string; bg: string }
> = {
  REQUESTED: {
    label: "Chờ xác nhận",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
  },
  CONFIRMED: {
    label: "Đã xác nhận",
    color: "text-green-400",
    bg: "bg-green-500/10 border-green-500/20",
  },
  PENDING_CLIENT_CONFIRMATION: {
    label: "Chờ khách xác nhận",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
  },
  DISPUTED: {
    label: "Đang tranh chấp",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
  },
  PT_NO_SHOW_REPORTED: {
    label: "Đã báo vắng mặt",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
  },
  COMPLETED: {
    label: "Hoàn thành",
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
  },
  CANCELLED: {
    label: "Đã hủy",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
  },
  NO_SHOW: {
    label: "Vắng mặt",
    color: "text-zinc-400",
    bg: "bg-zinc-700/50 border-zinc-700",
  },
  // Merge note: added for the payment-gateways branch's reschedule-request flow — see the
  // same note on BookingPage.tsx/PTContractsPage.tsx's SESSION_STATUS maps.
  RESCHEDULE_PENDING: {
    label: "Chờ đổi lịch",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
  },
};

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDay(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function formatSessionTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

type Tab = "schedule" | "availability";

export function PTSchedulePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(
    today.getDate(),
  );
  const [tab, setTab] = useState<Tab>("schedule");

  // Availability editing state
  const [editSlots, setEditSlots] = useState<
    Record<string, { start: string; end: string }>
  >({});
  const [isEditingAvail, setIsEditingAvail] = useState(false);
  const [blockDate, setBlockDate] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [cancelTarget, setCancelTarget] = useState<{ id: string; status: string; name: string } | null>(null);
  const [blockConfirm, setBlockConfirm] = useState<{ date: string; reason?: string; count: number } | null>(null);

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDay(year, month);
  const prevMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear(year - 1);
    } else setMonth(month - 1);
  };
  const nextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear(year + 1);
    } else setMonth(month + 1);
  };

  // ── Queries ──────────────────────────────────────────────────────
  const { data: upcomingSessions = [], isLoading: loadingSessions } = useQuery({
    queryKey: ["sessions-upcoming"],
    queryFn: () => sessionService.getMyUpcoming(),
  });
  // Moves already used per session (history read up front), so "đã dời 2 lần" is known before the form is filled.
  const acceptedMovesFor = useAcceptedMoves(upcomingSessions as Session[]);

  // Money-flow plan 4.3: sessions a client reported this PT as a no-show for. A separate,
  // time-unfiltered query — these are already in the past, so they never appear in
  // sessions-upcoming above.
  // Session rows only carry clientUserId; the PT's contract list (same cache as /pt/contracts)
  // already has each client's profile, so show a name instead of a UUID fragment.
  const { data: ptContracts = [] } = useQuery({
    queryKey: ["pt-contracts", ""],
    queryFn: () => contractService.getByPT(),
  });
  const clientNameById = new Map<string, string>();
  for (const c of ptContracts as any[]) {
    const p = c?.clientProfile;
    const n = fullName(p);
    if (c?.clientUserId && n) clientNameById.set(c.clientUserId, n);
  }
  const clientLabel = (id: string) => clientNameById.get(id) ?? "Khách hàng";

  const { data: noShowReports = [] } = useQuery({
    queryKey: ["sessions-no-show-reports"],
    queryFn: () => sessionService.listNoShowReports(),
  });

  // N15B-06: an in-person session that is over but still CONFIRMED is no longer in "upcoming" - without this list the PT could
  // only close it from the contract page.
  const awaitingQuery = useQuery({
    queryKey: ["sessions-awaiting-completion"],
    queryFn: () => sessionService.listAwaitingCompletion(),
  });
  const awaitingRaw = awaitingQuery.data ?? [];
  // A failed list must not read as "nothing to close" (FE2-FIX group B).
  const awaitingFailed = listFailed(awaitingQuery);
  const awaitingCompletion = sessionsToClose(awaitingRaw as Session[]);

  const { data: availability = [], isLoading: loadingAvail } = useQuery({
    queryKey: ["pt-availability"],
    queryFn: () => availabilityService.getAvailability("me"),
  });

  const { data: exceptions = [] } = useQuery({
    queryKey: ["pt-exceptions"],
    queryFn: () => availabilityService.getExceptions(),
  });

  // Filter sessions for selected day
  const sessions = upcomingSessions as Session[];
  const daySessions = selectedDay
    ? sessions.filter((s) => {
        const d = new Date(s.scheduledStartAt);
        return (
          d.getFullYear() === year &&
          d.getMonth() === month &&
          d.getDate() === selectedDay
        );
      })
    : [];

  // Session days for calendar dots
  const sessionDays = new Set(
    sessions
      .map((s) => {
        const d = new Date(s.scheduledStartAt);
        if (d.getFullYear() === year && d.getMonth() === month)
          return d.getDate();
        return -1;
      })
      .filter((d) => d > 0),
  );

  // Blocked dates set
  const blockedDates = new Set(
    (exceptions as PTScheduleException[]).map((e) =>
      new Date(e.date).toISOString().slice(0, 10),
    ),
  );

  // ── Session mutations ────────────────────────────────────────────
  const confirmMut = useMutation({
    mutationFn: (id: string) => sessionService.confirmSession(id),
    onSuccess: () => {
      toast.success("Đã xác nhận buổi tập");
      queryClient.invalidateQueries({ queryKey: ["sessions-upcoming"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Thao tác không thành công"),
  });

  const completeMut = useMutation({
    mutationFn: (id: string) => sessionService.completeSession(id),
    onSuccess: () => {
      toast.success("Đã hoàn thành buổi tập");
      queryClient.invalidateQueries({ queryKey: ["sessions-upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["sessions-awaiting-completion"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Thao tác không thành công"),
  });

  const cancelSessionMut = useMutation({
    mutationFn: ({ id }: { id: string; status: string }) =>
      sessionService.cancelSession(id, "PT hủy buổi tập"),
    onSuccess: (_data, vars) => {
      toast.success(ptCancelDoneMessage(vars.status));
      queryClient.invalidateQueries({ queryKey: ["sessions-upcoming"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Thao tác không thành công"),
  });

  const noShowMut = useMutation({
    mutationFn: (id: string) => sessionService.markNoShow(id, "CLIENT"),
    onSuccess: () => {
      toast.success("Đã ghi nhận vắng mặt");
      queryClient.invalidateQueries({ queryKey: ["sessions-upcoming"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Thao tác không thành công"),
  });

  // Money-flow plan 3.3: the PT's schedule had no way at all to respond to a client's
  // reschedule proposal (unlike the client side, which had a broken check — this side simply
  // had nothing). Mirrors BookingPage.tsx's client-side handling of the same
  // `respondToReschedule` endpoint.
  const respondRescheduleMut = useMutation({
    mutationFn: ({ requestId, action }: { requestId: string; action: "ACCEPT" | "REJECT" }) =>
      sessionService.respondToReschedule(requestId, action),
    onSuccess: (_data, variables) => {
      toast.success(variables.action === "ACCEPT" ? "Đã đồng ý đổi lịch" : "Đã từ chối đổi lịch");
      queryClient.invalidateQueries({ queryKey: ["sessions-upcoming"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Thao tác không thành công"),
  });

  // The PT's own fixed weekly hours (Mon–Fri, say) are a default, not a ceiling — a PT who
  // is unexpectedly out on a normal working day needs a way to move THAT session, same right
  // the client side already had. requestReschedule doesn't care which side calls it; only
  // the frontend never let the PT reach it.
  const [rescheduleTarget, setRescheduleTarget] = useState<Session | null>(null);
  const [rescheduleSlot, setRescheduleSlot] = useState<DateSlotValue | null>(null);
  const [rescheduleReason, setRescheduleReason] = useState("");
  // The server's own reason for refusing, kept inside the modal (the toast alone vanishes in seconds).
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const requestRescheduleMut = useMutation({
    mutationFn: ({ id, proposedStartAt, proposedEndAt, reason }: { id: string; proposedStartAt: string; proposedEndAt: string; reason: string }) =>
      sessionService.requestReschedule(id, proposedStartAt, proposedEndAt, reason),
    onMutate: () => setRescheduleError(null),
    onSuccess: () => {
      toast.success("Đã gửi yêu cầu dời lịch — chờ khách xác nhận");
      setRescheduleTarget(null);
      setRescheduleSlot(null);
      setRescheduleReason("");
      setRescheduleError(null);
      queryClient.invalidateQueries({ queryKey: ["sessions-upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["session-reschedule-history"] });
    },
    onError: (err: any) => {
      const message = rescheduleErrorMessage(err, "Không thể gửi yêu cầu dời lịch");
      setRescheduleError(message);
      toast.error(message);
      // A refusal usually means the list is stale (the client proposed meanwhile, a move was used): reload it.
      queryClient.invalidateQueries({ queryKey: ["sessions-upcoming"] });
    },
  });

  // The PT withdraws their own open proposal (confirmed in a dialog first; server: proposer only, only while PENDING).
  const [withdrawRequestId, setWithdrawRequestId] = useState<string | null>(null);
  const withdrawMut = useMutation({
    mutationFn: (requestId: string) => sessionService.cancelReschedule(requestId),
    onSuccess: () => toast.success("Đã rút lại đề nghị dời lịch — buổi giữ nguyên giờ cũ"),
    onError: (err: any) => toast.error(rescheduleErrorMessage(err, "Không thể rút lại đề nghị")),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions-upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["session-reschedule-history"] });
    },
  });

  // Money-flow plan 4.3 — PT responds to a client's no-show report.
  const respondNoShowMut = useMutation({
    mutationFn: ({ id, response, note }: { id: string; response: "AGREE" | "DENY"; note?: string }) =>
      sessionService.respondToNoShowReport(id, response, note),
    onSuccess: (_data, variables) => {
      toast.success(
        variables.response === "AGREE"
          ? "Đã xác nhận vắng mặt — khách sẽ được bồi thường"
          : "Đã gửi phản đối — quản trị viên sẽ phân xử",
      );
      queryClient.invalidateQueries({ queryKey: ["sessions-no-show-reports"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Không thể phản hồi"),
  });
  const [denyNoShowId, setDenyNoShowId] = useState<string | null>(null);
  const [denyNoShowNote, setDenyNoShowNote] = useState("");

  // ── Availability mutations ───────────────────────────────────────
  const saveAvailMut = useMutation({
    mutationFn: (
      slots: Array<{ dayOfWeek: string; startTime: string; endTime: string }>,
    ) => availabilityService.setAvailability(slots),
    onSuccess: (data: any) => {
      const affected = data?.affectedSessions?.length || 0;
      if (affected > 0) {
        toast.warning(
          `Đã lưu lịch. Bạn có ${affected} buổi tập đã được đặt ngoài khung giờ mới. Bạn cần tự thoả thuận dời lịch với khách hàng.`,
          { duration: 6000 }
        );
      } else {
        toast.success("Đã lưu lịch làm việc");
      }
      setIsEditingAvail(false);
      queryClient.invalidateQueries({ queryKey: ["pt-availability"] });
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error || "Không lưu được lịch làm việc"),
  });

  const addExceptionMut = useMutation({
    mutationFn: ({ date, reason }: { date: string; reason?: string }) =>
      availabilityService.addException(date, reason),
    onSuccess: (result: any) => {
      const affected = result?.affectedSessions ?? result?.data?.affectedSessions ?? 0;
      toast.success(
        affected > 0
          ? `Đã chặn ngày — ${affected} buổi tập trong ngày đó đã bị hủy và khách hàng được bồi thường`
          : "Đã chặn ngày",
      );
      setBlockDate("");
      setBlockReason("");
      queryClient.invalidateQueries({ queryKey: ["pt-exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["pt-sessions"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Thao tác không thành công"),
  });

  const removeExceptionMut = useMutation({
    mutationFn: (id: string) => availabilityService.removeException(id),
    onSuccess: () => {
      toast.success("Đã bỏ chặn ngày");
      queryClient.invalidateQueries({ queryKey: ["pt-exceptions"] });
    },
  });

  // ── Availability editing helpers ─────────────────────────────────
  const startEditing = () => {
    const slots: Record<string, { start: string; end: string }> = {};
    for (const s of availability as PTAvailabilitySlot[]) {
      slots[s.dayOfWeek] = { start: s.startTime, end: s.endTime };
    }
    setEditSlots(slots);
    setIsEditingAvail(true);
  };

  const toggleDay = (day: DayOfWeek) => {
    setEditSlots((prev) => {
      if (prev[day]) {
        const next = { ...prev };
        delete next[day];
        return next;
      }
      return { ...prev, [day]: { start: "09:00", end: "17:00" } };
    });
  };

  const updateSlotTime = (
    day: string,
    field: "start" | "end",
    value: string,
  ) => {
    setEditSlots((prev) => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }));
  };

  const saveAvailability = () => {
    const slots = Object.entries(editSlots).map(([day, times]) => ({
      dayOfWeek: day,
      startTime: times.start,
      endTime: times.end,
    }));
    saveAvailMut.mutate(slots);
  };

  // w-full: without it, this root block sat inside AppShell's `flex flex-col` page-transition
  // wrapper and, despite align-items:stretch being the flex default, ended up sized to its own
  // content's max-content width instead of the container's full available width — the exact
  // bug reported live: picking a day whose session card (buttons, longer names) is wider than
  // the empty "Không có buổi tập nào trong ngày này" state visibly widened the ENTIRE page, calendar column
  // included, even though the calendar's own content never changed. w-full pins the block to
  // 100% of its flex parent regardless of what any one child renders.
  return (
    <div className="w-full p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
            <Calendar className="w-5 h-5 text-green-400" /> Lịch của tôi
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">
            Quản lý các buổi huấn luyện và lịch làm việc của bạn
          </p>
        </div>
      </div>

      {/* N15B-06: finished in-person sessions nobody closed yet */}
      {awaitingFailed && (
        <QueryErrorNotice testId="pt-sessions-to-close-error" text={QUERY_ERROR_TEXT.ptSessionsToClose} onRetry={() => awaitingQuery.refetch()} busy={awaitingQuery.isFetching} />
      )}
      {awaitingCompletion.length > 0 && (
        <section data-testid="pt-sessions-to-close" aria-label="Cần chốt buổi" className="bg-blue-500/5 border border-blue-500/30 rounded-xl p-4 space-y-3">
          <div>
            <h2 className="text-sm font-bold text-blue-400">Cần chốt buổi ({awaitingCompletion.length})</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Các buổi trực tiếp đã kết thúc nhưng bạn chưa báo hoàn thành. Bấm Hoàn thành để khách xác nhận và buổi được tính.</p>
          </div>
          <ul className="space-y-2">
            {awaitingCompletion.map((s) => (
              <li key={s.id} className="flex flex-col gap-2 rounded-lg border border-zinc-800/60 bg-zinc-900 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-200">{sessionWhenLabel(s)}</p>
                  <p className="text-xs text-zinc-500 truncate">{clientLabel(s.clientUserId)}</p>
                </div>
                <button
                  type="button"
                  data-testid="pt-session-complete"
                  onClick={() => completeMut.mutate(s.id)}
                  disabled={completeMut.isPending}
                  className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-blue-500 px-4 text-xs font-bold text-white transition-all hover:bg-blue-400 disabled:opacity-50"
                >
                  <CheckCircle className="w-4 h-4" /> Hoàn thành
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Money-flow plan 4.3: a client reported this PT as a no-show — needs a response */}
      {(noShowReports as Session[]).length > 0 && (
        <div className="space-y-3">
          {(noShowReports as Session[]).map((s) => (
            <div key={s.id} className="bg-red-500/5 border border-red-500/30 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <p className="text-sm font-bold text-red-400">
                    Khách báo bạn vắng mặt — buổi {formatSessionTime(s.scheduledStartAt)}
                  </p>
                  {s.disputeReason && (
                    <p className="text-xs text-zinc-400 mt-1">Lý do khách nêu: {s.disputeReason}</p>
                  )}
                </div>
              </div>
              {denyNoShowId === s.id ? (
                <div className="bg-zinc-800/60 border border-zinc-700/60 rounded-lg p-3 mt-2">
                  <textarea
                    value={denyNoShowNote}
                    onChange={(e) => setDenyNoShowNote(e.target.value)}
                    placeholder="Giải trình của bạn — quản trị viên sẽ xem xét..."
                    className="w-full bg-zinc-900 border border-zinc-700/60 rounded-lg px-3 py-2 text-sm text-zinc-200 mb-2 min-h-[70px]"
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setDenyNoShowId(null)}
                      className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
                    >
                      Huỷ
                    </button>
                    <button
                      onClick={() => {
                        respondNoShowMut.mutate({ id: s.id, response: "DENY", note: denyNoShowNote });
                        setDenyNoShowId(null);
                        setDenyNoShowNote("");
                      }}
                      disabled={!denyNoShowNote.trim() || respondNoShowMut.isPending}
                      className="px-4 py-1.5 bg-red-500 hover:bg-red-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-all"
                    >
                      Gửi phản đối
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => respondNoShowMut.mutate({ id: s.id, response: "AGREE" })}
                    disabled={respondNoShowMut.isPending}
                    className="flex items-center gap-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-100 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                  >
                    <Check className="w-3.5 h-3.5" /> Xác nhận đúng — tôi vắng mặt
                  </button>
                  <button
                    onClick={() => setDenyNoShowId(s.id)}
                    className="flex items-center gap-1 border border-zinc-600 text-zinc-300 hover:bg-zinc-800 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> Phản đối
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      {WEB_UI ? (
        // Not a tab bar: this page has one view, and "Lịch làm việc" goes to another page — so it is a link.
        <div className="flex justify-end">
          <a href="/pt/listing" onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); navigate("/pt/listing"); }} className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--ob-r-md)] border border-[var(--ob-hair-strong)] px-3 text-sm font-medium text-[var(--ob-text)] hover:bg-[var(--ob-hover)]" data-testid="pt-schedule-availability-link">
            <Settings className="h-4 w-4" aria-hidden="true" /> Lịch làm việc
          </a>
        </div>
      ) : (
      <div className="flex gap-1 bg-zinc-800/60 border border-zinc-700/40 p-1 rounded-xl w-full sm:w-auto sm:inline-flex">
        <button
          onClick={() => setTab("schedule")}
          className={`relative flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${tab === "schedule" ? "text-black" : "text-zinc-500 hover:text-zinc-300"}`}
        >
          {tab === "schedule" && <ActivePill group="pt-schedule-tab" className="rounded-lg bg-green-500 shadow-sm" />}
          <span className="relative">Buổi tập</span>
        </button>
        <button
          onClick={() => navigate("/pt/listing")}
          className={`flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-1.5 ${tab === "availability" ? "bg-green-500 text-black shadow-sm" : "text-zinc-500 hover:text-zinc-300"}`}
        >
          <Settings className="w-3.5 h-3.5" /> Lịch làm việc
        </button>
      </div>
      )}

      {/* ─── SCHEDULE TAB ─── */}
      {tab === "schedule" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Calendar */}
          <div className="lg:col-span-2 bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <div className="flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={prevMonth}
                aria-label="Tháng trước"
                className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <h3 className="text-sm font-bold text-zinc-200">
                {MONTHS[month]} {year}
              </h3>
              <button
                type="button"
                onClick={nextMonth}
                aria-label="Tháng sau"
                className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-2">
              {DAYS_SHORT.map((d) => (
                <div
                  key={d}
                  className="text-center text-xs text-zinc-600 py-1 font-semibold"
                >
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstDay }).map((_, i) => (
                <div key={`e-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const isToday =
                  year === today.getFullYear() &&
                  month === today.getMonth() &&
                  day === today.getDate();
                const hasS = sessionDays.has(day);
                const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const isBlocked = blockedDates.has(dateStr);
                return (
                  <button
                    key={day}
                    onClick={() => setSelectedDay(day)}
                    className={`aspect-square flex flex-col items-center justify-center rounded-xl text-xs transition-all font-medium ${
                      selectedDay === day
                        ? "bg-green-500 text-black shadow-lg shadow-green-500/25"
                        : isBlocked
                          ? "bg-red-500/10 text-red-400/60 border border-red-500/20"
                          : isToday
                            ? "bg-green-500/15 text-green-400 border border-green-500/30"
                            : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    }`}
                  >
                    {day}
                    {hasS && (
                      <div
                        className={`w-1.5 h-1.5 rounded-full mt-0.5 ${selectedDay === day ? "bg-black" : "bg-green-500"}`}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Day sessions */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-zinc-200">
              {selectedDay
                ? `Ngày ${selectedDay} ${MONTHS[month].toLowerCase()}`
                : "Chọn một ngày"}
            </h4>

            {loadingSessions ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
              </div>
            ) : daySessions.length === 0 ? (
              <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-6 text-center">
                <Calendar className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
                <p className="text-sm text-zinc-500">Không có buổi tập nào trong ngày này</p>
              </div>
            ) : (
              daySessions.map((s) => {
                const cfg = SESSION_STATUS_CFG[s.status];
                return (
                  <div
                    key={s.id}
                    className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}
                      >
                        {cfg.label}
                      </span>
                      <span className="text-xs text-zinc-600">
                        {s.sessionMode === "ONLINE" ? "Trực tuyến" : "Trực tiếp"}
                      </span>
                      <span className="text-xs text-zinc-500 ml-auto">
                        {formatSessionTime(s.scheduledStartAt)}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-500">
                      {clientLabel(s.clientUserId)}
                    </div>
                    {s.notes && (
                      <p className="text-xs text-zinc-600 mt-1">{s.notes}</p>
                    )}

                    <div className="flex gap-1.5 mt-3 pt-2 border-t border-zinc-800/40">
                      {s.status === "REQUESTED" && (
                        <>
                          <button
                            onClick={() => confirmMut.mutate(s.id)}
                            disabled={confirmMut.isPending}
                            className="flex items-center gap-1 bg-green-500 hover:bg-green-400 text-black px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all"
                          >
                            <Check className="w-3 h-3" /> Xác nhận
                          </button>
                          <button
                            onClick={() => setCancelTarget({ id: s.id, status: s.status, name: clientLabel(s.clientUserId) })}
                            disabled={cancelSessionMut.isPending}
                            className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors"
                          >
                            <X className="w-3 h-3" /> Từ chối
                          </button>
                        </>
                      )}
                      {s.status === "CONFIRMED" && (
                        <>
                          {/* Open-room redesign: an ONLINE session's outcome (completed /
                              no-show, either direction) is now decided automatically by the
                              room-close sweep once its window passes, reading who actually
                              joined — Complete/No-Show would just race that same decision by
                              hand. Cancel stays for both modes: cancelling happens BEFORE the
                              room's own window resolves anything, a different moment in the
                              session's life entirely.
                              Both buttons were showing (and failing on click, with a 400 from
                              the server) for sessions that had not happened yet — the backend
                              has always gated on the clock (booking.service.ts's
                              completeSession requires scheduledEndAt to have passed;
                              markNoShow requires scheduledStartAt + a grace period), the
                              buttons here just never mirrored that, letting a PT try to close
                              out a session days in advance. NO_SHOW_GRACE_MIN mirrors that
                              service's own default (NO_SHOW_GRACE_MINUTES=15) — a UI nicety,
                              not the real guard; the server rejects either call regardless. */}
                          {s.sessionMode !== "ONLINE" && (
                            <>
                              {Date.now() >= new Date(s.scheduledEndAt).getTime() && (
                                <button
                                  onClick={() => completeMut.mutate(s.id)}
                                  disabled={completeMut.isPending}
                                  className="flex items-center gap-1 bg-blue-500 hover:bg-blue-400 text-white px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all"
                                >
                                  <CheckCircle className="w-3 h-3" /> Hoàn thành
                                </button>
                              )}
                              {Date.now() >=
                                new Date(s.scheduledStartAt).getTime() +
                                  NO_SHOW_GRACE_MIN * 60 * 1000 && (
                                <button
                                  onClick={() => noShowMut.mutate(s.id)}
                                  disabled={noShowMut.isPending}
                                  className="flex items-center gap-1 border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors"
                                >
                                  <AlertOctagon className="w-3 h-3" /> Vắng mặt
                                </button>
                              )}
                            </>
                          )}
                          {/* PT's own right to propose a new time — same requestReschedule
                              endpoint the client side already used, just never reachable
                              from here. Hidden once there's already an open request on this
                              session (server rejects a second one anyway with a 409 — no
                              point letting the PT hit it) and inside the ≥12h cutoff
                              requestReschedule itself enforces. */}
                          {!rescheduleBlockedReason(s, { viewer: "PT", acceptedMoves: acceptedMovesFor(s.id) }) && (
                              <button
                                onClick={() => setRescheduleTarget(s)}
                                className="flex items-center gap-1 border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors"
                              >
                                <Calendar className="w-3 h-3" /> Đề xuất dời lịch
                              </button>
                            )}
                          <button
                            onClick={() => setCancelTarget({ id: s.id, status: s.status, name: clientLabel(s.clientUserId) })}
                            disabled={cancelSessionMut.isPending}
                            title="Huỷ buổi đã xác nhận (kể cả chặn ngày nghỉ) sẽ bồi thường cho học viên 1 buổi bằng tiền, trừ vào thu nhập của bạn. Nên đề xuất dời lịch nếu học viên đồng ý."
                            className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors"
                          >
                            <X className="w-3 h-3" /> Hủy buổi
                          </button>
                        </>
                      )}
                    </div>
                    {/* "Đề xuất dời lịch" is simply absent when the session cannot be moved - say why (an open proposal is explained by its own card below). */}
                    {s.status === "CONFIRMED" && (!s.rescheduleRequests || s.rescheduleRequests.length === 0) &&
                      rescheduleBlockedReason(s, { viewer: "PT", acceptedMoves: acceptedMovesFor(s.id) }) && (
                        <p className="mt-2 text-xs text-zinc-500" data-testid="reschedule-blocked-reason">
                          Chưa dời lịch được: {rescheduleBlockedReason(s, { viewer: "PT", acceptedMoves: acceptedMovesFor(s.id) })}
                        </p>
                      )}
                    {/* Money-flow plan 3.3: gate on the pending-request list, not a session
                        status — the session stays CONFIRMED while a proposal is pending. */}
                    {s.rescheduleRequests && s.rescheduleRequests.length > 0 && (
                      <div className="mt-2 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                        {s.rescheduleRequests[0].requestedBy === "PT" ? (
                          <div className="flex flex-col gap-2">
                            <div className="text-amber-400 font-medium">
                              Bạn đã gửi yêu cầu dời lịch sang {formatDateTimeVi(s.rescheduleRequests[0].proposedStartAt)}. Đang chờ khách xác nhận.
                            </div>
                            <div>
                              <button
                                type="button"
                                data-testid="withdraw-reschedule"
                                onClick={() => setWithdrawRequestId(s.rescheduleRequests![0].id)}
                                disabled={withdrawMut.isPending}
                                className="min-h-9 px-3 py-1.5 border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 text-xs font-bold rounded-lg transition-colors"
                              >
                                Rút lại đề nghị
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <div className="text-amber-400 font-medium">
                              Khách yêu cầu dời lịch sang {formatDateTimeVi(s.rescheduleRequests[0].proposedStartAt)}
                            </div>
                            {s.rescheduleRequests[0].reason && (
                              <div className="text-zinc-400 italic">
                                Lý do: "{s.rescheduleRequests[0].reason}"
                              </div>
                            )}
                            <div className="flex gap-2">
                              <button
                                onClick={() => respondRescheduleMut.mutate({ requestId: s.rescheduleRequests![0].id, action: "ACCEPT" })}
                                disabled={respondRescheduleMut.isPending}
                                className="px-3 py-1.5 bg-green-500 hover:bg-green-400 text-black text-xs font-bold rounded-lg transition-colors"
                              >
                                Đồng ý
                              </button>
                              <button
                                onClick={() => respondRescheduleMut.mutate({ requestId: s.rescheduleRequests![0].id, action: "REJECT" })}
                                disabled={respondRescheduleMut.isPending}
                                className="px-3 py-1.5 border border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs font-bold rounded-lg transition-colors"
                              >
                                Từ chối
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {/* All upcoming sidebar */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
              <h4 className="text-xs font-bold text-zinc-600 mb-3">
                Sắp diễn ra
              </h4>
              {sessions.length === 0 ? (
                <p className="text-xs text-zinc-600">Chưa có buổi tập sắp tới</p>
              ) : (
                <div className="space-y-2">
                  {sessions.slice(0, 6).map((s) => (
                    <div key={s.id} className="flex items-center gap-2">
                      <div className="w-7 h-7 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center text-[10px] font-bold text-green-400 flex-shrink-0">
                        {clientLabel(s.clientUserId).slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-zinc-300 truncate">
                          {clientLabel(s.clientUserId)}
                        </div>
                        <div className="text-xs text-zinc-600">
                          {new Date(s.scheduledStartAt).toLocaleDateString(
                            "vi-VN",
                            { day: "2-digit", month: "2-digit" },
                          )}{" "}
                          · {formatSessionTime(s.scheduledStartAt)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── AVAILABILITY TAB ─── */}
      {tab === "availability" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Weekly availability */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-zinc-200">
                Lịch làm việc hàng tuần
              </h3>
              {!isEditingAvail ? (
                <button
                  onClick={startEditing}
                  className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 font-semibold transition-colors"
                >
                  <Settings className="w-3 h-3" /> Chỉnh sửa
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsEditingAvail(false)}
                    className="text-xs text-zinc-500 hover:text-zinc-300 font-semibold"
                  >
                    Hủy
                  </button>
                  <button
                    onClick={saveAvailability}
                    disabled={saveAvailMut.isPending}
                    className="flex items-center gap-1 bg-green-500 hover:bg-green-400 text-black px-3 py-1 rounded-lg text-xs font-bold transition-all"
                  >
                    {saveAvailMut.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Check className="w-3 h-3" />
                    )}{" "}
                    Lưu
                  </button>
                </div>
              )}
            </div>

            {loadingAvail ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
              </div>
            ) : isEditingAvail ? (
              <div className="space-y-2">
                {WEEK_DAYS.map((day) => {
                  const active = !!editSlots[day];
                  return (
                    <div
                      key={day}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${active ? "border-green-500/20 bg-green-500/5" : "border-zinc-800/60 bg-zinc-800/20"}`}
                    >
                      <button
                        onClick={() => toggleDay(day)}
                        className={`w-5 h-5 rounded flex items-center justify-center border transition-all ${active ? "bg-green-500 border-green-500" : "border-zinc-700"}`}
                      >
                        {active && <Check className="w-3 h-3 text-black" />}
                      </button>
                      <span
                        className={`text-xs font-bold w-10 ${active ? "text-zinc-200" : "text-zinc-600"}`}
                      >
                        {DAY_LABELS[day]}
                      </span>
                      {active && (
                        <div className="flex items-center gap-2 ml-auto">
                          <input
                            type="time"
                            value={editSlots[day].start}
                            onChange={(e) =>
                              updateSlotTime(day, "start", e.target.value)
                            }
                            className="bg-zinc-800 border border-zinc-700/60 rounded px-2 py-1 text-xs text-zinc-300 outline-none"
                          />
                          <span className="text-xs text-zinc-600">–</span>
                          <input
                            type="time"
                            value={editSlots[day].end}
                            onChange={(e) =>
                              updateSlotTime(day, "end", e.target.value)
                            }
                            className="bg-zinc-800 border border-zinc-700/60 rounded px-2 py-1 text-xs text-zinc-300 outline-none"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2">
                {(availability as PTAvailabilitySlot[]).length === 0 ? (
                  <div className="text-center py-6">
                    <Clock className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
                    <p className="text-sm text-zinc-500">Chưa thiết lập lịch làm việc</p>
                    <p className="text-xs text-zinc-600 mt-1">
                      Bấm Chỉnh sửa để đặt giờ làm việc hàng tuần
                    </p>
                  </div>
                ) : (
                  (availability as PTAvailabilitySlot[]).map((s) => (
                    <div
                      key={s.id || s.dayOfWeek}
                      className="flex items-center gap-3 p-3 rounded-lg border border-zinc-800/60 bg-zinc-800/20"
                    >
                      <div className="w-2 h-2 bg-green-500 rounded-full" />
                      <span className="text-xs font-bold text-zinc-300 w-10">
                        {DAY_LABELS[s.dayOfWeek as DayOfWeek]}
                      </span>
                      <span className="text-xs text-zinc-500 ml-auto">
                        {s.startTime} – {s.endTime}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Blocked dates */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-5 space-y-4">
            <h3 className="text-sm font-bold text-zinc-200">Ngày nghỉ</h3>
            <p className="text-xs text-zinc-500">
              Chặn những ngày bạn không nhận lịch (nghỉ phép, lễ, v.v.)
            </p>
            <p className="text-xs text-amber-400">
              Huỷ buổi đã xác nhận (kể cả chặn ngày nghỉ) sẽ bồi thường cho học viên 1 buổi bằng tiền, trừ vào thu nhập của bạn. Nên đề xuất dời lịch nếu học viên đồng ý.
            </p>

            <div className="flex gap-2">
              <input
                type="date"
                value={blockDate}
                onChange={(e) => setBlockDate(e.target.value)}
                className="flex-1 bg-zinc-800 border border-zinc-700/60 rounded-lg px-3 py-2 text-sm text-zinc-300 outline-none"
              />
              <input
                type="text"
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                placeholder="Lý do (không bắt buộc)"
                className="flex-1 bg-zinc-800 border border-zinc-700/60 rounded-lg px-3 py-2 text-sm text-zinc-300 placeholder-zinc-600 outline-none"
              />
              <button
                onClick={() => {
                  if (!blockDate) return;
                  const reason = blockReason || undefined;
                  // A day holding CONFIRMED sessions costs one cash compensation each: ask first. An empty day goes straight through.
                  const count = confirmedSessionsOnDate(upcomingSessions as any[], blockDate);
                  if (count > 0) setBlockConfirm({ date: blockDate, reason, count });
                  else addExceptionMut.mutate({ date: blockDate, reason });
                }}
                disabled={!blockDate || addExceptionMut.isPending}
                className="flex items-center gap-1 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {addExceptionMut.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Plus className="w-3 h-3" />
                )}{" "}
                Chặn
              </button>
            </div>

            <div className="space-y-2">
              {(exceptions as PTScheduleException[]).length === 0 ? (
                <p className="text-xs text-zinc-600 text-center py-4">
                  Chưa có ngày nghỉ nào
                </p>
              ) : (
                (exceptions as PTScheduleException[]).map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-red-500/20 bg-red-500/5"
                  >
                    <Ban className="w-3.5 h-3.5 text-red-400" />
                    <div className="flex-1">
                      <div className="text-xs font-bold text-zinc-300">
                        {new Date(e.date).toLocaleDateString("vi-VN", {
                          weekday: "short",
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        })}
                      </div>
                      {e.reason && (
                        <div className="text-xs text-zinc-500">{e.reason}</div>
                      )}
                    </div>
                    <button
                      onClick={() => removeExceptionMut.mutate(e.id)}
                      className="p-1 text-zinc-600 hover:text-red-400 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!withdrawRequestId}
        onOpenChange={(o) => !o && setWithdrawRequestId(null)}
        title="Rút lại đề nghị dời lịch?"
        description="Buổi tập giữ nguyên giờ cũ. Bạn có thể gửi một đề nghị mới sau."
        confirmLabel="Rút lại"
        cancelLabel="Không"
        onConfirm={() => {
          if (withdrawRequestId) withdrawMut.mutate(withdrawRequestId);
          setWithdrawRequestId(null);
        }}
      />

      {/* ─── PT ĐỀ XUẤT DỜI LỊCH ─── */}
      <Modal
        open={!!(rescheduleTarget)}
        onClose={() => {
          setRescheduleTarget(null);
          setRescheduleError(null);
        }}
        closeOnBackdrop={false}
        placement="sheet"
        data-testid="pt-reschedule-modal"
      >
        {rescheduleTarget && (
          <div className="bg-zinc-900/60 backdrop-blur-xl border border-white/10 rounded-2xl w-full max-w-2xl shadow-[0_8px_32px_rgba(0,0,0,0.37)] overflow-hidden flex flex-col max-h-[90vh] transition-all">
            <div className="p-5 border-b border-white/10 shrink-0 bg-white/5">
              <ModalTitle className="text-zinc-100 font-bold tracking-tight">Đề xuất dời lịch</ModalTitle>
              <p className="text-xs text-zinc-500 mt-0.5">
                Buổi hiện tại: {formatDateTimeVi(rescheduleTarget.scheduledStartAt)}
              </p>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto">
              <DateSlotPicker
                ptUserId={rescheduleTarget.ptUserId}
                value={rescheduleSlot}
                onChange={(v) => {
                  setRescheduleSlot(v);
                  setRescheduleError(null);
                }}
              />
              <div>
                <label className="text-xs font-semibold text-zinc-400 mb-1.5 block">Lý do dời lịch</label>
                <textarea
                  value={rescheduleReason}
                  onChange={(e) => setRescheduleReason(e.target.value)}
                  rows={2}
                  placeholder="Ví dụ: bận đột xuất, xin dời sang khung giờ khác..."
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50 resize-none"
                />
              </div>
            </div>
            {rescheduleError && (
              <div
                role="alert"
                data-testid="reschedule-error"
                className="mx-5 mb-3 shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300"
              >
                {rescheduleError}
              </div>
            )}
            {rescheduleSubmitHint({ dateStr: rescheduleSlot?.dateStr, slot: rescheduleSlot?.slot, reason: rescheduleReason }) && (
              <p className="px-5 pb-2 shrink-0 text-center text-xs text-zinc-500" data-testid="reschedule-submit-hint">
                {rescheduleSubmitHint({ dateStr: rescheduleSlot?.dateStr, slot: rescheduleSlot?.slot, reason: rescheduleReason })}
              </p>
            )}
            <div className="p-5 border-t border-white/10 flex gap-3 shrink-0 bg-white/5 backdrop-blur-md">
              <button
                type="button"
                onClick={() => {
                  setRescheduleTarget(null);
                  setRescheduleSlot(null);
                  setRescheduleReason("");
                  setRescheduleError(null);
                }}
                className="min-h-10 flex-1 py-2.5 border border-white/10 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-white/10 transition-colors"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!rescheduleTarget || !rescheduleSlot?.dateStr || !rescheduleSlot?.slot || !rescheduleReason.trim()) return;
                  const start = new Date(`${rescheduleSlot.dateStr}T${rescheduleSlot.slot}:00`);
                  const end = new Date(start.getTime() + 60 * 60 * 1000); // server always recomputes the real end from the contract's own duration
                  requestRescheduleMut.mutate({
                    id: rescheduleTarget.id,
                    proposedStartAt: start.toISOString(),
                    proposedEndAt: end.toISOString(),
                    reason: rescheduleReason,
                  });
                }}
                disabled={!rescheduleSlot?.dateStr || !rescheduleSlot?.slot || !rescheduleReason.trim() || requestRescheduleMut.isPending}
                className="min-h-10 flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {requestRescheduleMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Gửi yêu cầu
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(o) => !o && setCancelTarget(null)}
        title="Huỷ buổi tập?"
        description={cancelTarget ? ptCancelNotice(cancelTarget.status, cancelTarget.name) : undefined}
        confirmLabel="Huỷ buổi"
        cancelLabel="Không"
        onConfirm={() => {
          if (cancelTarget) cancelSessionMut.mutate({ id: cancelTarget.id, status: cancelTarget.status });
          setCancelTarget(null);
        }}
      />
      <ConfirmDialog
        open={!!blockConfirm}
        onOpenChange={(o) => !o && setBlockConfirm(null)}
        title="Chặn ngày nghỉ?"
        description={blockConfirm ? ptBlockDayNotice(blockConfirm.count) : undefined}
        confirmLabel="Chặn ngày"
        cancelLabel="Không"
        onConfirm={() => {
          if (blockConfirm) addExceptionMut.mutate({ date: blockConfirm.date, reason: blockConfirm.reason });
          setBlockConfirm(null);
        }}
      />
    </div>
  );
}
