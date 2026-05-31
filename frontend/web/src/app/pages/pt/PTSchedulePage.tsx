import { useState } from "react";
import {
  Calendar, Clock, ChevronLeft, ChevronRight, X, Plus, Loader2,
  Check, CheckCircle, XCircle, AlertOctagon, Ban, Settings,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionService, availabilityService } from "../../services/api";
import { toast } from "sonner";
import type { Session, SessionStatus, DayOfWeek, PTAvailabilitySlot, PTScheduleException } from "../../types";

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEK_DAYS: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const DAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: "Mon", TUESDAY: "Tue", WEDNESDAY: "Wed", THURSDAY: "Thu",
  FRIDAY: "Fri", SATURDAY: "Sat", SUNDAY: "Sun",
};

const SESSION_STATUS_CFG: Record<SessionStatus, { label: string; color: string; bg: string }> = {
  REQUESTED: { label: "Pending", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
  CONFIRMED: { label: "Confirmed", color: "text-green-400", bg: "bg-green-500/10 border-green-500/20" },
  COMPLETED: { label: "Completed", color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
  CANCELLED: { label: "Cancelled", color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
  NO_SHOW: { label: "No Show", color: "text-zinc-400", bg: "bg-zinc-700/50 border-zinc-700" },
};

function getDaysInMonth(year: number, month: number) { return new Date(year, month + 1, 0).getDate(); }
function getFirstDay(year: number, month: number) { return new Date(year, month, 1).getDay(); }

function formatSessionTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

type Tab = "schedule" | "availability";

export function PTSchedulePage() {
  const queryClient = useQueryClient();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());
  const [tab, setTab] = useState<Tab>("schedule");

  // Availability editing state
  const [editSlots, setEditSlots] = useState<Record<string, { start: string; end: string }>>({});
  const [isEditingAvail, setIsEditingAvail] = useState(false);
  const [blockDate, setBlockDate] = useState("");
  const [blockReason, setBlockReason] = useState("");

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDay(year, month);
  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1); };

  // ── Queries ──────────────────────────────────────────────────────
  const { data: upcomingSessions = [], isLoading: loadingSessions } = useQuery({
    queryKey: ["sessions-upcoming"],
    queryFn: () => sessionService.getMyUpcoming(),
  });

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
    ? sessions.filter(s => {
        const d = new Date(s.scheduledStartAt);
        return d.getFullYear() === year && d.getMonth() === month && d.getDate() === selectedDay;
      })
    : [];

  // Session days for calendar dots
  const sessionDays = new Set(
    sessions.map(s => {
      const d = new Date(s.scheduledStartAt);
      if (d.getFullYear() === year && d.getMonth() === month) return d.getDate();
      return -1;
    }).filter(d => d > 0)
  );

  // Blocked dates set
  const blockedDates = new Set(
    (exceptions as PTScheduleException[]).map(e => new Date(e.date).toISOString().slice(0, 10))
  );

  // ── Session mutations ────────────────────────────────────────────
  const confirmMut = useMutation({
    mutationFn: (id: string) => sessionService.confirmSession(id),
    onSuccess: () => { toast.success("Session confirmed"); queryClient.invalidateQueries({ queryKey: ["sessions-upcoming"] }); },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Failed"),
  });

  const completeMut = useMutation({
    mutationFn: (id: string) => sessionService.completeSession(id),
    onSuccess: () => { toast.success("Session completed"); queryClient.invalidateQueries({ queryKey: ["sessions-upcoming"] }); },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Failed"),
  });

  const cancelSessionMut = useMutation({
    mutationFn: (id: string) => sessionService.cancelSession(id, "PT cancelled"),
    onSuccess: () => { toast.success("Session cancelled"); queryClient.invalidateQueries({ queryKey: ["sessions-upcoming"] }); },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Failed"),
  });

  const noShowMut = useMutation({
    mutationFn: (id: string) => sessionService.markNoShow(id, "CLIENT"),
    onSuccess: () => { toast.success("No-show recorded"); queryClient.invalidateQueries({ queryKey: ["sessions-upcoming"] }); },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Failed"),
  });

  // ── Availability mutations ───────────────────────────────────────
  const saveAvailMut = useMutation({
    mutationFn: (slots: Array<{ dayOfWeek: string; startTime: string; endTime: string }>) =>
      availabilityService.setAvailability(slots),
    onSuccess: () => {
      toast.success("Availability saved");
      setIsEditingAvail(false);
      queryClient.invalidateQueries({ queryKey: ["pt-availability"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Failed to save"),
  });

  const addExceptionMut = useMutation({
    mutationFn: ({ date, reason }: { date: string; reason?: string }) => availabilityService.addException(date, reason),
    onSuccess: () => {
      toast.success("Date blocked");
      setBlockDate("");
      setBlockReason("");
      queryClient.invalidateQueries({ queryKey: ["pt-exceptions"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Failed"),
  });

  const removeExceptionMut = useMutation({
    mutationFn: (id: string) => availabilityService.removeException(id),
    onSuccess: () => {
      toast.success("Block removed");
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
    setEditSlots(prev => {
      if (prev[day]) {
        const next = { ...prev };
        delete next[day];
        return next;
      }
      return { ...prev, [day]: { start: "09:00", end: "17:00" } };
    });
  };

  const updateSlotTime = (day: string, field: "start" | "end", value: string) => {
    setEditSlots(prev => ({ ...prev, [day]: { ...prev[day], [field]: value } }));
  };

  const saveAvailability = () => {
    const slots = Object.entries(editSlots).map(([day, times]) => ({
      dayOfWeek: day,
      startTime: times.start,
      endTime: times.end,
    }));
    saveAvailMut.mutate(slots);
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
            <Calendar className="w-5 h-5 text-green-400" /> My Schedule
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">Manage your coaching sessions and availability</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-800/60 border border-zinc-700/40 p-1 rounded-xl w-full sm:w-auto sm:inline-flex">
        <button onClick={() => setTab("schedule")} className={`flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${tab === "schedule" ? "bg-green-500 text-black shadow-sm" : "text-zinc-500 hover:text-zinc-300"}`}>
          Sessions
        </button>
        <button onClick={() => setTab("availability")} className={`flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-1.5 ${tab === "availability" ? "bg-green-500 text-black shadow-sm" : "text-zinc-500 hover:text-zinc-300"}`}>
          <Settings className="w-3.5 h-3.5" /> Availability
        </button>
      </div>

      {/* ─── SCHEDULE TAB ─── */}
      {tab === "schedule" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Calendar */}
          <div className="lg:col-span-2 bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <div className="flex items-center justify-between mb-4">
              <button onClick={prevMonth} className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"><ChevronLeft className="w-4 h-4" /></button>
              <h3 className="text-sm font-bold text-zinc-200">{MONTHS[month]} {year}</h3>
              <button onClick={nextMonth} className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"><ChevronRight className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-2">
              {DAYS_SHORT.map(d => <div key={d} className="text-center text-xs text-zinc-600 py-1 font-semibold">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstDay }).map((_, i) => <div key={`e-${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const isToday = year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
                const hasS = sessionDays.has(day);
                const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const isBlocked = blockedDates.has(dateStr);
                return (
                  <button
                    key={day}
                    onClick={() => setSelectedDay(day)}
                    className={`aspect-square flex flex-col items-center justify-center rounded-xl text-xs transition-all font-medium ${
                      selectedDay === day ? "bg-green-500 text-black shadow-lg shadow-green-500/25" :
                      isBlocked ? "bg-red-500/10 text-red-400/60 border border-red-500/20" :
                      isToday ? "bg-green-500/15 text-green-400 border border-green-500/30" :
                      "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    }`}
                  >
                    {day}
                    {hasS && <div className={`w-1.5 h-1.5 rounded-full mt-0.5 ${selectedDay === day ? "bg-black" : "bg-green-500"}`} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Day sessions */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-zinc-200">
              {selectedDay ? `${MONTHS[month]} ${selectedDay}` : "Select a date"}
            </h4>

            {loadingSessions ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 text-green-500 animate-spin" /></div>
            ) : daySessions.length === 0 ? (
              <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-6 text-center">
                <Calendar className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
                <p className="text-sm text-zinc-500">No sessions on this day</p>
              </div>
            ) : (
              daySessions.map(s => {
                const cfg = SESSION_STATUS_CFG[s.status];
                return (
                  <div key={s.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                      <span className="text-xs text-zinc-600">{s.sessionMode === "ONLINE" ? "Online" : "In Person"}</span>
                      <span className="text-xs text-zinc-500 ml-auto">{formatSessionTime(s.scheduledStartAt)}</span>
                    </div>
                    <div className="text-xs text-zinc-500">{s.clientUserId.slice(0, 8)}...</div>
                    {s.notes && <p className="text-xs text-zinc-600 mt-1">{s.notes}</p>}

                    <div className="flex gap-1.5 mt-3 pt-2 border-t border-zinc-800/40">
                      {s.status === "REQUESTED" && (
                        <>
                          <button onClick={() => confirmMut.mutate(s.id)} disabled={confirmMut.isPending} className="flex items-center gap-1 bg-green-500 hover:bg-green-400 text-black px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all">
                            <Check className="w-3 h-3" /> Confirm
                          </button>
                          <button onClick={() => cancelSessionMut.mutate(s.id)} disabled={cancelSessionMut.isPending} className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors">
                            <X className="w-3 h-3" /> Decline
                          </button>
                        </>
                      )}
                      {s.status === "CONFIRMED" && (
                        <>
                          <button onClick={() => completeMut.mutate(s.id)} disabled={completeMut.isPending} className="flex items-center gap-1 bg-blue-500 hover:bg-blue-400 text-white px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all">
                            <CheckCircle className="w-3 h-3" /> Complete
                          </button>
                          <button onClick={() => noShowMut.mutate(s.id)} disabled={noShowMut.isPending} className="flex items-center gap-1 border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors">
                            <AlertOctagon className="w-3 h-3" /> No-Show
                          </button>
                          <button onClick={() => cancelSessionMut.mutate(s.id)} disabled={cancelSessionMut.isPending} className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors">
                            <X className="w-3 h-3" /> Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {/* All upcoming sidebar */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
              <h4 className="text-xs font-bold text-zinc-600 mb-3 uppercase tracking-wider">All Upcoming</h4>
              {sessions.length === 0 ? (
                <p className="text-xs text-zinc-600">No upcoming sessions</p>
              ) : (
                <div className="space-y-2">
                  {sessions.slice(0, 6).map(s => (
                    <div key={s.id} className="flex items-center gap-2">
                      <div className="w-7 h-7 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center text-[10px] font-bold text-green-400 flex-shrink-0">
                        {s.clientUserId.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-zinc-300 truncate">{s.clientUserId.slice(0, 8)}...</div>
                        <div className="text-xs text-zinc-600">
                          {new Date(s.scheduledStartAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {formatSessionTime(s.scheduledStartAt)}
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
              <h3 className="text-sm font-bold text-zinc-200">Weekly Schedule</h3>
              {!isEditingAvail ? (
                <button onClick={startEditing} className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 font-semibold transition-colors">
                  <Settings className="w-3 h-3" /> Edit
                </button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => setIsEditingAvail(false)} className="text-xs text-zinc-500 hover:text-zinc-300 font-semibold">Cancel</button>
                  <button
                    onClick={saveAvailability}
                    disabled={saveAvailMut.isPending}
                    className="flex items-center gap-1 bg-green-500 hover:bg-green-400 text-black px-3 py-1 rounded-lg text-xs font-bold transition-all"
                  >
                    {saveAvailMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                  </button>
                </div>
              )}
            </div>

            {loadingAvail ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 text-green-500 animate-spin" /></div>
            ) : isEditingAvail ? (
              <div className="space-y-2">
                {WEEK_DAYS.map(day => {
                  const active = !!editSlots[day];
                  return (
                    <div key={day} className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${active ? "border-green-500/20 bg-green-500/5" : "border-zinc-800/60 bg-zinc-800/20"}`}>
                      <button onClick={() => toggleDay(day)} className={`w-5 h-5 rounded flex items-center justify-center border transition-all ${active ? "bg-green-500 border-green-500" : "border-zinc-700"}`}>
                        {active && <Check className="w-3 h-3 text-black" />}
                      </button>
                      <span className={`text-xs font-bold w-10 ${active ? "text-zinc-200" : "text-zinc-600"}`}>{DAY_LABELS[day]}</span>
                      {active && (
                        <div className="flex items-center gap-2 ml-auto">
                          <input type="time" value={editSlots[day].start} onChange={e => updateSlotTime(day, "start", e.target.value)} className="bg-zinc-800 border border-zinc-700/60 rounded px-2 py-1 text-xs text-zinc-300 outline-none" />
                          <span className="text-xs text-zinc-600">–</span>
                          <input type="time" value={editSlots[day].end} onChange={e => updateSlotTime(day, "end", e.target.value)} className="bg-zinc-800 border border-zinc-700/60 rounded px-2 py-1 text-xs text-zinc-300 outline-none" />
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
                    <p className="text-sm text-zinc-500">No availability set</p>
                    <p className="text-xs text-zinc-600 mt-1">Click Edit to set your weekly hours</p>
                  </div>
                ) : (
                  (availability as PTAvailabilitySlot[]).map(s => (
                    <div key={s.id || s.dayOfWeek} className="flex items-center gap-3 p-3 rounded-lg border border-zinc-800/60 bg-zinc-800/20">
                      <div className="w-2 h-2 bg-green-500 rounded-full" />
                      <span className="text-xs font-bold text-zinc-300 w-10">{DAY_LABELS[s.dayOfWeek as DayOfWeek]}</span>
                      <span className="text-xs text-zinc-500 ml-auto">{s.startTime} – {s.endTime}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Blocked dates */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-5 space-y-4">
            <h3 className="text-sm font-bold text-zinc-200">Blocked Dates</h3>
            <p className="text-xs text-zinc-500">Block specific dates when you're unavailable (vacation, holidays, etc.)</p>

            <div className="flex gap-2">
              <input
                type="date"
                value={blockDate}
                onChange={e => setBlockDate(e.target.value)}
                className="flex-1 bg-zinc-800 border border-zinc-700/60 rounded-lg px-3 py-2 text-sm text-zinc-300 outline-none"
              />
              <input
                type="text"
                value={blockReason}
                onChange={e => setBlockReason(e.target.value)}
                placeholder="Reason (optional)"
                className="flex-1 bg-zinc-800 border border-zinc-700/60 rounded-lg px-3 py-2 text-sm text-zinc-300 placeholder-zinc-600 outline-none"
              />
              <button
                onClick={() => blockDate && addExceptionMut.mutate({ date: blockDate, reason: blockReason || undefined })}
                disabled={!blockDate || addExceptionMut.isPending}
                className="flex items-center gap-1 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {addExceptionMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Block
              </button>
            </div>

            <div className="space-y-2">
              {(exceptions as PTScheduleException[]).length === 0 ? (
                <p className="text-xs text-zinc-600 text-center py-4">No blocked dates</p>
              ) : (
                (exceptions as PTScheduleException[]).map(e => (
                  <div key={e.id} className="flex items-center gap-3 p-3 rounded-lg border border-red-500/20 bg-red-500/5">
                    <Ban className="w-3.5 h-3.5 text-red-400" />
                    <div className="flex-1">
                      <div className="text-xs font-bold text-zinc-300">
                        {new Date(e.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                      </div>
                      {e.reason && <div className="text-xs text-zinc-500">{e.reason}</div>}
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
    </div>
  );
}
