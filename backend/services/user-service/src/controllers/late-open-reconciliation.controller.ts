import type { Response } from "express";
import { ZodError, z, type ZodTypeAny } from "zod";
import { logger } from "@gym-coach/shared";
import { lateOpenReconciliationService, type Actor } from "../services/late-open-reconciliation.service";

/**
 * Late-open reconciliation endpoints (final safety gate). ADMIN only (the router also runs authMiddleware + roleMiddleware). The identity comes ONLY from x-user-id / x-user-role (installed by
 * authMiddleware from the verified token); every body schema is strict, so an `amount`, an `approvedBy`, a `settleLateOpen` or a `userId` in a body is refused, not ignored. No endpoint acts on more
 * than one row. Mutating routes accept an `Idempotency-Key` header.
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
export const claimBody = z.object({}).strict();
export const proposalBody = z
  .object({
    reason: text(2000),
    verificationNote: text(4000),
    evidenceRefs: z.array(text(500)).min(1).max(20),
    policyBasis: text(4000),
  })
  .strict();
export const approveBody = z.object({ reason: text(2000), conflictOfInterestDeclaredNone: z.boolean() }).strict();
export const rejectBody = z.object({ reason: text(2000) }).strict();
export const emptyBody = z.object({}).strict();
export const handoverBody = z.object({ newAssigneeId: text(128), reason: text(2000) }).strict();
export const recoveryOpenBody = z.object({ reason: text(2000) }).strict();

function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data ?? {});
}

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
    logger.error(error, `Late-open reconciliation error (${context})`);
    return res.status(500).json({ error: "Không xử lý được yêu cầu đối soát. Vui lòng thử lại.", code: "INTERNAL_ERROR" });
  }
}

const intParam = (v: unknown): number | undefined => (typeof v === "string" && /^\d{1,4}$/.test(v) ? Number(v) : undefined);

export const lateOpenReconciliationController = {
  list: (req: any, res: Response) => run(res, req, "list", async (actor) => ({ body: await lateOpenReconciliationService.list(actor, { limit: intParam(req.query.limit) }) })),
  get: (req: any, res: Response) => run(res, req, "get", async (actor) => ({ body: await lateOpenReconciliationService.get(actor, String(req.params.rowId)) })),
  claim: (req: any, res: Response) =>
    run(res, req, "claim", async (actor) => {
      parse(claimBody, req.body);
      return { body: await lateOpenReconciliationService.claim(actor, String(req.params.rowId), idempotencyKeyOf(req)) };
    }),
  propose: (req: any, res: Response) =>
    run(res, req, "propose", async (actor) => ({ status: 201, body: await lateOpenReconciliationService.propose(actor, String(req.params.rowId), parse(proposalBody, req.body), idempotencyKeyOf(req)) })),
  approve: (req: any, res: Response) =>
    run(res, req, "approve", async (actor) => ({ body: await lateOpenReconciliationService.approve(actor, String(req.params.proposalId), parse(approveBody, req.body), idempotencyKeyOf(req)) })),
  reject: (req: any, res: Response) =>
    run(res, req, "reject", async (actor) => ({ body: await lateOpenReconciliationService.reject(actor, String(req.params.proposalId), parse(rejectBody, req.body), idempotencyKeyOf(req)) })),
  handover: (req: any, res: Response) =>
    run(res, req, "handover", async (actor) => ({ body: await lateOpenReconciliationService.handover(actor, String(req.params.rowId), parse(handoverBody, req.body), idempotencyKeyOf(req)) })),
  openRecovery: (req: any, res: Response) =>
    run(res, req, "openRecovery", async (actor) => ({ status: 201, body: await lateOpenReconciliationService.openRecovery(actor, String(req.params.proposalId), parse(recoveryOpenBody, req.body), idempotencyKeyOf(req)) })),
  approveRecovery: (req: any, res: Response) =>
    run(res, req, "approveRecovery", async (actor) => ({ body: await lateOpenReconciliationService.approveRecovery(actor, String(req.params.recoveryId), parse(approveBody, req.body), idempotencyKeyOf(req)) })),
  rejectRecovery: (req: any, res: Response) =>
    run(res, req, "rejectRecovery", async (actor) => ({ body: await lateOpenReconciliationService.rejectRecovery(actor, String(req.params.recoveryId), parse(rejectBody, req.body), idempotencyKeyOf(req)) })),
  retry: (req: any, res: Response) =>
    run(res, req, "retry", async (actor) => {
      parse(emptyBody, req.body);
      return { body: await lateOpenReconciliationService.retry(actor, String(req.params.proposalId)) };
    }),
};
