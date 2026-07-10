import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { authMiddleware } from "../middleware/auth.middleware";
import { inbodyController } from "../controllers/inbody.controller";
import {
  validateUploadFilename,
  validateUploadMime,
} from "../utils/upload-validation";

export { validateUploadFilename, validateUploadMime };

const router = Router();

// BR: InBody photo uploads capped at 5 MB. Anything bigger should fail with a clean
// 413 (Payload Too Large) — not bubble up as 500.
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    const nameErr = validateUploadFilename(file.originalname);
    if (nameErr) {
      cb(new Error(nameErr));
      return;
    }
    const mimeErr = validateUploadMime(file.mimetype, file.originalname);
    if (mimeErr) {
      cb(new Error(mimeErr));
      return;
    }
    cb(null, true);
  },
});

function handleUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single("image")(req, res, (err: any) => {
    if (err?.code === "LIMIT_FILE_SIZE") {
      res
        .status(413)
        .json({ error: "File too large. Maximum allowed size is 5 MB." });
      return;
    }
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next();
  });
}

router.get(
  "/client/:clientUserId",
  authMiddleware,
  inbodyController.getClientHistory as any,
);
router.get("/", authMiddleware, inbodyController.getHistory as any);
router.get("/latest", authMiddleware, inbodyController.getLatest as any);
router.post("/", authMiddleware, inbodyController.create as any);
router.patch("/:id", authMiddleware, inbodyController.update as any);
router.post(
  "/upload",
  authMiddleware,
  handleUpload,
  inbodyController.upload as any,
);

export default router;
