import { AsyncLocalStorage } from 'async_hooks';
import type { NextFunction, Request, Response } from 'express';

/**
 * Ngữ cảnh theo từng request mà các service sâu bên dưới cần nhưng không nên phải nhận `req` qua cả
 * chục tầng hàm. Hiện chỉ có một thứ: địa chỉ công khai mà người gọi đang dùng để tới hệ thống
 * (`x-public-base-url`, gateway tự tính và xoá mọi bản do client gửi) — để ký link tệp theo đúng cửa
 * người đó đi vào (xem partner-s3.service.ts `PARTNER_S3_PUBLIC_VIA_REQUEST`).
 */
interface RequestContext {
  publicBaseUrl?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

const INTERNAL_SECRET = () => process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  // Chỉ tin header khi request thật sự đi qua gateway (cổng của service này cũng được publish).
  const secret = req.headers['x-gateway-secret'];
  const fromGateway = (Array.isArray(secret) ? secret[0] : secret) === INTERNAL_SECRET();
  const raw = fromGateway ? req.headers['x-public-base-url'] : undefined;
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  const publicBaseUrl = value && /^https?:\/\/[^/\s]+$/i.test(value) ? value.replace(/\/$/, '') : undefined;
  storage.run({ publicBaseUrl }, next);
}

export function currentPublicBaseUrl(): string | undefined {
  return storage.getStore()?.publicBaseUrl;
}
