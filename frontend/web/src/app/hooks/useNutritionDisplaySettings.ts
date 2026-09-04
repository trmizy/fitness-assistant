import { useCallback, useEffect, useState } from "react";

/**
 * Settings Center → Nutrition (docs/features/PRODUCT_COMPLETENESS_IMPACT_ANALYSIS.md
 * §10/§15). Same justified localStorage-only exception as
 * useWorkoutSettings.ts — a cosmetic display toggle, not domain data. Wired
 * into Food Library/Detail (frontend/web/src/app/pages/client/library) to
 * show/hide the protein/carbs/fat breakdown; calories always show
 * regardless, since that's the figure nutrition targets are actually
 * expressed against.
 *
 * Meal reminders and hydration reminders are deliberately NOT settings
 * here — no NotificationPreference field or delivery path exists for
 * either in user-service (verified; only workoutUpcoming/workoutRescheduled
 * /workoutUnfinished/planUpdated/ptFeedback are real), so exposing a toggle
 * for them would violate spec §9 ("every visible toggle must change actual
 * behavior").
 */
export type NutritionDisplaySettings = {
  showMacros: boolean;
};

const STORAGE_KEY = "fitness-assistant.nutritionSettings.v1";
const DEFAULTS: NutritionDisplaySettings = { showMacros: true };

function readStored(): NutritionDisplaySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function useNutritionDisplaySettings() {
  const [settings, setSettings] = useState<NutritionDisplaySettings>(() => readStored());

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setSettings(readStored());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const update = useCallback((patch: Partial<NutritionDisplaySettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
      return next;
    });
  }, []);

  return { settings, update };
}
