import type { ConfigContext, ExpoConfig } from "expo/config";
import { detectLanIp } from "./scripts/detect-api-url";

// app.json vẫn là nguồn cấu hình tĩnh chính (icon, splash, plugins...) —
// file này CHỈ thêm 1 việc: khi EXPO_PUBLIC_API_URL chưa set qua .env,
// tính sẵn IP LAN và đưa vào `extra.detectedApiUrl` để app đọc lúc chạy
// qua expo-constants.
//
// LƯU Ý QUAN TRỌNG (đã tự thử và sai lúc đầu — xem DECISIONS.md): set
// `process.env.EXPO_PUBLIC_API_URL` ở đây KHÔNG hoạt động — Metro chạy
// bước inline `EXPO_PUBLIC_*` (babel-preset-expo) trong worker process
// riêng, không thấy được process.env đã bị mutate ở process của Expo
// CLI lúc evaluate app.config.ts (verify bằng cách grep chuỗi IP trong
// bundle .hbc export ra — không có). `extra` + expo-constants đúng cơ
// chế hơn: xác nhận qua `npx expo config --type public` (đúng manifest
// mà `expo start` phục vụ cho Expo Go / mà native build nhúng vào) show
// đúng `extra.detectedApiUrl`.
export default ({ config }: ConfigContext): ExpoConfig => {
  const finalConfig = config as ExpoConfig;

  if (process.env.EXPO_PUBLIC_API_URL) {
    return finalConfig;
  }

  const ip = detectLanIp();
  const detectedApiUrl = ip ? `http://${ip}:3000` : null;

  if (detectedApiUrl) {
    console.log(
      `[app.config.ts] EXPO_PUBLIC_API_URL chưa set trong .env — tự dùng ${detectedApiUrl} (IP LAN phát hiện được)`,
    );
  } else {
    console.warn(
      "[app.config.ts] Không tự phát hiện được IP LAN — sẽ fallback về http://localhost:3000 trong src/config/env.ts",
    );
  }

  return {
    ...finalConfig,
    extra: {
      ...finalConfig.extra,
      detectedApiUrl,
    },
  };
};
