import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import { authMiddleware } from "../middleware/auth.middleware";
import { roleMiddleware } from "../middleware/role.middleware";
import { ptApplicationController } from "../controllers/pt_application.controller";
import { isLambdaRuntime } from "../utils/runtime.util";

const router = Router();

// PT application documents (national ID, portrait, certificates) must PERSIST — unlike InBody's
// transient OCR upload, there is no S3 migration for these yet (see
// docs/features/USER_SERVICE_LAMBDA_IMPACT_ANALYSIS.md). Lambda's only writable path, /tmp, is
// ephemeral per-invocation, so redirecting there would silently pretend persistence works when
// it doesn't (explicitly forbidden — a doomed write is worse than a clear "unavailable"
// response). This uses the FUNCTION form of `destination`, which does not itself trigger
// multer's eager `mkdirSync` at construction time (only the string-shorthand `dest` option
// does — see profile.routes.ts's comment), so building `upload` here is safe either way; it is
// still gated for consistency and to keep the actual doomed disk write from ever being attempted
// on Lambda (a bare 500/ENOENT instead of the controlled response below).
const upload = isLambdaRuntime()
  ? null
  : multer({
      storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
          cb(null, "uploads/pt-applications/");
        },
        filename: (_req, file, cb) => {
          const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
          cb(
            null,
            file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname),
          );
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
      fileFilter: (_req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|pdf/;
        const extname = allowedTypes.test(
          path.extname(file.originalname).toLowerCase(),
        );
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
          return cb(null, true);
        }
        cb(new Error("Only .png, .jpg, .jpeg and .pdf formats are allowed"));
      },
    });

// Document download — signature-gated (see ptDocumentUrl.util.ts), not
// authMiddleware-gated: this URL is loaded via plain <img src=...>, which
// cannot attach an Authorization header. No auth middleware here on purpose.
router.get(
  "/documents/s3",
  ptApplicationController.getS3Document as any,
);
router.get(
  "/documents/:filename",
  ptApplicationController.getDocument as any,
);

// Applicant routes
router.get("/me", authMiddleware, ptApplicationController.getMe as any);
router.post(
  "/me/draft",
  authMiddleware,
  ptApplicationController.saveDraft as any,
);
router.post(
  "/me/submit",
  authMiddleware,
  ptApplicationController.submit as any,
);
// Wrap multer so file-too-large → 413 and bad-format → 400 instead of leaking 500.
function handleDocumentUpload(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!upload) {
    res.status(410).json({
      error:
        "PT application document upload is not available on this deployment (local-disk storage only; not yet migrated to S3).",
    });
    return;
  }
  upload.single("document")(req, res, (err: any) => {
    if (err?.code === "LIMIT_FILE_SIZE") {
      res
        .status(413)
        .json({ error: "File too large. Maximum allowed size is 10 MB." });
      return;
    }
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next();
  });
}

router.post(
  "/me/upload",
  authMiddleware,
  handleDocumentUpload,
  ptApplicationController.upload as any,
);
router.post(
  "/me/upload/presign",
  authMiddleware,
  ptApplicationController.presignUpload as any,
);
router.post(
  "/me/upload/confirm",
  authMiddleware,
  ptApplicationController.confirmUpload as any,
);

// Admin routes
router.get(
  "/admin",
  authMiddleware,
  roleMiddleware(["ADMIN"]),
  ptApplicationController.listApplications as any,
);
router.get(
  "/admin/:id",
  authMiddleware,
  roleMiddleware(["ADMIN"]),
  ptApplicationController.getById as any,
);
router.post(
  "/admin/:id/review/:action",
  authMiddleware,
  roleMiddleware(["ADMIN"]),
  ptApplicationController.reviewAction as any,
);

export default router;
