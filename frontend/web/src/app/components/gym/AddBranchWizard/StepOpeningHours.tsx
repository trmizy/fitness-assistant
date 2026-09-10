import { cn } from "../../ui/utils";
import type { DayScheduleType, GymOperatingHoursDay, WeekDay } from "../../../types";

const DAY_LABELS: Record<WeekDay, string> = {
  MONDAY: "Thứ 2",
  TUESDAY: "Thứ 3",
  WEDNESDAY: "Thứ 4",
  THURSDAY: "Thứ 5",
  FRIDAY: "Thứ 6",
  SATURDAY: "Thứ 7",
  SUNDAY: "Chủ nhật",
};
const WEEKDAYS: WeekDay[] = ["TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
const ALL_DAYS: WeekDay[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

const TYPE_OPTIONS: { value: DayScheduleType; label: string }[] = [
  { value: "CLOSED", label: "Đóng cửa" },
  { value: "OPEN", label: "Mở cửa" },
  { value: "ALL_DAY", label: "Mở 24 giờ" },
];

function minutesToTime(m: number | null): string {
  if (m == null) return "";
  const h = Math.floor(m / 60)
    .toString()
    .padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}
function timeToMinutes(t: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(t);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** GYM_BRANCH_FORM_SPEC.md, Phase 2 — Step 3 "Opening Hours". §20: single interval per day
 * only (no split hours — the backend never supported it, not faking it here). Quick actions
 * copy Monday's schedule across the week to cut down on repetitive taps. */
export function StepOpeningHours({
  value,
  onChange,
}: {
  value: GymOperatingHoursDay[];
  onChange: (next: GymOperatingHoursDay[]) => void;
}) {
  const byDay = new Map(value.map((d) => [d.day, d]));

  function updateDay(day: WeekDay, patch: Partial<GymOperatingHoursDay>) {
    onChange(value.map((d) => (d.day === day ? { ...d, ...patch } : d)));
  }

  function applyMondayTo(days: WeekDay[]) {
    const monday = byDay.get("MONDAY");
    if (!monday) return;
    onChange(value.map((d) => (days.includes(d.day) ? { ...d, type: monday.type, openMinute: monday.openMinute, closeMinute: monday.closeMinute } : d)));
  }

  const hasAnyOpenDay = value.some((d) => d.type === "OPEN" || d.type === "ALL_DAY");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">Giờ hoạt động</h1>
        <p className="text-sm text-zinc-500 mt-1">Đặt giờ mở/đóng cửa cho từng ngày trong tuần. Mỗi ngày chỉ một khung giờ liên tục.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => applyMondayTo(WEEKDAYS)}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          Áp dụng giờ Thứ 2 cho Thứ 3 → Thứ 6
        </button>
        <button
          type="button"
          onClick={() => applyMondayTo(ALL_DAYS.filter((d) => d !== "MONDAY"))}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          Áp dụng giờ Thứ 2 cho tất cả các ngày
        </button>
      </div>

      <div className="space-y-2">
        {ALL_DAYS.map((day) => {
          const row = byDay.get(day);
          if (!row) return null;
          return (
            <div key={day} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 sm:flex sm:items-center sm:gap-4">
              <p className="text-sm font-semibold text-zinc-200 w-24 shrink-0 mb-2 sm:mb-0">{DAY_LABELS[day]}</p>

              <div className="flex gap-1 mb-2 sm:mb-0 shrink-0">
                {TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      updateDay(day, {
                        type: opt.value,
                        openMinute: opt.value === "OPEN" ? (row.openMinute ?? 360) : null,
                        closeMinute: opt.value === "OPEN" ? (row.closeMinute ?? 1320) : null,
                      })
                    }
                    className={cn(
                      "text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors",
                      row.type === opt.value ? "bg-primary/10 border-primary/40 text-primary" : "border-zinc-700 text-zinc-500 hover:bg-zinc-800",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {row.type === "OPEN" && (
                <div className="flex items-center gap-2">
                  <input
                    aria-label={`${DAY_LABELS[day]} — giờ mở cửa`}
                    type="time"
                    value={minutesToTime(row.openMinute)}
                    onChange={(e) => updateDay(day, { openMinute: timeToMinutes(e.target.value) })}
                    className="px-2.5 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                  />
                  <span className="text-zinc-600 text-xs">đến</span>
                  <input
                    aria-label={`${DAY_LABELS[day]} — giờ đóng cửa`}
                    type="time"
                    value={minutesToTime(row.closeMinute)}
                    onChange={(e) => updateDay(day, { closeMinute: timeToMinutes(e.target.value) })}
                    className="px-2.5 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                  />
                  {row.openMinute != null && row.closeMinute != null && row.openMinute >= row.closeMinute && (
                    <span className="text-[11px] text-red-400">Giờ mở phải trước giờ đóng</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!hasAnyOpenDay && <p className="text-xs text-amber-400">Cần ít nhất một ngày mở cửa (hoặc mở 24 giờ) trước khi gửi duyệt.</p>}
    </div>
  );
}

export function validateOpeningHours(value: GymOperatingHoursDay[]): string[] {
  const issues: string[] = [];
  for (const row of value) {
    if (row.type === "OPEN") {
      if (row.openMinute == null || row.closeMinute == null) {
        issues.push(`${DAY_LABELS[row.day]}: cần đủ giờ mở và giờ đóng cửa`);
      } else if (row.openMinute >= row.closeMinute) {
        issues.push(`${DAY_LABELS[row.day]}: giờ mở cửa phải trước giờ đóng cửa`);
      }
    }
  }
  if (!value.some((d) => d.type === "OPEN" || d.type === "ALL_DAY")) {
    issues.push("Cần ít nhất một ngày mở cửa (hoặc mở 24 giờ)");
  }
  return issues;
}
