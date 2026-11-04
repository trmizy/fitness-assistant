import type { Response } from "express";
import { ZodError, z, type ZodTypeAny } from "zod";
import { logger } from "@gym-coach/shared";
import { disputeCaseService, type Actor } from "../services/dispute-case/dispute-case.service";
import { executionService } from "../services/dispute-case/execution.service";
import { processService } from "../services/dispute-case/process.service";
import { contractPolicyReviewService } from "../services/dispute-case/contract-policy-review.service";
import { evidenceStorageEnabled } from "../services/dispute-case/flags";
import { MAX_EVIDENCE_BYTES } from "../services/dispute-case/evidence-storage";
import multer from "multer";
import {
  accessLogQuery,
  ackBody,
  agreementBody,
  agreementConfirmBody,
  appealBody,
  appealDecisionBody,
  appealReviewerBody,
  heldDecisionBody,
  heldQuery,
  quotaCorrectionBody,
  stuckQuery,
  acknowledgeNeedsHumanBody,
  approvalBody,
  assessmentBody,
  assignBody,
  claimBody,
  classifyBody,
  contractPolicyReviewBody,
  closeBody,
  emptyBody,
  executeBody,
  findingBody,
  intakeBody,
  issueBody,
  listQuery,
  partyEvidenceBody,
  policyEligibilityApproveBody,
  policyEligibilityBody,
  proposalBody,
  queueQuery,
  requestMoreBody,
  shareBody,
  statementBody,
  transitionBody,
} from "../services/dispute-case/schemas";

/**
 * Dispute Case endpoints (slice 1). Identity comes ONLY from x-user-id / x-user-role (installed by authMiddleware from the verified token);
 * no handler reads a user id from the body, and every body schema is strict. Errors: Vietnamese `error` + stable `code`.
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

/**
 * F11: the writes that create a row and have no natural unique key (claim, issue, assessment, party statement, party evidence / evidence file) REQUIRE an
 * Idempotency-Key, so a double click cannot add a duplicate: a missing key is 400 IDEMPOTENCY_KEY_REQUIRED (nothing is written). The UI sends one UUID per opened form.
 */
function requiredIdempotencyKeyOf(req: any): string {
  const key = idempotencyKeyOf(req);
  if (!key) {
    throw Object.assign(new Error("Thiếu Idempotency-Key (bắt buộc cho thao tác này để bấm đúp không tạo bản ghi trùng; tối đa 128 ký tự: chữ, số, _ . : -)"), { status: 400, code: "IDEMPOTENCY_KEY_REQUIRED" });
  }
  return key;
}

function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data ?? {});
}

async function run(res: Response, fn: (actor: Actor) => Promise<{ status?: number; body: unknown; replayed?: boolean }>, req: any, context: string) {
  try {
    const actor = actorOf(req);
    if (!actor) return res.status(401).json({ error: "Cần đăng nhập", code: "UNAUTHENTICATED" });
    const out = await fn(actor);
    res.set("Cache-Control", "no-store");
    if (out.replayed) res.set("Idempotent-Replay", "true");
    return res.status(out.status ?? 200).json(out.body);
  } catch (error: any) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: "Dữ liệu gửi lên không hợp lệ",
        code: "INVALID_INPUT",
        fields: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    if (error && typeof error.status === "number" && typeof error.code === "string") {
      return res.status(error.status).json({ error: error.message, code: error.code, ...(error.details === undefined ? {} : { details: error.details }) });
    }
    logger.error(error, `Dispute case error (${context})`);
    return res.status(500).json({ error: "Không xử lý được yêu cầu về hồ sơ khiếu nại. Vui lòng thử lại.", code: "INTERNAL_ERROR" });
  }
}

const idOf = (req: any) => String(req.params.id);

// Slice 2 / S2.8 - evidence files (dev / test only, flag-gated). Memory storage with a hard cap (one byte over the limit is refused by multer itself);
// the service re-checks size, type-from-bytes and the party, and writes to the evidence directory only after those checks.
const fileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_EVIDENCE_BYTES + 1, files: 1, fields: 5, fieldSize: 4000 } });
const evidenceFileFields = z.object({ description: z.string().trim().min(1).max(2000), title: z.string().trim().min(1).max(200).optional() }).strict();

export const disputeCaseController = {
  /** Flag first (404 when the feature is OFF - fail closed, nothing is parsed), then the multipart parser. */
  evidenceFileGate: (req: any, res: Response, next: (e?: any) => void): void => {
    if (!evidenceStorageEnabled()) {
      res.status(404).json({ error: "Chức năng lưu tệp bằng chứng chưa được bật", code: "FEATURE_DISABLED" });
      return;
    }
    fileUpload.single("file")(req, res, (err: any) => {
      if (!err) {
        next();
        return;
      }
      if (err?.code === "LIMIT_FILE_SIZE") res.status(413).json({ error: "Tệp quá lớn", code: "FILE_TOO_LARGE" });
      else res.status(400).json({ error: "Không đọc được dữ liệu tải lên", code: "INVALID_UPLOAD" });
    });
  },

  partyEvidenceFile: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        if (!req.file) throw Object.assign(new Error("Chưa chọn tệp (trường 'file')"), { status: 400, code: "FILE_REQUIRED" });
        const fields = parse(evidenceFileFields, req.body);
        const r = await disputeCaseService.submitEvidenceFile(
          actor,
          idOf(req),
          { bytes: req.file.buffer, declaredMime: String(req.file.mimetype || ""), originalName: req.file.originalname, description: fields.description, title: fields.title },
          requiredIdempotencyKeyOf(req),
        );
        return { status: r.replayed ? 200 : 201, body: r.result, replayed: r.replayed };
      },
      req,
      "partyEvidenceFile",
    ),

  /** Party (own file) and admin (non-party) share this handler; the service decides who may read. */
  evidenceFile: async (req: any, res: Response) => {
    try {
      const actor = actorOf(req);
      if (!actor) return res.status(401).json({ error: "Cần đăng nhập", code: "UNAUTHENTICATED" });
      const f = await disputeCaseService.readEvidenceFile(actor, idOf(req), String(req.params.evidenceId));
      res.set({ "Cache-Control": "no-store", "Content-Type": f.mime, "Content-Disposition": "attachment", "X-Content-Type-Options": "nosniff", "X-Evidence-Sha256": f.sha256 });
      return res.status(200).send(f.bytes);
    } catch (error: any) {
      if (error && typeof error.status === "number" && typeof error.code === "string") return res.status(error.status).json({ error: error.message, code: error.code });
      logger.error(error, "Dispute case error (evidenceFile)");
      return res.status(500).json({ error: "Không xử lý được yêu cầu về hồ sơ khiếu nại. Vui lòng thử lại.", code: "INTERNAL_ERROR" });
    }
  },

  // ── admin: slice 2 executor (refused unless DISPUTE_CASE_EXECUTION_ENABLED is effective: fail-closed, test environment only) ──
  execute: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const b = parse(executeBody, req.body);
        const r = await executionService.executeDecision(actor, idOf(req), { decisionId: b.decisionId });
        return { body: r, replayed: r.replayed };
      },
      req,
      "execute",
    ),

  reconcileExecution: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        parse(emptyBody, req.body);
        return { body: await executionService.reconcileExecution(actor, idOf(req)) };
      },
      req,
      "reconcileExecution",
    ),

  // ── admin ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  open: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const b = parse(intakeBody, req.body);
        const r = await disputeCaseService.openCase(actor, b.sessionId, idempotencyKeyOf(req));
        return { status: r.result.created ? 201 : 200, body: r.result, replayed: r.replayed };
      },
      req,
      "open",
    ),

  list: (req: any, res: Response) =>
    run(res, async (actor) => ({ body: await disputeCaseService.list(actor, parse(listQuery, req.query)) }), req, "list"),

  proposeContractPolicy: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const r = await contractPolicyReviewService.propose(actor, String(req.params.contractId).slice(0, 64), parse(contractPolicyReviewBody, req.body), idempotencyKeyOf(req));
        return { status: r.replayed ? 200 : 201, body: r.result, replayed: r.replayed };
      },
      req,
      "proposeContractPolicy",
    ),

  approveContractPolicy: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const r = await contractPolicyReviewService.approve(actor, String(req.params.contractId).slice(0, 64), String(req.params.reviewId).slice(0, 64), parse(policyEligibilityApproveBody, req.body), idempotencyKeyOf(req));
        return { body: r.result, replayed: r.replayed };
      },
      req,
      "approveContractPolicy",
    ),

  classifyContractPolicy: (req: any, res: Response) =>
    run(res, async (actor) => ({ body: await contractPolicyReviewService.classify(actor, String(req.params.contractId).slice(0, 64)) }), req, "classifyContractPolicy"),

  capabilities: (req: any, res: Response) => run(res, async (actor) => ({ body: disputeCaseService.capabilities(actor) }), req, "capabilities"),

  accessLog: (req: any, res: Response) => run(res, async (actor) => ({ body: await disputeCaseService.accessLog(actor, idOf(req), parse(accessLogQuery, req.query)) }), req, "accessLog"),

  adminSession: (req: any, res: Response) => run(res, async (actor) => ({ body: await disputeCaseService.getSessionForAdmin(actor, String(req.params.id)) }), req, "adminSession"),

  queue: (req: any, res: Response) => run(res, async (actor) => ({ body: await disputeCaseService.queue(actor, parse(queueQuery, req.query)) }), req, "queue"),

  policyReviewsOfCase: (req: any, res: Response) => run(res, async (actor) => ({ body: await disputeCaseService.listPolicyReviewsOfCase(actor, idOf(req)) }), req, "policyReviewsOfCase"),

  policyReviewsOfContract: (req: any, res: Response) =>
    run(res, async (actor) => ({ body: await disputeCaseService.listPolicyReviewsForContract(actor, String(req.params.contractId).slice(0, 64)) }), req, "policyReviewsOfContract"),

  closeOrphan: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const r = await disputeCaseService.closeOrphan(actor, idOf(req), parse(closeBody, req.body).reason, idempotencyKeyOf(req));
        return { body: r.result, replayed: r.replayed };
      },
      req,
      "closeOrphan",
    ),

  // ── V2.1 process: deadlines, stuck queue, held money, agreement, appeal, quota correction ──
  deadlines: (req: any, res: Response) => run(res, async (actor) => ({ body: await disputeCaseService.listDeadlines(actor, idOf(req)) }), req, "deadlines"),
  stuck: (req: any, res: Response) => run(res, async (actor) => ({ body: await processService.stuckQueue(actor, parse(stuckQuery, req.query)) }), req, "stuck"),
  heldMoneyList: (req: any, res: Response) => run(res, async (actor) => ({ body: await processService.listHeldMoney(actor, parse(heldQuery, req.query)) }), req, "heldMoneyList"),
  heldMoneyDecide: (req: any, res: Response) =>
    run(res, async (actor) => ({ body: await processService.decideHeldMoney(actor, String(req.params.reviewId).slice(0, 64), parse(heldDecisionBody, req.body)) }), req, "heldMoneyDecide"),
  agreementsList: (req: any, res: Response) => run(res, async (actor) => ({ body: await processService.listAgreements(actor, idOf(req)) }), req, "agreementsList"),
  proposeAgreement: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const r = await processService.proposeAgreement(actor, idOf(req), parse(agreementBody, req.body), requiredIdempotencyKeyOf(req));
        return { status: r.replayed ? 200 : 201, body: r.result, replayed: r.replayed };
      },
      req,
      "proposeAgreement",
    ),
  withdrawAgreement: (req: any, res: Response) =>
    run(res, async (actor) => { const r = await processService.withdrawAgreement(actor, idOf(req), String(req.params.agreementId), idempotencyKeyOf(req)); return { body: r.result, replayed: r.replayed }; }, req, "withdrawAgreement"),
  recordAgreementFinding: (req: any, res: Response) =>
    run(res, async (actor) => { const r = await processService.recordAgreementFinding(actor, idOf(req), String(req.params.agreementId), idempotencyKeyOf(req)); return { status: r.replayed ? 200 : 201, body: r.result, replayed: r.replayed }; }, req, "recordAgreementFinding"),
  confirmAgreement: (req: any, res: Response) =>
    run(res, async (actor) => { const r = await processService.confirmAgreement(actor, idOf(req), String(req.params.agreementId), parse(agreementConfirmBody, req.body), idempotencyKeyOf(req)); return { body: r.result, replayed: r.replayed }; }, req, "confirmAgreement"),
  requestAppeal: (req: any, res: Response) =>
    run(res, async (actor) => { const r = await processService.requestAppeal(actor, idOf(req), parse(appealBody, req.body), requiredIdempotencyKeyOf(req)); return { status: r.replayed ? 200 : 201, body: r.result, replayed: r.replayed }; }, req, "requestAppeal"),
  appealsList: (req: any, res: Response) => run(res, async (actor) => ({ body: await processService.listAppeals(actor, idOf(req)) }), req, "appealsList"),
  assignAppealReviewer: (req: any, res: Response) =>
    run(res, async (actor) => { const r = await processService.assignAppealReviewer(actor, idOf(req), String(req.params.appealId), parse(appealReviewerBody, req.body), idempotencyKeyOf(req)); return { body: r.result, replayed: r.replayed }; }, req, "assignAppealReviewer"),
  decideAppeal: (req: any, res: Response) =>
    run(res, async (actor) => { const r = await processService.decideAppeal(actor, idOf(req), String(req.params.appealId), parse(appealDecisionBody, req.body), idempotencyKeyOf(req)); return { body: r.result, replayed: r.replayed }; }, req, "decideAppeal"),
  proposeQuotaCorrection: (req: any, res: Response) =>
    run(res, async (actor) => { const r = await processService.proposeQuotaCorrection(actor, idOf(req), String(req.params.consequenceId), parse(quotaCorrectionBody, req.body), requiredIdempotencyKeyOf(req)); return { status: r.replayed ? 200 : 201, body: r.result, replayed: r.replayed }; }, req, "proposeQuotaCorrection"),
  approveQuotaCorrection: (req: any, res: Response) =>
    run(res, async (actor) => { const r = await processService.approveQuotaCorrection(actor, idOf(req), String(req.params.correctionId), parse(policyEligibilityApproveBody, req.body), idempotencyKeyOf(req)); return { body: r.result, replayed: r.replayed }; }, req, "approveQuotaCorrection"),

  closeExecuted: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const r = await disputeCaseService.closeExecuted(actor, idOf(req), parse(closeBody, req.body).reason, idempotencyKeyOf(req));
        return { body: r.result, replayed: r.replayed };
      },
      req,
      "closeExecuted",
    ),

  closeNotADispute: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const r = await disputeCaseService.closeNotADispute(actor, idOf(req), parse(closeBody, req.body).reason, idempotencyKeyOf(req));
        return { body: r.result, replayed: r.replayed };
      },
      req,
      "closeNotADispute",
    ),

  acknowledgeNeedsHuman: (req: any, res: Response) =>
    run(res, async (actor) => ({ body: await executionService.acknowledgeNeedsHuman(actor, idOf(req), parse(acknowledgeNeedsHumanBody, req.body).note) }), req, "acknowledgeNeedsHuman"),

  get: (req: any, res: Response) => run(res, async (actor) => ({ body: await disputeCaseService.getForAdmin(actor, idOf(req)) }), req, "get"),

  assign: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const b = parse(assignBody, req.body);
        const r = await disputeCaseService.assign(actor, idOf(req), b.investigatorId, idempotencyKeyOf(req));
        return { body: r.result, replayed: r.replayed };
      },
      req,
      "assign",
    ),

  recollect: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        parse(emptyBody, req.body);
        const r = await disputeCaseService.recollect(actor, idOf(req), idempotencyKeyOf(req));
        return { body: r.result, replayed: r.replayed };
      },
      req,
      "recollect",
    ),

  transition: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const b = parse(transitionBody, req.body);
        const r = await disputeCaseService.transition(actor, idOf(req), b.to, { reason: b.reason, note: b.note }, idempotencyKeyOf(req));
        return { body: r.result, replayed: r.replayed };
      },
      req,
      "transition",
    ),

  requestMore: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const b = parse(requestMoreBody, req.body);
        const r = await disputeCaseService.requestMore(actor, idOf(req), b.to, b.note, idempotencyKeyOf(req));
        return { body: r.result, replayed: r.replayed };
      },
      req,
      "requestMore",
    ),

  classify: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const r = await disputeCaseService.classify(actor, idOf(req), parse(classifyBody, req.body).type, idempotencyKeyOf(req));
        return { body: r.result, replayed: r.replayed };
      },
      req,
      "classify",
    ),

  addClaim: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const r = await disputeCaseService.addClaim(actor, idOf(req), parse(claimBody, req.body), requiredIdempotencyKeyOf(req));
        return { status: r.replayed ? 200 : 201, body: r.result, replayed: r.replayed };
      },
      req,
      "addClaim",
    ),

  addIssue: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const r = await disputeCaseService.addIssue(actor, idOf(req), parse(issueBody, req.body), requiredIdempotencyKeyOf(req));
        return { status: r.replayed ? 200 : 201, body: r.result, replayed: r.replayed };
      },
      req,
      "addIssue",
    ),

  addAssessment: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const r = await disputeCaseService.addAssessment(actor, idOf(req), parse(assessmentBody, req.body), requiredIdempotencyKeyOf(req));
        return { status: r.replayed ? 200 : 201, body: r.result, replayed: r.replayed };
      },
      req,
      "addAssessment",
    ),

  recordFinding: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const r = await disputeCaseService.recordFinding(actor, idOf(req), parse(findingBody, req.body), idempotencyKeyOf(req));
        return { status: r.replayed ? 200 : 201, body: r.result, replayed: r.replayed };
      },
      req,
      "recordFinding",
    ),

  propose: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const b = parse(proposalBody, req.body);
        const r = await disputeCaseService.propose(actor, idOf(req), b.note, idempotencyKeyOf(req));
        // F4: 201 ONLY when a proposal row was created now. 200 when nothing was created (proposalCreated:false, the case moved to a waiting state) and on a replay.
        return { status: r.result.proposalCreated === true && !r.replayed ? 201 : 200, body: r.result, replayed: r.replayed };
      },
      req,
      "propose",
    ),

  decide: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const r = await disputeCaseService.decide(actor, idOf(req), parse(approvalBody, req.body), idempotencyKeyOf(req));
        return { body: r.result, replayed: r.replayed };
      },
      req,
      "decide",
    ),

  proposePolicyEligibility: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const r = await disputeCaseService.proposePolicyEligibility(actor, idOf(req), parse(policyEligibilityBody, req.body), idempotencyKeyOf(req));
        return { body: r.result, replayed: r.replayed };
      },
      req,
      "proposePolicyEligibility",
    ),

  approvePolicyEligibility: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const r = await disputeCaseService.approvePolicyEligibility(actor, idOf(req), String(req.params.reviewId), parse(policyEligibilityApproveBody, req.body), idempotencyKeyOf(req));
        return { body: r.result, replayed: r.replayed };
      },
      req,
      "approvePolicyEligibility",
    ),

  acknowledgeEvidenceChange: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const b = parse(ackBody, req.body);
        const r = await disputeCaseService.acknowledgeEvidenceChange(actor, idOf(req), b.note, idempotencyKeyOf(req));
        return { body: r.result, replayed: r.replayed };
      },
      req,
      "acknowledgeEvidenceChange",
    ),

  share: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const r = await disputeCaseService.share(actor, idOf(req), parse(shareBody, req.body), idempotencyKeyOf(req));
        return { status: r.replayed ? 200 : 201, body: r.result, replayed: r.replayed };
      },
      req,
      "share",
    ),

  // ── parties ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  partyList: (req: any, res: Response) => run(res, async (actor) => ({ body: await disputeCaseService.listForParty(actor) }), req, "partyList"),

  partyGet: (req: any, res: Response) => run(res, async (actor) => ({ body: await disputeCaseService.getForParty(actor, idOf(req)) }), req, "partyGet"),

  partyStatement: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const r = await disputeCaseService.submitStatement(actor, idOf(req), parse(statementBody, req.body), requiredIdempotencyKeyOf(req));
        return { status: r.replayed ? 200 : 201, body: r.result, replayed: r.replayed };
      },
      req,
      "partyStatement",
    ),

  partyEvidence: (req: any, res: Response) =>
    run(
      res,
      async (actor) => {
        const r = await disputeCaseService.submitEvidence(actor, idOf(req), parse(partyEvidenceBody, req.body), requiredIdempotencyKeyOf(req));
        return { status: r.replayed ? 200 : 201, body: r.result, replayed: r.replayed };
      },
      req,
      "partyEvidence",
    ),
};
