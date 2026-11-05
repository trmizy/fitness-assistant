import { Router, type Response } from "express";
import { ZodError, z } from "zod";
import { logger } from "@gym-coach/shared";
import { processService } from "../services/dispute-case/process.service";
import type { Actor } from "../services/dispute-case/dispute-case.service";

/**
 * E5: the two admin routes that finish the formal obligation after a won appeal. Mounted INSIDE the admin router (authMiddleware + roleMiddleware ADMIN already ran) at
 * /dispute-cases/:caseId/appeal-consequences, BEFORE the dispute-cases router. Identity ONLY from the verified token; bodies are strict (empty); both behind the V2.1 process flag
 * (409 DISPUTE_PROCESS_DISABLED). They move no money: the first asks payment-service (idempotent) for the obligation, the second reads its live state.
 */
const router = Router({ mergeParams: true });
const empty = z.object({}).strict();

async function run(req: any, res: Response, fn: (actor: Actor) => Promise<unknown>) {
  try {
    const id = req.headers["x-user-id"];
    const role = req.headers["x-user-role"];
    if (typeof id !== "string" || !id) return void res.status(401).json({ error: "Cần đăng nhập", code: "UNAUTHENTICATED" });
    empty.parse(req.body ?? {});
    const body = await fn({ id, role: typeof role === "string" ? role : "" });
    res.set("Cache-Control", "no-store");
    return void res.json(body);
  } catch (error: any) {
    if (error instanceof ZodError) return void res.status(400).json({ error: "Dữ liệu gửi lên không hợp lệ", code: "INVALID_INPUT", fields: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    if (error && typeof error.status === "number" && typeof error.code === "string") {
      return void res.status(error.status).json({ error: error.message, code: error.code, ...(error.details === undefined ? {} : { details: error.details }) });
    }
    logger.error(error, "appeal obligation route error");
    return void res.status(500).json({ error: "Không xử lý được yêu cầu. Vui lòng thử lại.", code: "INTERNAL_ERROR" });
  }
}

router.post("/:consequenceId/create-obligation", (req, res) => run(req, res, (actor) => processService.createAppealObligation(actor, String((req.params as any).caseId), String(req.params.consequenceId))));
router.post("/:consequenceId/sync-obligation", (req, res) => run(req, res, (actor) => processService.syncAppealObligation(actor, String((req.params as any).caseId), String(req.params.consequenceId))));

export default router;
