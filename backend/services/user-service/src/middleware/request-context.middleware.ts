import { AsyncLocalStorage } from "async_hooks";
import type { NextFunction, Request, Response } from "express";
import { isAcceptedServiceSecret } from "./serviceSecret.middleware";

/**
 * Per-request context that deep services need without threading `req` through every layer. Today only one
 * thing: the public address the caller used to reach the system (`x-public-base-url`, computed by the gateway,
 * which strips any client-supplied copy first) - so PT physique-photo links are signed for the door the caller
 * actually came in by (localhost, LAN IP, Cloudflare tunnel). See pt-media-s3.service.ts `PT_MEDIA_S3_PUBLIC_VIA_REQUEST`.
 * Mirrors gym-service/src/middleware/request-context.middleware.ts.
 */
interface RequestContext {
  publicBaseUrl?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  // The header is trusted only when the request really came through the gateway (this service's own port is published too).
  const secret = req.headers["x-gateway-secret"];
  const fromGateway = isAcceptedServiceSecret(Array.isArray(secret) ? secret[0] : secret);
  const raw = fromGateway ? req.headers["x-public-base-url"] : undefined;
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  const publicBaseUrl = value && /^https?:\/\/[^/\s]+$/i.test(value) ? value.replace(/\/$/, "") : undefined;
  storage.run({ publicBaseUrl }, next);
}

export function currentPublicBaseUrl(): string | undefined {
  return storage.getStore()?.publicBaseUrl;
}
