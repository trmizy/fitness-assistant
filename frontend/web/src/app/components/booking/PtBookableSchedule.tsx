import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CircleNotchIcon,
  ClockIcon,
} from "@phosphor-icons/react";
import { availabilityService } from "../../services/api";

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function mondayOf(date: Date): Date {
  return addDays(date, -((date.getDay() + 6) % 7));
}

/** Read-only, anonymous openings from the same endpoint the booking flow uses. */
export function PtBookableSchedule({ ptUserId }: { ptUserId: string }) {
  const [today] = useState(() => new Date());
  const [weekOffset, setWeekOffset] = useState(() => mondayOf(addDays(new Date(), 1)).getTime() > mondayOf(new Date()).getTime() ? 1 : 0);
  const [selected, setSelected] = useState(() => dateKey(addDays(new Date(), 1)));
  const weekStart = addDays(mondayOf(today), weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const slotsQuery = useQuery({
    queryKey: ["pt-bookable-slots", ptUserId, selected],
    queryFn: () => availabilityService.getBookableSlots(ptUserId, selected),
    enabled: !!ptUserId,
    staleTime: 0,
  });
  const slots = Array.isArray(slotsQuery.data) ? slotsQuery.data.filter((slot): slot is string => typeof slot === "string") : [];

  const changeWeek = (direction: -1 | 1) => {
    const nextOffset = Math.max(0, weekOffset + direction);
    if (nextOffset === weekOffset) return;
    setWeekOffset(nextOffset);
    setSelected(nextOffset === 0 ? dateKey(today) : dateKey(addDays(mondayOf(today), nextOffset * 7)));
  };

  return (
    <section aria-label="Giờ trống có thể đặt" className="rounded-2xl border border-green-500/20 bg-gradient-to-br from-zinc-800/80 to-zinc-900 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-green-500/25 bg-green-500/10 text-green-400">
          <CalendarIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-bold text-zinc-100">Giờ trống có thể đặt</h4>
          <p className="mt-0.5 text-xs leading-5 text-zinc-400">Chọn ngày để xem các giờ PT còn nhận lịch.</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-1">
        <button type="button" aria-label="Tuần trước" disabled={weekOffset === 0} onClick={() => changeWeek(-1)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-300 hover:bg-zinc-700/60 disabled:cursor-not-allowed disabled:opacity-35">
          <CaretLeftIcon className="h-4 w-4" />
        </button>
        <p className="min-w-0 flex-1 text-center text-xs font-semibold text-zinc-300">
          {days[0].toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })} – {days[6].toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}
        </p>
        <button type="button" aria-label="Tuần sau" onClick={() => changeWeek(1)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-300 hover:bg-zinc-700/60">
          <CaretRightIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1" role="group" aria-label="Chọn ngày xem giờ trống">
        {days.map((day) => {
          const key = dateKey(day);
          const past = key < dateKey(today);
          const active = key === selected;
          return (
            <button key={key} type="button" disabled={past} aria-pressed={active} aria-label={day.toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "long" })} onClick={() => setSelected(key)} className={`flex min-h-12 min-w-0 flex-col items-center justify-center rounded-xl border px-0.5 text-center transition-colors ${active ? "border-green-500 bg-green-500 text-black" : past ? "border-transparent text-zinc-600" : "border-zinc-700/60 bg-zinc-900/50 text-zinc-300 hover:border-green-500/40"}`}>
              <span className="text-[10px] font-semibold">{day.toLocaleDateString("vi-VN", { weekday: "short" })}</span>
              <span className="text-sm font-bold">{day.getDate()}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 min-h-16 border-t border-zinc-700/50 pt-3" aria-live="polite">
        {slotsQuery.isLoading || slotsQuery.isFetching ? (
          <div className="flex items-center gap-2 text-xs text-zinc-400"><CircleNotchIcon className="h-4 w-4 animate-spin" /> Đang kiểm tra giờ trống…</div>
        ) : slotsQuery.isError ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-amber-300">
            <span>Chưa tải được giờ trống.</span>
            <button type="button" className="font-semibold underline underline-offset-2" onClick={() => void slotsQuery.refetch()}>Thử lại</button>
          </div>
        ) : slots.length === 0 ? (
          <p className="text-sm text-zinc-400">Ngày này chưa có giờ trống. Hãy chọn ngày khác.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {slots.map((slot) => (
              <span key={slot} className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-green-500/25 bg-green-500/10 px-3 text-sm font-semibold text-green-300">
                <ClockIcon className="h-3.5 w-3.5" /> {slot}
              </span>
            ))}
          </div>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-4 text-zinc-500">Buổi tập cần đặt trước ít nhất 24 giờ. Giờ trống có thể thay đổi; hệ thống sẽ kiểm tra lại khi đặt buổi.</p>
    </section>
  );
}
