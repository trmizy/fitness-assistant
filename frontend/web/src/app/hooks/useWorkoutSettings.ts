import { useCallback, useEffect, useState } from "react";

/**
 * Settings Center → Workout (docs/features/PRODUCT_COMPLETENESS_IMPACT_ANALYSIS.md
 * §14/§15). Deliberately localStorage-only, same justified exception as
 * theme/language in SettingsContext.tsx: these are cosmetic active-workout
 * UI toggles, not domain data, and threading them through the profile
 * round-trip would mean touching WorkoutLogPage.tsx's active-session state
 * (8900+ lines) far beyond what's needed to make the toggle real. Every
 * key here gates ACTUAL rendered behavior in WorkoutLogPage.tsx — nothing
 * here is decorative (per spec §9's "every visible toggle must change
 * actual behavior").
 */

export type WorkoutSettings = {
  // Hides the RPE/RIR sliders + explainer during active set logging.
  // Wired at WorkoutLogPage.tsx's set-detail RPE/RIR block.
  showRpeRir: boolean;
  // Used when a set/exercise has no prescribed rest duration.
  defaultRestSeconds: number;
  // Controls the existing Screen Wake Lock integration while timers run.
  keepScreenAwake: boolean;
  // Browser-only feedback when the rest timer reaches zero.
  restTimerSound: boolean;
  restTimerVibration: boolean;
  // Gates previous-performance/progression based active-set prefill.
  smartPrefill: boolean;
};

const STORAGE_KEY = "fitness-assistant.workoutSettings.v1";

const DEFAULTS: WorkoutSettings = {
  showRpeRir: true,
  defaultRestSeconds: 90,
  keepScreenAwake: true,
  restTimerSound: true,
  restTimerVibration: true,
  smartPrefill: true,
};

export function normalizeRestSeconds(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULTS.defaultRestSeconds;
  return Math.min(300, Math.max(15, Math.round(numeric / 15) * 15));
}

function readStored(): WorkoutSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULTS,
      ...parsed,
      defaultRestSeconds: normalizeRestSeconds(parsed?.defaultRestSeconds),
      keepScreenAwake:
        typeof parsed?.keepScreenAwake === "boolean"
          ? parsed.keepScreenAwake
          : DEFAULTS.keepScreenAwake,
      restTimerSound:
        typeof parsed?.restTimerSound === "boolean"
          ? parsed.restTimerSound
          : DEFAULTS.restTimerSound,
      restTimerVibration:
        typeof parsed?.restTimerVibration === "boolean"
          ? parsed.restTimerVibration
          : DEFAULTS.restTimerVibration,
      smartPrefill:
        typeof parsed?.smartPrefill === "boolean"
          ? parsed.smartPrefill
          : DEFAULTS.smartPrefill,
    };
  } catch {
    return DEFAULTS;
  }
}

export function playRestTimerFeedback(settings: {
  restTimerSound: boolean;
  restTimerVibration: boolean;
}) {
  if (settings.restTimerVibration && typeof navigator !== "undefined") {
    try {
      navigator.vibrate?.([120, 70, 120]);
    } catch {
      // Vibration is best-effort only.
    }
  }

  if (!settings.restTimerSound || typeof window === "undefined") return;
  try {
    const AudioContextCtor =
      window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;

    const ctx = new AudioContextCtor();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    gain.connect(ctx.destination);

    [0, 0.13].forEach((offset) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now + offset);
      osc.connect(gain);
      osc.start(now + offset);
      osc.stop(now + offset + 0.09);
    });

    window.setTimeout(() => {
      ctx.close().catch(() => {});
    }, 500);
  } catch {
    // Autoplay/audio restrictions must never break the timer.
  }
}

/**
 * Two components need this independently (WorkoutSection in Settings, and
 * WorkoutLogPage itself, which aren't in a parent/child relationship at
 * mount time) — a "storage" event listener keeps a change made in one tab
 * reflected in another without a shared context provider neither page
 * already has a reason to sit inside.
 */
export function useWorkoutSettings() {
  const [settings, setSettings] = useState<WorkoutSettings>(() => readStored());

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setSettings(readStored());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const update = useCallback((patch: Partial<WorkoutSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      if (patch.defaultRestSeconds !== undefined) {
        next.defaultRestSeconds = normalizeRestSeconds(patch.defaultRestSeconds);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      // Same-tab consumers (e.g. WorkoutLogPage already mounted) don't get
      // a native "storage" event for writes made from their own tab —
      // dispatch one manually so a toggle in Settings takes effect
      // immediately if a workout is already open in another tab of the
      // same app instance, and so this hook's own other instances in the
      // same tab re-read consistently.
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
      return next;
    });
  }, []);

  return { settings, update };
}
