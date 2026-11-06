import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Plus, Trash2 } from "lucide-react-native";

import { Button, Card, Input, Tappable, useToast } from "../../components/ui";
import { availabilityService } from "../../services/api";
import { useWorkspaceAccent } from "../../theme/workspace";

const DAYS = [
  { key: "MONDAY", label: "Thứ 2", short: "T2" },
  { key: "TUESDAY", label: "Thứ 3", short: "T3" },
  { key: "WEDNESDAY", label: "Thứ 4", short: "T4" },
  { key: "THURSDAY", label: "Thứ 5", short: "T5" },
  { key: "FRIDAY", label: "Thứ 6", short: "T6" },
  { key: "SATURDAY", label: "Thứ 7", short: "T7" },
  { key: "SUNDAY", label: "Chủ nhật", short: "CN" },
] as const;
type Day = (typeof DAYS)[number]["key"];
type Range = { startTime: string; endTime: string };
type Week = Record<Day, Range[]>;
type Exception = { id: string; date: string; reason?: string | null };
const emptyWeek = (): Week => ({ MONDAY: [], TUESDAY: [], WEDNESDAY: [], THURSDAY: [], FRIDAY: [], SATURDAY: [], SUNDAY: [] });
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
function splitForBreak(range: Range): Range[] | null {
  if (!timePattern.test(range.startTime) || !timePattern.test(range.endTime)) return null;
  const start = minutes(range.startTime);
  const end = minutes(range.endTime);
  if (end - start < 120) return null;
  const breakStart = Math.floor((start + end - 60) / 2);
  return [{ startTime: range.startTime, endTime: clock(breakStart) }, { startTime: clock(breakStart + 60), endTime: range.endTime }];
}
function breaksOf(ranges: Range[]) {
  const sorted = [...ranges].sort((a, b) => a.startTime.localeCompare(b.startTime));
  return sorted.slice(1).map((range, index) => ({ start: sorted[index].endTime, end: range.startTime })).filter((gap) => gap.start < gap.end);
}
function nextRange(ranges: Range[]): Range | null {
  const lastEnd = Math.max(...ranges.map((range) => minutes(range.endTime)));
  const start = Math.max(lastEnd + 30, 18 * 60);
  const end = Math.min(start + 180, 23 * 60 + 59);
  return start < end ? { startTime: clock(start), endTime: clock(end) } : null;
}
const dateKey = (value: string) => {
  if (!value.includes("T")) return value.slice(0, 10);
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export function PtWorkingHoursManager({ ptUserId, onDirtyChange }: { ptUserId: string; onDirtyChange?: (dirty: boolean) => void }) {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Day>("MONDAY");
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
    if (Array.isArray(hoursQuery.data)) {
      for (const row of hoursQuery.data) {
        if (!row || row.isActive === false || !DAYS.some((day) => day.key === row.dayOfWeek)) continue;
        const range = { startTime: String(row.startTime ?? ""), endTime: String(row.endTime ?? "") };
        if (timePattern.test(range.startTime) && timePattern.test(range.endTime) && range.startTime < range.endTime) next[row.dayOfWeek as Day].push(range);
      }
    }
    for (const day of DAYS) next[day.key].sort((a, b) => a.startTime.localeCompare(b.startTime));
    setWeek(next);
  }, [hoursQuery.data, dirty]);

  const updateDay = (day: Day, ranges: Range[]) => { setWeek((current) => ({ ...current, [day]: ranges })); setDirty(true); };
  const saveHours = async () => {
    for (const { key, label } of DAYS) {
      const ranges = [...week[key]].sort((a, b) => a.startTime.localeCompare(b.startTime));
      for (let i = 0; i < ranges.length; i += 1) {
        if (!timePattern.test(ranges[i].startTime) || !timePattern.test(ranges[i].endTime) || ranges[i].startTime >= ranges[i].endTime) return toast.show(`${label}: giờ bắt đầu phải trước giờ kết thúc.`, "danger");
        if (i > 0 && ranges[i - 1].endTime > ranges[i].startTime) return toast.show(`${label}: các khung giờ không được chồng lên nhau.`, "danger");
      }
    }
    setSaving(true);
    try {
      await availabilityService.setAvailability(DAYS.flatMap(({ key }) => week[key].map((range) => ({ dayOfWeek: key, ...range }))));
      await queryClient.invalidateQueries({ queryKey: ["pt-availability", ptUserId] });
      setDirty(false);
      toast.show("Đã lưu lịch cho lượt đặt mới. Buổi đã đặt giữ nguyên.", "success");
    } catch (error) {
      toast.show(error instanceof Error ? error.message : "Không lưu được lịch làm việc.", "danger");
    } finally { setSaving(false); }
  };
  const addDayOff = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOff) || dateOff < dateKey(new Date().toISOString())) return toast.show("Nhập ngày từ hôm nay trở đi theo dạng YYYY-MM-DD.", "danger");
    setDateBusy(true);
    try {
      await availabilityService.addPlanningException(dateOff, reason.trim() || undefined);
      await queryClient.invalidateQueries({ queryKey: ["pt-planning-exceptions", ptUserId] });
      setDateOff(""); setReason("");
      toast.show("Đã đóng lịch nhận đặt mới. Buổi đã đặt giữ nguyên.", "success");
    } catch (error) { toast.show(error instanceof Error ? error.message : "Không thêm được ngày nghỉ.", "danger"); }
    finally { setDateBusy(false); }
  };
  const removeDayOff = async (id: string) => {
    setDateBusy(true);
    try {
      await availabilityService.removeException(id);
      await queryClient.invalidateQueries({ queryKey: ["pt-planning-exceptions", ptUserId] });
      toast.show("Đã mở lại lịch nhận đặt mới.", "success");
    } catch (error) { toast.show(error instanceof Error ? error.message : "Không mở lại được ngày này.", "danger"); }
    finally { setDateBusy(false); }
  };

  return (
    <Card className="gap-4 border-primary/20 p-4">
      <View className="flex-row items-start gap-3"><View className="h-9 w-9 items-center justify-center rounded-xl bg-primary/10"><CalendarDays size={18} color={accent.primary} /></View><View className="min-w-0 flex-1"><Text className="font-body-semibold text-base text-foreground">Lịch làm việc</Text><Text className="mt-1 font-body text-xs leading-5 text-muted-foreground">Giờ nhận lịch, breaktime và ngày nghỉ áp dụng ngay cho lượt đặt mới, không cần duyệt. Buổi đã đặt giữ nguyên.</Text></View></View>
      {hoursQuery.isLoading ? <ActivityIndicator color={accent.primary} /> : hoursQuery.isError ? <Button size="sm" variant="secondary" onPress={() => void hoursQuery.refetch()}>Thử tải lịch lại</Button> : <>
        <View className="flex-row flex-wrap gap-2">{DAYS.map(({ key, short, label }) => <Tappable key={key} accessibilityLabel={label} onPress={() => setSelected(key)} className={`min-h-14 min-w-14 items-center justify-center rounded-xl border px-2 ${selected === key ? "border-primary bg-primary/10" : "border-border bg-panel"}`}><Text className={`font-body-semibold text-xs ${selected === key ? "text-primary" : "text-foreground"}`}>{short}</Text><Text className="font-body text-[10px] text-muted-foreground">{week[key].length ? `${week[key].length} khung` : "Nghỉ"}</Text></Tappable>)}</View>
        <View className="gap-3 rounded-xl border border-border bg-panel p-3"><View className="flex-row items-center justify-between"><Text className="font-body-semibold text-sm text-foreground">{DAYS.find((day) => day.key === selected)?.label}</Text><Tappable onPress={() => updateDay(selected, week[selected].length ? [] : [{ startTime: "08:00", endTime: "17:00" }])} className="min-h-10 justify-center rounded-lg px-2"><Text className="font-body-semibold text-xs text-primary">{week[selected].length ? "Đặt ngày nghỉ" : "Bật nhận lịch"}</Text></Tappable></View>
          {week[selected].length === 0 ? <Text className="font-body text-xs text-muted-foreground">Ngày nghỉ hằng tuần — không mở lượt đặt mới.</Text> : week[selected].map((range, index) => <View key={`${selected}-${index}`} className="flex-row items-end gap-2"><Input label="Từ" value={range.startTime} onChangeText={(value) => updateDay(selected, week[selected].map((item, i) => i === index ? { ...item, startTime: value } : item))} keyboardType="numbers-and-punctuation" maxLength={5} className="min-w-0 flex-1" /><Input label="Đến" value={range.endTime} onChangeText={(value) => updateDay(selected, week[selected].map((item, i) => i === index ? { ...item, endTime: value } : item))} keyboardType="numbers-and-punctuation" maxLength={5} className="min-w-0 flex-1" /><Tappable accessibilityLabel={`Xóa khung giờ ${index + 1}`} onPress={() => updateDay(selected, week[selected].filter((_, i) => i !== index))} className="h-12 w-10 items-center justify-center"><Trash2 size={18} color={accent.primary} /></Tappable></View>)}
          {week[selected].length > 0 ? <><Tappable onPress={() => { const next = nextRange(week[selected]); if (!next) toast.show("Không còn đủ giờ để thêm ca trong ngày này.", "danger"); else updateDay(selected, [...week[selected], next]); }} className="min-h-10 flex-row items-center gap-2"><Plus size={16} color={accent.primary} /><Text className="font-body-semibold text-xs text-primary">Thêm ca sau giờ nghỉ</Text></Tappable>{week[selected].length === 1 ? <Tappable onPress={() => { const split = splitForBreak(week[selected][0]); if (!split) toast.show("Khung giờ cần dài ít nhất 2 tiếng để tạo giờ nghỉ giữa ca.", "danger"); else updateDay(selected, split); }} className="min-h-10 justify-center"><Text className="font-body-semibold text-xs text-primary">Tạo breaktime 1 giờ</Text></Tappable> : null}{breaksOf(week[selected]).map((gap, index) => <Text key={index} className="font-body-semibold text-xs text-primary">Nghỉ giữa ca: {gap.start}–{gap.end}</Text>)}<Text className="font-body text-xs leading-5 text-muted-foreground">Khoảng trống giữa hai khung là breaktime; Client không thấy giờ đặt trong khoảng đó.</Text></> : null}
        </View>
        <Button size="sm" disabled={!dirty || saving} onPress={() => void saveHours()}>{saving ? "Đang lưu…" : "Lưu lịch làm việc"}</Button>
      </>}
      <View className="gap-3 border-t border-border pt-4"><Text className="font-body-semibold text-sm text-foreground">Ngày nghỉ riêng</Text><Text className="font-body text-xs leading-5 text-muted-foreground">Đóng nhận đặt mới một ngày; lịch hẹn hiện có vẫn giữ nguyên.</Text><Input label="Ngày (YYYY-MM-DD)" value={dateOff} onChangeText={setDateOff} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} /><Input label="Ghi chú (tùy chọn)" value={reason} onChangeText={setReason} placeholder="Ví dụ: nghỉ phép" maxLength={200} /><Button size="sm" disabled={!dateOff || dateBusy} onPress={() => void addDayOff()}>Thêm ngày nghỉ</Button>
        {daysOffQuery.isLoading ? <ActivityIndicator color={accent.primary} /> : daysOffQuery.isError ? <Button size="sm" variant="secondary" onPress={() => void daysOffQuery.refetch()}>Thử tải ngày nghỉ lại</Button> : (Array.isArray(daysOffQuery.data) ? daysOffQuery.data as Exception[] : []).filter((item) => dateKey(item.date) >= dateKey(new Date().toISOString())).map((item) => <View key={item.id} className="flex-row items-center gap-2 rounded-xl border border-border bg-panel p-3"><Text className="min-w-0 flex-1 font-body text-xs text-foreground">{new Date(item.date).toLocaleDateString("vi-VN")}{item.reason ? ` · ${item.reason}` : ""}</Text><Tappable accessibilityLabel={`Mở lại ngày ${dateKey(item.date)}`} disabled={dateBusy} onPress={() => void removeDayOff(item.id)} className="min-h-10 justify-center"><Text className="font-body-semibold text-xs text-primary">Mở lại</Text></Tappable></View>)}
      </View>
    </Card>
  );
}
