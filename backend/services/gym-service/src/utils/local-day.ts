/**
 * "Local day" of a branch for PT check-in (Phase 2, D70 Q18).
 *
 * One timezone for the whole system: Asia/Ho_Chi_Minh (same constant name and value as
 * fitness-service's APP_SCHEDULE_TIME_ZONE). Vietnam has no daylight saving, so the offset is a
 * fixed +07:00. The day D is the calendar day, in that zone, of the instant the SERVER received the
 * scan - never the device clock, never the process `TZ` (production's TZ is unknown, audit I.1):
 * the date is read through Intl.DateTimeFormat with an explicit timeZone, and the window is built
 * from an explicit "+07:00" literal, so the result is identical whatever `process.env.TZ` says.
 *
 * The window [start, end) is returned as UTC instants; user-service only compares instants, so
 * only this one function ever does the timezone arithmetic.
 */
export const APP_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const OFFSET = '+07:00';
const DAY_MS = 24 * 60 * 60 * 1000;

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export interface LocalDayWindow {
  /** 'YYYY-MM-DD' - the local calendar day. */
  localDate: string;
  /** D 00:00 +07:00 as an instant (inclusive). */
  start: Date;
  /** (D+1) 00:00 +07:00 as an instant (exclusive). */
  end: Date;
}

/** 'YYYY-MM-DD' of `instant` in Asia/Ho_Chi_Minh. */
export function localDateOf(instant: Date): string {
  if (Number.isNaN(instant.getTime())) throw new RangeError('Invalid instant');
  const parts = dateFormatter.formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The window of local day `localDate` ('YYYY-MM-DD') as UTC instants. */
export function windowOfLocalDate(localDate: string): { start: Date; end: Date } {
  const start = new Date(`${localDate}T00:00:00.000${OFFSET}`);
  if (Number.isNaN(start.getTime())) throw new RangeError(`Invalid local date: ${localDate}`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** The local day containing `instant` (the server receive time) and its [start, end) window. */
export function localDayWindow(instant: Date = new Date()): LocalDayWindow {
  const localDate = localDateOf(instant);
  return { localDate, ...windowOfLocalDate(localDate) };
}
