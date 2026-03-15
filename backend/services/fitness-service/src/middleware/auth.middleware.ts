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
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const authServiceUrl =
      process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
    const response = await axios.post(`${authServiceUrl}/auth/verify`, {
      token,
    });
    req.user = response.data.user;
    return next();
  } catch (error) {
    logger.error('Auth verification failed:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
}
