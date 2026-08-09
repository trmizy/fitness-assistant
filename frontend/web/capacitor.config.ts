import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'vn.fitnessassistant.app',
  appName: 'Fitness Assistant',
  webDir: 'dist',
  server: {
    // androidScheme belongs HERE, under `server` — not under `android`. Capacitor silently
    // ignores an unknown `android.androidScheme` key and falls back to its default 'https',
    // which makes the app origin https://localhost. A secure origin then blocks every plain
    // http:// request as mixed content, so the LAN address this build ships with
    // (http://<LAN_IP>:3000) fails with no visible network error at all.
    //
    // With 'http' the origin is http://localhost, which can call BOTH the LAN address over
    // http and a Cloudflare tunnel over https (http -> https is never mixed content).
    androidScheme: 'http',
    cleartext: true,
  },
};

export default config;
