import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import os from "os";
import path from "path";
import { authMiddleware } from "../middleware/auth.middleware";
import { inbodyController } from "../controllers/inbody.controller";
import { isLambdaRuntime } from "../utils/runtime.util";
import {
  validateUploadFilename,
  validateUploadMime,
} from "../utils/upload-validation";

export { validateUploadFilename, validateUploadMime };

const router = Router();

// BR: InBody photo uploads capped at 5 MB. Anything bigger should fail with a clean
// 413 (Payload Too Large) — not bubble up as 500.
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

// This upload is genuinely transient: inbody.controller.ts's `upload` handler reads the file
// once for OCR (inbody-vision.service.ts) and unconditionally `fs.unlink`s it in a `finally`
// block — nothing ever stores the file path itself, only the extracted OCR result. That makes
// it a legitimate fit for Lambda's one writable path, `/tmp` (ephemeral per-invocation, exactly
// matching this flow's own lifetime already) — unlike profile photos or PT documents, which are
// meant to persist. multer({dest: <string>}) still synchronously `mkdirSync`s this destination
// at construction time (see profile.routes.ts's comment for why), but /tmp IS writable on
// Lambda, so that succeeds cleanly there instead of crashing.
const UPLOAD_DEST = isLambdaRuntime() ? path.join(os.tmpdir(), "inbody-uploads") : "uploads/";

const upload = multer({
  dest: UPLOAD_DEST,
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
