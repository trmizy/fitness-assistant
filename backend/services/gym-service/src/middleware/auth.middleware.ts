import { Request, Response, NextFunction } from 'express';

export interface AuthUser {
  userId: string;
  role: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser | null;
    }
  }
}

export function extractUser(req: Request, _res: Response, next: NextFunction): void {
  const userId = req.headers['x-user-id'] as string | undefined;
  req.user = userId
    ? { userId, role: (req.headers['x-user-role'] as string) ?? '', email: (req.headers['x-user-email'] as string) ?? '' }
    : null;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.userId) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }
  next();
}

export function requireRoles(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user?.userId || !roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }
    next();
  };
}
