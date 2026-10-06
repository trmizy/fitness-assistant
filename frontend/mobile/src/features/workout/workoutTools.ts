import type { Href } from "expo-router";
import { Apple, BarChart3, ClipboardList, Dumbbell, LayoutTemplate, Upload, type LucideIcon } from "lucide-react-native";

export type WorkoutTool = { key: string; label: string; icon: LucideIcon; href: Href };

/**
 * The doors out of "Tập luyện". They used to be six unlabelled round icons in the header — nobody
 * could tell which was which, and the sixth sat half under the "+" button (partner test, 6/10) — so
 * they now live in WorkoutToolsMenu, each with its name. Order = how often a client reaches for it.
 * Nutrition is here rather than a sixth tab (doc 08 §4.2).
 */
export const WORKOUT_TOOLS: WorkoutTool[] = [
  { key: "nutrition", label: "Dinh dưỡng", icon: Apple, href: "/client/workout/nutrition" },
  { key: "plans", label: "Kế hoạch tập", icon: ClipboardList, href: "/client/plans" },
  { key: "programs", label: "Chương trình của tôi", icon: Dumbbell, href: "/client/workout/programs" },
  { key: "templates", label: "Mẫu buổi tập", icon: LayoutTemplate, href: "/client/workout/templates" },
  { key: "import", label: "Nhập buổi tập", icon: Upload, href: "/client/workout/import" },
  { key: "stats", label: "Thống kê", icon: BarChart3, href: "/client/stats/activity" },
];
