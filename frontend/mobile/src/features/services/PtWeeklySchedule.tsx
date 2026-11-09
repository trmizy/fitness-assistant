import { ActivityIndicator, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react-native";

import { Card, Tappable } from "../../components/ui";
import { availabilityService } from "../../services/api";
import { useWorkspaceAccent } from "../../theme/workspace";

const DAYS = [
  { key: "MONDAY", label: "Thứ 2" },
  { key: "TUESDAY", label: "Thứ 3" },
  { key: "WEDNESDAY", label: "Thứ 4" },
  { key: "THURSDAY", label: "Thứ 5" },
  { key: "FRIDAY", label: "Thứ 6" },
  { key: "SATURDAY", label: "Thứ 7" },
  { key: "SUNDAY", label: "Chủ nhật" },
] as const;

type Range = { startTime: string; endTime: string };

function weeklyHours(raw: unknown) {
  const rows = Array.isArray(raw) ? raw : [];
  return DAYS.map((day) => ({
    ...day,
    ranges: rows
      .filter((row) => row && row.dayOfWeek === day.key && row.isActive !== false)
      .map((row): Range => ({ startTime: String(row.startTime ?? ""), endTime: String(row.endTime ?? "") }))
      .filter((range) => /^([01]\d|2[0-3]):[0-5]\d$/.test(range.startTime) && /^([01]\d|2[0-3]):[0-5]\d$/.test(range.endTime) && range.startTime < range.endTime)
      .sort((a, b) => a.startTime.localeCompare(b.startTime)),
  }));
}

/** Read-only published recurring hours. Dated bookability remains in PtBookableSchedule. */
export function PtWeeklySchedule({ ptUserId }: { ptUserId: string }) {
  const accent = useWorkspaceAccent();
  const hoursQuery = useQuery({
    queryKey: ["pt-availability", ptUserId],
    queryFn: () => availabilityService.getAvailability(ptUserId),
    enabled: !!ptUserId,
  });
  const days = weeklyHours(hoursQuery.data);
  const workingDays = days.filter((day) => day.ranges.length > 0).length;

  return (
    <Card className="gap-3 border-border p-4">
      <View className="flex-row items-start gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
          <CalendarDays size={18} color={accent.primary} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="font-body-semibold text-sm text-foreground">Lịch dạy thường lệ</Text>
          <Text className="mt-0.5 font-body text-xs leading-5 text-muted-foreground">Khung giờ PT thường nhận dạy trong tuần.</Text>
        </View>
        {!hoursQuery.isLoading && !hoursQuery.isError && workingDays > 0 ? (
          <View className="rounded-full border border-border bg-panel px-2 py-1">
            <Text className="font-body-semibold text-[10px] text-muted-foreground">{workingDays} ngày/tuần</Text>
          </View>
        ) : null}
      </View>

      {hoursQuery.isLoading ? (
        <View className="flex-row items-center gap-2"><ActivityIndicator size="small" color={accent.primary} /><Text className="font-body text-xs text-muted-foreground">Đang tải lịch dạy…</Text></View>
      ) : hoursQuery.isError ? (
        <Tappable onPress={() => void hoursQuery.refetch()} className="min-h-10 justify-center">
          <Text className="font-body-semibold text-xs text-destructive">Chưa tải được lịch dạy · Chạm để thử lại</Text>
        </Tappable>
      ) : workingDays === 0 ? (
        <Text className="font-body text-sm text-muted-foreground">PT chưa công bố lịch dạy thường lệ.</Text>
      ) : (
        <View className="overflow-hidden rounded-xl border border-border">
          {days.map((day, index) => (
            <View key={day.key} className={`min-h-11 flex-row items-center gap-2 bg-panel px-3 py-2 ${index < days.length - 1 ? "border-b border-border" : ""}`}>
              <Text className={`w-16 font-body-semibold text-xs ${day.ranges.length ? "text-foreground" : "text-muted-foreground"}`}>{day.label}</Text>
              <View className="min-w-0 flex-1 flex-row flex-wrap gap-1.5">
                {day.ranges.length ? day.ranges.map((range, rangeIndex) => (
                  <View key={`${range.startTime}-${range.endTime}-${rangeIndex}`} className="rounded-lg border border-primary/20 bg-primary/10 px-2 py-1">
                    <Text className="font-body-semibold text-xs text-primary">{range.startTime}–{range.endTime}</Text>
                  </View>
                )) : <Text className="font-body text-xs text-muted-foreground">Nghỉ</Text>}
              </View>
            </View>
          ))}
        </View>
      )}
      <Text className="font-body text-[11px] leading-4 text-muted-foreground">Khoảng giữa các ca là giờ nghỉ. Ngày nghỉ riêng và buổi đã đặt có thể làm thay đổi giờ trống; xem giờ có thể đặt bên dưới.</Text>
    </Card>
  );
}
