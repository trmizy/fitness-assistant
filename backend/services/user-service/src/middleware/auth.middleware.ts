import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { logger } from '@gym-coach/shared';

export interface AuthRequest extends Request {
  user?: { id: string; email: string; role: string };
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const authServiceUrl =
      process.env.AUTH_SERVICE_URL || 'http://localhost:3001';

    const { data } = await axios.post(
      `${authServiceUrl}/auth/verify`,
      {},
      { headers: { Authorization: `Bearer ${token}` }, timeout: 5000 },
    );

    req.user = data.user;
    return next();
  } catch (error) {
    if (axios.isAxiosError(error) && error.code === 'ECONNREFUSED') {
      return res.status(503).json({ error: 'Auth service unavailable' });
    }
    logger.error(error, 'Auth middleware error');
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
