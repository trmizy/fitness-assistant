import { useState } from "react";
import { Calendar, Clock, Video, ChevronLeft, ChevronRight, X, Edit3 } from "lucide-react";

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const sessions = [
  { id: 1, client: "Alex Johnson", avatar: "AJ", date: 19, month: 5, year: 2025, time: "10:00 AM", type: "Video", status: "upcoming", session: 8 },
  { id: 2, client: "Maria Chen", avatar: "MC", date: 19, month: 5, year: 2025, time: "2:00 PM", type: "Video", status: "upcoming", session: 3 },
  { id: 3, client: "Ryan Park", avatar: "RP", date: 20, month: 5, year: 2025, time: "9:00 AM", type: "Video", status: "upcoming", session: 5 },
  { id: 4, client: "Lisa Morgan", avatar: "LM", date: 22, month: 5, year: 2025, time: "11:00 AM", type: "Video", status: "upcoming", session: 11 },
  { id: 5, client: "Tom Wallace", avatar: "TW", date: 24, month: 5, year: 2025, time: "3:00 PM", type: "Video", status: "upcoming", session: 2 },
  { id: 6, client: "Alex Johnson", avatar: "AJ", date: 12, month: 5, year: 2025, time: "10:00 AM", type: "Video", status: "completed", session: 7 },
];

function getDaysInMonth(year: number, month: number) { return new Date(year, month + 1, 0).getDate(); }
function getFirstDay(year: number, month: number) { return new Date(year, month, 1).getDay(); }

export function PTSchedulePage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());
  const [selectedSession, setSelectedSession] = useState<typeof sessions[0] | null>(null);

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDay(year, month);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1); };

  const daySessions = sessions.filter(s => s.date === selectedDay && s.month === month && s.year === year);
  const sessionDays = new Set(sessions.filter(s => s.month === month && s.year === year).map(s => s.date));

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2"><Calendar className="w-5 h-5 text-green-400" /> My Schedule</h1>
        <p className="text-zinc-500 text-sm mt-0.5">Manage your coaching sessions and availability</p>
      </div>

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
              return (
                <button
                  key={day}
                  onClick={() => setSelectedDay(day)}
                  className={`aspect-square flex flex-col items-center justify-center rounded-xl text-xs transition-all font-medium ${
                    selectedDay === day ? "bg-green-500 text-black shadow-lg shadow-green-500/25" :
                    isToday ? "bg-green-500/15 text-green-400 border border-green-500/30" :
                    "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                  }`}
                >
                  {day}
                  {hasS && (
                    <div className={`w-1.5 h-1.5 rounded-full mt-0.5 ${selectedDay === day ? "bg-black" : "bg-green-500"}`} />
                  )}
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
          {daySessions.length === 0 ? (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-6 text-center">
              <Calendar className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
              <p className="text-sm text-zinc-500">No sessions on this day</p>
            </div>
          ) : (
            daySessions.map(s => (
              <div
                key={s.id}
                onClick={() => setSelectedSession(selectedSession?.id === s.id ? null : s)}
                className={`bg-zinc-900 rounded-xl border-2 p-4 cursor-pointer transition-all ${selectedSession?.id === s.id ? "border-green-500 bg-green-500/5" : "border-zinc-800/60 hover:border-zinc-700"}`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center text-sm font-bold text-green-400">{s.avatar}</div>
                  <div>
                    <div className="text-sm font-bold text-zinc-200">{s.client}</div>
                    <div className="text-xs text-zinc-600">Session #{s.session}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-zinc-500">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {s.time}</span>
                  <span className="flex items-center gap-1"><Video className="w-3 h-3" /> {s.type}</span>
                  <span className={`px-2 py-0.5 rounded-full font-semibold ml-auto border ${s.status === "upcoming" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-green-500/10 text-green-400 border-green-500/20"}`}>
                    {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                  </span>
                </div>
                {selectedSession?.id === s.id && s.status === "upcoming" && (
                  <div className="flex gap-2 mt-3 pt-3 border-t border-zinc-800/60">
                    <button className="flex-1 py-1.5 bg-green-500 hover:bg-green-400 text-black text-xs font-bold rounded-lg transition-all shadow-sm shadow-green-500/20">Join Session</button>
                    <button className="p-1.5 border border-zinc-700/60 text-zinc-400 rounded-lg hover:bg-zinc-800 transition-colors"><Edit3 className="w-3.5 h-3.5" /></button>
                    <button className="p-1.5 border border-red-500/20 text-red-400 rounded-lg hover:bg-red-500/10 transition-colors"><X className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>
            ))
          )}

          {/* All upcoming */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <h4 className="text-xs font-bold text-zinc-600 mb-3 uppercase tracking-wider">All Upcoming</h4>
            <div className="space-y-2">
              {sessions.filter(s => s.status === "upcoming").slice(0, 4).map(s => (
                <div key={s.id} className="flex items-center gap-2">
                  <div className="w-7 h-7 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center text-xs font-bold text-green-400 flex-shrink-0">{s.avatar}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-zinc-300 truncate">{s.client}</div>
                    <div className="text-xs text-zinc-600">{MONTHS[s.month].slice(0,3)} {s.date} · {s.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}