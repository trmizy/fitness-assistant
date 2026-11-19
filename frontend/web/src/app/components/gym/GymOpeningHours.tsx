import { useEffect, useState } from "react";
import { ClockIcon as Clock } from "@phosphor-icons/react";
import { closedDaysLabel, hoursLabel, normalizeHours, openNowStatus, vietnamClock, WEEKDAY_LABEL_VI } from "../../utils/gymHours";

/**
 * Giờ mở cửa trên chi tiết gym công khai (Q8 / N14G-03): huy hiệu "đang mở/đóng" + bảng cả tuần,
 * hôm nay được nhấn, ngày nghỉ làm mờ. Không có dữ liệu → không vẽ gì (không khẳng định "đóng cửa").
 * `suppressNow`: chi nhánh đang tạm đóng thì bỏ huy hiệu (đã có khung "Tạm đóng cửa" phía trên).
 */
export function GymOpeningHours({ hours, suppressNow = false }: { hours: unknown; suppressNow?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const days = normalizeHours(hours);
  if (days.length === 0) return null;

  const status = openNowStatus(days, now);
  const today = vietnamClock(now).day;
  const closedNote = closedDaysLabel(days);

  return (
    <section className="space-y-2" aria-label="Giờ mở cửa" data-testid="gym-opening-hours">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-zinc-200">
          <Clock className="w-4 h-4 text-zinc-500" /> Giờ mở cửa
        </h3>
        {!suppressNow && status.state !== "unknown" && (
          <span
            data-testid="gym-open-now"
            data-state={status.state}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
              status.state === "open"
                ? "border-green-500/30 bg-green-500/10 text-green-400"
                : "border-zinc-700/60 bg-zinc-800/60 text-zinc-400"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${status.state === "open" ? "bg-green-400" : "bg-zinc-500"}`} aria-hidden />
            {status.label}
          </span>
        )}
      </div>
      <ul className="divide-y divide-zinc-800/60 overflow-hidden rounded-xl border border-zinc-800/60 bg-zinc-900/40 text-sm">
        {days.map((d) => {
          const isToday = d.day === today;
          const closed = d.type === "CLOSED";
          return (
            <li
              key={d.day}
              aria-current={isToday ? "date" : undefined}
              className={`flex items-center justify-between gap-3 px-3.5 py-2 ${isToday ? "bg-green-500/5" : ""}`}
            >
              <span className={`flex items-center gap-2 ${isToday ? "font-semibold text-zinc-100" : closed ? "text-zinc-500" : "text-zinc-300"}`}>
                {WEEKDAY_LABEL_VI[d.day]}
                {isToday && <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green-400">Hôm nay</span>}
              </span>
              <span className={`tabular-nums ${closed ? "text-zinc-500" : isToday ? "font-semibold text-zinc-100" : "text-zinc-300"}`}>{hoursLabel(d)}</span>
            </li>
          );
        })}
      </ul>
      {closedNote && <p className="text-[11px] text-zinc-500">{closedNote}</p>}
    </section>
  );
}
