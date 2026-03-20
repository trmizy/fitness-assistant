import { useState } from "react";
import { Calendar, Clock, Video, ChevronLeft, ChevronRight, CheckCircle, AlertCircle, X } from "lucide-react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const slots = ["9:00 AM", "10:00 AM", "11:00 AM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM"];
const bookedSlots = ["10:00 AM", "2:00 PM"];

const upcomingSessions = [
  { id: 1, date: "Jun 19, 2025", time: "10:00 AM", coach: "Sarah Mitchell", type: "Video", status: "upcoming", session: 8 },
  { id: 2, date: "Jun 24, 2025", time: "10:00 AM", coach: "Sarah Mitchell", type: "Video", status: "upcoming", session: 9 },
];

const pastSessions = [
  { id: 3, date: "Jun 12, 2025", time: "10:00 AM", coach: "Sarah Mitchell", type: "Video", status: "completed", session: 7 },
  { id: 4, date: "Jun 5, 2025", time: "10:00 AM", coach: "Sarah Mitchell", type: "Video", status: "completed", session: 6 },
  { id: 5, date: "May 30, 2025", time: "3:00 PM", coach: "Sarah Mitchell", type: "Video", status: "cancelled", session: 5 },
];

function getDaysInMonth(year: number, month: number) { return new Date(year, month + 1, 0).getDate(); }
function getFirstDay(year: number, month: number) { return new Date(year, month, 1).getDay(); }

type Tab = "book" | "upcoming" | "past";

export function BookingPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [tab, setTab] = useState<Tab>("book");

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDay(year, month);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1); };

  const hasSession = (day: number) => [10, 17, 24].includes(day);
  const isToday = (day: number) => year === today.getFullYear() && month === today.getMonth() && day === today.getDate();

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-green-400" /> Coaching Schedule
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">Book and manage your coaching sessions</p>
        </div>
        <span className="px-3 py-1 bg-green-500/10 text-green-400 text-xs font-bold rounded-full flex items-center gap-1.5 border border-green-500/20">
          <div className="w-1.5 h-1.5 bg-green-500 rounded-full shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
          5 sessions remaining
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
            <div className="max-w-sm mx-auto bg-zinc-900 rounded-2xl border border-zinc-800/60 p-8 text-center">
              <div className="w-16 h-16 bg-green-500/10 border border-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-green-500/20">
                <CheckCircle className="w-8 h-8 text-green-400" />
              </div>
              <h3 className="text-zinc-100 font-bold mb-1">Session Booked!</h3>
              <p className="text-sm text-zinc-500 mb-1">
                {MONTHS[month]} {selectedDate}, {year}
              </p>
              <p className="text-sm font-bold text-green-400 mb-4">{selectedSlot} · Video Call</p>
              <p className="text-xs text-zinc-600 mb-6">Coach Sarah Mitchell will receive a confirmation.</p>
              <button onClick={() => { setConfirmed(false); setSelectedDate(null); setSelectedSlot(null); }} className="w-full py-2.5 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-xl transition-all shadow-lg shadow-green-500/20">
                Book Another
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Calendar */}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
                <div className="flex items-center justify-between mb-4">
                  <button onClick={prevMonth} className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"><ChevronLeft className="w-4 h-4" /></button>
                  <h3 className="text-sm font-bold text-zinc-200">{MONTHS[month]} {year}</h3>
                  <button onClick={nextMonth} className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"><ChevronRight className="w-4 h-4" /></button>
                </div>
                <div className="grid grid-cols-7 gap-1 mb-2">
                  {DAYS.map((d) => <div key={d} className="text-center text-xs text-zinc-600 py-1 font-semibold">{d}</div>)}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {Array.from({ length: firstDay }).map((_, i) => <div key={`e-${i}`} />)}
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1;
                    const isPast = year === today.getFullYear() && month === today.getMonth() && day < today.getDate();
                    const hasS = hasSession(day);
                    return (
                      <button
                        key={day}
                        disabled={isPast}
                        onClick={() => { setSelectedDate(day); setSelectedSlot(null); }}
                        className={`aspect-square flex flex-col items-center justify-center rounded-xl text-xs transition-all font-medium ${
                          selectedDate === day ? "bg-green-500 text-black shadow-lg shadow-green-500/25" :
                          isToday(day) ? "bg-green-500/15 text-green-400 border border-green-500/30" :
                          isPast ? "text-zinc-700 cursor-not-allowed" :
                          "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                        }`}
                      >
                        {day}
                        {hasS && <div className={`w-1 h-1 rounded-full mt-0.5 ${selectedDate === day ? "bg-black" : "bg-green-500"}`} />}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-4 mt-3 text-xs text-zinc-600">
                  <div className="flex items-center gap-1"><div className="w-2 h-2 bg-green-500 rounded-full" /> Has session</div>
                  <div className="flex items-center gap-1"><div className="w-2 h-2 bg-green-500 rounded-full shadow-[0_0_4px_rgba(34,197,94,0.8)]" /> Selected</div>
                </div>
              </div>

              {/* Time slots */}
              <div className="space-y-3">
                {selectedDate ? (
                  <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
                    <h4 className="text-sm font-bold text-zinc-200 mb-1">
                      Available Slots – {MONTHS[month]} {selectedDate}
                    </h4>
                    <p className="text-xs text-zinc-500 mb-3">with Coach Sarah Mitchell · Video</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2">
                      {slots.map((slot) => {
                        const booked = bookedSlots.includes(slot);
                        return (
                          <button
                            key={slot}
                            disabled={booked}
                            onClick={() => setSelectedSlot(slot)}
                            className={`flex items-center gap-2 px-3 py-2.5 border-2 rounded-xl text-sm transition-all font-medium ${
                              booked ? "border-zinc-800/60 bg-zinc-800/30 text-zinc-600 cursor-not-allowed" :
                              selectedSlot === slot ? "border-green-500 bg-green-500/10 text-green-400 shadow-lg shadow-green-500/15" :
                              "border-zinc-700/60 hover:border-green-500/50 text-zinc-400 hover:text-zinc-200"
                            }`}
                          >
                            <Clock className="w-3.5 h-3.5" />
                            <span>{slot}</span>
                            {booked && <span className="text-xs ml-auto text-zinc-600">Booked</span>}
                          </button>
                        );
                      })}
                    </div>

                    {selectedSlot && (
                      <div className="mt-4 p-3 bg-green-500/8 rounded-xl border border-green-500/20">
                        <div className="flex items-center gap-2 mb-2">
                          <Video className="w-4 h-4 text-green-400" />
                          <span className="text-sm font-bold text-zinc-200">Confirm Booking</span>
                        </div>
                        <p className="text-xs text-zinc-400 mb-3">
                          {MONTHS[month]} {selectedDate}, {year} at {selectedSlot} · Video Call with Coach Sarah
                        </p>
                        <button onClick={() => setConfirmed(true)} className="w-full py-2.5 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20">
                          Confirm Booking
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-8 text-center">
                    <Calendar className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
                    <p className="text-sm text-zinc-500">Select a date to view available slots</p>
                  </div>
                )}

                {/* Session note */}
                <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-400/80">You have an active contract with 5 sessions remaining. Sessions must be booked at least 24 hours in advance.</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "upcoming" && (
        <div className="space-y-3">
          {upcomingSessions.map((s) => (
            <div key={s.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-green-500/10 border border-green-500/20 rounded-xl flex flex-col items-center justify-center text-green-400 flex-shrink-0">
                    <span className="text-xs font-bold">{s.date.split(" ")[1].replace(",", "")}</span>
                    <span className="text-xs">{s.date.split(" ")[0]}</span>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-zinc-200">Session #{s.session} with {s.coach}</div>
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <Clock className="w-3 h-3" /> {s.time} · <Video className="w-3 h-3" /> {s.type}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="px-3 py-1.5 bg-green-500 hover:bg-green-400 text-black text-xs font-bold rounded-lg transition-all shadow-lg shadow-green-500/20">Join</button>
                  <button className="px-3 py-1.5 border border-zinc-700/60 text-zinc-400 text-xs rounded-lg hover:bg-zinc-800 hover:text-zinc-200 transition-colors">Reschedule</button>
                  <button className="px-3 py-1.5 border border-red-500/20 text-red-400 text-xs rounded-lg hover:bg-red-500/10 transition-colors"><X className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "past" && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px]">
              <thead>
                <tr className="text-left text-xs text-zinc-600 bg-zinc-800/30 border-b border-zinc-800/60 uppercase tracking-wider">
                  <th className="px-4 py-2.5">Session</th>
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Coach</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {pastSessions.map((s) => (
                  <tr key={s.id} className="border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-3 text-sm font-bold text-zinc-200">#{s.session}</td>
                    <td className="px-4 py-3 text-sm text-zinc-400">{s.date} · {s.time}</td>
                    <td className="px-4 py-3 text-sm text-zinc-300">{s.coach}</td>
                    <td className="px-4 py-3 text-sm text-zinc-500">{s.type}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${s.status === "completed" ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
                        {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
