import { addDays, parseApiDateOnly, toDateInputValue } from "../../utils/date";

/**
 * The "Lịch tuần" segment of CL-02 (`app/client/workout/index.tsx`), as a pure function so the
 * day-state rules can be tested without rendering the screen.
 */

export const TRAINING_WEEK_LABELS = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "CN"];

export type TrainingDay = {
  label: string;
  /** Local `YYYY-MM-DD`. */
  key: string;
  today: boolean;
  past: boolean;
  schedule: any;
  rest: boolean;
  done: boolean;
  inProgress: boolean;
};

export function buildTrainingWeek(
  schedules: unknown,
  weekStart: Date,
  now: Date = new Date(),
): TrainingDay[] {
  const list: any[] = Array.isArray(schedules) ? schedules : [];
  const todayKey = toDateInputValue(now);
  return TRAINING_WEEK_LABELS.map((label, i) => {
    const key = toDateInputValue(addDays(weekStart, i));
    const schedule = list.find((s) => toDateInputValue(parseApiDateOnly(s.date)) === key);
    return {
      label,
      key,
      today: key === todayKey,
      // Y-M-D strings compare chronologically, so no Date round-trip (and no timezone) needed.
      past: key < todayKey,
      schedule,
      // No schedule row for a day means the program prescribes rest, exactly how web reads it.
      rest: !schedule,
      // Finished is the schedule's own status, not "has a workout row": starting a session creates
      // the workout immediately (status IN_PROGRESS), so the old workoutId test ticked a session
      // the moment it began and locked the user out of resuming it. Same rule as web's
      // WorkoutLogPage (`status === "COMPLETED"`).
      done: schedule?.status === "COMPLETED",
      inProgress:
        schedule?.status !== "COMPLETED" && !!(schedule?.workoutId || schedule?.workout?.id),
    };
  });
}
