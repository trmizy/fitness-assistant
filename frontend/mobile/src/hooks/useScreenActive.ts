import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "expo-router";

/**
 * True only while this screen is the one in front (focused) AND the app is in the foreground.
 * Used to gate polling: a refetch interval keeps running on a screen that is merely buried in the
 * stack or while the app sits in the background, so it must be turned off explicitly.
 */
export function useScreenActive(): boolean {
  const focused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setAppActive(state === "active"));
    return () => sub.remove();
  }, []);
  return focused && appActive;
}
