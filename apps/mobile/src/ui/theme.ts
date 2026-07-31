// Dark-first design tokens, mirroring the web app's established language
// (green accent on a zinc-dark background — see frontend/web/src/styles
// and pages like GymsPage/WalletPage). Values are the hex equivalents of
// the Tailwind zinc/green scales used there.

export const colors = {
  bg: "#09090b", // zinc-950
  surface: "#18181b", // zinc-900
  surfaceAlt: "#27272a", // zinc-800
  border: "#27272a", // zinc-800
  borderStrong: "#3f3f46", // zinc-700

  textPrimary: "#f4f4f5", // zinc-100
  textSecondary: "#a1a1aa", // zinc-400
  textMuted: "#71717a", // zinc-500
  textDisabled: "#52525b", // zinc-600

  accent: "#22c55e", // green-500
  accentStrong: "#16a34a", // green-600
  accentSoft: "rgba(34, 197, 94, 0.12)",
  onAccent: "#09090b", // black text on filled green buttons, per web convention

  success: "#22c55e",
  successSoft: "rgba(34, 197, 94, 0.12)",
  warning: "#f59e0b",
  warningSoft: "rgba(245, 158, 11, 0.12)",
  danger: "#ef4444",
  dangerSoft: "rgba(239, 68, 68, 0.12)",
  info: "#38bdf8",
  infoSoft: "rgba(56, 189, 248, 0.12)",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 999,
} as const;

export const typography = {
  heading: { fontSize: 22, fontWeight: "700" as const, color: colors.textPrimary },
  subheading: { fontSize: 17, fontWeight: "600" as const, color: colors.textPrimary },
  body: { fontSize: 15, fontWeight: "400" as const, color: colors.textPrimary },
  bodyStrong: { fontSize: 15, fontWeight: "600" as const, color: colors.textPrimary },
  caption: { fontSize: 13, fontWeight: "400" as const, color: colors.textSecondary },
  small: { fontSize: 11, fontWeight: "500" as const, color: colors.textMuted },
};

export const theme = { colors, spacing, radius, typography };

export type Theme = typeof theme;
