import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { authMiddleware } from "../middleware/auth.middleware";
import { profileController } from "../controllers/profile.controller";

const router = Router();

const photoUpload = multer({
  dest: "uploads/profile-photos/",
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"));
  },
});

// Wrapper around multer.single so the upload-error paths produce 413/400 instead of
// bubbling up to the global error handler and becoming 500 (BUG-022 / BUG-023).
function handlePhotoUpload(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  photoUpload.single("photo")(req, res, (err: any) => {
    if (err?.code === "LIMIT_FILE_SIZE") {
      res
        .status(413)
        .json({ error: "Photo too large. Maximum allowed size is 5 MB." });
      return;
    }
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next();
  });
}

router.get("/me", authMiddleware, profileController.getProfile as any);
router.put("/me", authMiddleware, profileController.upsertProfile as any);
router.post(
  "/me/photo",
  authMiddleware,
  handlePhotoUpload,
  profileController.uploadPhoto as any,
);
router.patch(
  "/me/become-pt",
  authMiddleware,
  profileController.becomePT as any,
);
router.delete("/me", authMiddleware, profileController.deleteProfile as any);

// Listing PT users — used by the chat-service to validate PT-client conversations
router.get("/pts", authMiddleware, profileController.listPTs as any);
router.patch(
  "/admin/users/:userId/pt-status",
  authMiddleware,
  profileController.adminSetPTStatus as any,
);

// Admin: contract count summary — used by API Gateway to enrich user list
router.get(
  "/admin/contracts/summary",
  authMiddleware,
  profileController.adminContractsSummary as any,
);
router.get(
  "/admin/stats",
  authMiddleware,
  profileController.adminGetStats as any,
);

export default router;
