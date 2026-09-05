import { useState, useEffect } from "react";
import {
  Calendar,
  Clock,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  AlertCircle,
  XCircle,
  Loader2,
  Star,
  MapPin,
  MessageSquare,
  FileText,
  RefreshCw,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  contractService,
  sessionService,
  availabilityService,
} from "../../services/api";
import { toast } from "sonner";
import { useApp } from "../../context/AppContext";
import { useCall } from "../../context/CallContext";
import { getJoinSessionState } from "../../utils/sessionUtils";
import type { Contract, Session, SessionStatus } from "../../types";
import { useBackDismissible } from "../../hooks/useBackDismissible";

const DAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
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
const FALLBACK_SLOTS = [
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
  "19:00",
  "20:00",
];

function formatTime(t: string) {
  return t;
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("vi-VN", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }) +
    " lúc " +
    d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
  );
}

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString("vi-VN", {
    month: "short",
    day: "numeric",
  });
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDay(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

const SESSION_STATUS_CONFIG: Record<
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
    label: "Chờ bạn xác nhận",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
  },
  DISPUTED: {
    label: "Đang khiếu nại",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
  },
  COMPLETED: {
    label: "Hoàn thành",
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
  },
  CANCELLED: {
    label: "Đã huỷ",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
  },
  NO_SHOW: {
    label: "Khách vắng mặt",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
  },
};

type Tab = "book" | "upcoming" | "confirm" | "past";

export function BookingPage() {
  const queryClient = useQueryClient();
  const { user } = useApp();
  const { startSessionPreview } = useCall();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(
    null,
  );
  const [sessionMode, setSessionMode] = useState<"OFFLINE" | "ONLINE">(
    "OFFLINE",
  );
  const [bookingNotes, setBookingNotes] = useState("");
  const [tab, setTab] = useState<Tab>("book");
  const [cancelId, setCancelId] = useState<string | null>(null);
  useBackDismissible(!!cancelId, () => setCancelId(null));
  const [cancelReason, setCancelReason] = useState("");
  const [reviewId, setReviewId] = useState<string | null>(null);
  useBackDismissible(!!reviewId, () => setReviewId(null));
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [disputeId, setDisputeId] = useState<string | null>(null);
  useBackDismissible(!!disputeId, () => setDisputeId(null));
  const [disputeReason, setDisputeReason] = useState("");
  const [noShowReportId, setNoShowReportId] = useState<string | null>(null);
  useBackDismissible(!!noShowReportId, () => setNoShowReportId(null));
  const [noShowReportReason, setNoShowReportReason] = useState("");
  const [joiningSessionId, setJoiningSessionId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const handleResendESign = async (contractId: string) => {
    if (resendingId) return;
    setResendingId(contractId);
    try {
      await contractService.resendESign(contractId);
      toast.success("Đã gửi lại email ký. Vui lòng kiểm tra hộp thư.");
      queryClient.invalidateQueries({
        queryKey: ["client-contracts-pending-signature"],
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Không thể gửi lại email ký");
    } finally {
      setResendingId(null);
    }
  };

  const handleJoinSession = async (s: Session) => {
    if (joiningSessionId) return;
    setJoiningSessionId(s.id);
    try {
      const result = await sessionService.joinSession(s.id);
      await startSessionPreview({
        id: result.sessionId,
        otherUserId: result.otherUserId,
        joinToken: result.joinToken,
        roomClosesAt: result.roomClosesAt,
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Không thể tham gia buổi học");
    } finally {
      setJoiningSessionId(null);
    }
  };

  // Fetch active contracts
  const { data: contracts = [] } = useQuery({
    queryKey: ["client-contracts", "ACTIVE"],
    queryFn: () => contractService.getByClient("ACTIVE"),
  });

  const activeContracts = (contracts as Contract[]).filter(
    (c) => c.status === "ACTIVE",
  );

  // Fetch contracts awaiting e-signature
  const { data: pendingSigContracts = [] } = useQuery({
    queryKey: ["client-contracts-pending-signature"],
    queryFn: () => contractService.getByClient("PENDING_SIGNATURE"),
  });
  const selectedContract = activeContracts.find(
    (c) => c.id === selectedContractId,
  );

  // Auto-select first active contract
  if (activeContracts.length > 0 && !selectedContractId) {
    setSelectedContractId(activeContracts[0].id);
  }

  // Lock session mode to match contract when contract has a specific mode
  useEffect(() => {
    if (!selectedContract) return;
    const cm = selectedContract.sessionMode;
    if (cm === "ONLINE") setSessionMode("ONLINE");
    else if (cm === "OFFLINE") setSessionMode("OFFLINE");
  }, [selectedContract?.id]);

  // Fetch upcoming sessions
  const { data: upcomingSessions = [], isLoading: loadingUpcoming } = useQuery({
    queryKey: ["sessions-upcoming"],
    queryFn: () => sessionService.getMyUpcoming(),
  });

  // Money-flow plan 4.1: sessions the PT reported as done and the client still has to
  // confirm or dispute. Distinct from "upcoming" — these are already in the past.
  const { data: pendingConfirmSessions = [], isLoading: loadingPendingConfirm } = useQuery({
    queryKey: ["sessions-pending-confirmation"],
    queryFn: () => sessionService.listPendingConfirmation(),
  });

  // Fetch sessions for selected contract (for past tab)
  const { data: contractSessions = [], isLoading: loadingPast } = useQuery({
    queryKey: ["contract-sessions", selectedContractId],
    queryFn: () =>
      selectedContractId
        ? sessionService.getContractSessions(selectedContractId)
        : Promise.resolve([]),
    enabled: !!selectedContractId,
  });

  // Days that already hold a session, so the calendar can mark them instead of looking
  // identical to a free day — you could otherwise only discover an existing booking by
  // clicking each date or switching tabs. Keyed by local Y-M-D because the timestamps are
  // UTC and the calendar is drawn in the viewer's own timezone.
  const bookedDays = new Set<string>(
    ([...(upcomingSessions as Session[]), ...(contractSessions as Session[])] || [])
      .filter((s) => s.status !== "CANCELLED")
      .map((s) => {
        const d = new Date(s.scheduledStartAt);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      }),
  );

  // Money-flow plan 4.3: a CONFIRMED session whose time has already passed and that the PT
  // never touched (never reported complete, never no-showed) used to be invisible everywhere
  // — dropped out of "upcoming" once its time passed, never counted as "past" either. Shown
  // here so the client has a place to report it.
  const pastSessions = (contractSessions as Session[]).filter(
    (s) =>
      s.status === "COMPLETED" ||
      s.status === "CANCELLED" ||
      s.status === "NO_SHOW" ||
      s.status === "PT_NO_SHOW_REPORTED" ||
      s.status === "DISPUTED" ||
      (s.status === "CONFIRMED" && new Date(s.scheduledStartAt).getTime() < Date.now()),
  );

  // Remaining sessions count — must also subtract compensatedSessions (PT no-shows already
  // paid out in cash): those consume entitlement exactly like a used session, but totalSessions
  // itself no longer shrinks to reflect them (money-flow plan 1.5).
  const remainingSessions = selectedContract
    ? Math.max(
        0,
        selectedContract.totalSessions -
          selectedContract.usedSessions -
          (selectedContract.compensatedSessions ?? 0),
      )
    : 0;

  // Fetch available slots for selected date + PT
  const selectedDateStr = selectedDate
    ? `${year}-${String(month + 1).padStart(2, "0")}-${String(selectedDate).padStart(2, "0")}`
    : null;

  const { data: availableSlots, isLoading: loadingSlots } = useQuery({
    queryKey: ["available-slots", selectedContract?.ptUserId, selectedDateStr],
    queryFn: () =>
      availabilityService.getAvailableSlots(
        selectedContract!.ptUserId,
        selectedDateStr!,
      ),
    enabled: !!selectedContract?.ptUserId && !!selectedDateStr,
  });

  // Use available slots from API, fall back to default time slots if PT hasn't set availability
  const timeSlots: string[] =
    availableSlots && (availableSlots as string[]).length > 0
      ? (availableSlots as string[])
      : !loadingSlots &&
          availableSlots !== undefined &&
          (availableSlots as string[]).length === 0
        ? []
        : FALLBACK_SLOTS;

  // Book mutation
  const bookMutation = useMutation({
    mutationFn: () => {
      if (!selectedContractId || !selectedDate || !selectedSlot)
        throw new Error("Missing data");
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(selectedDate).padStart(2, "0")}`;
      return sessionService.bookSession(selectedContractId, {
        scheduledDate: dateStr,
        scheduledTime: selectedSlot,
        durationMin: 60,
        sessionMode,
        notes: bookingNotes || undefined,
      });
    },
    onSuccess: () => {
      toast.success("Đặt lịch thành công! Huấn luyện viên sẽ được thông báo.");
      queryClient.invalidateQueries({ queryKey: ["sessions-upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["contract-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["client-contracts"] });
      setSelectedDate(null);
      setSelectedSlot(null);
      setBookingNotes("");
      setTab("upcoming");
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error || "Không thể đặt lịch"),
  });

  // Cancel mutation
  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      sessionService.cancelSession(id, reason),
    onSuccess: () => {
      toast.success("Đã hủy lịch tập");
      setCancelId(null);
      setCancelReason("");
      queryClient.invalidateQueries({ queryKey: ["sessions-upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["contract-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["client-contracts"] });
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error || "Không thể hủy lịch"),
  });

  // Money-flow plan 4.1 — client confirms the PT's report of a session, releasing the PT's
  // money for it (backend already handled this correctly; only the UI to reach it was missing).
  const confirmSessionMutation = useMutation({
    mutationFn: (id: string) => sessionService.clientConfirmSession(id),
    onSuccess: () => {
      toast.success("Đã xác nhận buổi tập");
      queryClient.invalidateQueries({ queryKey: ["sessions-pending-confirmation"] });
      queryClient.invalidateQueries({ queryKey: ["contract-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["client-contracts"] });
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error || "Không thể xác nhận buổi tập"),
  });

  const disputeSessionMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      sessionService.disputeSession(id, reason),
    onSuccess: () => {
      toast.success("Đã gửi khiếu nại — quản trị viên sẽ xem xét");
      setDisputeId(null);
      setDisputeReason("");
      queryClient.invalidateQueries({ queryKey: ["sessions-pending-confirmation"] });
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error || "Không thể gửi khiếu nại"),
  });

  // Money-flow plan 4.3 — client reports the PT never showed up for a past CONFIRMED session.
  const reportNoShowMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      sessionService.reportPtNoShow(id, reason),
    onSuccess: () => {
      toast.success("Đã gửi báo cáo — PT sẽ được yêu cầu phản hồi");
      setNoShowReportId(null);
      setNoShowReportReason("");
      queryClient.invalidateQueries({ queryKey: ["contract-sessions"] });
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error || "Không thể gửi báo cáo"),
  });

  // Review mutation
  const reviewMutation = useMutation({
    mutationFn: () => {
      if (!reviewId || !reviewRating) throw new Error("Missing data");
      return sessionService.reviewSession(
        reviewId,
        reviewRating,
        reviewComment,
      );
    },
    onSuccess: () => {
      toast.success("Cảm ơn bạn đã đánh giá!");
      setReviewId(null);
      setReviewComment("");
      setReviewRating(5);
      queryClient.invalidateQueries({ queryKey: ["contract-sessions"] });
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error || "Không thể gửi đánh giá"),
  });

  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  useBackDismissible(!!rescheduleId, () => setRescheduleId(null));
  const [rescheduleDate, setRescheduleDate] = useState<string>("");
  const [rescheduleTime, setRescheduleTime] = useState<string>("");
  const [rescheduleReason, setRescheduleReason] = useState<string>("");

  const rescheduleMutation = useMutation({
    mutationFn: ({
      id,
      proposedStartAt,
      proposedEndAt,
      reason,
    }: {
      id: string;
      proposedStartAt: string;
      proposedEndAt: string;
      reason: string;
    }) =>
      sessionService.requestReschedule(
        id,
        proposedStartAt,
        proposedEndAt,
        reason
      ),
    onSuccess: () => {
      toast.success("Đã gửi yêu cầu dời lịch!");
      setRescheduleId(null);
      setRescheduleReason("");
      queryClient.invalidateQueries({ queryKey: ["sessions-upcoming"] });
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error || "Không thể yêu cầu dời lịch"),
  });

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
  const isToday = (day: number) =>
    year === today.getFullYear() &&
    month === today.getMonth() &&
    day === today.getDate();

  const tabLabels: Record<Tab, string> = {
    book: "Đặt lịch",
    upcoming: "Sắp tới",
    confirm: "Chờ xác nhận",
    past: "Đã qua",
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
            <Calendar className="w-5 h-5 text-green-400" /> Lịch tập luyện
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">
            Đặt và quản lý các buổi tập của bạn
          </p>
        </div>
        {selectedContract && (
          <span className="px-3 py-1 bg-zinc-800 text-zinc-400 text-xs font-bold rounded-full flex items-center gap-1.5 border border-zinc-700/50">
            <Clock className="w-3 h-3" />
            còn {remainingSessions} buổi
          </span>
        )}
      </div>

      {/* ─── E-SIGN SECTION ─── */}
      {(pendingSigContracts as any[]).map((contract) => (
        <div
          key={contract.id}
          className="bg-zinc-900 rounded-2xl border border-amber-500/20 p-4 space-y-3"
        >
          {contract.eSignTestMode && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 px-3 py-2 rounded-lg text-xs font-medium">
              ⚠ Chữ ký điện tử đang ở chế độ thử nghiệm (test mode) — không có
              giá trị pháp lý production
            </div>
          )}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-zinc-100 font-bold text-sm">
                Chờ ký hợp đồng
              </h3>
              <p className="text-zinc-500 text-xs mt-0.5">
                {contract.packageName}
              </p>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 font-semibold">
              Chờ ký
            </span>
          </div>
          <p className="text-sm text-zinc-400">
            {contract.eSignStatus === "SENT" &&
              "Đang chờ cả hai bên ký. Kiểm tra email của bạn."}
            {contract.eSignStatus === "PARTIALLY_SIGNED" &&
              (contract.clientSignedAt && !contract.ptSignedAt
                ? "Bạn đã ký. Đang chờ huấn luyện viên ký."
                : !contract.clientSignedAt && contract.ptSignedAt
                  ? "Huấn luyện viên đã ký. Đang chờ bạn ký."
                  : "Đang xử lý...")}
            {contract.eSignStatus === "DECLINED" && (
              <span className="text-red-400">Một bên đã từ chối ký.</span>
            )}
            {contract.eSignStatus === "EXPIRED" && (
              <span className="text-zinc-400">Yêu cầu ký đã hết hạn.</span>
            )}
            {contract.eSignStatus === "ERROR" && (
              <span className="text-red-400">
                Có lỗi xảy ra khi gửi yêu cầu ký. Vui lòng thử lại.
              </span>
            )}
            {!contract.eSignStatus && "Đang chuẩn bị yêu cầu ký..."}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {contract.contractPdfPath && (
              <a
                href={contractService.getPdfUrl(contract.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs font-semibold text-blue-400 hover:text-blue-300 border border-blue-500/20 bg-blue-500/10 px-3 py-1.5 rounded-lg transition-colors"
              >
                <FileText className="w-3.5 h-3.5" /> Tải PDF hợp đồng
              </a>
            )}
            {["ERROR", "EXPIRED"].includes(contract.eSignStatus || "") && (
              <button
                onClick={() => handleResendESign(contract.id)}
                disabled={resendingId === contract.id}
                className="flex items-center gap-1.5 text-xs font-semibold text-green-400 hover:text-green-300 border border-green-500/20 bg-green-500/10 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {resendingId === contract.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                Gửi lại email ký
              </button>
            )}
          </div>
        </div>
      ))}

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-800/60 border border-zinc-700/40 p-1 rounded-xl w-full sm:w-auto sm:inline-flex">
        {(["book", "upcoming", "confirm", "past"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${tab === t ? "bg-green-500 text-black shadow-sm" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            {tabLabels[t]}
            {t === "confirm" && (pendingConfirmSessions as Session[]).length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {(pendingConfirmSessions as Session[]).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ─── BOOK TAB ─── */}
      {tab === "book" && (
        <>
          {activeContracts.length === 0 ? (
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-20 text-center">
              <FileText className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
              <h3 className="text-zinc-200 font-bold mb-1">
                Không có hợp đồng đang hoạt động
              </h3>
              <p className="text-sm text-zinc-500 max-w-xs mx-auto">
                Bạn cần có hợp đồng đang hoạt động với huấn luyện viên để đặt
                lịch. Tìm PT để bắt đầu!
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Contract selector */}
              {activeContracts.length > 1 && (
                <div className="flex gap-2 overflow-x-auto">
                  {activeContracts.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setSelectedContractId(c.id);
                        setSelectedDate(null);
                        setSelectedSlot(null);
                      }}
                      className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${
                        selectedContractId === c.id
                          ? "bg-green-500 text-black border-green-500"
                          : "bg-zinc-900 border-zinc-700/60 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {c.packageName} (còn{" "}
                      {Math.max(0, c.totalSessions - c.usedSessions - (c.compensatedSessions ?? 0))})
                    </button>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Calendar */}
                <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 shadow-xl">
                  <div className="flex items-center justify-between mb-4">
                    <button
                      onClick={prevMonth}
                      className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <h3 className="text-sm font-bold text-zinc-200">
                      {MONTHS[month]} {year}
                    </h3>
                    <button
                      onClick={nextMonth}
                      className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-7 gap-1 mb-2 border-b border-zinc-800/60 pb-2">
                    {DAYS.map((d) => (
                      <div
                        key={d}
                        className="text-center text-[10px] text-zinc-600 uppercase tracking-tighter font-bold"
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
                      const dateObj = new Date(year, month, day);
                      const isPast =
                        dateObj <
                        new Date(
                          today.getFullYear(),
                          today.getMonth(),
                          today.getDate(),
                        );
                      const isPastEndDate =
                        selectedContract?.endDate &&
                        dateObj > new Date(selectedContract.endDate);
                      const disabled = isPast || !!isPastEndDate;
                      const hasSession = bookedDays.has(
                        `${year}-${month}-${day}`,
                      );
                      return (
                        <button
                          key={day}
                          disabled={disabled}
                          onClick={() => {
                            setSelectedDate(day);
                            setSelectedSlot(null);
                          }}
                          title={hasSession ? "Đã có buổi tập trong ngày này" : undefined}
                          className={`relative aspect-square flex flex-col items-center justify-center rounded-xl text-xs transition-all font-medium ${
                            selectedDate === day
                              ? "bg-green-500 text-black shadow-lg shadow-green-500/25"
                              : hasSession
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40"
                                : isToday(day)
                                  ? "bg-green-500/15 text-green-400 border border-green-500/30"
                                  : disabled
                                    ? "text-zinc-700 cursor-not-allowed"
                                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                          }`}
                        >
                          {day}
                          {/* Dot survives the selected state, where the fill colour is taken. */}
                          {hasSession && (
                            <span
                              className={`absolute bottom-1 w-1.5 h-1.5 rounded-full ${
                                selectedDate === day ? "bg-black/70" : "bg-emerald-400"
                              }`}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {bookedDays.size > 0 && (
                    <div className="flex items-center gap-1.5 mt-3 text-[11px] text-zinc-500">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      Ngày đã có buổi tập
                    </div>
                  )}
                </div>

                {/* Time slots + booking form */}
                <div className="space-y-3">
                  {selectedDate ? (
                    <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 shadow-xl">
                      <h4 className="text-sm font-bold text-zinc-200 mb-1">
                        Khung giờ trống – {MONTHS[month]} {selectedDate}
                      </h4>
                      <p className="text-xs text-zinc-500 mb-3">
                        Chọn giờ cho buổi tập của bạn
                      </p>
                      {loadingSlots ? (
                        <div className="flex justify-center py-6">
                          <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
                        </div>
                      ) : timeSlots.length === 0 ? (
                        <div className="text-center py-6">
                          <Clock className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
                          <p className="text-sm text-zinc-500">
                            Không có khung giờ trống ngày này
                          </p>
                          <p className="text-xs text-zinc-600 mt-1">
                            Huấn luyện viên có thể không khả dụng hoặc đã được
                            đặt hết
                          </p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                          {timeSlots.map((slot) => (
                            <button
                              key={slot}
                              onClick={() => setSelectedSlot(slot)}
                              className={`flex items-center justify-center gap-1.5 px-2 py-2.5 border-2 rounded-xl text-sm transition-all font-medium ${
                                selectedSlot === slot
                                  ? "border-green-500 bg-green-500/10 text-green-400 shadow-lg shadow-green-500/15"
                                  : "border-zinc-700/60 hover:border-green-500/50 text-zinc-400 hover:text-zinc-200"
                              }`}
                            >
                              <Clock className="w-3 h-3" />
                              {formatTime(slot)}
                            </button>
                          ))}
                        </div>
                      )}

                      {selectedSlot && (
                        <div className="mt-4 space-y-3">
                          {/* Session mode */}
                          <div>
                            <label className="text-xs font-semibold text-zinc-400 mb-1.5 block">
                              Hình thức
                              {selectedContract?.sessionMode &&
                                selectedContract.sessionMode !== "HYBRID" && (
                                  <span className="ml-1.5 text-zinc-600 font-normal">
                                    (theo gói)
                                  </span>
                                )}
                            </label>
                            <div className="flex gap-2">
                              {(["OFFLINE", "ONLINE"] as const).map((mode) => {
                                const contractMode =
                                  selectedContract?.sessionMode;
                                const isLocked =
                                  contractMode === "ONLINE" ||
                                  contractMode === "OFFLINE";
                                const isDisabled =
                                  isLocked && contractMode !== mode;
                                return (
                                  <button
                                    key={mode}
                                    onClick={() =>
                                      !isDisabled && setSessionMode(mode)
                                    }
                                    disabled={isDisabled}
                                    className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all border ${
                                      sessionMode === mode
                                        ? "bg-green-500/10 border-green-500/30 text-green-400"
                                        : isDisabled
                                          ? "border-zinc-800 text-zinc-700 cursor-not-allowed"
                                          : "border-zinc-700/60 text-zinc-500 hover:text-zinc-300"
                                    }`}
                                  >
                                    {mode === "OFFLINE"
                                      ? "Trực tiếp"
                                      : "Trực tuyến"}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Notes */}
                          <div>
                            <label className="text-xs font-semibold text-zinc-400 mb-1.5 block">
                              Ghi chú (không bắt buộc)
                            </label>
                            <textarea
                              value={bookingNotes}
                              onChange={(e) => setBookingNotes(e.target.value)}
                              rows={2}
                              placeholder="Ghi chú cho huấn luyện viên..."
                              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50 resize-none"
                            />
                          </div>

                          {/* Confirm */}
                          <div className="p-3 bg-green-500/8 border border-green-500/20 rounded-xl">
                            <div className="flex items-center gap-2 mb-2 text-green-400">
                              <CheckCircle className="w-4 h-4" />
                              <span className="text-sm font-bold">
                                Sẵn sàng đặt lịch
                              </span>
                            </div>
                            <p className="text-xs text-zinc-400 mb-3">
                              {MONTHS[month]} {selectedDate}, {year} lúc{" "}
                              {formatTime(selectedSlot)} ·{" "}
                              {sessionMode === "ONLINE"
                                ? "Trực tuyến"
                                : "Trực tiếp"}
                            </p>
                            <button
                              onClick={() => bookMutation.mutate()}
                              disabled={bookMutation.isPending}
                              className="w-full py-2.5 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20 flex items-center justify-center gap-2"
                            >
                              {bookMutation.isPending && (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              )}
                              Xác nhận đặt lịch
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-10 text-center flex flex-col items-center justify-center h-full">
                      <Calendar className="w-10 h-10 text-zinc-800 mb-3" />
                      <p className="text-sm text-zinc-500">
                        Chọn ngày để xem khung giờ trống
                      </p>
                    </div>
                  )}

                  {/* Booking rules */}
                  <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-zinc-600 flex-shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider">
                          Quy tắc đặt lịch
                        </p>
                        <p className="text-xs text-zinc-500 leading-relaxed">
                          • Lịch tập phải được đặt trước ít nhất 24 giờ.
                          <br />
                          • Hủy lịch trong vòng 24 giờ sẽ tính là 1 buổi đã
                          dùng.
                          <br />• Vắng mặt cũng sẽ tính là 1 buổi đã dùng.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── UPCOMING TAB ─── */}
      {tab === "upcoming" && (
        <div>
          {loadingUpcoming ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
            </div>
          ) : (upcomingSessions as Session[]).length === 0 ? (
            <div className="max-w-md mx-auto py-10 text-center">
              <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4 border border-zinc-700/60">
                <Clock className="w-8 h-8 text-zinc-600" />
              </div>
              <h3 className="text-zinc-200 font-bold mb-1">
                Không có buổi tập sắp tới
              </h3>
              <p className="text-sm text-zinc-500 mb-6">
                Bạn chưa có buổi tập nào được lên lịch.
              </p>
              <button
                onClick={() => setTab("book")}
                className="px-6 py-2 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-xl transition-all"
              >
                Đặt lịch tập
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {(upcomingSessions as Session[]).map((s) => {
                const cfg = SESSION_STATUS_CONFIG[s.status];
                const startDate = new Date(s.scheduledStartAt);
                const hoursUntil =
                  (startDate.getTime() - Date.now()) / (1000 * 60 * 60);
                return (
                  <div
                    key={s.id}
                    className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}
                          >
                            {cfg.label}
                          </span>
                          <span className="text-xs text-zinc-600">
                            {s.sessionMode === "ONLINE"
                              ? "Trực tuyến"
                              : "Trực tiếp"}
                          </span>
                        </div>
                        <div className="text-sm font-bold text-zinc-200 flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                          {formatDateTime(s.scheduledStartAt)}
                        </div>
                        {s.location && (
                          <div className="text-xs text-zinc-500 flex items-center gap-1 mt-1">
                            <MapPin className="w-3 h-3" /> {s.location}
                          </div>
                        )}
                        {s.notes && (
                          <div className="text-xs text-zinc-500 flex items-center gap-1 mt-1">
                            <MessageSquare className="w-3 h-3" /> {s.notes}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        {(() => {
                          const joinState = getJoinSessionState(s, user?.id);
                          if (!joinState.visible) return null;
                          const isJoining = joiningSessionId === s.id;
                          return (
                            <div className="flex flex-col items-end gap-0.5">
                              <button
                                onClick={() =>
                                  joinState.enabled && handleJoinSession(s)
                                }
                                disabled={!joinState.enabled || isJoining}
                                title={joinState.reason}
                                className={`text-xs px-2.5 py-1 rounded-lg font-bold transition-all ${
                                  joinState.enabled && !isJoining
                                    ? "bg-green-500 hover:bg-green-400 text-black shadow-sm shadow-green-500/20 cursor-pointer"
                                    : "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                                }`}
                              >
                                {isJoining ? "Đang vào..." : joinState.label}
                              </button>
                              {joinState.reason && !joinState.enabled && (
                                <span className="text-[10px] text-zinc-600 text-right max-w-[130px] leading-tight">
                                  {joinState.reason}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                        <div className="flex gap-1.5">
                          {hoursUntil >= 12 && (
                            <button
                              onClick={() => setRescheduleId(s.id)}
                              className="flex items-center gap-1 border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                            >
                              <Calendar className="w-3.5 h-3.5" /> Dời lịch
                            </button>
                          )}
                          <button
                            onClick={() => setCancelId(s.id)}
                            className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                          >
                            <XCircle className="w-3.5 h-3.5" /> Hủy
                          </button>
                        </div>
                      </div>
                    </div>
                    {hoursUntil < 24 && hoursUntil > 0 && (
                      <div className="mt-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5">
                        Hủy lúc này sẽ tính là 1 buổi đã dùng (còn dưới 24 giờ)
                      </div>
                    )}
                    {/* Money-flow plan 3.3: gate on the actual pending-request list, not the
                        "RESCHEDULE_PENDING" session status — that status was never set by the
                        backend (the session deliberately stays CONFIRMED while a proposal is
                        pending), so this condition never matched anything. */}
                    {s.rescheduleRequests && s.rescheduleRequests.length > 0 && (
                      <div className="mt-2 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                        {s.rescheduleRequests[0].requestedBy === "CLIENT" ? (
                          <div className="text-amber-400 font-medium">Bạn đã gửi yêu cầu dời lịch sang {formatDateTime(s.rescheduleRequests[0].proposedStartAt)}. Đang chờ PT xác nhận.</div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <div className="text-amber-400 font-medium">PT yêu cầu dời lịch sang {formatDateTime(s.rescheduleRequests[0].proposedStartAt)}</div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => sessionService.respondToReschedule(s.rescheduleRequests![0].id, "ACCEPT").then(() => queryClient.invalidateQueries({ queryKey: ["sessions-upcoming"] }))}
                                className="px-3 py-1.5 bg-green-500 hover:bg-green-400 text-black text-xs font-bold rounded-lg transition-colors"
                              >
                                Đồng ý
                              </button>
                              <button
                                onClick={() => sessionService.respondToReschedule(s.rescheduleRequests![0].id, "REJECT").then(() => queryClient.invalidateQueries({ queryKey: ["sessions-upcoming"] }))}
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
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── CONFIRM TAB ─── (money-flow plan 4.1) */}
      {tab === "confirm" && (
        <div>
          {loadingPendingConfirm ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
            </div>
          ) : (pendingConfirmSessions as Session[]).length === 0 ? (
            <div className="max-w-md mx-auto py-10 text-center">
              <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4 border border-zinc-700/60">
                <CheckCircle className="w-8 h-8 text-zinc-600" />
              </div>
              <h3 className="text-zinc-200 font-bold mb-1">
                Không có buổi tập nào chờ xác nhận
              </h3>
              <p className="text-sm text-zinc-500">
                Khi PT báo cáo một buổi tập đã hoàn thành, buổi đó sẽ xuất hiện ở đây để bạn xác nhận hoặc khiếu nại.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {(pendingConfirmSessions as Session[]).map((s) => (
                <div
                  key={s.id}
                  className="bg-zinc-900 rounded-xl border border-amber-500/30 p-4"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="text-sm font-semibold text-zinc-200">
                        {formatDateTime(s.scheduledStartAt)}
                      </p>
                      {s.ptNotes && (
                        <p className="text-xs text-zinc-500 mt-1">
                          PT ghi chú: {s.ptNotes}
                        </p>
                      )}
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-amber-500/10 border-amber-500/20 text-amber-400 whitespace-nowrap">
                      Chờ bạn xác nhận
                    </span>
                  </div>
                  {s.clientConfirmDeadline && (
                    <div className="text-xs text-zinc-500 bg-zinc-800/40 border border-zinc-700/40 rounded-lg px-3 py-1.5 mb-3 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                      Nếu bạn không phản hồi trước{" "}
                      <span className="text-zinc-300 font-medium">
                        {formatDateTime(s.clientConfirmDeadline)}
                      </span>
                      , buổi tập sẽ tự động được xác nhận.
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => confirmSessionMutation.mutate(s.id)}
                      disabled={confirmSessionMutation.isPending}
                      className="flex items-center gap-1 bg-green-500 hover:bg-green-400 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                    >
                      <CheckCircle className="w-3.5 h-3.5" /> Xác nhận đã tập
                    </button>
                    <button
                      onClick={() => setDisputeId(s.id)}
                      className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    >
                      <AlertCircle className="w-3.5 h-3.5" /> Khiếu nại
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dispute reason modal */}
      {disputeId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-zinc-100 font-bold mb-2">Khiếu nại buổi tập</h3>
            <p className="text-xs text-zinc-500 mb-4">
              Cho biết vì sao bạn không đồng ý với báo cáo của PT. Quản trị viên sẽ xem xét và
              phân xử — buổi tập không bị trừ cho tới khi có kết luận.
            </p>
            <textarea
              value={disputeReason}
              onChange={(e) => setDisputeReason(e.target.value)}
              placeholder="Ví dụ: Tôi không tham gia buổi tập này..."
              className="w-full bg-zinc-800/60 border border-zinc-700/60 rounded-lg px-3 py-2 text-sm text-zinc-200 mb-4 min-h-[90px]"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setDisputeId(null);
                  setDisputeReason("");
                }}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
              >
                Huỷ
              </button>
              <button
                onClick={() =>
                  disputeId &&
                  disputeSessionMutation.mutate({ id: disputeId, reason: disputeReason })
                }
                disabled={!disputeReason.trim() || disputeSessionMutation.isPending}
                className="px-4 py-2 bg-red-500 hover:bg-red-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-all"
              >
                Gửi khiếu nại
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report PT no-show modal (money-flow plan 4.3) */}
      {noShowReportId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-zinc-100 font-bold mb-2">Báo huấn luyện viên vắng mặt</h3>
            <p className="text-xs text-zinc-500 mb-4">
              PT sẽ được yêu cầu phản hồi — nếu PT không đồng ý, quản trị viên sẽ phân xử. Buổi
              tập không bị trừ cho tới khi có kết luận.
            </p>
            <textarea
              value={noShowReportReason}
              onChange={(e) => setNoShowReportReason(e.target.value)}
              placeholder="Ví dụ: Tôi đã đợi 30 phút nhưng PT không đến..."
              className="w-full bg-zinc-800/60 border border-zinc-700/60 rounded-lg px-3 py-2 text-sm text-zinc-200 mb-4 min-h-[90px]"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setNoShowReportId(null);
                  setNoShowReportReason("");
                }}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
              >
                Huỷ
              </button>
              <button
                onClick={() =>
                  noShowReportId &&
                  reportNoShowMutation.mutate({ id: noShowReportId, reason: noShowReportReason })
                }
                disabled={!noShowReportReason.trim() || reportNoShowMutation.isPending}
                className="px-4 py-2 bg-red-500 hover:bg-red-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-all"
              >
                Gửi báo cáo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── PAST TAB ─── */}
      {tab === "past" && (
        <div>
          {/* Contract selector for past sessions */}
          {activeContracts.length > 1 && (
            <div className="flex gap-2 overflow-x-auto mb-4">
              {activeContracts.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedContractId(c.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all border ${
                    selectedContractId === c.id
                      ? "bg-green-500 text-black border-green-500"
                      : "bg-zinc-900 border-zinc-700/60 text-zinc-400"
                  }`}
                >
                  {c.packageName}
                </button>
              ))}
            </div>
          )}

          {loadingPast ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
            </div>
          ) : pastSessions.length === 0 ? (
            <div className="max-w-md mx-auto py-10 text-center">
              <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4 border border-zinc-700/60">
                <Calendar className="w-8 h-8 text-zinc-600" />
              </div>
              <h3 className="text-zinc-200 font-bold mb-1">
                Chưa có buổi tập nào
              </h3>
              <p className="text-sm text-zinc-500 mb-6">
                Lịch sử buổi tập sẽ xuất hiện ở đây sau khi bạn hoàn thành buổi
                tập đầu tiên.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {pastSessions.map((s) => {
                const cfg = SESSION_STATUS_CONFIG[s.status];
                return (
                  <div
                    key={s.id}
                    className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}
                          >
                            {cfg.label}
                          </span>
                          {s.sessionDeducted && (
                            <span className="text-xs text-zinc-600">
                              Đã trừ buổi
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-bold text-zinc-200">
                          {formatDateTime(s.scheduledStartAt)}
                        </div>
                        {s.ptNotes && (
                          <p className="text-xs text-zinc-500 mt-1">
                            PT: {s.ptNotes}
                          </p>
                        )}
                        {s.cancellationReason && (
                          <p className="text-xs text-red-400/80 mt-1">
                            Lý do: {s.cancellationReason}
                          </p>
                        )}
                        {(s.status === "PT_NO_SHOW_REPORTED" || s.status === "DISPUTED") && s.disputeReason && (
                          <p className="text-xs text-amber-400/80 mt-1">
                            Báo cáo của bạn: {s.disputeReason}
                          </p>
                        )}
                      </div>
                      <div>
                        {/* Open-room redesign: an ONLINE session's outcome is now decided
                            automatically by the room-close sweep the moment it reads who
                            actually joined — this manual report is only meaningful for
                            OFFLINE sessions, which have no room at all. */}
                        {s.status === "CONFIRMED" &&
                          s.sessionMode !== "ONLINE" &&
                          new Date(s.scheduledStartAt).getTime() < Date.now() && (
                            <button
                              onClick={() => setNoShowReportId(s.id)}
                              className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                            >
                              <AlertCircle className="w-3.5 h-3.5" /> Báo PT vắng mặt
                            </button>
                          )}
                        {s.status === "COMPLETED" && !s.review && (
                          <button
                            onClick={() => setReviewId(s.id)}
                            className="flex items-center gap-1 bg-green-500/10 border border-green-500/20 text-green-400 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-green-500/20 transition-colors"
                          >
                            <Star className="w-3.5 h-3.5" /> Đánh giá
                          </button>
                        )}
                        {s.review && (
                          <div className="flex items-center gap-0.5">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star
                                key={i}
                                className={`w-3 h-3 ${i < s.review!.rating ? "text-amber-400 fill-amber-400" : "text-zinc-700"}`}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── HỦY LỊCH ─── */}
      {cancelId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-zinc-800/60">
              <h3 className="text-zinc-100 font-bold">Hủy lịch tập</h3>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-zinc-400">
                Vui lòng cho biết lý do hủy lịch tập này.
              </p>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
                placeholder="Lý do hủy lịch..."
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-red-500/50 resize-none"
              />
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button
                onClick={() => {
                  setCancelId(null);
                  setCancelReason("");
                }}
                className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Giữ lịch
              </button>
              <button
                onClick={() =>
                  cancelMutation.mutate({ id: cancelId, reason: cancelReason })
                }
                disabled={!cancelReason.trim() || cancelMutation.isPending}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {cancelMutation.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                Hủy lịch tập
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── ĐÁNH GIÁ ─── */}
      {reviewId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-zinc-800/60">
              <h3 className="text-zinc-100 font-bold">Đánh giá buổi tập</h3>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-center gap-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <button key={i} onClick={() => setReviewRating(i + 1)}>
                    <Star
                      className={`w-8 h-8 transition-colors ${i < reviewRating ? "text-amber-400 fill-amber-400" : "text-zinc-700 hover:text-zinc-500"}`}
                    />
                  </button>
                ))}
              </div>
              <textarea
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                rows={3}
                placeholder="Buổi tập của bạn như thế nào? (không bắt buộc)"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50 resize-none"
              />
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button
                onClick={() => {
                  setReviewId(null);
                  setReviewRating(5);
                  setReviewComment("");
                }}
                className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Bỏ qua
              </button>
              <button
                onClick={() => reviewMutation.mutate()}
                disabled={reviewMutation.isPending}
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {reviewMutation.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                Gửi đánh giá
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── DỜI LỊCH ─── */}
      {rescheduleId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900/60 backdrop-blur-xl border border-white/10 rounded-2xl w-full max-w-md shadow-[0_8px_32px_rgba(0,0,0,0.37)] overflow-hidden flex flex-col max-h-[90vh] transition-all">
            <div className="p-5 border-b border-white/10 shrink-0 bg-white/5">
              <h3 className="text-zinc-100 font-bold tracking-tight">Yêu cầu dời lịch</h3>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto">
              <div>
                <label className="text-xs font-semibold text-zinc-400 mb-1.5 block">Ngày đề xuất</label>
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-400 mb-1.5 block">Giờ đề xuất</label>
                <select
                  value={rescheduleTime}
                  onChange={(e) => setRescheduleTime(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                >
                  <option value="">Chọn giờ</option>
                  {FALLBACK_SLOTS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-400 mb-1.5 block">Lý do dời lịch</label>
                <textarea
                  value={rescheduleReason}
                  onChange={(e) => setRescheduleReason(e.target.value)}
                  rows={2}
                  placeholder="Lý do..."
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50 resize-none"
                />
              </div>
            </div>
            <div className="p-5 border-t border-white/10 flex gap-3 shrink-0 bg-white/5 backdrop-blur-md">
              <button
                onClick={() => {
                  setRescheduleId(null);
                  setRescheduleDate("");
                  setRescheduleTime("");
                  setRescheduleReason("");
                }}
                className="flex-1 py-2.5 border border-white/10 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-white/10 transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={() => {
                  if (!rescheduleId || !rescheduleDate || !rescheduleTime) return;
                  const start = new Date(`${rescheduleDate}T${rescheduleTime}:00`);
                  const end = new Date(start.getTime() + 60 * 60 * 1000); // 1 hour
                  rescheduleMutation.mutate({
                    id: rescheduleId,
                    proposedStartAt: start.toISOString(),
                    proposedEndAt: end.toISOString(),
                    reason: rescheduleReason,
                  });
                }}
                disabled={!rescheduleDate || !rescheduleTime || rescheduleMutation.isPending}
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {rescheduleMutation.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                Gửi yêu cầu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
