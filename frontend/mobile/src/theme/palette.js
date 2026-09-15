/**
 * Canonical color source, copied verbatim from frontend/web/src/styles/theme.css.
 * Plain CommonJS (not TypeScript) so both `tailwind.config.js` (loaded directly by Node,
 * no TS transform available there) and `colors.ts` (loaded by Metro/TS for in-app use) can
 * `require()` this single file — avoids duplicating the palette in two places.
 * Re-verify against theme.css if that file changes.
 */

const darkColors = {
  background: "#0a0a0a",
  foreground: "#f4f4f5",
  mutedText: "#a1a1aa",
  card: "#111111",
  cardForeground: "#f4f4f5",
  panel: "#18181b",
  input: "#1f1f1f",
  inputBackground: "#1f1f1f",
  inputText: "#f4f4f5",
  inputPlaceholder: "#a1a1aa",
  border: "#27272a",
  primary: "#22c55e",
  primaryForeground: "#0a0a0a",
  primaryText: "#052e16",
  secondary: "#1f1f1f",
  secondaryForeground: "#f4f4f5",
  muted: "#1f1f1f",
  mutedForeground: "#71717a",
  accent: "#1f1f1f",
  accentForeground: "#f4f4f5",
  destructive: "#ef4444",
  destructiveForeground: "#ffffff",
  switchBackground: "#3f3f46",
  ring: "#22c55e",
  tabBackground: "#18181b",
  tabText: "#d4d4d8",
  tabActiveBackground: "#22c55e",
  tabActiveText: "#052e16",
  sidebar: "#0d0d0d",
  sidebarForeground: "#f4f4f5",
  sidebarPrimary: "#22c55e",
  sidebarPrimaryForeground: "#0a0a0a",
  sidebarAccent: "#1f1f1f",
  sidebarAccentForeground: "#f4f4f5",
  sidebarBorder: "#1f1f1f",
  sidebarRing: "#22c55e",
};

const lightColors = {
  background: "#f8fafc",
  foreground: "#111827",
  mutedText: "#475569",
  card: "#ffffff",
  cardForeground: "#111827",
  panel: "#f1f5f9",
  input: "#ffffff",
  inputBackground: "#ffffff",
  inputText: "#111827",
  inputPlaceholder: "#64748b",
  border: "#d1d5db",
  primary: "#059669",
  primaryForeground: "#ffffff",
  primaryText: "#ffffff",
  secondary: "#eef2f7",
  secondaryForeground: "#111827",
  muted: "#eef2f7",
  mutedForeground: "#64748b",
  accent: "#e2e8f0",
  accentForeground: "#111827",
  destructive: "#ef4444",
  destructiveForeground: "#ffffff",
  switchBackground: "#94a3b8",
  ring: "#059669",
  tabBackground: "#e2e8f0",
  tabText: "#334155",
  tabActiveBackground: "#059669",
  tabActiveText: "#ffffff",
  sidebar: "#ffffff",
  sidebarForeground: "#111827",
  sidebarPrimary: "#059669",
  sidebarPrimaryForeground: "#ffffff",
  sidebarAccent: "#f1f5f9",
  sidebarAccentForeground: "#111827",
  sidebarBorder: "#d1d5db",
  sidebarRing: "#059669",
};

/** Chart series order — must stay in this exact order (theme.css --chart-1..5). */
const chartSeries = ["#22c55e", "#10b981", "#a78bfa", "#f59e0b", "#ef4444"];

/**
 * Visual tokens taken from the DESIGN source (`D:\New Frontend\src\index.css`), which the
 * migration plan makes the authority on appearance — the tokens above came from the running web
 * app's theme.css, which is the authority on behaviour and carries some names the design does not.
 *
 * Where the two disagree it is naming, not colour: web splits `--muted-text-color` (#a1a1aa) from
 * `--muted-foreground` (#71717a), while the design collapses both into one
 * `--color-muted-foreground` (#a1a1aa). So a `text-muted-foreground` class ported from a design
 * screen means #a1a1aa — `darkColors.mutedText` above, NOT `darkColors.mutedForeground`. That is
 * why tailwind.config.js maps the class to this value.
 */
const designTokens = {
  mutedForeground: "#a1a1aa",
  primaryDeep: "#16a34a",
  onPrimary: "#052e16",
  warning: "#f59e0b",
  /** .glass — a frosted surface. RN has no backdrop-filter, so the translucent fill is kept and
   *  the blur is approximated per-use with expo-blur where it is actually visible. */
  glass: "rgba(17, 17, 17, 0.72)",
};

/**
 * Per-workspace accent. The design re-themes the whole app by overriding a handful of CSS
 * variables on a wrapper (`[data-workspace="pt"]` and friends) — every `bg-primary`/`text-primary`
 * /ring/chart follows with no reload. NativeWind's `vars()` reproduces that exactly; see
 * src/theme/workspace.ts.
 */
const workspaceAccents = {
  client: {
    primary: "#22c55e",
    primaryDeep: "#16a34a",
    onPrimary: "#052e16",
    chart1: "#22c55e",
    chart2: "#10b981",
    chart3: "#a78bfa",
  },
  pt: {
    primary: "#8b5cf6",
    primaryDeep: "#7c3aed",
    onPrimary: "#faf5ff",
    chart1: "#8b5cf6",
    chart2: "#a78bfa",
    chart3: "#22d3ee",
  },
  gym: {
    primary: "#3b82f6",
    primaryDeep: "#2563eb",
    onPrimary: "#eff6ff",
    chart1: "#3b82f6",
    chart2: "#60a5fa",
    chart3: "#22d3ee",
  },
  admin: {
    primary: "#14b8a6",
    primaryDeep: "#0d9488",
    onPrimary: "#042f2e",
    chart1: "#14b8a6",
    chart2: "#2dd4bf",
    chart3: "#38bdf8",
  },
};

module.exports = {
  darkColors,
  lightColors,
  chartSeries,
  designTokens,
  workspaceAccents,
};
