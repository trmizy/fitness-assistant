import serverless from "serverless-http";
import {
  ensureDatabaseUrlConfigured,
  validateRequiredRuntimeConfig,
} from "./config/lambda-runtime";

let cachedHandler: ReturnType<typeof serverless> | null = null;

async function getHandler() {
  await ensureDatabaseUrlConfigured();
  validateRequiredRuntimeConfig();
  if (!cachedHandler) {
    const { default: app } = await import("./app");
    cachedHandler = serverless(app, {
      provider: "aws",
      requestId: "x-request-id",
    });
  }
  return cachedHandler;
}

export async function handler(event: any, context: any) {
  const h = await getHandler();
  return h(event, context);
}
