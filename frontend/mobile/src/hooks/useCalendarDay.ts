import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";

import { toDateInputValue } from "../utils/date";

/**
 * "Now", re-read every time the screen comes back into view, the app returns to the foreground,
 * or midnight passes.
 *
 * A tab screen stays mounted for as long as the app's process lives — often days. Reading the
 * date once at mount (`useMemo(() => new Date(), [])`) left Trang chủ showing yesterday's
 * calories under "hôm nay" after midnight until the app was killed (real phone, 8/10).
 *
 * `dayKey` (local YYYY-MM-DD) only changes when the calendar day does, so it is the thing to key
 * memos and queries on; `now` is for what depends on the hour (a greeting).
 */
export function useCalendarDay(): { now: Date; dayKey: string } {
  const [now, setNow] = useState(() => new Date());
  const sync = useCallback(() => setNow(new Date()), []);

  useFocusEffect(sync);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });
    return () => sub.remove();
  }, [sync]);

  // Neither of those fires for someone who is simply looking at the screen when the clock passes
  // 00:00 (real phone, 9/10: the calories stayed on yesterday until the tab was left and
  // reopened), so the day also rolls over on its own, one second into the next one.
  const dayKey = toDateInputValue(now);
  useEffect(() => {
    const today = new Date();
    const nextDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 0, 0, 1);
    const timer = setTimeout(sync, Math.max(1000, nextDay.getTime() - today.getTime()));
    return () => clearTimeout(timer);
  }, [dayKey, sync]);

  return { now, dayKey };
}
