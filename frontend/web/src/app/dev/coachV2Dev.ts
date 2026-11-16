/**
 * DEV-only opt-in state for trying Multi-Agent V2 inside the EXISTING AI Coach page (M9.3-T1).
 *
 * Two independent build-time conditions must hold, both statically replaced by Vite so a production build compiles this to a constant
 * `false` and keeps no panel, endpoint path or scenario text:
 *   import.meta.env.DEV  (false in every `vite build`)   AND   VITE_AI_COACH_V2_DEV === "1"  (never set in any deploy config).
 * Default OFF. The switch only changes how THIS browser sends a message (JSON `/ai/ask` instead of the V1 SSE stream, because V2 has no
 * SSE); whether a request is actually served by V2 is decided ONLY by the server (bridge flag + allowlist + eligibility). Nothing sent
 * from here can grant that.
 */
import { useSyncExternalStore } from "react";

export const COACH_V2_DEV_AVAILABLE: boolean = import.meta.env.DEV === true && import.meta.env.VITE_AI_COACH_V2_DEV === "1";

/** Composer placeholder while the opt-in is on; an empty string (no text at all) in any build where the feature is unavailable. */
export const V2_DEV_COMPOSER_PLACEHOLDER: string = COACH_V2_DEV_AVAILABLE ? "V2 DEV: chọn một kịch bản ở trên" : "";

let enabled = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** True only in a DEV build that explicitly enabled the feature AND after the server confirmed the opt-in. */
export function isCoachV2DevMode(): boolean {
  return COACH_V2_DEV_AVAILABLE && enabled;
}
export function setCoachV2DevMode(next: boolean): void {
  if (!COACH_V2_DEV_AVAILABLE) return;
  if (enabled === next) return;
  enabled = next;
  emit();
}
export function useCoachV2DevMode(): boolean {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, isCoachV2DevMode, () => false);
}
