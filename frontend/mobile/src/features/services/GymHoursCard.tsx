import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Clock } from "lucide-react-native";

import { Badge, Card } from "../../components/ui";
import {
  closedDaysLabel,
  hoursLabel,
  normalizeHours,
  openNowStatus,
  vietnamClock,
  WEEKDAY_LABEL_VI,
} from "./gymHours";

/**
 * Giờ mở cửa của chi nhánh (FIX5 / Q8, theo `GymOpeningHours` của web): huy hiệu đang mở/đóng + bảng cả
 * tuần, hôm nay được nhấn. Chưa có dữ liệu → không vẽ gì (không khẳng định "đóng cửa").
 *
 * `closedTemporarily`: chi nhánh đang tạm đóng thì huy hiệu là "Tạm đóng cửa" + ngày dự kiến mở lại,
 * không hiện "đang mở" dù lịch tuần có giờ.
 */
export function GymHoursCard({
  hours,
  closedTemporarily = false,
  reopenText,
}: {
  hours: unknown;
  closedTemporarily?: boolean;
  reopenText?: string | null;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const days = normalizeHours(hours);
  if (days.length === 0) return null;

  const status = openNowStatus(days, now);
  const today = vietnamClock(now).day;
  // "Đang mở cửa · đóng lúc 21:00" → huy hiệu ngắn + dòng chi tiết "Đóng lúc 21:00" (huy hiệu không xuống dòng).
  const detailRaw = status.label.split(" · ")[1] ?? "";
  const statusDetail = detailRaw ? detailRaw.charAt(0).toUpperCase() + detailRaw.slice(1) : "";
  const closedNote = closedDaysLabel(days);

  return (
    <Card className="gap-3 p-4">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <View className="flex-row items-center gap-2">
          <Clock size={15} color="#8b9299" />
          <Text className="font-body-medium text-sm text-foreground">Giờ mở cửa</Text>
        </View>
        {closedTemporarily ? (
          <Badge tone="warning">Tạm đóng cửa</Badge>
        ) : status.state !== "unknown" ? (
          <Badge tone={status.state === "open" ? "success" : "neutral"}>
            {status.state === "open" ? "Đang mở cửa" : "Đang đóng cửa"}
          </Badge>
        ) : null}
      </View>

      {closedTemporarily ? (
        reopenText ? <Text className="font-body text-xs text-muted-foreground">{reopenText}</Text> : null
      ) : statusDetail ? (
        <Text className="font-body text-xs text-muted-foreground">{statusDetail}</Text>
      ) : null}

      <View className="overflow-hidden rounded-xl border border-border">
        {days.map((d, i) => {
          const isToday = d.day === today;
          const closed = d.type === "CLOSED";
          return (
            <View
              key={d.day}
              accessibilityLabel={`${WEEKDAY_LABEL_VI[d.day]}: ${hoursLabel(d)}${isToday ? " (hôm nay)" : ""}`}
              className={`min-h-[40px] flex-row items-center justify-between gap-3 px-3.5 py-2 ${
                isToday ? "bg-primary/10" : ""
              } ${i > 0 ? "border-t border-border" : ""}`}
            >
              <View className="flex-row items-center gap-2">
                <Text
                  className={`text-sm ${
                    isToday ? "font-body-medium text-foreground" : closed ? "font-body text-muted-foreground" : "font-body text-foreground"
                  }`}
                >
                  {WEEKDAY_LABEL_VI[d.day]}
                </Text>
                {isToday ? (
                  <View className="rounded bg-primary/15 px-1.5 py-0.5">
                    <Text className="font-body-medium text-[10px] uppercase text-primary">Hôm nay</Text>
                  </View>
                ) : null}
              </View>
              <Text
                className={`text-sm ${
                  closed ? "font-body text-muted-foreground" : isToday ? "font-body-medium text-foreground" : "font-body text-foreground"
                }`}
              >
                {hoursLabel(d)}
              </Text>
            </View>
          );
        })}
      </View>

      {closedNote ? <Text className="font-body text-xs text-muted-foreground">{closedNote}</Text> : null}
    </Card>
  );
}
