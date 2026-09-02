import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

/**
 * Vòng 4 / Phase E5 — @capacitor/status-bar wiring. Kept in its own small hook (rather than
 * added to AppContext.tsx, which owns bootstrapSession/appUrlOpen/appStateChange — none of
 * that is touched here) so it is trivially removable and cannot collide with those.
 *
 * Style.Light = light/white status bar icons, correct for this app's dark theme (the inverse
 * of what the name suggests — Capacitor names the style after the icon color, not the
 * background). No-ops entirely on web (Capacitor.isNativePlatform() false) and swallows any
 * native error rather than crashing app startup over a cosmetic detail.
 */
export function useNativeStatusBar() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void (async () => {
      try {
        const { StatusBar, Style } = await import("@capacitor/status-bar");
        await StatusBar.setStyle({ style: Style.Light });
      } catch {
        // Best-effort — a status bar color mismatch is not worth surfacing to the user.
      }
    })();
  }, []);
}
