import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';
import { ptApplicationController } from '../controllers/pt_application.controller';

const router = Router();

// Configure multer for PT application documents
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, 'uploads/pt-applications/');
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only .png, .jpg, .jpeg and .pdf formats are allowed'));
  }
});

// Applicant routes
router.get('/me', authMiddleware, ptApplicationController.getMe as any);
router.post('/me/draft', authMiddleware, ptApplicationController.saveDraft as any);
router.post('/me/submit', authMiddleware, ptApplicationController.submit as any);
router.post('/me/upload', authMiddleware, upload.single('document'), ptApplicationController.upload as any);

// Admin routes
router.get('/admin', authMiddleware, roleMiddleware(['ADMIN']), ptApplicationController.listApplications as any);
router.get('/admin/:id', authMiddleware, roleMiddleware(['ADMIN']), ptApplicationController.getById as any);
router.post('/admin/:id/review/:action', authMiddleware, roleMiddleware(['ADMIN']), ptApplicationController.reviewAction as any);

export default router;
