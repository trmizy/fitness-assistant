import { principalId } from '../middleware/partner-context.middleware';
import {
  adminAmenityCreateBodySchema,
  adminAmenityPatchBodySchema,
  adminProposalApproveBodySchema,
  adminProposalMergeBodySchema,
  adminProposalRejectBodySchema,
  ownerProposalBodySchema,
  ownerProposalPatchBodySchema,
  parseOrThrow,
} from '../services/gym-listing.schemas';
import { adminAmenityService, ownerAmenityService } from '../services/gym-amenity-catalog.service';
import { ok, wrap } from './gym-listing.controller';

export const amenityController = {
  // ── OWNER ────────────────────────────────────────────────────────────────────────────────────
  ownerCatalog: wrap(async (req, res) => ok(res, await ownerAmenityService.catalog(principalId(req)))),
  propose: wrap(async (req, res) => {
    const body = parseOrThrow(ownerProposalBodySchema, req.body);
    const out = await ownerAmenityService.propose(principalId(req), req.user!.userId, body);
    ok(res, out.body, out.status);
  }),
  updateProposal: wrap(async (req, res) => {
    const body = parseOrThrow(ownerProposalPatchBodySchema, req.body);
    ok(res, await ownerAmenityService.update(principalId(req), req.params.id, body));
  }),
  cancelProposal: wrap(async (req, res) => ok(res, await ownerAmenityService.cancel(principalId(req), req.user!.userId, req.params.id))),

  // ── ADMIN ────────────────────────────────────────────────────────────────────────────────────
  adminList: wrap(async (req, res) => {
    const q = req.query;
    ok(
      res,
      await adminAmenityService.list({
        status: typeof q.status === 'string' ? q.status : undefined,
        category: typeof q.category === 'string' ? q.category : undefined,
        q: typeof q.q === 'string' ? q.q : undefined,
      }),
    );
  }),
  adminCreate: wrap(async (req, res) => {
    const body = parseOrThrow(adminAmenityCreateBodySchema, req.body);
    ok(res, await adminAmenityService.create(req.user!.userId, body), 201);
  }),
  adminUpdate: wrap(async (req, res) => {
    const body = parseOrThrow(adminAmenityPatchBodySchema, req.body);
    ok(res, await adminAmenityService.update(req.user!.userId, req.params.id, body));
  }),
  adminHistory: wrap(async (req, res) => ok(res, await adminAmenityService.history(req.params.id))),
  adminListProposals: wrap(async (req, res) => {
    ok(res, await adminAmenityService.listProposals({ status: typeof req.query.status === 'string' ? req.query.status : undefined }));
  }),
  adminApprove: wrap(async (req, res) => {
    ok(res, await adminAmenityService.decide(req.user!.userId, 'approve', parseOrThrow(adminProposalApproveBodySchema, req.body)));
  }),
  adminReject: wrap(async (req, res) => {
    ok(res, await adminAmenityService.decide(req.user!.userId, 'reject', parseOrThrow(adminProposalRejectBodySchema, req.body)));
  }),
  adminMerge: wrap(async (req, res) => {
    ok(res, await adminAmenityService.decide(req.user!.userId, 'merge', parseOrThrow(adminProposalMergeBodySchema, req.body)));
  }),
};
