/**
 * Account-scoped display units — `UserProfile.unitSystem` / `.energyUnit` in user-service, the SAME fields web's
 * Settings → Đơn vị đo writes (`PUT /profile/me`). Canonical storage never changes (cm / kg / kcal); these only
 * decide how a value is shown and typed. Pure (no React, no Expo) so it runs under `tsx --test`.
 */
import { feetInchesFromCm, kjFromKcal, lbFromKg } from "../../utils/units";

export type UnitSystem = "metric" | "imperial";
export type EnergyUnit = "kcal" | "kj";

export type UnitPreferences = { unitSystem: UnitSystem; energyUnit: EnergyUnit };

export const DEFAULT_UNIT_PREFERENCES: UnitPreferences = { unitSystem: "metric", energyUnit: "kcal" };

/** Anything unrecognised (no profile yet, an older server) falls back to metric / kcal. */
export function unitPreferencesFromProfile(profile: { unitSystem?: unknown; energyUnit?: unknown } | null | undefined): UnitPreferences {
  return {
    unitSystem: profile?.unitSystem === "imperial" ? "imperial" : "metric",
    energyUnit: profile?.energyUnit === "kj" ? "kj" : "kcal",
  };
}

export function energyLabel(kcal: number, unit: EnergyUnit): string {
  return unit === "kj" ? `${kjFromKcal(kcal)} kJ` : `${Math.round(kcal)} kcal`;
}

export function weightLabel(kg: number, system: UnitSystem): string {
  return system === "imperial" ? `${lbFromKg(kg)} lb` : `${kg} kg`;
}

export function heightLabel(cm: number, system: UnitSystem): string {
  if (system !== "imperial") return `${cm} cm`;
  const { feet, inches } = feetInchesFromCm(cm);
  return `${feet}'${inches}"`;
}
