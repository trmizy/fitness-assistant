import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '@gym-coach/shared';

const JWT_SECRET =
  process.env.JWT_SECRET || 'dev_jwt_secret_change_in_production';

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'No token provided' },
      });
    }

    const token = authHeader.substring(7);
    const payload = jwt.verify(token, JWT_SECRET) as any;

    // Forward user info to downstream services via headers
    req.headers['x-user-id'] = payload.userId;
    req.headers['x-user-email'] = payload.email || '';
    req.headers['x-user-role'] = payload.role || 'user';

    return next();
  } catch (error) {
    logger.error({
      error: 'Auth middleware failed',
      message: (error as Error).message,
    });
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' },
    });
  }
}
