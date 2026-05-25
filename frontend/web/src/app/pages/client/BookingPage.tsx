import { useState } from "react";
import {
  Calendar, Clock, ChevronLeft, ChevronRight, CheckCircle, AlertCircle,
  XCircle, Loader2, Star, MapPin, MessageSquare, FileText, RefreshCw,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { contractService, sessionService, availabilityService } from "../../services/api";
import { toast } from "sonner";
import { useApp } from "../../context/AppContext";
import { useCall } from "../../context/CallContext";
import { getJoinSessionState } from "../../utils/sessionUtils";
import type { Contract, Session, SessionStatus } from "../../types";

const DAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const MONTHS = ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"];
const FALLBACK_SLOTS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00"];

function formatTime(t: string) {
  return t;
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("vi-VN", { month: "short", day: "numeric", year: "numeric" })
    + " lúc " + d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString("vi-VN", { month: "short", day: "numeric" });
}

function getDaysInMonth(year: number, month: number) { return new Date(year, month + 1, 0).getDate(); }
function getFirstDay(year: number, month: number) { return new Date(year, month, 1).getDay(); }

const SESSION_STATUS_CONFIG: Record<SessionStatus, { label: string; color: string; bg: string }> = {
  REQUESTED: { label: "Chờ xác nhận", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
  CONFIRMED: { label: "Đã xác nhận",  color: "text-green-400", bg: "bg-green-500/10 border-green-500/20" },
  COMPLETED: { label: "Hoàn thành",   color: "text-blue-400",  bg: "bg-blue-500/10 border-blue-500/20" },
  CANCELLED: { label: "Đã hủy",       color: "text-red-400",   bg: "bg-red-500/10 border-red-500/20" },
  NO_SHOW:   { label: "Vắng mặt",     color: "text-zinc-400",  bg: "bg-zinc-700/50 border-zinc-700" },
};

type Tab = "book" | "upcoming" | "past";

export function BookingPage() {
  const queryClient = useQueryClient();
  const { user } = useApp();
  const { joinCoachingSession } = useCall();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [sessionMode, setSessionMode] = useState<"OFFLINE" | "ONLINE">("OFFLINE");
  const [bookingNotes, setBookingNotes] = useState("");
  const [tab, setTab] = useState<Tab>("book");
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [joiningSessionId, setJoiningSessionId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const handleResendESign = async (contractId: string) => {
    if (resendingId) return;
    setResendingId(contractId);
    try {
      await contractService.resendESign(contractId);
      toast.success("Đã gửi lại email ký. Vui lòng kiểm tra hộp thư.");
      queryClient.invalidateQueries({ queryKey: ["client-contracts-pending-signature"] });
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
      await joinCoachingSession({ id: result.sessionId, otherUserId: result.otherUserId, joinToken: result.joinToken });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Không thể tham gia buổi học');
    } finally {
      setJoiningSessionId(null);
    }
  };

  // Fetch active contracts
  const { data: contracts = [] } = useQuery({
    queryKey: ["client-contracts", "ACTIVE"],
    queryFn: () => contractService.getByClient("ACTIVE"),
  });

  const activeContracts = (contracts as Contract[]).filter(c => c.status === "ACTIVE");

  // Fetch contracts awaiting e-signature
  const { data: pendingSigContracts = [] } = useQuery({
    queryKey: ["client-contracts-pending-signature"],
    queryFn: () => contractService.getByClient("PENDING_SIGNATURE"),
  });
  const selectedContract = activeContracts.find(c => c.id === selectedContractId);

  // Auto-select first active contract
  if (activeContracts.length > 0 && !selectedContractId) {
    setSelectedContractId(activeContracts[0].id);
  }

  // Fetch upcoming sessions
  const { data: upcomingSessions = [], isLoading: loadingUpcoming } = useQuery({
    queryKey: ["sessions-upcoming"],
    queryFn: () => sessionService.getMyUpcoming(),
  });

  // Fetch sessions for selected contract (for past tab)
  const { data: contractSessions = [], isLoading: loadingPast } = useQuery({
    queryKey: ["contract-sessions", selectedContractId],
    queryFn: () => selectedContractId ? sessionService.getContractSessions(selectedContractId) : Promise.resolve([]),
    enabled: !!selectedContractId,
  });

  const pastSessions = (contractSessions as Session[]).filter(
    s => s.status === "COMPLETED" || s.status === "CANCELLED" || s.status === "NO_SHOW"
  );

  // Remaining sessions count
  const remainingSessions = selectedContract
    ? selectedContract.totalSessions - selectedContract.usedSessions
    : 0;

  // Fetch available slots for selected date + PT
  const selectedDateStr = selectedDate
    ? `${year}-${String(month + 1).padStart(2, "0")}-${String(selectedDate).padStart(2, "0")}`
    : null;

  const { data: availableSlots, isLoading: loadingSlots } = useQuery({
    queryKey: ["available-slots", selectedContract?.ptUserId, selectedDateStr],
    queryFn: () => availabilityService.getAvailableSlots(selectedContract!.ptUserId, selectedDateStr!),
    enabled: !!selectedContract?.ptUserId && !!selectedDateStr,
  });

  // Use available slots from API, fall back to default time slots if PT hasn't set availability
  const timeSlots: string[] = availableSlots && (availableSlots as string[]).length > 0
    ? (availableSlots as string[])
    : !loadingSlots && availableSlots !== undefined && (availableSlots as string[]).length === 0
      ? []
      : FALLBACK_SLOTS;

  // Book mutation
  const bookMutation = useMutation({
    mutationFn: () => {
      if (!selectedContractId || !selectedDate || !selectedSlot) throw new Error("Missing data");
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
    onError: (err: any) => toast.error(err?.response?.data?.error || "Không thể đặt lịch"),
  });

  // Cancel mutation
  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => sessionService.cancelSession(id, reason),
    onSuccess: () => {
      toast.success("Đã hủy lịch tập");
      setCancelId(null);
      setCancelReason("");
      queryClient.invalidateQueries({ queryKey: ["sessions-upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["contract-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["client-contracts"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Không thể hủy lịch"),
  });

  // Review mutation
  const reviewMutation = useMutation({
    mutationFn: () => {
      if (!reviewId) throw new Error("Missing session");
      return sessionService.reviewSession(reviewId, reviewRating, reviewComment || undefined);
    },
    onSuccess: () => {
      toast.success("Đánh giá đã được gửi!");
      setReviewId(null);
      setReviewRating(5);
      setReviewComment("");
      queryClient.invalidateQueries({ queryKey: ["contract-sessions"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Không thể gửi đánh giá"),
  });

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDay(year, month);
  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1); };
  const isToday = (day: number) => year === today.getFullYear() && month === today.getMonth() && day === today.getDate();

  const tabLabels: Record<Tab, string> = { book: "Đặt lịch", upcoming: "Sắp tới", past: "Đã qua" };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
            <Calendar className="w-5 h-5 text-green-400" /> Lịch tập luyện
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">Đặt và quản lý các buổi tập của bạn</p>
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
        <div key={contract.id} className="bg-zinc-900 rounded-2xl border border-amber-500/20 p-4 space-y-3">
          {contract.eSignTestMode && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 px-3 py-2 rounded-lg text-xs font-medium">
              ⚠ Chữ ký điện tử đang ở chế độ thử nghiệm (test mode) — không có giá trị pháp lý production
            </div>
          )}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-zinc-100 font-bold text-sm">Chờ ký hợp đồng</h3>
              <p className="text-zinc-500 text-xs mt-0.5">{contract.packageName}</p>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 font-semibold">
              Chờ ký
            </span>
          </div>
          <p className="text-sm text-zinc-400">
            {contract.eSignStatus === "SENT" && "Đang chờ cả hai bên ký. Kiểm tra email của bạn."}
            {contract.eSignStatus === "PARTIALLY_SIGNED" && (
              contract.clientSignedAt && !contract.ptSignedAt
                ? "Bạn đã ký. Đang chờ huấn luyện viên ký."
                : !contract.clientSignedAt && contract.ptSignedAt
                ? "Huấn luyện viên đã ký. Đang chờ bạn ký."
                : "Đang xử lý..."
            )}
            {contract.eSignStatus === "DECLINED" && <span className="text-red-400">Một bên đã từ chối ký.</span>}
            {contract.eSignStatus === "EXPIRED" && <span className="text-zinc-400">Yêu cầu ký đã hết hạn.</span>}
            {contract.eSignStatus === "ERROR" && (
              <span className="text-red-400">Có lỗi xảy ra khi gửi yêu cầu ký. Vui lòng thử lại.</span>
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
                {resendingId === contract.id
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <RefreshCw className="w-3.5 h-3.5" />
                }
                Gửi lại email ký
              </button>
            )}
          </div>
        </div>
      ))}

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-800/60 border border-zinc-700/40 p-1 rounded-xl w-full sm:w-auto sm:inline-flex">
        {(["book", "upcoming", "past"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${tab === t ? "bg-green-500 text-black shadow-sm" : "text-zinc-500 hover:text-zinc-300"}`}>
            {tabLabels[t]}
          </button>
        ))}
      </div>

      {/* ─── BOOK TAB ─── */}
      {tab === "book" && (
        <>
          {activeContracts.length === 0 ? (
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-20 text-center">
              <FileText className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
              <h3 className="text-zinc-200 font-bold mb-1">Không có hợp đồng đang hoạt động</h3>
              <p className="text-sm text-zinc-500 max-w-xs mx-auto">Bạn cần có hợp đồng đang hoạt động với huấn luyện viên để đặt lịch. Tìm PT để bắt đầu!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Contract selector */}
              {activeContracts.length > 1 && (
                <div className="flex gap-2 overflow-x-auto">
                  {activeContracts.map(c => (
                    <button
                      key={c.id}
                      onClick={() => { setSelectedContractId(c.id); setSelectedDate(null); setSelectedSlot(null); }}
                      className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${
                        selectedContractId === c.id
                          ? "bg-green-500 text-black border-green-500"
                          : "bg-zinc-900 border-zinc-700/60 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {c.packageName} (còn {c.totalSessions - c.usedSessions})
                    </button>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Calendar */}
                <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 shadow-xl">
                  <div className="flex items-center justify-between mb-4">
                    <button onClick={prevMonth} className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"><ChevronLeft className="w-4 h-4" /></button>
                    <h3 className="text-sm font-bold text-zinc-200">{MONTHS[month]} {year}</h3>
                    <button onClick={nextMonth} className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"><ChevronRight className="w-4 h-4" /></button>
                  </div>
                  <div className="grid grid-cols-7 gap-1 mb-2 border-b border-zinc-800/60 pb-2">
                    {DAYS.map((d) => <div key={d} className="text-center text-[10px] text-zinc-600 uppercase tracking-tighter font-bold">{d}</div>)}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: firstDay }).map((_, i) => <div key={`e-${i}`} />)}
                    {Array.from({ length: daysInMonth }).map((_, i) => {
                      const day = i + 1;
                      const dateObj = new Date(year, month, day);
                      const isPast = dateObj < new Date(today.getFullYear(), today.getMonth(), today.getDate());
                      const isPastEndDate = selectedContract?.endDate && dateObj > new Date(selectedContract.endDate);
                      const disabled = isPast || !!isPastEndDate;
                      return (
                        <button
                          key={day}
                          disabled={disabled}
                          onClick={() => { setSelectedDate(day); setSelectedSlot(null); }}
                          className={`aspect-square flex flex-col items-center justify-center rounded-xl text-xs transition-all font-medium ${
                            selectedDate === day ? "bg-green-500 text-black shadow-lg shadow-green-500/25" :
                            isToday(day) ? "bg-green-500/15 text-green-400 border border-green-500/30" :
                            disabled ? "text-zinc-700 cursor-not-allowed" :
                            "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                          }`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Time slots + booking form */}
                <div className="space-y-3">
                  {selectedDate ? (
                    <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 shadow-xl">
                      <h4 className="text-sm font-bold text-zinc-200 mb-1">
                        Khung giờ trống – {MONTHS[month]} {selectedDate}
                      </h4>
                      <p className="text-xs text-zinc-500 mb-3">Chọn giờ cho buổi tập của bạn</p>
                      {loadingSlots ? (
                        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 text-green-500 animate-spin" /></div>
                      ) : timeSlots.length === 0 ? (
                        <div className="text-center py-6">
                          <Clock className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
                          <p className="text-sm text-zinc-500">Không có khung giờ trống ngày này</p>
                          <p className="text-xs text-zinc-600 mt-1">Huấn luyện viên có thể không khả dụng hoặc đã được đặt hết</p>
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
                            <label className="text-xs font-semibold text-zinc-400 mb-1.5 block">Hình thức</label>
                            <div className="flex gap-2">
                              {(["OFFLINE", "ONLINE"] as const).map(mode => (
                                <button
                                  key={mode}
                                  onClick={() => setSessionMode(mode)}
                                  className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all border ${
                                    sessionMode === mode
                                      ? "bg-green-500/10 border-green-500/30 text-green-400"
                                      : "border-zinc-700/60 text-zinc-500 hover:text-zinc-300"
                                  }`}
                                >
                                  {mode === "OFFLINE" ? "Trực tiếp" : "Trực tuyến"}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Notes */}
                          <div>
                            <label className="text-xs font-semibold text-zinc-400 mb-1.5 block">Ghi chú (không bắt buộc)</label>
                            <textarea
                              value={bookingNotes}
                              onChange={e => setBookingNotes(e.target.value)}
                              rows={2}
                              placeholder="Ghi chú cho huấn luyện viên..."
                              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50 resize-none"
                            />
                          </div>

                          {/* Confirm */}
                          <div className="p-3 bg-green-500/8 border border-green-500/20 rounded-xl">
                            <div className="flex items-center gap-2 mb-2 text-green-400">
                              <CheckCircle className="w-4 h-4" />
                              <span className="text-sm font-bold">Sẵn sàng đặt lịch</span>
                            </div>
                            <p className="text-xs text-zinc-400 mb-3">
                              {MONTHS[month]} {selectedDate}, {year} lúc {formatTime(selectedSlot)} · {sessionMode === "ONLINE" ? "Trực tuyến" : "Trực tiếp"}
                            </p>
                            <button
                              onClick={() => bookMutation.mutate()}
                              disabled={bookMutation.isPending}
                              className="w-full py-2.5 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20 flex items-center justify-center gap-2"
                            >
                              {bookMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                              Xác nhận đặt lịch
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-10 text-center flex flex-col items-center justify-center h-full">
                      <Calendar className="w-10 h-10 text-zinc-800 mb-3" />
                      <p className="text-sm text-zinc-500">Chọn ngày để xem khung giờ trống</p>
                    </div>
                  )}

                  {/* Booking rules */}
                  <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-zinc-600 flex-shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Quy tắc đặt lịch</p>
                        <p className="text-xs text-zinc-500 leading-relaxed">
                          • Lịch tập phải được đặt trước ít nhất 24 giờ.<br />
                          • Hủy lịch trong vòng 24 giờ sẽ tính là 1 buổi đã dùng.<br />
                          • Vắng mặt cũng sẽ tính là 1 buổi đã dùng.
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
              <h3 className="text-zinc-200 font-bold mb-1">Không có buổi tập sắp tới</h3>
              <p className="text-sm text-zinc-500 mb-6">Bạn chưa có buổi tập nào được lên lịch.</p>
              <button onClick={() => setTab("book")} className="px-6 py-2 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-xl transition-all">
                Đặt lịch tập
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {(upcomingSessions as Session[]).map((s) => {
                const cfg = SESSION_STATUS_CONFIG[s.status];
                const startDate = new Date(s.scheduledStartAt);
                const hoursUntil = (startDate.getTime() - Date.now()) / (1000 * 60 * 60);
                return (
                  <div key={s.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                          <span className="text-xs text-zinc-600">{s.sessionMode === "ONLINE" ? "Trực tuyến" : "Trực tiếp"}</span>
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
                                onClick={() => joinState.enabled && handleJoinSession(s)}
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
                                <span className="text-[10px] text-zinc-600 text-right max-w-[130px] leading-tight">{joinState.reason}</span>
                              )}
                            </div>
                          );
                        })()}
                        <button
                          onClick={() => setCancelId(s.id)}
                          className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        >
                          <XCircle className="w-3.5 h-3.5" /> Hủy
                        </button>
                      </div>
                    </div>
                    {hoursUntil < 24 && hoursUntil > 0 && (
                      <div className="mt-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5">
                        Hủy lúc này sẽ tính là 1 buổi đã dùng (còn dưới 24 giờ)
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── PAST TAB ─── */}
      {tab === "past" && (
        <div>
          {/* Contract selector for past sessions */}
          {activeContracts.length > 1 && (
            <div className="flex gap-2 overflow-x-auto mb-4">
              {activeContracts.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedContractId(c.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all border ${
                    selectedContractId === c.id ? "bg-green-500 text-black border-green-500" : "bg-zinc-900 border-zinc-700/60 text-zinc-400"
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
              <h3 className="text-zinc-200 font-bold mb-1">Chưa có buổi tập nào</h3>
              <p className="text-sm text-zinc-500 mb-6">Lịch sử buổi tập sẽ xuất hiện ở đây sau khi bạn hoàn thành buổi tập đầu tiên.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pastSessions.map((s) => {
                const cfg = SESSION_STATUS_CONFIG[s.status];
                return (
                  <div key={s.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                          {s.sessionDeducted && <span className="text-xs text-zinc-600">Đã trừ buổi</span>}
                        </div>
                        <div className="text-sm font-bold text-zinc-200">{formatDateTime(s.scheduledStartAt)}</div>
                        {s.ptNotes && <p className="text-xs text-zinc-500 mt-1">PT: {s.ptNotes}</p>}
                        {s.cancellationReason && <p className="text-xs text-red-400/80 mt-1">Lý do: {s.cancellationReason}</p>}
                      </div>
                      <div>
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
                              <Star key={i} className={`w-3 h-3 ${i < s.review!.rating ? "text-amber-400 fill-amber-400" : "text-zinc-700"}`} />
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
              <p className="text-sm text-zinc-400">Vui lòng cho biết lý do hủy lịch tập này.</p>
              <textarea
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                rows={3}
                placeholder="Lý do hủy lịch..."
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-red-500/50 resize-none"
              />
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button onClick={() => { setCancelId(null); setCancelReason(""); }} className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors">
                Giữ lịch
              </button>
              <button
                onClick={() => cancelMutation.mutate({ id: cancelId, reason: cancelReason })}
                disabled={!cancelReason.trim() || cancelMutation.isPending}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {cancelMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
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
                    <Star className={`w-8 h-8 transition-colors ${i < reviewRating ? "text-amber-400 fill-amber-400" : "text-zinc-700 hover:text-zinc-500"}`} />
                  </button>
                ))}
              </div>
              <textarea
                value={reviewComment}
                onChange={e => setReviewComment(e.target.value)}
                rows={3}
                placeholder="Buổi tập của bạn như thế nào? (không bắt buộc)"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50 resize-none"
              />
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button onClick={() => { setReviewId(null); setReviewRating(5); setReviewComment(""); }} className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors">
                Bỏ qua
              </button>
              <button
                onClick={() => reviewMutation.mutate()}
                disabled={reviewMutation.isPending}
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {reviewMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Gửi đánh giá
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
