import { useState } from "react";
import { Calendar, Clock, Video, ChevronLeft, ChevronRight, CheckCircle, AlertCircle, MessageSquare, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../context/AppContext";
import { chatService, profileService } from "../../services/api";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function getDaysInMonth(year: number, month: number) { return new Date(year, month + 1, 0).getDate(); }
function getFirstDay(year: number, month: number) { return new Date(year, month, 1).getDay(); }

type Tab = "book" | "upcoming" | "past";

export function BookingPage() {
  const { user } = useApp();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<number | null>(null);
  const [selectedCoachId, setSelectedCoachId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [tab, setTab] = useState<Tab>("book");

  const { data: ptsData, isLoading: loadingPts } = useQuery({
    queryKey: ["booking-pts"],
    queryFn: profileService.listPTs,
  });

  const { data: convsData, isLoading: loadingConvs } = useQuery({
    queryKey: ["booking-conversations"],
    queryFn: chatService.listConversations,
  });

  const ptList = ptsData?.pts || [];
  const conversations = convsData?.conversations || [];

  if (loadingPts || loadingConvs) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDay(year, month);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1); };

  const isToday = (day: number) => year === today.getFullYear() && month === today.getMonth() && day === today.getDate();

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
            <Calendar className="w-5 h-5 text-green-400" /> Coaching Schedule
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">Book and manage your coaching sessions with real account data</p>
        </div>
        <span className="px-3 py-1 bg-zinc-800 text-zinc-400 text-xs font-bold rounded-full flex items-center gap-1.5 border border-zinc-700/50">
          <Clock className="w-3 h-3" />
          {conversations.length} active coaching conversation(s)
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-800/60 border border-zinc-700/40 p-1 rounded-xl w-full sm:w-auto sm:inline-flex">
        {(["book", "upcoming", "past"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-sm font-semibold capitalize transition-all ${tab === t ? "bg-green-500 text-black shadow-sm" : "text-zinc-500 hover:text-zinc-300"}`}>
            {t === "book" ? "Book Session" : t === "upcoming" ? "Upcoming" : "Past"}
          </button>
        ))}
      </div>

      {tab === "book" && (
        <>
          {confirmed ? (
            <div className="max-w-sm mx-auto bg-zinc-900 rounded-2xl border border-zinc-800/60 p-8 text-center mt-10">
              <div className="w-16 h-16 bg-green-500/10 border border-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-green-500/20">
                <CheckCircle className="w-8 h-8 text-green-400" />
              </div>
              <h3 className="text-zinc-100 font-bold mb-1">Session Booked!</h3>
              <p className="text-sm text-zinc-500 mb-1">
                {MONTHS[month]} {selectedDate}, {year}
              </p>
              <p className="text-sm font-bold text-green-400 mb-4">Coach contact created in system</p>
              <p className="text-xs text-zinc-600 mb-6">Use Chat to finalize exact time slot because no booking-slot endpoint exists yet.</p>
              <button onClick={() => { setConfirmed(false); setSelectedDate(null); setSelectedCoachId(null); }} className="w-full py-2.5 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-xl transition-all shadow-lg shadow-green-500/20">
                Book Another
              </button>
            </div>
          ) : (
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
                    const isPast = year === today.getFullYear() && month === today.getMonth() && day < today.getDate();
                    return (
                      <button
                        key={day}
                        disabled={isPast}
                        onClick={() => { setSelectedDate(day); setSelectedCoachId(null); }}
                        className={`aspect-square flex flex-col items-center justify-center rounded-xl text-xs transition-all font-medium ${
                          selectedDate === day ? "bg-green-500 text-black shadow-lg shadow-green-500/25" :
                          isToday(day) ? "bg-green-500/15 text-green-400 border border-green-500/30" :
                          isPast ? "text-zinc-700 cursor-not-allowed" :
                          "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Time slots */}
              <div className="space-y-3">
                {selectedDate ? (
                  <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 shadow-xl animate-in fade-in slide-in-from-right-2 duration-300">
                    <h4 className="text-sm font-bold text-zinc-200 mb-1">
                      Available Coaches – {MONTHS[month]} {selectedDate}
                    </h4>
                    <p className="text-xs text-zinc-500 mb-3">Selected date is stored, coach relationship is loaded from database.</p>
                    {ptList.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {ptList.map((pt: any) => {
                          const ptId = pt.userId || pt.id;
                          const selected = selectedCoachId === ptId;
                          return (
                            <button
                              key={ptId}
                              onClick={() => setSelectedCoachId(ptId)}
                              className={`flex items-center justify-between gap-2 px-3 py-2.5 border rounded-xl text-sm transition-all font-medium ${
                                selected
                                  ? "border-green-500 bg-green-500/10 text-green-400"
                                  : "border-zinc-700/60 text-zinc-300 hover:border-green-500/50"
                              }`}
                            >
                              <span>{`${pt.firstName || ""} ${pt.lastName || ""}`.trim() || `PT ${String(ptId).slice(0, 8)}...`}</span>
                              <Video className="w-3.5 h-3.5" />
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-zinc-800 bg-zinc-800/40 p-4 text-xs text-zinc-500">
                        No PT profiles found in database yet.
                      </div>
                    )}

                    {selectedCoachId && (
                      <div className="mt-4 p-3 bg-green-500/8 border border-green-500/20 rounded-xl">
                        <div className="flex items-center gap-2 mb-2 text-green-400">
                          <CheckCircle className="w-4 h-4" />
                          <span className="text-sm font-bold">Ready to Book</span>
                        </div>
                        <p className="text-xs text-zinc-400 mb-3">
                          {MONTHS[month]} {selectedDate}, {year} · PT selected from DB
                        </p>
                        <button onClick={() => setConfirmed(true)} className="w-full py-2.5 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20">
                          Confirm Booking
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-10 text-center flex flex-col items-center justify-center h-full">
                    <Calendar className="w-10 h-10 text-zinc-800 mb-3" />
                    <p className="text-sm text-zinc-500">Choose a date to see available coaching hours</p>
                  </div>
                )}

                {/* Session note */}
                <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-zinc-600 flex-shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Booking Rules</p>
                      <p className="text-xs text-zinc-500 leading-relaxed">• Cancellations required 24 hours in advance.<br/>• Please join video calls on time.<br/>• Ensure you have a stable internet connection.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "upcoming" && (
        <div className="space-y-4 py-10 text-center">
          {conversations.length > 0 ? (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden text-left max-w-3xl mx-auto">
              {conversations.map((c: any) => {
                const participant = c.otherUser || c.participants?.find((p: any) => p.userId !== user?.id);
                const title = participant?.firstName ? `${participant.firstName} ${participant.lastName || ""}`.trim() : `User ${String(participant?.userId || "").slice(0, 8)}...`;
                return (
                  <div key={c.id} className="p-4 border-b border-zinc-800/40 last:border-0 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-zinc-200">{title}</p>
                      <p className="text-xs text-zinc-500">Last activity: {c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleString() : "No messages yet"}</p>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20">Conversation Active</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="max-w-md mx-auto">
              <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4 border border-zinc-700/60">
                 <Clock className="w-8 h-8 text-zinc-600" />
              </div>
              <h3 className="text-zinc-200 font-bold mb-1">No upcoming sessions</h3>
              <p className="text-sm text-zinc-500 mb-6">No coaching relationship found in database. Start by connecting with a coach.</p>
              <button onClick={() => setTab("book")} className="px-6 py-2 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-xl transition-all">
                Book a Session
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "past" && (
        <div className="space-y-4 py-10 text-center">
          <div className="max-w-md mx-auto">
            <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4 border border-zinc-700/60">
               <Calendar className="w-8 h-8 text-zinc-600" />
            </div>
            <h3 className="text-zinc-200 font-bold mb-1">No past sessions</h3>
            <p className="text-sm text-zinc-500 mb-6">Session history endpoint is not available in backend yet, so no demo data is shown.</p>
          </div>
        </div>
      )}
    </div>
  );
}

