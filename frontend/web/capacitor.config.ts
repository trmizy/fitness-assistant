import type { CapacitorConfig } from '@capacitor/cli';

// Vòng 4 / Phase E5 — dev/prod split so `cleartext: true` (plain HTTP allowed) never ships in
// a real production build. Default (no env var) is the SAFE production shape; the existing LAN
// dev workflow (`pnpm app:build` / `app:sync`, already pointed at a LAN IP via .env.capacitor)
// now sets CAPACITOR_ENV=dev to opt into the http/cleartext override — nothing about that
// existing workflow's *commands* changes, only what capacitor.config.ts itself resolves to.
const isDev = process.env.CAPACITOR_ENV === 'dev';

const config: CapacitorConfig = {
  appId: 'vn.fitnessassistant.app',
  appName: 'Gymini',
  webDir: 'dist',
  plugins: {
    // Vòng 4 / Phase E5 — sensible defaults only; no custom JS lifecycle code added anywhere
    // to hide/show it manually (launchAutoHide already handles that natively) — a botched
    // manual hide call would risk leaving the app looking stuck on startup, which is worse
    // than not touching this at all.
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 500,
      backgroundColor: '#0b1020',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
    },
  },
  ...(isDev
    ? {
        server: {
          // androidScheme belongs HERE, under `server` — not under `android`. Capacitor
          // silently ignores an unknown `android.androidScheme` key and falls back to its
          // default 'https', which makes the app origin https://localhost. A secure origin
          // then blocks every plain http:// request as mixed content, so the LAN address this
          // build ships with (http://<LAN_IP>:3000) fails with no visible network error at all.
          //
          // With 'http' the origin is http://localhost, which can call BOTH the LAN address
          // over http and a Cloudflare tunnel over https (http -> https is never mixed
          // content). Dev-only: a production build must not allow cleartext traffic.
          androidScheme: 'http',
          cleartext: true,
        },
      }
    : {
        server: {
          androidScheme: 'https',
        },
      }),
};

export default config;
