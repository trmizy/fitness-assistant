// eslint-disable-next-line @typescript-eslint/no-var-requires
const palette = require("./palette") as {
  darkColors: Record<string, string>;
  lightColors: Record<string, string>;
  chartSeries: readonly string[];
  designTokens: Record<string, string>;
};

export const darkColors = palette.darkColors;
export const lightColors = palette.lightColors;
export const chartSeries = palette.chartSeries;

/** Visual tokens from the design source — see the note above `designTokens` in palette.js for why
 *  these are separate from `darkColors` and when to prefer them. */
export const designTokens = palette.designTokens;

export type ThemeColors = typeof darkColors;
