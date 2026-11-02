import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { disputeCaseController as c } from "../controllers/dispute-case.controller";

/**
 * Dispute Case (slice 1), PARTY side: the client and the PT of a case. Any authenticated user may call these routes; the service answers only
 * for a party of the case (anyone else gets 404 / an empty list). Deliberately NO PT-restriction check here: a restricted or suspended PT
 * must still be able to give their side (assertPtMayActOnContract is not called).
 */
const router = Router();
router.use(authMiddleware);

router.get("/", c.partyList);
router.get("/:id", c.partyGet);
router.post("/:id/statements", c.partyStatement);
router.post("/:id/evidence", c.partyEvidence);
// Slice 2 / S2.8 (flag DISPUTE_CASE_EVIDENCE_STORAGE_ENABLED, 404 when off): upload a file / read one's OWN file back.
router.post("/:id/evidence-files", c.evidenceFileGate, c.partyEvidenceFile);
router.get("/:id/evidence/:evidenceId/file", c.evidenceFile);

export default router;
