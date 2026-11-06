import { useQuery } from "@tanstack/react-query";
import { CalendarIcon, CircleNotchIcon } from "@phosphor-icons/react";
import { availabilityService } from "../../services/api";
import { groupCurrentPtAvailability } from "../../utils/ptAvailability";

/** Published recurring working hours; dated exceptions and existing bookings belong to the slots view below. */
export function PtWeeklySchedule({ ptUserId }: { ptUserId: string }) {
  const hoursQuery = useQuery({
    queryKey: ["pt-availability", ptUserId],
    queryFn: () => availabilityService.getAvailability(ptUserId),
    enabled: !!ptUserId,
  });
  const days = groupCurrentPtAvailability(hoursQuery.data);
  const workingDays = days.filter((day) => day.ranges.length > 0).length;

  return (
    <section aria-label="Lịch dạy thường lệ" className="rounded-2xl border border-zinc-700/70 bg-zinc-900/70 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-green-500/25 bg-green-500/10 text-green-400">
          <CalendarIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-bold text-zinc-100">Lịch dạy thường lệ</h4>
          <p className="mt-0.5 text-xs leading-5 text-zinc-400">Khung giờ PT thường nhận dạy trong tuần.</p>
        </div>
        {!hoursQuery.isLoading && !hoursQuery.isError && workingDays > 0 && (
          <span className="shrink-0 rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] font-semibold text-zinc-300">
            {workingDays} ngày/tuần
          </span>
        )}
      </div>

      {hoursQuery.isLoading ? (
        <div role="status" className="mt-4 flex items-center gap-2 text-xs text-zinc-400">
          <CircleNotchIcon className="h-4 w-4 animate-spin" /> Đang tải lịch dạy…
        </div>
      ) : hoursQuery.isError ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-amber-300">
          <span>Chưa tải được lịch dạy.</span>
          <button type="button" className="font-semibold underline underline-offset-2" onClick={() => void hoursQuery.refetch()}>Thử lại</button>
        </div>
      ) : workingDays === 0 ? (
        <p className="mt-4 text-sm text-zinc-400">PT chưa công bố lịch dạy thường lệ.</p>
      ) : (
        <div role="list" className="mt-4 overflow-hidden rounded-xl border border-zinc-700/70">
          {days.map((day) => (
            <div role="listitem" key={day.day} className="flex min-h-11 items-center gap-3 border-b border-zinc-700/60 bg-zinc-800/30 px-3 py-2 last:border-b-0">
              <span className={`w-16 shrink-0 text-xs font-semibold ${day.ranges.length ? "text-zinc-100" : "text-zinc-500"}`}>{day.label}</span>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {day.ranges.length ? day.ranges.map((range, index) => (
                  <span key={`${range.startTime}-${range.endTime}-${index}`} className="rounded-lg border border-green-500/20 bg-green-500/10 px-2 py-1 text-xs font-semibold tabular-nums text-green-300">
                    {range.startTime}–{range.endTime}
                  </span>
                )) : <span className="text-xs text-zinc-500">Nghỉ</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] leading-4 text-zinc-400">Khoảng giữa các ca là giờ nghỉ. Ngày nghỉ riêng và buổi đã đặt có thể làm thay đổi giờ trống; xem giờ có thể đặt bên dưới.</p>
    </section>
  );
}
