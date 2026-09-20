import { darkColors, lightColors, chartSeries } from "./colors";
import { fontFamily, letterSpacing } from "./typography";

/** --radius: 0.5rem in theme.css (16px base font-size => 8px). RN takes raw px. */
export const radius = {
  sm: 4, // calc(var(--radius) - 4px)
  md: 6, // calc(var(--radius) - 2px)
  lg: 8, // var(--radius)
  xl: 12, // calc(var(--radius) + 4px)
} as const;

export const tokens = {
  dark: darkColors,
  light: lightColors,
  chartSeries,
  font: fontFamily,
  letterSpacing,
  radius,
} as const;

export type Theme = typeof tokens.dark;

export { darkColors, lightColors, chartSeries, fontFamily, letterSpacing };
