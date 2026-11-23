import { Capacitor } from "@capacitor/core";

/**
 * Web-only presentation gate for the navigation design-system prototype.
 *
 * The packaged Android app (Capacitor, webDir = dist) runs this SAME React bundle, and `app:build:prod` uses the
 * same `vite build --mode production` as the website — so neither a breakpoint nor the build mode can tell the
 * two apart. `Capacitor.isNativePlatform()` can: it is true only when the native bridge is injected, and the repo
 * already relies on it for keystore storage, payments, the status bar and the login server override.
 * No user-agent sniffing.
 *
 * DEV only: `?ui=legacy` previews the presentation the packaged app keeps, in a normal browser.
 */
export function isWebPresentation(): boolean {
  if (Capacitor.isNativePlatform()) return false;
  if (import.meta.env?.DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("ui") === "legacy") return false;
  return true;
}
