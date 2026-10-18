import { Router } from "express";
import { noStorePrivate, ptListingController as c } from "../controllers/pt-listing.controller";

/**
 * /admin/listings/pts/* - mounted by admin.routes.ts AFTER its `authMiddleware + roleMiddleware(["ADMIN"])`, so
 * every route here is ADMIN-only. The acting admin is req.user.id. There is deliberately NO presign / upload route:
 * an admin never supplies a trainer's physique photos, only reorders / covers / retires the public ones.
 */
const router = Router();
router.use(noStorePrivate);

router.get("/", c.adminList as any);
router.get("/revisions/:rid", c.adminGetRevision as any);
router.get("/revisions/:rid/preview", c.adminPreview as any);
router.post("/revisions/:rid/approve", c.adminApprove as any);
router.post("/revisions/:rid/reject", c.adminReject as any);
router.post("/revisions/:rid/request-changes", c.adminRequestChanges as any);
router.post("/:ptUserId/direct-edit", c.adminDirectEdit as any);
router.post("/:ptUserId/physique/:photoId/retire", c.adminRetirePhoto as any);
router.get("/:ptUserId/history", c.adminHistory as any);

export default router;
