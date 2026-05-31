import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { logger } from '@gym-coach/shared';

const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL || 'http://localhost:3001';

type UserRole = 'ADMIN' | 'CUSTOMER' | 'PT';

interface JwtPayload {
  id: string;
  email?: string;
  role?: UserRole;
}

export async function authMiddleware(
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
    const verifyResponse = await axios.post<{ user: JwtPayload }>(
      `${AUTH_SERVICE_URL}/auth/verify`,
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        timeout: 5000,
      },
    );

    const payload = verifyResponse.data.user;

    if (!payload?.id) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid token payload' },
      });
    }

    // Forward user info to downstream services via headers
    req.headers['x-user-id'] = payload.id;
    req.headers['x-user-email'] = payload.email || '';
    req.headers['x-user-role'] = payload.role || 'CUSTOMER';

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

export function requireRoles(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const roleHeader = req.headers['x-user-role'];
    const role = Array.isArray(roleHeader) ? roleHeader[0] : roleHeader;

    if (!role || !allowedRoles.includes(role as UserRole)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Insufficient role permissions' },
      });
    }

    return next();
  };
}
