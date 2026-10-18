import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { noStorePrivate, ptListingController as c } from "../controllers/pt-listing.controller";

/**
 * /profile/me/listing/* - the signed-in trainer's own listing workflow (plan §3).
 * Identity is always the verified token's user; the controller refuses anybody who is not an approved PT (403).
 * Every response is `Cache-Control: no-store, private` (drafts, presigned photo URLs).
 */
const router = Router();
router.use(authMiddleware as any, noStorePrivate);

router.get("/", c.get as any);
router.post("/draft", c.createDraft as any);
router.put("/draft", c.saveDraft as any);
router.post("/submit", c.submit as any);
router.post("/withdraw", c.withdraw as any);
router.post("/discard", c.discard as any);
router.post("/rebase", c.rebase as any);
router.get("/preview", c.preview as any);

router.post("/physique/presign", c.presign as any);
router.post("/physique/confirm", c.confirm as any);
router.delete("/physique/:photoId", c.deletePhoto as any);

export default router;
