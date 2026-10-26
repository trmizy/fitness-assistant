import { useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react-native";

import { Tappable } from "../../components/ui";
import { availabilityService } from "../../services/api";
import { designTokens } from "../../theme/colors";
import { useWorkspaceAccent } from "../../theme/workspace";
import {
  WEEKDAY_LABELS,
  activeWeekdays,
  addMonths,
  bookingRange,
  candidateDays,
  canGoNext,
  canGoPrev,
  clampMonth,
  dayLabel,
  dayState,
  daysWithFreeSlots,
  freeSlotsOfDay,
  isTappable,
  monthGrid,
  monthOf,
  monthOfKey,
  monthTitle,
  toDateKey,
  type MonthRef,
} from "./bookingCalendar";
import { normalizeSlots } from "./sessions";

/**
 * Month calendar + the chosen day's free time slots, shared by the booking and reschedule sheets.
 *
 * The data is exactly what the strip of day chips used before: `GET /availability/:pt/slots?date=`
 * (one call per day, "HH:MM" strings). To colour a month, only the days that can matter are asked —
 * inside the allowed range and on a weekday the PT works (`GET /availability/:pt`) — and they share
 * the ["pt-slots", pt, date] cache key with the selected-day query, so nothing is fetched twice.
 *
 * It owns no booking rule: lead time and contract window come in as props and are applied by the
 * pure helpers in bookingCalendar.ts; the server still has the last word.
 */
export function SlotCalendarPicker({
  ptUserId,
  leadHours,
  contractEnd,
  contractStart,
  date,
  time,
  onChange,
  emptyDayText,
}: {
  ptUserId: string | null | undefined;
  leadHours: number;
  contractEnd?: string | null;
  contractStart?: string | null;
  date: string | null;
  time: string | null;
  onChange: (date: string | null, time: string | null) => void;
  emptyDayText: string;
}) {
  const accent = useWorkspaceAccent();

  const range = useMemo(
    () => bookingRange({ leadHours, contractEnd, contractStart }),
    [leadHours, contractEnd, contractStart],
  );
  const [month, setMonth] = useState<MonthRef>(() =>
    range ? (monthOfKey(range.minKey) ?? monthOf(new Date())) : monthOf(new Date()),
  );
  const shown = clampMonth(month, range);
  const todayKey = toDateKey(new Date());

  const slotRules = useMemo(
    () => ({ leadHours, contractEnd, contractStart }),
    [leadHours, contractEnd, contractStart],
  );

  // The PT's weekly pattern only trims requests; when it cannot be read, every day is asked.
  const availabilityQuery = useQuery({
    queryKey: ["pt-availability", ptUserId],
    queryFn: () => availabilityService.getAvailability(ptUserId!),
    enabled: !!ptUserId,
    staleTime: 5 * 60_000,
  });
  const patternReady = !availabilityQuery.isLoading;
  const weekdays = useMemo(() => activeWeekdays(availabilityQuery.data), [availabilityQuery.data]);

  const days = useMemo(
    () => (patternReady && ptUserId ? candidateDays(shown, range, weekdays) : []),
    [patternReady, ptUserId, shown.year, shown.month, range, weekdays],
  );
  const dayQueries = useQueries({
    queries: days.map((day) => ({
      queryKey: ["pt-slots", ptUserId, day],
      queryFn: () => availabilityService.getAvailableSlots(ptUserId!, day),
      staleTime: 30_000,
    })),
  });

  const { free, pending } = useMemo(() => {
    const slotsByDate: Record<string, string[]> = {};
    const waiting = new Set<string>();
    days.forEach((day, index) => {
      const query = dayQueries[index];
      if (query?.isSuccess) slotsByDate[day] = normalizeSlots(query.data);
      else if (!query || query.isPending) waiting.add(day);
    });
    // Until the weekly pattern is known nothing can be ruled out, so every allowed day waits.
    if (!patternReady) candidateDays(shown, range, null).forEach((day) => waiting.add(day));
    return { free: daysWithFreeSlots(slotsByDate, slotRules), pending: waiting };
  }, [days, dayQueries, patternReady, shown.year, shown.month, range, slotRules]);

  const selectedQuery = useQuery({
    queryKey: ["pt-slots", ptUserId, date],
    queryFn: () => availabilityService.getAvailableSlots(ptUserId!, date!),
    enabled: !!ptUserId && !!date,
    staleTime: 30_000,
  });
  const slots = useMemo(
    () => (date ? freeSlotsOfDay(normalizeSlots(selectedQuery.data), date, slotRules) : []),
    [selectedQuery.data, date, slotRules],
  );

  const grid = useMemo(() => monthGrid(shown), [shown.year, shown.month]);
  const prevOk = canGoPrev(shown, range);
  const nextOk = canGoNext(shown, range);
  const loadingMonth = pending.size > 0;
  const monthEmpty = !!range && !loadingMonth && free.size === 0;

  if (!range) {
    return (
      <Text className="font-body text-xs text-muted-foreground">
        Hợp đồng sắp hết hạn nên không còn ngày nào để chọn.
      </Text>
    );
  }

  return (
    <View className="gap-4">
      <View className="gap-2">
        <Text className="font-body-medium text-xs text-muted-foreground">Ngày tập</Text>

        <View className="flex-row items-center justify-between">
          <Tappable
            className="h-9 w-9 items-center justify-center rounded-full border border-border bg-panel"
            style={prevOk ? undefined : { opacity: 0.35 }}
            disabled={!prevOk}
            accessibilityLabel="Tháng trước"
            onPress={() => setMonth(addMonths(shown, -1))}
          >
            <ChevronLeft size={18} color={designTokens.mutedForeground} />
          </Tappable>
          <View className="flex-row items-center gap-2">
            <Text className="font-display text-sm text-foreground">{monthTitle(shown)}</Text>
            {loadingMonth ? <ActivityIndicator size="small" color={accent.primary} /> : null}
          </View>
          <Tappable
            className="h-9 w-9 items-center justify-center rounded-full border border-border bg-panel"
            style={nextOk ? undefined : { opacity: 0.35 }}
            disabled={!nextOk}
            accessibilityLabel="Tháng sau"
            onPress={() => setMonth(addMonths(shown, 1))}
          >
            <ChevronRight size={18} color={designTokens.mutedForeground} />
          </Tappable>
        </View>

        <View className="flex-row">
          {WEEKDAY_LABELS.map((label) => (
            <View key={label} className="flex-1 items-center py-1">
              <Text className="font-body-medium text-xs text-muted-foreground">{label}</Text>
            </View>
          ))}
        </View>

        <View className="gap-1">
          {grid.map((row, rowIndex) => (
            <View key={rowIndex} className="flex-row">
              {row.map((cell, colIndex) => {
                if (!cell) return <View key={colIndex} className="flex-1" />;
                const state = dayState(cell.key, { range, free, pending, selected: date });
                const tappable = isTappable(state);
                const isToday = cell.key === todayKey;
                const selected = state === "selected";
                return (
                  <View key={colIndex} className="flex-1 items-center">
                    <Tappable
                      className={`h-10 w-10 items-center justify-center rounded-xl border ${
                        state === "free" ? "border-primary bg-primary/10" : "border-transparent"
                      }`}
                      style={[
                        { maxWidth: "94%" },
                        selected ? { backgroundColor: accent.primary, borderColor: accent.primary } : null,
                        state === "none" || state === "out" ? { opacity: 0.3 } : null,
                        state === "pending" ? { opacity: 0.6 } : null,
                      ]}
                      disabled={!tappable}
                      haptic={tappable}
                      accessibilityLabel={`Ngày ${dayLabel(cell.key)}${
                        state === "free" || selected ? ", còn khung giờ trống" : ""
                      }${isToday ? ", hôm nay" : ""}`}
                      onPress={() => onChange(cell.key, null)}
                    >
                      <Text
                        className={`text-sm ${
                          selected
                            ? "font-body-medium text-background"
                            : state === "free"
                              ? "font-body-medium text-foreground"
                              : "font-body text-muted-foreground"
                        }`}
                      >
                        {cell.day}
                      </Text>
                      {isToday ? (
                        <View
                          className={`absolute bottom-1 h-1 w-1 rounded-full ${selected ? "bg-background" : ""}`}
                          style={selected ? undefined : { backgroundColor: accent.primary }}
                        />
                      ) : null}
                    </Tappable>
                  </View>
                );
              })}
            </View>
          ))}
        </View>

        <Text className="font-body text-xs text-muted-foreground">
          {monthEmpty
            ? "Tháng này chưa có ngày nào còn khung giờ trống — thử xem tháng khác."
            : "Chỉ những ngày được tô màu mới còn khung giờ trống. Chấm nhỏ là hôm nay."}
        </Text>
      </View>

      {date ? (
        <View className="gap-2">
          <Text className="font-body-medium text-xs text-muted-foreground">
            {`Khung giờ trống · ${dayLabel(date)}`}
          </Text>
          {selectedQuery.isLoading ? (
            <ActivityIndicator color={accent.primary} />
          ) : slots.length === 0 ? (
            <Text className="font-body text-xs text-muted-foreground">{emptyDayText}</Text>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {slots.map((slot) => {
                const active = slot === time;
                return (
                  <Tappable
                    key={slot}
                    className={`rounded-xl border px-3.5 py-2 ${
                      active ? "border-primary" : "border-border bg-panel"
                    }`}
                    style={active ? { backgroundColor: accent.primary } : undefined}
                    onPress={() => onChange(date, slot)}
                  >
                    <Text
                      className={`font-body-medium text-sm ${
                        active ? "text-background" : "text-foreground"
                      }`}
                    >
                      {slot}
                    </Text>
                  </Tappable>
                );
              })}
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}
