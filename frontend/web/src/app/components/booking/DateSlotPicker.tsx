import { useState } from "react";
import {
  CaretLeftIcon as ChevronLeft,
  CaretRightIcon as ChevronRight,
  ClockIcon as Clock,
  CircleNotchIcon as Loader2,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { availabilityService } from "../../services/api";

/**
 * Month calendar + available-slot grid, shared by fresh booking (BookingPage.tsx) and
 * rescheduling (both BookingPage.tsx's own reschedule modal and PTSchedulePage.tsx's).
 *
 * Reuses GET /availability/:ptUserId/slots?date=... as-is — that endpoint already excludes
 * any time the PT has another CONFIRMED/REQUESTED session (session.repository.ts's
 * findConflictsByDate), so picking a slot here is already conflict-free by construction; the
 * server-side assertSlotBookable check on submit is defense against a stale/racing pick, not
 * the primary guard. A day the PT hasn't published any weekly hours for simply returns an
 * empty slot list — shown here as "PT chưa mở lịch rảnh ngày này" rather than a bare "no
 * slots", so a PT proposing their own reschedule understands WHY before re-picking.
 */

const DAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const MONTHS = [
  "Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6",
  "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12",
];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDay(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}
function pad(n: number) {
  return String(n).padStart(2, "0");
}

export interface DateSlotValue {
  dateStr: string; // YYYY-MM-DD
  slot: string; // HH:mm
}

export function DateSlotPicker({
  ptUserId,
  value,
  onChange,
  minDate,
  maxDate,
}: {
  ptUserId: string;
  value: DateSlotValue | null;
  onChange: (value: DateSlotValue) => void;
  /** Earliest selectable date (defaults to today) — e.g. "now" for a fresh booking, or left
   *  as today for a reschedule (the ≥12h-before-start rule is enforced server-side on the
   *  session being moved, not on the calendar itself, since it depends on the OLD time). */
  minDate?: Date;
  /** Latest selectable date, e.g. the contract's own end date. */
  maxDate?: Date;
}) {
  const today = new Date();
  const floor = minDate ?? today;
  const [year, setYear] = useState(floor.getFullYear());
  const [month, setMonth] = useState(floor.getMonth());

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDay(year, month);

  const prevMonth = () => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  };

  const selectedDay = value && Number(value.dateStr.slice(8, 10));
  const selectedInThisMonth =
    value && Number(value.dateStr.slice(0, 4)) === year && Number(value.dateStr.slice(5, 7)) - 1 === month;

  const { data: availableSlots, isLoading: loadingSlots } = useQuery({
    queryKey: ["available-slots", ptUserId, value?.dateStr],
    queryFn: () => availabilityService.getAvailableSlots(ptUserId, value!.dateStr),
    enabled: !!ptUserId && !!value?.dateStr,
  });
  const slots: string[] = (availableSlots as string[]) ?? [];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {/* Calendar */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={prevMonth}
            className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h3 className="text-sm font-bold text-zinc-200">{MONTHS[month]} {year}</h3>
          <button
            type="button"
            onClick={nextMonth}
            className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 mb-2 border-b border-zinc-800/60 pb-2">
          {DAYS.map((d) => (
            <div key={d} className="text-center text-[10px] text-zinc-600 uppercase font-bold">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstDay }).map((_, i) => <div key={`e-${i}`} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dateObj = new Date(year, month, day);
            const floorDay = new Date(floor.getFullYear(), floor.getMonth(), floor.getDate());
            const isBeforeMin = dateObj < floorDay;
            const isAfterMax = !!maxDate && dateObj > maxDate;
            const disabled = isBeforeMin || isAfterMax;
            const isSelected = !!selectedInThisMonth && selectedDay === day;
            return (
              <button
                type="button"
                key={day}
                disabled={disabled}
                onClick={() => onChange({ dateStr: `${year}-${pad(month + 1)}-${pad(day)}`, slot: "" })}
                className={`aspect-square flex items-center justify-center rounded-xl text-xs font-medium transition-all ${
                  isSelected
                    ? "bg-green-500 text-black shadow-lg shadow-green-500/25"
                    : disabled
                      ? "text-zinc-700 cursor-not-allowed"
                      : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                }`}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>

      {/* Slots */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
        {!value?.dateStr ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-6">
            <Clock className="w-8 h-8 text-zinc-700 mb-2" />
            <p className="text-sm text-zinc-500">Chọn một ngày để xem khung giờ trống</p>
          </div>
        ) : loadingSlots ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
          </div>
        ) : slots.length === 0 ? (
          <div className="text-center py-6">
            <Clock className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
            <p className="text-sm text-zinc-500">PT chưa mở lịch rảnh ngày này</p>
            <p className="text-xs text-zinc-600 mt-1">
              hoặc đã kín lịch — hãy chọn ngày khác, hoặc mở thêm khung giờ rảnh trong Lịch dạy trước.
            </p>
          </div>
        ) : (
          <>
            <h4 className="text-sm font-bold text-zinc-200 mb-3">Khung giờ trống</h4>
            <div className="grid grid-cols-3 gap-2">
              {slots.map((slot) => (
                <button
                  type="button"
                  key={slot}
                  onClick={() => onChange({ dateStr: value.dateStr, slot })}
                  className={`flex items-center justify-center gap-1.5 px-2 py-2.5 border-2 rounded-xl text-sm font-medium transition-all ${
                    value.slot === slot
                      ? "border-green-500 bg-green-500/10 text-green-400"
                      : "border-zinc-700/60 hover:border-green-500/50 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Clock className="w-3 h-3" />
                  {slot}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
