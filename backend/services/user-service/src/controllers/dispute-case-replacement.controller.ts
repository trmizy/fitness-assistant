import type { Response } from "express";
import { ZodError, z } from "zod";
import { logger } from "@gym-coach/shared";
import { decisionReplacementService, type Actor } from "../services/dispute-case/decision-replacement.service";

/**
 * A4 endpoints (replacement of an approved Case decision that has had no effect). ADMIN only (the router also runs authMiddleware + roleMiddleware). Identity ONLY from x-user-id / x-user-role
 * (installed by authMiddleware from the verified token). Every body schema is STRICT: a userId / outcome / approvalId / amount in a body is refused (400), not ignored.
 */
function actorOf(req: any): Actor | null {
  const id = req.headers["x-user-id"];
  const role = req.headers["x-user-role"];
  if (typeof id !== "string" || !id) return null;
  return { id, role: typeof role === "string" ? role : "" };
}
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
function idempotencyKeyOf(req: any): string | undefined {
  const raw = req.headers["idempotency-key"];
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !IDEMPOTENCY_KEY_RE.test(raw)) {
    throw Object.assign(new Error("Idempotency-Key không hợp lệ (tối đa 128 ký tự: chữ, số, _ . : -)"), { status: 400, code: "INVALID_IDEMPOTENCY_KEY" });
  }
  return raw;
}
const text = (max: number) => z.string().trim().min(1).max(max);
export const proposeBody = z.object({ reason: text(2000) }).strict();
export const decideBody = z.object({ reason: text(2000), conflictOfInterestDeclaredNone: z.boolean() }).strict();

async function run(res: Response, req: any, context: string, fn: (actor: Actor) => Promise<{ status?: number; body: unknown }>) {
  try {
    const actor = actorOf(req);
    if (!actor) return res.status(401).json({ error: "Cần đăng nhập", code: "UNAUTHENTICATED" });
    const out = await fn(actor);
    res.set("Cache-Control", "no-store");
    if ((out.body as { replayed?: boolean })?.replayed) res.set("Idempotent-Replay", "true");
    return res.status(out.status ?? 200).json(out.body);
  } catch (error: any) {
    if (error instanceof ZodError) {
      return res.status(400).json({ error: "Dữ liệu gửi lên không hợp lệ", code: "INVALID_INPUT", fields: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    if (error && typeof error.status === "number" && typeof error.code === "string") {
      return res.status(error.status).json({ error: error.message, code: error.code, ...(error.details === undefined ? {} : { details: error.details }) });
    }
    logger.error(error, `Decision replacement error (${context})`);
    return res.status(500).json({ error: "Không xử lý được yêu cầu. Vui lòng thử lại.", code: "INTERNAL_ERROR" });
  }
}

export const decisionReplacementController = {
  list: (req: any, res: Response) => run(res, req, "list", async (actor) => ({ body: await decisionReplacementService.list(actor, String(req.params.caseId)) })),
  propose: (req: any, res: Response) =>
    run(res, req, "propose", async (actor) => ({ status: 201, body: await decisionReplacementService.propose(actor, String(req.params.caseId), proposeBody.parse(req.body ?? {}), idempotencyKeyOf(req)) })),
  approve: (req: any, res: Response) =>
    run(res, req, "approve", async (actor) => ({
      body: await decisionReplacementService.approve(actor, String(req.params.caseId), String(req.params.replacementId), decideBody.parse(req.body ?? {}), idempotencyKeyOf(req)),
    })),
  reject: (req: any, res: Response) =>
    run(res, req, "reject", async (actor) => ({
      body: await decisionReplacementService.reject(actor, String(req.params.caseId), String(req.params.replacementId), decideBody.parse(req.body ?? {}), idempotencyKeyOf(req)),
    })),
};
