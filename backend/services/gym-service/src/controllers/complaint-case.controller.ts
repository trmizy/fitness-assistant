import type { Request, Response } from 'express';
import { ZodError, z, type ZodTypeAny } from 'zod';
import { logger } from '@gym-coach/shared';
import { complaintCaseService, type Actor } from '../services/complaint-case/case.service';
import { complaintCaseExecutionService } from '../services/complaint-case/execution.service';
import { appealService } from '../services/complaint-case/appeal.service';
import { decisionReplacementService } from '../services/complaint-case/decision-replacement.service';
import { flagVerdict, replacementEnabled, GYM_DECISION_REPLACEMENT_FLAG } from '../services/complaint-case/flags';
import { explainerService, type GymScope } from '../services/complaint-case/explainer.service';
import {
  ackBody,
  replaceApproveBody,
  replaceProposeBody,
  replaceRejectBody,
  appealBody,
  assignReviewerBody,
  assessmentBody,
  assignBody,
  claimBody,
  decisionBody,
  emptyBody,
  evidenceBody,
  executeBody,
  findingBody,
  listQuery,
  openCaseBody,
  proposalBody,
  requestMoreBody,
  shareBody,
  statementBody,
  transitionBody,
} from '../services/complaint-case/schemas';

/**
 * Complaint-case endpoints (Dispute V2.1 Slice 3). Identity comes ONLY from the verified token (extractUser -> req.user); no handler reads a user id
 * from the body and every body schema is strict. Envelope as the rest of gym-service: { success, data } / { success:false, error:{ code, message } }.
 */
function actorOf(req: Request): Actor | null {
  return req.user?.userId ? { id: req.user.userId, role: req.user.role } : null;
}

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
function idempotencyKeyOf(req: Request): string | undefined {
  const raw = req.headers['idempotency-key'];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !IDEMPOTENCY_KEY_RE.test(raw)) {
    throw Object.assign(new Error('Idempotency-Key không hợp lệ (tối đa 128 ký tự: chữ, số, _ . : -)'), { status: 400, code: 'INVALID_IDEMPOTENCY_KEY' });
  }
  return raw;
}
const parse = <S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> => schema.parse(data ?? {});

async function run(
  req: Request,
  res: Response,
  context: string,
  fn: (actor: Actor, key: string | undefined) => Promise<{ status?: number; data: unknown; replayed?: boolean }>,
) {
  try {
    const actor = actorOf(req);
    if (!actor) return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Cần đăng nhập' } });
    const out = await fn(actor, idempotencyKeyOf(req));
    res.set('Cache-Control', 'no-store');
    if (out.replayed) res.set('Idempotent-Replay', 'true');
    return res.status(out.status ?? 200).json({ success: true, data: out.data });
  } catch (error: any) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Dữ liệu gửi lên không hợp lệ', fields: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      });
    }
    if (error && typeof error.status === 'number' && typeof error.code === 'string') {
      return res.status(error.status).json({ success: false, error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) } });
    }
    logger.error(error, `Complaint case error (${context})`);
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Không xử lý được yêu cầu về hồ sơ khiếu nại. Vui lòng thử lại.' } });
  }
}

const idParam = (req: Request) => String(req.params.id);
function gymScopeOf(req: Request): GymScope {
  const p = req.partner;
  if (!p || !req.user) throw Object.assign(new Error('Không xác định được tài khoản đối tác'), { status: 403, code: 'PARTNER_CONTEXT_UNRESOLVED' });
  return { principalUserId: p.principalUserId, userId: req.user.userId, role: p.role, scopedGymIds: p.scopedGymIds };
}
const historyQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(200), offset: z.coerce.number().int().min(0).max(100000).default(0) }).strict();

export const complaintCaseController = {
  // ── Admin ────────────────────────────────────────────────────────────────────────────────────────────────────
  open: (req: Request, res: Response) =>
    run(req, res, 'open', async (a, k) => {
      const r = await complaintCaseService.openCase(a, idParam(req), parse(openCaseBody, req.body) as any, k);
      return { status: r.replayed ? 200 : 201, data: r.result, replayed: r.replayed };
    }),
  /** INT-09: read-only, admin-only. Every verdict comes from the same functions the write paths use (flags.ts); nothing is re-implemented. */
  capabilities: (req: Request, res: Response) =>
    run(req, res, 'capabilities', async () => {
      const gc = flagVerdict();
      const rep = replacementEnabled();
      const repRefused = rep ? undefined : gc.effective ? (process.env[GYM_DECISION_REPLACEMENT_FLAG] === 'true' ? undefined : 'FLAG_OFF') : (gc.refusedBecause ?? 'FLAG_OFF');
      return {
        data: {
          gymCase: { effective: gc.effective, ...(gc.refusedBecause ? { refusedBecause: gc.refusedBecause } : {}) },
          decisionReplacement: { effective: rep, ...(repRefused ? { refusedBecause: repRefused } : {}) },
          gymParty: { effective: false },
        },
      };
    }),
  /** INT-15: read-only, admin-only. Memberships of the complaint's reporter at the complaint's gym; `refundable` comes from the case path's own predicate. */
  membershipOptions: (req: Request, res: Response) =>
    run(req, res, 'membershipOptions', async (a) => ({ data: await complaintCaseService.membershipOptions(a, idParam(req)) })),
  list: (req: Request, res: Response) => run(req, res, 'list', async (a) => ({ data: await complaintCaseService.list(a, parse(listQuery, req.query)) })),
  detail: (req: Request, res: Response) => run(req, res, 'detail', async (a) => ({ data: await complaintCaseService.getForAdmin(a, idParam(req)) })),
  history: (req: Request, res: Response) => run(req, res, 'history', async (a) => ({ data: await complaintCaseService.history(a, idParam(req), parse(historyQuery, req.query)) })),
  assign: (req: Request, res: Response) =>
    run(req, res, 'assign', async (a, k) => {
      const r = await complaintCaseService.assign(a, idParam(req), parse(assignBody, req.body).investigatorId, k);
      return { data: r.result, replayed: r.replayed };
    }),
  transition: (req: Request, res: Response) =>
    run(req, res, 'transition', async (a, k) => {
      const b = parse(transitionBody, req.body);
      const r = await complaintCaseService.transition(a, idParam(req), b.to as any, { reason: b.reason }, k);
      return { data: r.result, replayed: r.replayed };
    }),
  requestMore: (req: Request, res: Response) =>
    run(req, res, 'request-more', async (a, k) => {
      const b = parse(requestMoreBody, req.body);
      const r = await complaintCaseService.requestMore(a, idParam(req), b.to, b.note, k, b.parties);
      return { data: r.result, replayed: r.replayed };
    }),
  recollect: (req: Request, res: Response) =>
    run(req, res, 'recollect', async (a, k) => {
      parse(emptyBody, req.body);
      const r = await complaintCaseService.recollect(a, idParam(req), k);
      return { data: r.result, replayed: r.replayed };
    }),
  claim: (req: Request, res: Response) =>
    run(req, res, 'claim', async (a, k) => {
      const r = await complaintCaseService.addClaim(a, idParam(req), parse(claimBody, req.body), k);
      return { status: 201, data: r.result, replayed: r.replayed };
    }),
  assessment: (req: Request, res: Response) =>
    run(req, res, 'assessment', async (a, k) => {
      const r = await complaintCaseService.addAssessment(a, idParam(req), parse(assessmentBody, req.body), k);
      return { status: 201, data: r.result, replayed: r.replayed };
    }),
  finding: (req: Request, res: Response) =>
    run(req, res, 'finding', async (a, k) => {
      const r = await complaintCaseService.recordFinding(a, idParam(req), parse(findingBody, req.body), k);
      return { status: 201, data: r.result, replayed: r.replayed };
    }),
  propose: (req: Request, res: Response) =>
    run(req, res, 'propose', async (a, k) => {
      const r = await complaintCaseService.propose(a, idParam(req), parse(proposalBody, req.body).note, k);
      return { status: 201, data: r.result, replayed: r.replayed };
    }),
  decision: (req: Request, res: Response) =>
    run(req, res, 'decision', async (a, k) => {
      const r = await complaintCaseService.decide(a, idParam(req), parse(decisionBody, req.body), k);
      return { data: r.result, replayed: r.replayed };
    }),
  ack: (req: Request, res: Response) =>
    run(req, res, 'ack', async (a, k) => {
      const r = await complaintCaseService.acknowledgeEvidenceChange(a, idParam(req), parse(ackBody, req.body).note, k);
      return { data: r.result, replayed: r.replayed };
    }),
  share: (req: Request, res: Response) =>
    run(req, res, 'share', async (a, k) => {
      const r = await complaintCaseService.share(a, idParam(req), parse(shareBody, req.body), k);
      return { status: 201, data: r.result, replayed: r.replayed };
    }),
  statementOnBehalf: (req: Request, res: Response) =>
    run(req, res, 'statement-on-behalf', async (a, k) => {
      const r = await complaintCaseService.statementOnBehalf(a, idParam(req), parse(statementBody, req.body), k);
      return { status: 201, data: r.result, replayed: r.replayed };
    }),
  evidenceOnBehalf: (req: Request, res: Response) =>
    run(req, res, 'evidence-on-behalf', async (a, k) => {
      const r = await complaintCaseService.evidenceOnBehalf(a, idParam(req), parse(evidenceBody, req.body), k);
      return { status: 201, data: r.result, replayed: r.replayed };
    }),
  execute: (req: Request, res: Response) =>
    run(req, res, 'execute', async (a) => ({ data: await complaintCaseExecutionService.executeDecision(a, idParam(req), parse(executeBody, req.body)) })),
  reconcile: (req: Request, res: Response) =>
    run(req, res, 'reconcile', async (a) => {
      parse(emptyBody, req.body);
      return { data: await complaintCaseExecutionService.reconcileExecution(a, idParam(req)) };
    }),

  replacementPropose: (req: Request, res: Response) =>
    run(req, res, 'replacement-propose', async (a, k) => {
      const r = await decisionReplacementService.propose(a, idParam(req), parse(replaceProposeBody, req.body).reason, k);
      return { status: 201, data: r.result, replayed: r.replayed };
    }),
  replacementApprove: (req: Request, res: Response) =>
    run(req, res, 'replacement-approve', async (a, k) => {
      const r = await decisionReplacementService.approve(a, idParam(req), parse(replaceApproveBody, req.body), k);
      return { data: r.result, replayed: r.replayed };
    }),
  replacementReject: (req: Request, res: Response) =>
    run(req, res, 'replacement-reject', async (a, k) => {
      const r = await decisionReplacementService.reject(a, idParam(req), parse(replaceRejectBody, req.body).reason, k);
      return { data: r.result, replayed: r.replayed };
    }),
  assignAppealReviewer: (req: Request, res: Response) =>
    run(req, res, 'appeal-assign', async (a, k) => {
      const r = await appealService.assignReviewer(a, idParam(req), parse(assignReviewerBody, req.body).reviewerId, k);
      return { data: r.result, replayed: r.replayed };
    }),

  // ── Gym (C10: evidence + explanation within its branch scope; owner router resolves the partner context) ──
  gymList: (req: Request, res: Response) => run(req, res, 'gym-list', async () => ({ data: await explainerService.list(gymScopeOf(req)) })),
  gymDetail: (req: Request, res: Response) => run(req, res, 'gym-detail', async (a) => ({ data: await explainerService.get(a, gymScopeOf(req), idParam(req)) })),
  gymExplain: (req: Request, res: Response) =>
    run(req, res, 'gym-explain', async (a, k) => {
      const r = await explainerService.explain(a, gymScopeOf(req), idParam(req), parse(statementBody, req.body), k);
      return { status: 201, data: r.result, replayed: r.replayed };
    }),
  gymEvidence: (req: Request, res: Response) =>
    run(req, res, 'gym-evidence', async (a, k) => {
      const r = await explainerService.addEvidence(a, gymScopeOf(req), idParam(req), parse(evidenceBody, req.body), k);
      return { status: 201, data: r.result, replayed: r.replayed };
    }),

  // ── Member (reporter) ────────────────────────────────────────────────────────────────────────────────────────
  appealMine: (req: Request, res: Response) =>
    run(req, res, 'appeal', async (a, k) => {
      const r = await appealService.fileAppeal(a, idParam(req), parse(appealBody, req.body), k);
      return { status: 201, data: r.result, replayed: r.replayed };
    }),
  listMine: (req: Request, res: Response) => run(req, res, 'list-mine', async (a) => ({ data: await complaintCaseService.listForMember(a) })),
  detailMine: (req: Request, res: Response) => run(req, res, 'detail-mine', async (a) => ({ data: await complaintCaseService.getForMember(a, idParam(req)) })),
  statementMine: (req: Request, res: Response) =>
    run(req, res, 'statement-mine', async (a, k) => {
      const r = await complaintCaseService.submitStatement(a, idParam(req), parse(statementBody, req.body), k);
      return { status: 201, data: r.result, replayed: r.replayed };
    }),
  evidenceMine: (req: Request, res: Response) =>
    run(req, res, 'evidence-mine', async (a, k) => {
      const r = await complaintCaseService.submitEvidence(a, idParam(req), parse(evidenceBody, req.body), k);
      return { status: 201, data: r.result, replayed: r.replayed };
    }),
};
