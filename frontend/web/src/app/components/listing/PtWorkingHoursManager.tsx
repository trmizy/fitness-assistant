import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { availabilityService } from "../../services/api";
import { groupCurrentPtAvailability, PT_WEEKDAYS, type PtTimeRange, type PtWeekday } from "../../utils/ptAvailability";
import { Button } from "../ui/button";

type Week = Record<PtWeekday, PtTimeRange[]>;
type Exception = { id: string; date: string; reason?: string | null };

const emptyWeek = (): Week => ({ MONDAY: [], TUESDAY: [], WEDNESDAY: [], THURSDAY: [], FRIDAY: [], SATURDAY: [], SUNDAY: [] });
const dateKey = (value: string) => {
  if (!value.includes("T")) return value.slice(0, 10);
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
function splitForBreak(range: PtTimeRange): PtTimeRange[] | null {
  if (!timePattern.test(range.startTime) || !timePattern.test(range.endTime)) return null;
  const start = minutes(range.startTime);
  const end = minutes(range.endTime);
  if (end - start < 120) return null;
  const breakStart = Math.floor((start + end - 60) / 2);
  return [{ startTime: range.startTime, endTime: clock(breakStart) }, { startTime: clock(breakStart + 60), endTime: range.endTime }];
}
function breaksOf(ranges: PtTimeRange[]) {
  const sorted = [...ranges].sort((a, b) => a.startTime.localeCompare(b.startTime));
  return sorted.slice(1).map((range, index) => ({ start: sorted[index].endTime, end: range.startTime })).filter((gap) => gap.start < gap.end);
}
function nextRange(ranges: PtTimeRange[]): PtTimeRange | null {
  const lastEnd = Math.max(...ranges.map((range) => minutes(range.endTime)));
  const start = Math.max(lastEnd + 30, 18 * 60);
  const end = Math.min(start + 180, 23 * 60 + 59);
  return start < end ? { startTime: clock(start), endTime: clock(end) } : null;
}

function validateWeek(week: Week): string | null {
  for (const { key, label } of PT_WEEKDAYS) {
    const ranges = [...week[key]].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let index = 0; index < ranges.length; index += 1) {
      const range = ranges[index];
      if (!timePattern.test(range.startTime) || !timePattern.test(range.endTime) || range.startTime >= range.endTime) return `${label}: giờ bắt đầu phải trước giờ kết thúc.`;
      if (index > 0 && ranges[index - 1].endTime > range.startTime) return `${label}: các khung giờ không được chồng lên nhau.`;
    }
  }
  return null;
}

/** Edits future booking availability only. Existing sessions are never changed by this screen. */
export function PtWorkingHoursManager({ ptUserId, onDirtyChange }: { ptUserId: string; onDirtyChange?: (dirty: boolean) => void }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<PtWeekday>("MONDAY");
  const [week, setWeek] = useState<Week>(emptyWeek);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dateOff, setDateOff] = useState("");
  const [reason, setReason] = useState("");
  const [dateBusy, setDateBusy] = useState(false);
  const hoursQuery = useQuery({ queryKey: ["pt-availability", ptUserId], queryFn: () => availabilityService.getAvailability("me"), enabled: !!ptUserId });
  const daysOffQuery = useQuery({ queryKey: ["pt-planning-exceptions", ptUserId], queryFn: () => availabilityService.getExceptions(), enabled: !!ptUserId });

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!hoursQuery.data || dirty) return;
    const next = emptyWeek();
    for (const { day, ranges } of groupCurrentPtAvailability(hoursQuery.data)) next[day] = ranges;
    setWeek(next);
  }, [hoursQuery.data, dirty]);

  const updateDay = (day: PtWeekday, ranges: PtTimeRange[]) => {
    setWeek((current) => ({ ...current, [day]: ranges }));
    setDirty(true);
  };
  const saveHours = async () => {
    const problem = validateWeek(week);
    if (problem) return toast.error(problem);
    setSaving(true);
    try {
      const slots = PT_WEEKDAYS.flatMap(({ key }) => week[key].map((range) => ({ dayOfWeek: key, ...range })));
      await availabilityService.setAvailability(slots);
      await queryClient.invalidateQueries({ queryKey: ["pt-availability", ptUserId] });
      setDirty(false);
      toast.success("Đã cập nhật giờ làm việc cho lượt đặt mới. Buổi đã đặt giữ nguyên.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được giờ làm việc.");
    } finally {
      setSaving(false);
    }
  };
  const addDayOff = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOff) || dateOff < dateKey(new Date().toISOString())) return toast.error("Chọn ngày nghỉ từ hôm nay trở đi.");
    setDateBusy(true);
    try {
      await availabilityService.addPlanningException(dateOff, reason.trim() || undefined);
      await queryClient.invalidateQueries({ queryKey: ["pt-planning-exceptions", ptUserId] });
      setDateOff("");
      setReason("");
      toast.success("Đã đóng lịch nhận đặt mới trong ngày này. Buổi đã đặt giữ nguyên.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thêm được ngày nghỉ.");
    } finally {
      setDateBusy(false);
    }
  };
  const removeDayOff = async (id: string) => {
    setDateBusy(true);
    try {
      await availabilityService.removeException(id);
      await queryClient.invalidateQueries({ queryKey: ["pt-planning-exceptions", ptUserId] });
      toast.success("Đã mở lại lịch nhận đặt mới cho ngày này.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không mở lại được ngày này.");
    } finally {
      setDateBusy(false);
    }
  };

  return (
    <section aria-label="Quản lý lịch làm việc" className="space-y-4 rounded-2xl border border-green-500/20 bg-zinc-900 p-4 md:p-5">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-green-500/10 text-green-400"><CalendarIcon className="size-5" /></div>
        <div>
          <h2 className="font-bold text-zinc-100">Lịch làm việc</h2>
          <p className="mt-1 text-sm leading-5 text-zinc-400">Chỉnh giờ nhận lịch, khoảng nghỉ giữa ca và ngày nghỉ. Áp dụng ngay cho lượt đặt mới, không cần duyệt. Buổi đã đặt không thay đổi.</p>
        </div>
      </div>
      {hoursQuery.isLoading ? <p className="text-sm text-zinc-400">Đang tải lịch làm việc…</p> : hoursQuery.isError ? <button type="button" onClick={() => void hoursQuery.refetch()} className="text-sm text-amber-300 underline">Không tải được lịch. Thử lại</button> : (
        <>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7" role="group" aria-label="Chọn thứ trong tuần">
            {PT_WEEKDAYS.map(({ key, short, label }) => <button key={key} type="button" aria-pressed={selected === key} aria-label={label} onClick={() => setSelected(key)} className={`min-h-16 rounded-xl border px-1 text-center transition-colors ${selected === key ? "border-green-400 bg-green-500/10 text-green-300" : "border-zinc-700 text-zinc-300 hover:border-zinc-500"}`}><span className="block text-xs font-bold">{short}</span><span className="mt-1 block text-[11px]">{week[key].length ? `${week[key].length} khung` : "Nghỉ"}</span></button>)}
          </div>
          <div className="space-y-3 rounded-xl border border-zinc-700/70 bg-zinc-950/50 p-3">
            <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-zinc-100">{PT_WEEKDAYS.find((d) => d.key === selected)?.label}</h3><label className="flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" checked={week[selected].length > 0} onChange={(event) => updateDay(selected, event.target.checked ? [{ startTime: "08:00", endTime: "17:00" }] : [])} /> Nhận lịch</label></div>
            {week[selected].length === 0 ? <p className="text-xs text-zinc-500">Ngày nghỉ hằng tuần — không mở lượt đặt mới.</p> : week[selected].map((range, index) => <div key={`${selected}-${index}`} className="flex flex-wrap items-end gap-2"><label className="text-xs text-zinc-400">Từ<input type="time" value={range.startTime} onChange={(event) => updateDay(selected, week[selected].map((item, i) => i === index ? { ...item, startTime: event.target.value } : item))} className="mt-1 block h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100" /></label><label className="text-xs text-zinc-400">Đến<input type="time" value={range.endTime} onChange={(event) => updateDay(selected, week[selected].map((item, i) => i === index ? { ...item, endTime: event.target.value } : item))} className="mt-1 block h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100" /></label><button type="button" aria-label={`Xóa khung giờ ${index + 1}`} onClick={() => updateDay(selected, week[selected].filter((_, i) => i !== index))} className="flex size-10 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-red-300"><TrashIcon className="size-4" /></button></div>)}
            {week[selected].length > 0 && <><div className="flex flex-wrap gap-4"><button type="button" onClick={() => { const next = nextRange(week[selected]); if (!next) toast.error("Không còn đủ giờ để thêm ca trong ngày này."); else updateDay(selected, [...week[selected], next]); }} className="inline-flex min-h-10 items-center gap-1 text-xs font-semibold text-green-300"><PlusIcon className="size-4" /> Thêm ca sau giờ nghỉ</button>{week[selected].length === 1 && <button type="button" onClick={() => { const split = splitForBreak(week[selected][0]); if (!split) toast.error("Khung giờ cần dài ít nhất 2 tiếng để tạo giờ nghỉ giữa ca."); else updateDay(selected, split); }} className="min-h-10 text-xs font-semibold text-green-300">Tạo breaktime 1 giờ</button>}</div>{breaksOf(week[selected]).map((gap, index) => <p key={index} className="text-xs font-semibold text-amber-200">Nghỉ giữa ca: {gap.start}–{gap.end}</p>)}<p className="text-xs text-zinc-500">Khoảng trống giữa hai khung là breaktime; Client sẽ không thấy giờ có thể đặt trong khoảng đó.</p></>}
          </div>
          <Button size="sm" disabled={!dirty || saving} onClick={() => void saveHours()}>{saving ? "Đang lưu…" : "Lưu lịch làm việc"}</Button>
        </>
      )}
      <div className="space-y-3 border-t border-zinc-700/70 pt-4">
        <h3 className="text-sm font-semibold text-zinc-100">Ngày nghỉ riêng</h3>
        <p className="text-xs text-zinc-400">Đóng nhận đặt mới cho một ngày, kể cả khi ngày đó thường làm việc. Lịch hẹn hiện có vẫn giữ nguyên.</p>
        <div className="flex flex-wrap items-end gap-2"><label className="text-xs text-zinc-400">Ngày<input type="date" min={dateKey(new Date().toISOString())} value={dateOff} onChange={(event) => setDateOff(event.target.value)} className="mt-1 block h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100" /></label><label className="min-w-40 flex-1 text-xs text-zinc-400">Ghi chú (tùy chọn)<input value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="Ví dụ: nghỉ phép" className="mt-1 block h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100" /></label><Button size="sm" disabled={!dateOff || dateBusy} onClick={() => void addDayOff()}>Thêm ngày nghỉ</Button></div>
        {daysOffQuery.isLoading ? <p className="text-xs text-zinc-500">Đang tải ngày nghỉ…</p> : daysOffQuery.isError ? <button type="button" onClick={() => void daysOffQuery.refetch()} className="text-xs text-amber-300 underline">Không tải được ngày nghỉ. Thử lại</button> : <div className="flex flex-wrap gap-2">{(Array.isArray(daysOffQuery.data) ? daysOffQuery.data as Exception[] : []).filter((item) => dateKey(item.date) >= dateKey(new Date().toISOString())).map((item) => <div key={item.id} className="flex min-h-9 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/60 px-2 text-xs text-zinc-300"><span>{new Date(item.date).toLocaleDateString("vi-VN")}{item.reason ? ` · ${item.reason}` : ""}</span><button type="button" aria-label={`Mở lại ngày ${dateKey(item.date)}`} disabled={dateBusy} onClick={() => void removeDayOff(item.id)} className="font-semibold text-green-300 underline underline-offset-2">Mở lại</button></div>)}</div>}
      </div>
    </section>
  );
}
