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

const GATEWAY_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

export function extractUser(req: Request, _res: Response, next: NextFunction): void {
  // Only trust identity headers stamped by the gateway (x-gateway-secret). A direct call to this
  // service's port with forged x-user-* headers is treated as unauthenticated — this is money, so
  // bypassing the gateway must never impersonate a user.
  const fromGateway = req.headers['x-gateway-secret'] === GATEWAY_SECRET;
  const userId = req.headers['x-user-id'] as string | undefined;
  req.user = fromGateway && userId
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
