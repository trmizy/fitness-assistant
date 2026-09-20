import { Request, Response } from "express";
import { z } from "zod";
import { logger } from "@gym-coach/shared";
import { authRepository } from "../repositories/auth.repository";
import { partnerApplicationService } from "../services/partner-application.service";
import {
  partnerApplicationStartSchema,
  partnerApplicationVerifySchema,
  partnerApplicationSetPasswordSchema,
} from "../models/partner-application.models";

const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || "dev_internal_service_secret_change_in_production";

/**
 * Cùng quy tắc với authController.requestPasswordReset: host của link chỉ lấy từ
 * `x-trusted-web-origin` khi request chứng minh được đi qua gateway, nếu không thì FRONTEND_URL —
 * không bao giờ từ header do người gọi tự đặt (endpoint này công khai, không cần đăng nhập).
 */
function linkBaseUrlFor(req: Request): string {
  const gatewaySecret = req.headers["x-gateway-secret"];
  const fromGateway =
    (Array.isArray(gatewaySecret) ? gatewaySecret[0] : gatewaySecret) === INTERNAL_SERVICE_SECRET;
  const trustedHeader = fromGateway ? req.headers["x-trusted-web-origin"] : undefined;
  const trustedOrigin = Array.isArray(trustedHeader) ? trustedHeader[0] : trustedHeader;
  return trustedOrigin || process.env.FRONTEND_URL || "http://localhost:5173";
}

function handleError(res: Response, error: any, context: string) {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Validation failed", code: "VALIDATION_FAILED", details: error.errors });
    return;
  }
  if (error?.status) {
    if (error.retryAfterSeconds) res.setHeader("Retry-After", String(error.retryAfterSeconds));
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  // Không đưa lỗi thô ra ngoài, và không log body (có thể chứa token/mật khẩu).
  logger.error({ err: error }, context);
  res.status(500).json({ error: "Internal server error" });
}

export const partnerApplicationController = {
  async start(req: Request, res: Response): Promise<void> {
    try {
      const body = partnerApplicationStartSchema.parse(req.body);
      const result = await partnerApplicationService.start(body.email, linkBaseUrlFor(req));
      res.json(result);
    } catch (error) {
      handleError(res, error, "Partner application start error");
    }
  },

  async verify(req: Request, res: Response): Promise<void> {
    try {
      const body = partnerApplicationVerifySchema.parse(req.body);
      const result = await partnerApplicationService.verify(body.token);
      res.json(result);
    } catch (error) {
      handleError(res, error, "Partner application verify error");
    }
  },

  async setPassword(req: Request, res: Response): Promise<void> {
    try {
      const body = partnerApplicationSetPasswordSchema.parse(req.body);
      const result = await partnerApplicationService.setPassword(body.setupToken, body.password);
      await authRepository.createAuditLog({
        userId: result.user.id,
        action: "PARTNER_APPLICATION_ACCOUNT_CREATED",
        ipAddress: req.ip || req.socket.remoteAddress || null,
        userAgent: req.headers["user-agent"] || null,
      });
      res.status(201).json(result);
    } catch (error) {
      handleError(res, error, "Partner application set-password error");
    }
  },
};
