/**
 * Font families ported from frontend/web/src/styles/fonts.css (Google Fonts CDN there;
 * here bundled via @expo-google-fonts/barlow + @expo-google-fonts/inter, loaded in
 * app/_layout.tsx). Headings use Barlow, body uses Inter — same split as web.
 */

export const fontFamily = {
  // Inter — body text
  bodyLight: "Inter_300Light",
  bodyRegular: "Inter_400Regular",
  bodyMedium: "Inter_500Medium",
  bodySemiBold: "Inter_600SemiBold",
  bodyBold: "Inter_700Bold",
  bodyExtraBold: "Inter_800ExtraBold",
  // Barlow — headings (h1-h4 on web)
  displayRegular: "Barlow_400Regular",
  displayMedium: "Barlow_500Medium",
  displaySemiBold: "Barlow_600SemiBold",
  displayBold: "Barlow_700Bold",
  displayExtraBold: "Barlow_800ExtraBold",
  displayBlack: "Barlow_900Black",
} as const;

/** letter-spacing values from theme.css, in px-equivalent em (RN takes numeric px, not em). */
export const letterSpacing = {
  h1: -0.32, // -0.02em @ ~16px base *2 for text-2xl scale, refine per actual rendered size in Phase 3
  h2: -0.16, // -0.01em
} as const;
