import Constants from "expo-constants";

// EXPO_PUBLIC_* vars are inlined at build time by Metro — no runtime
// fetch needed. When EXPO_PUBLIC_API_URL isn't set in .env, app.config.ts
// computes a LAN-IP fallback into `extra.detectedApiUrl` (read here via
// expo-constants, NOT process.env — see app.config.ts for why the
// process.env approach doesn't work). Final fallback is localhost, for
// web/laptop-only dev against Docker.
const detectedApiUrl = Constants.expoConfig?.extra?.detectedApiUrl as string | null | undefined;

export const env = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL || detectedApiUrl || "http://localhost:3000",
  mock: process.env.EXPO_PUBLIC_MOCK === "1",
  featureCycles: process.env.EXPO_PUBLIC_FEATURE_CYCLES !== "0",
} as const;
