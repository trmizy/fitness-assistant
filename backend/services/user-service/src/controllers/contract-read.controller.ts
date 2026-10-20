import { Response } from "express";
import { logger } from "@gym-coach/shared";
import { contractGymOptionsService } from "../services/contract-gym-options.service";
import { contractCheckoutContextService } from "../services/contract-checkout-context.service";
import { errorCodeBody } from "../utils/error-code.util";
import { redactCheckoutContextForViewer } from "../services/contract-dto";

/**
 * Phase 3 (P3.4 / P3.5) - read-only contract endpoints. The caller is ALWAYS the verified identity
 * (x-user-id / x-user-role, rewritten by authMiddleware); no client id is ever read from the query or body.
 */
export const contractReadController = {
  // GET /contracts/gym-options?ptUserId=&packageId=
  async gymOptions(req: any, res: Response) {
    try {
      const clientUserId = req.headers["x-user-id"] as string;
      res.json(await contractGymOptionsService.getGymOptions(clientUserId, req.query));
    } catch (error: any) {
      if (!error.status || error.status >= 500) logger.error(error, "Gym options error");
      res.status(error.status || 500).json({
        ...errorCodeBody(error),
        error: error.message || "Failed to load gym options",
      });
    }
  },

  // GET /contracts/:id/checkout-context
  async checkoutContext(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      const role = req.headers["x-user-role"] as string;
      // The frozen split and the PT-gym agreement ids are the PT's / the platform's business: a client gets the context without them.
      const context = await contractCheckoutContextService.getCheckoutContext(req.params.id, { userId, role });
      res.json(redactCheckoutContextForViewer(context, { userId, role }, context.parties.ptUserId));
    } catch (error: any) {
      if (!error.status || error.status >= 500) logger.error(error, "Checkout context error");
      res.status(error.status || 500).json({
        ...errorCodeBody(error),
        error: error.message || "Failed to load checkout context",
      });
    }
  },
};
