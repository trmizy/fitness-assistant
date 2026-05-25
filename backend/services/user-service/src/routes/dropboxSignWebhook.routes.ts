import { Router } from 'express';
import multer from 'multer';
import { handleDropboxSignWebhook } from '../controllers/dropboxSignWebhook.controller';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

// Dropbox Sign sends multipart/form-data with a 'json' field
router.post('/', upload.none(), handleDropboxSignWebhook as any);

export default router;
