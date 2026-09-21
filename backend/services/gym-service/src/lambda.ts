import serverless from "serverless-http";
import {
  ensureDatabaseUrlConfigured,
  validateRequiredRuntimeConfig,
} from "./config/lambda-runtime";
import { assertPartnerS3ProductionSafe } from "./services/partner-s3.guard";

let cachedHandler: ReturnType<typeof serverless> | null = null;

async function getHandler() {
  if (!cachedHandler) {
    await ensureDatabaseUrlConfigured();
    validateRequiredRuntimeConfig();
    // Cùng chốt chặn với server.ts, nhưng Lambda KHÔNG đi qua đó (không có startServer), nên phải
    // gọi lại ở đây — nếu không, cấu hình lưu trữ sai chỉ lộ ra khi có người tải tệp, chứ không
    // chặn ngay lúc khởi tạo như tài liệu đã hứa.
    assertPartnerS3ProductionSafe();
    const { default: app } = await import("./app");
    cachedHandler = serverless(app, {
      provider: "aws",
      requestId: "x-request-id",
    });
  }
  return cachedHandler;
}

export async function handler(event: any, context: any) {
  const activeHandler = await getHandler();
  return activeHandler(event, context);
}

