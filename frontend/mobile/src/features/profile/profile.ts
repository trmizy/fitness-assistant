/**
 * CL-05 — pure parts of the "Cá nhân" hub and the edit-profile form (web's ProfilePage).
 */
import { currentStreak } from "../dashboard/dashboardWeek";
import type { ActivityHeatmapResult } from "../../services/api";

type ActivityDay = ActivityHeatmapResult["days"][number];

/** The hub's three numbers: trained days in the fetched window, the running streak, InBody scans. */
export function profileStats(days: ActivityDay[] | undefined, inbody: unknown, now: Date = new Date()) {
  const trained = (days ?? []).filter((d) => d.state === "completed" || d.state === "partial").length;
  return {
    sessions: trained,
    streak: currentStreak(days, now),
    inbodyScans: Array.isArray(inbody) ? inbody.length : 0,
  };
}

// ── Edit form: the same option lists and enum mapping as web's ProfilePage ─────────────────

export const GOAL_OPTIONS = [
  { value: "WEIGHT_LOSS", label: "Giảm mỡ", emoji: "🔥" },
  { value: "MUSCLE_GAIN", label: "Tăng cơ", emoji: "💪" },
  { value: "MAINTENANCE", label: "Duy trì vóc dáng", emoji: "⚖️" },
  { value: "ATHLETIC_PERFORMANCE", label: "Cải thiện sức khỏe", emoji: "❤️" },
] as const;

export const ACTIVITY_OPTIONS = [
  { value: "SEDENTARY", label: "Ít vận động" },
  { value: "LIGHTLY_ACTIVE", label: "Vận động nhẹ" },
  { value: "MODERATELY_ACTIVE", label: "Vận động vừa" },
  { value: "VERY_ACTIVE", label: "Năng động" },
  { value: "EXTREMELY_ACTIVE", label: "Cực kỳ năng động" },
] as const;

// Stored as the Vietnamese text itself (web sends the label as `dietaryPreference`).
export const DIET_OPTIONS = ["Không yêu cầu", "Nhiều protein", "Ăn chay (có trứng/sữa)", "Thuần chay", "Keto", "Ít tinh bột"] as const;

// "" = not set: never silently defaulted (web's comment — the cycle AI gates advice on it).
export const EXPERIENCE_OPTIONS = [
  { value: "", label: "Chưa xác định" },
  { value: "BEGINNER", label: "Người mới" },
  { value: "INTERMEDIATE", label: "Trung cấp" },
  { value: "ADVANCED", label: "Nâng cao" },
] as const;

export const GENDER_OPTIONS = [
  { value: "MALE", label: "Nam" },
  { value: "FEMALE", label: "Nữ" },
  { value: "OTHER", label: "Khác" },
] as const;

export type ProfileForm = {
  goal: string;
  activityLevel: string;
  dietaryPreference: string;
  dateOfBirth: string;
  gender: string;
  heightCm: string;
  currentWeight: string;
  experienceLevel: string;
  competesInSport: boolean;
  injuries: string;
};

export function formFromProfile(p: any): ProfileForm {
  return {
    goal: p?.goal ?? "WEIGHT_LOSS",
    activityLevel: p?.activityLevel ?? "MODERATELY_ACTIVE",
    dietaryPreference: p?.dietaryPreference ?? "Nhiều protein",
    dateOfBirth: p?.dateOfBirth ? String(p.dateOfBirth).slice(0, 10) : "",
    gender: p?.gender ?? "",
    heightCm: p?.heightCm != null ? String(p.heightCm) : "",
    currentWeight: p?.currentWeight != null ? String(p.currentWeight) : "",
    experienceLevel: p?.experienceLevel ?? "",
    competesInSport: Boolean(p?.competesInSport),
    injuries: Array.isArray(p?.injuries) ? p.injuries.join(", ") : "",
  };
}

const num = (s: string) => {
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
};

/** Body for PUT /profile/me — same fields web sends; empty inputs are left out, not zeroed. */
export function profilePatch(f: ProfileForm) {
  return {
    goal: f.goal,
    activityLevel: f.activityLevel,
    dateOfBirth: f.dateOfBirth || undefined,
    gender: f.gender || undefined,
    heightCm: f.heightCm ? num(f.heightCm) : undefined,
    currentWeight: f.currentWeight ? num(f.currentWeight) : undefined,
    dietaryPreference: f.dietaryPreference,
    experienceLevel: f.experienceLevel || undefined,
    competesInSport: f.competesInSport,
    injuries: f.injuries
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/** A YYYY-MM-DD the backend accepts, or an error to show. */
export function dateOfBirthError(v: string): string | null {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "Ngày sinh theo dạng YYYY-MM-DD.";
  const d = new Date(`${v}T00:00:00`);
  if (Number.isNaN(d.getTime()) || d > new Date()) return "Ngày sinh không hợp lệ.";
  return null;
}
