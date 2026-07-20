// Web-only override — Metro tự chọn file này thay cho db.ts khi bundle
// cho platform "web" (quy ước platform-extension chuẩn của Metro/React
// Native, không cần cấu hình gì thêm). Bắt buộc phải tách file thay vì
// chỉ guard bằng `if (Platform.OS !== "web")` bên trong hàm — vì
// expo-sqlite's web implementation tự import 1 file .wasm mà Metro
// KHÔNG resolve được, nên chỉ cần `import * as SQLite from "expo-sqlite"`
// xuất hiện tĩnh trong bundle graph (dù logic runtime không bao giờ gọi
// tới) là đã đủ làm hỏng `expo start --web`/`expo export --platform web`
// — xem DECISIONS.md.
export function isOfflineQueueSupported(): boolean {
  return false;
}

export async function getDb(): Promise<never> {
  throw new Error(
    "Offline queue (expo-sqlite) không hỗ trợ web — mọi call site phải check isOfflineQueueSupported() trước khi gọi getDb().",
  );
}
