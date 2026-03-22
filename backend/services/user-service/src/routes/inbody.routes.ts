import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { authMiddleware } from '../middleware/auth.middleware';
import { inbodyController } from '../controllers/inbody.controller';

const router = Router();
const upload = multer({ 
  dest: 'uploads/',
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg') {
      return cb(new Error('Only images are allowed'));
    }
    cb(null, true);
  }
});

router.get('/', authMiddleware, inbodyController.getHistory as any);
router.get('/latest', authMiddleware, inbodyController.getLatest as any);
router.post('/', authMiddleware, inbodyController.create as any);
router.post('/upload', authMiddleware, upload.single('image'), inbodyController.upload as any);

export default router;
