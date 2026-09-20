const { darkColors, chartSeries, designTokens } = require("./src/theme/palette");

/**
 * Colours the workspace accent can change at runtime resolve through a CSS variable, exactly as
 * the design does it — src/theme/workspace.ts sets those variables with NativeWind's `vars()` on a
 * wrapper view, and every `bg-primary`/`text-primary`/chart colour below follows with no reload.
 * The literal after each `var(...)` is the Client (green) default, so anything rendered outside a
 * workspace wrapper still gets a sensible colour instead of nothing.
 *
 * The variables hold SPACE-SEPARATED RGB CHANNELS ("34 197 94"), not hex, and are wrapped in
 * `rgb(... / <alpha-value>)`. That is what makes opacity modifiers work: `bg-primary/15` compiles
 * to `rgb(var(--color-primary) / 0.15)`, whereas a variable holding `#22c55e` gives Tailwind
 * nothing to compute an alpha from and the modifier is silently dropped — which showed up as a
 * success Badge with no background while the literal-coloured tones around it were fine.
 */
const channels = (hex) => {
  const value = hex.replace("#", "");
  const int = parseInt(
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value,
    16,
  );
  return `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`;
};

const themeable = (name, fallbackHex) =>
  `rgb(var(--color-${name}, ${channels(fallbackHex)}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: darkColors.background,
        foreground: darkColors.foreground,
        "muted-text": darkColors.mutedText,
        card: darkColors.card,
        "card-foreground": darkColors.cardForeground,
        panel: darkColors.panel,
        input: darkColors.input,
        "input-background": darkColors.inputBackground,
        "input-text": darkColors.inputText,
        "input-placeholder": darkColors.inputPlaceholder,
        border: darkColors.border,
        primary: themeable("primary", darkColors.primary),
        "primary-deep": themeable("primary-deep", designTokens.primaryDeep),
        // What text/icons on a primary-filled surface use. The design calls it --color-on-primary;
        // web's theme.css calls the same value --primary-text.
        "on-primary": themeable("on-primary", designTokens.onPrimary),
        "primary-foreground": darkColors.primaryForeground,
        "primary-text": themeable("on-primary", designTokens.onPrimary),
        secondary: darkColors.secondary,
        "secondary-foreground": darkColors.secondaryForeground,
        muted: darkColors.muted,
        // Deliberately the DESIGN's value (#a1a1aa), not darkColors.mutedForeground (#71717a) —
        // see the note above `designTokens` in src/theme/palette.js.
        "muted-foreground": designTokens.mutedForeground,
        accent: darkColors.accent,
        "accent-foreground": darkColors.accentForeground,
        destructive: darkColors.destructive,
        "destructive-foreground": darkColors.destructiveForeground,
        warning: designTokens.warning,
        glass: designTokens.glass,
        ring: themeable("primary", darkColors.ring),
        chart: {
          1: themeable("chart-1", chartSeries[0]),
          2: themeable("chart-2", chartSeries[1]),
          3: themeable("chart-3", chartSeries[2]),
          4: chartSeries[3],
          5: chartSeries[4],
        },
      },
      borderRadius: {
        sm: "4px",
        md: "6px",
        lg: "8px",
        xl: "12px",
      },
      fontFamily: {
        body: ["Inter_400Regular"],
        "body-medium": ["Inter_500Medium"],
        "body-semibold": ["Inter_600SemiBold"],
        display: ["Barlow_700Bold"],
        "display-black": ["Barlow_900Black"],
      },
    },
  },
  plugins: [],
};
