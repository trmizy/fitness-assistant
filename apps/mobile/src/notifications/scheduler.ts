import * as Notifications from "expo-notifications";
import type { WorkoutSchedule } from "../api/workouts";
import type { TrainingCycle } from "../api/trainingCycles";

const REMINDER_HOUR = 7; // buổi tập
const INBODY_HOUR = 9; // nhắc đo InBody

function atLocalTime(date: Date, hour: number): Date {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function isFuture(date: Date): boolean {
  return date.getTime() > Date.now();
}

async function scheduleAt(identifier: string, date: Date, title: string, body: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: { title, body, sound: true },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
  });
}

interface SyncRemindersInput {
  upcomingSchedules: WorkoutSchedule[];
  activeCycle: TrainingCycle | null;
}

// Huỷ toàn bộ nhắc lịch cũ rồi đặt lại từ dữ liệu hiện tại — đơn giản
// hơn nhiều so với diff theo từng identifier, và luôn đúng vì được gọi
// lại mỗi khi user bấm "Đồng bộ nhắc lịch" (xem ProfileScreen ở P12)
// hoặc dữ liệu lịch/chu kỳ thay đổi đáng kể.
export async function syncReminders({ upcomingSchedules, activeCycle }: SyncRemindersInput): Promise<number> {
  await Notifications.cancelAllScheduledNotificationsAsync();
  let scheduled = 0;

  for (const s of upcomingSchedules) {
    if (s.status !== "NOT_STARTED") continue;
    const triggerDate = atLocalTime(new Date(s.date), REMINDER_HOUR);
    if (!isFuture(triggerDate)) continue;
    await scheduleAt(
      `workout-${s.id}`,
      triggerDate,
      "Buổi tập hôm nay",
      s.programDay?.title ?? "Đừng quên buổi tập theo lịch của bạn",
    );
    scheduled += 1;
  }

  if (activeCycle) {
    const endDate = new Date(activeCycle.endDate);
    const warnDate = atLocalTime(new Date(endDate.getTime() - 3 * 24 * 60 * 60 * 1000), INBODY_HOUR);
    const endDateAtHour = atLocalTime(endDate, INBODY_HOUR);

    if (isFuture(warnDate)) {
      await scheduleAt(
        `inbody-warn-${activeCycle.id}`,
        warnDate,
        "Sắp đến hạn đo InBody",
        `Chu kỳ #${activeCycle.cycleIndex} kết thúc trong 3 ngày — chuẩn bị đo InBody nhé.`,
      );
      scheduled += 1;
    }
    if (isFuture(endDateAtHour)) {
      await scheduleAt(
        `inbody-end-${activeCycle.id}`,
        endDateAtHour,
        "Đến hạn đo InBody",
        `Chu kỳ #${activeCycle.cycleIndex} kết thúc hôm nay — đo InBody để đóng chu kỳ.`,
      );
      scheduled += 1;
    }
  }

  return scheduled;
}

export async function cancelAllReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function listScheduledReminders() {
  return Notifications.getAllScheduledNotificationsAsync();
}
