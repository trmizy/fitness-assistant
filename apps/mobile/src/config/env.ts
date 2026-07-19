// EXPO_PUBLIC_* vars are inlined at build time by Metro — no runtime
// fetch needed. Falls back to localhost for local dev against Docker.
export const env = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000",
  mock: process.env.EXPO_PUBLIC_MOCK === "1",
  featureCycles: process.env.EXPO_PUBLIC_FEATURE_CYCLES !== "0",
} as const;
