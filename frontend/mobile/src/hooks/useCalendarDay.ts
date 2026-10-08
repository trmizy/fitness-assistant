import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";

import { toDateInputValue } from "../utils/date";

/**
 * "Now", re-read every time the screen comes back into view or the app returns to the foreground.
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

  return { now, dayKey: toDateInputValue(now) };
}
