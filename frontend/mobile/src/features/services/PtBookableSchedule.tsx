import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from "lucide-react-native";

import { Card, Tappable } from "../../components/ui";
import { availabilityService } from "../../services/api";
import { useWorkspaceAccent } from "../../theme/workspace";
import { designTokens } from "../../theme/colors";

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

/** Anonymous bookable times only; session/client details never enter this component. */
export function PtBookableSchedule({ ptUserId }: { ptUserId: string }) {
  const accent = useWorkspaceAccent();
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
    const next = Math.max(0, weekOffset + direction);
    if (next === weekOffset) return;
    setWeekOffset(next);
    setSelected(next === 0 ? dateKey(today) : dateKey(addDays(mondayOf(today), next * 7)));
  };

  return (
    <Card className="gap-3 border-primary/20 p-4">
      <View className="flex-row items-start gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
          <CalendarDays size={18} color={accent.primary} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="font-body-semibold text-sm text-foreground">Giờ trống có thể đặt</Text>
          <Text className="mt-0.5 font-body text-xs leading-5 text-muted-foreground">Chọn ngày để xem giờ PT còn nhận lịch.</Text>
        </View>
      </View>

      <View className="flex-row items-center justify-between">
        <Tappable accessibilityLabel="Tuần trước" disabled={weekOffset === 0} onPress={() => changeWeek(-1)} className="h-10 w-10 items-center justify-center rounded-xl bg-panel">
          <ChevronLeft size={18} color={weekOffset === 0 ? designTokens.mutedForeground : accent.primary} />
        </Tappable>
        <Text className="flex-1 text-center font-body-semibold text-xs text-foreground">
          {days[0].toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })} – {days[6].toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}
        </Text>
        <Tappable accessibilityLabel="Tuần sau" onPress={() => changeWeek(1)} className="h-10 w-10 items-center justify-center rounded-xl bg-panel">
          <ChevronRight size={18} color={accent.primary} />
        </Tappable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} accessibilityLabel="Chọn ngày xem giờ trống">
        {days.map((day) => {
          const key = dateKey(day);
          const past = key < dateKey(today);
          const active = key === selected;
          return (
            <Tappable key={key} accessibilityLabel={day.toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "long" })} disabled={past} onPress={() => setSelected(key)} className={`h-14 w-11 items-center justify-center rounded-xl border ${active ? "border-primary bg-primary" : "border-border bg-panel"}`}>
              <Text className={`font-body-semibold text-[10px] ${active ? "text-on-primary" : "text-muted-foreground"}`}>{day.toLocaleDateString("vi-VN", { weekday: "short" })}</Text>
              <Text className={`font-body-semibold text-sm ${active ? "text-on-primary" : past ? "text-muted-foreground" : "text-foreground"}`}>{day.getDate()}</Text>
            </Tappable>
          );
        })}
      </ScrollView>

      <View className="min-h-14 border-t border-border pt-3">
        {slotsQuery.isLoading || slotsQuery.isFetching ? (
          <View className="flex-row items-center gap-2"><ActivityIndicator size="small" color={accent.primary} /><Text className="font-body text-xs text-muted-foreground">Đang kiểm tra giờ trống…</Text></View>
        ) : slotsQuery.isError ? (
          <Tappable onPress={() => void slotsQuery.refetch()} className="min-h-10 justify-center">
            <Text className="font-body-semibold text-xs text-destructive">Chưa tải được giờ trống · Chạm để thử lại</Text>
          </Tappable>
        ) : slots.length === 0 ? (
          <Text className="font-body text-sm text-muted-foreground">Ngày này chưa có giờ trống. Hãy chọn ngày khác.</Text>
        ) : (
          <View className="flex-row flex-wrap gap-2">
            {slots.map((slot) => (
              <View key={slot} className="min-h-9 flex-row items-center gap-1.5 rounded-xl border border-primary/25 bg-primary/10 px-3">
                <Clock3 size={13} color={accent.primary} />
                <Text className="font-body-semibold text-sm text-primary">{slot}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      <Text className="font-body text-[11px] leading-4 text-muted-foreground">Buổi tập cần đặt trước ít nhất 24 giờ. Giờ trống có thể thay đổi; hệ thống sẽ kiểm tra lại khi đặt buổi.</Text>
    </Card>
  );
}
