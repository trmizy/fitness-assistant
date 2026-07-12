import { Router } from 'express';

const router = Router();

// GET /me/payments
router.get('/', (_req, res) => {
  res.json({ success: true, data: [] });
});

// GET /me/payments/:id
router.get('/:id', (_req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
});

export default router;
