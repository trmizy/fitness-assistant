import type { Response } from "express";
import { ZodError, z, type ZodTypeAny } from "zod";
import { logger } from "@gym-coach/shared";
import { d65bResolutionService, type Actor } from "../services/d65b-resolution.service";

/**
 * D65-B endpoints (admin resolution of the money held for a NO_SHOW session). ADMIN only (the router also runs authMiddleware + roleMiddleware). The identity comes ONLY from x-user-id /
 * x-user-role (installed by authMiddleware from the verified token). Every body schema is STRICT: an `amount`, `outcome`, `userId`, `approvedBy`, `sessionId` ... in a body is refused (400), not
 * ignored. One session per call; there is no batch route. Mutating routes accept an `Idempotency-Key` header.
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
/** Verifiable references only: an existing case-evidence row (id + its content hash) or a ledger operation key of this contract's payment. Free text is refused. */
const evidenceRef = z.discriminatedUnion("type", [
  z.object({ type: z.literal("EVIDENCE"), id: text(64), contentHash: text(200) }).strict(),
  z.object({ type: z.literal("LEDGER_OP"), key: text(200) }).strict(),
]);
export const proposeBody = z.object({ reason: text(2000), evidenceRefs: z.array(evidenceRef).min(1).max(20) }).strict();
export const rejectBody = z.object({ reason: text(2000), conflictOfInterestDeclaredNone: z.boolean() }).strict();
export const handoverBody = rejectBody;
export const approveBody = z.object({ reason: text(2000), conflictOfInterestDeclaredNone: z.boolean() }).strict();

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
    logger.error(error, `D65-B resolution error (${context})`);
    return res.status(500).json({ error: "Không xử lý được yêu cầu. Vui lòng thử lại.", code: "INTERNAL_ERROR" });
  }
}

const intParam = (v: unknown): number | undefined => (typeof v === "string" && /^\d{1,4}$/.test(v) ? Number(v) : undefined);

export const d65bResolutionController = {
  list: (req: any, res: Response) => run(res, req, "list", async (actor) => ({ body: await d65bResolutionService.list(actor, { limit: intParam(req.query.limit) }) })),
  get: (req: any, res: Response) => run(res, req, "get", async (actor) => ({ body: await d65bResolutionService.get(actor, String(req.params.id)) })),
  getBySession: (req: any, res: Response) => run(res, req, "getBySession", async (actor) => ({ body: await d65bResolutionService.getBySession(actor, String(req.params.sessionId)) })),
  propose: (req: any, res: Response) =>
    run(res, req, "propose", async (actor) => ({ status: 201, body: await d65bResolutionService.propose(actor, String(req.params.sessionId), parse(proposeBody, req.body), idempotencyKeyOf(req)) })),
  reject: (req: any, res: Response) =>
    run(res, req, "reject", async (actor) => ({ body: await d65bResolutionService.reject(actor, String(req.params.id), parse(rejectBody, req.body), idempotencyKeyOf(req)) })),
  handover: (req: any, res: Response) =>
    run(res, req, "handover", async (actor) => {
      const body = await d65bResolutionService.handover(actor, String(req.params.id), parse(handoverBody, req.body));
      const exec = (body as { execution?: { status?: string } }).execution;
      return { status: exec && exec.status !== "EXECUTED" ? 202 : 200, body };
    }),
  approve: (req: any, res: Response) =>
    run(res, req, "approve", async (actor) => {
      const body = await d65bResolutionService.approve(actor, String(req.params.id), parse(approveBody, req.body), idempotencyKeyOf(req));
      // approved but the ledger credit is not confirmed (failed / timed out / in flight): 202, the money is still held and nothing is said to be paid
      const exec = (body as { execution?: { status?: string } }).execution;
      return { status: exec && exec.status !== "EXECUTED" ? 202 : 200, body };
    }),
};
