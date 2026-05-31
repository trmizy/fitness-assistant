import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import { authService } from '../services/auth.service';
import { authRepository } from '../repositories/auth.repository';
import {
  registerStartSchema,
  registerVerifySchema,
  loginSchema,
  refreshSchema,
  updateMeSchema,
  updateUserRoleSchema,
} from '../models/auth.models';

const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

function getBearerToken(req: Request): string | null {
  const token = req.headers.authorization?.split(' ')[1];
  return token || null;
}

function auditMeta(req: Request) {
  return {
    ipAddress: req.ip || req.socket.remoteAddress || null,
    userAgent: req.get('user-agent') || null,
  };
}

export const authController = {
  async listUsers(req: Request, res: Response): Promise<void> {
    try {
      const token = getBearerToken(req);
      if (!token) {
        res.status(401).json({ error: 'No token provided' });
        return;
      }

      const actor = await authService.verifyToken(token);
      if (actor.role !== 'ADMIN') {
        res.status(403).json({ error: 'Forbidden: admin role required' });
        return;
      }

      const users = await authService.listUsers();
      res.json({ users });
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error(error, 'List users error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async register(req: Request, res: Response): Promise<void> {
    try {
      const body = registerStartSchema.parse(req.body);
      const result = await authService.register(body);
      res.status(202).json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation failed', details: error.errors });
        return;
      }
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error(error, 'Register error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async verifyRegistration(req: Request, res: Response): Promise<void> {
    try {
      const body = registerVerifySchema.parse(req.body);
      const result = await authService.verifyRegistration(body);
      await authRepository.createAuditLog({
        userId: result.user.id,
        action: 'REGISTER',
        ...auditMeta(req),
      });
      res.status(201).json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation failed', details: error.errors });
        return;
      }
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error(error, 'Verify registration error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async login(req: Request, res: Response): Promise<void> {
    try {
      const body = loginSchema.parse(req.body);
      const result = await authService.login(body.email, body.password);
      await authRepository.createAuditLog({
        userId: result.user.id,
        action: 'LOGIN',
        ...auditMeta(req),
      });
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation failed', details: error.errors });
        return;
      }
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error(error, 'Login error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async refresh(req: Request, res: Response): Promise<void> {
    try {
      const body = refreshSchema.parse(req.body);
      const result = await authService.refresh(body.refreshToken);
      await authRepository.createAuditLog({
        userId: result.userId,
        action: 'REFRESH_TOKEN',
        ...auditMeta(req),
      });
      res.json({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation failed', details: error.errors });
        return;
      }
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error(error, 'Refresh token error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async logout(req: Request, res: Response): Promise<void> {
    try {
      const body = refreshSchema.parse(req.body);
      const userId = await authService.logout(body.refreshToken);
      if (userId) {
        await authRepository.createAuditLog({
          userId,
          action: 'LOGOUT',
          ...auditMeta(req),
        });
      }
      res.json({ message: 'Logged out successfully' });
    } catch (error: any) {
      logger.error(error, 'Logout error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async verify(req: Request, res: Response): Promise<void> {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      if (!token) {
        res.status(401).json({ error: 'No token provided' });
        return;
      }
      const user = await authService.verifyToken(token);
      res.json({ user });
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error(error, 'Verify token error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async updateMe(req: Request, res: Response): Promise<void> {
    try {
      const token = getBearerToken(req);
      if (!token) {
        res.status(401).json({ error: 'No token provided' });
        return;
      }

      const body = updateMeSchema.parse(req.body);
      const result = await authService.updateMe(token, body);
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation failed', details: error.errors });
        return;
      }
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error(error, 'Update me error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async updateUserRole(req: Request, res: Response): Promise<void> {
    try {
      const token = getBearerToken(req);
      if (!token) {
        res.status(401).json({ error: 'No token provided' });
        return;
      }

      const actor = await authService.verifyToken(token);
      if (actor.role !== 'ADMIN') {
        res.status(403).json({ error: 'Forbidden: admin role required' });
        return;
      }

      const body = updateUserRoleSchema.parse(req.body);
      if (body.role === 'ADMIN') {
        res.status(403).json({ error: 'Forbidden: assigning ADMIN role is not allowed' });
        return;
      }
      const result = await authService.updateUserRole(req.params.userId, body);
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation failed', details: error.errors });
        return;
      }
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error(error, 'Update user role error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async batchGetUsersInternal(req: Request, res: Response): Promise<void> {
    try {
      const serviceSecret = req.headers['x-service-secret'];
      const secret = Array.isArray(serviceSecret) ? serviceSecret[0] : serviceSecret;
      if (!INTERNAL_SERVICE_SECRET) {
        res.status(503).json({ error: 'Internal endpoint disabled' });
        return;
      }
      if (!secret || secret !== INTERNAL_SERVICE_SECRET) {
        res.status(401).json({ error: 'Invalid service secret' });
        return;
      }
      const { userIds } = req.body;
      if (!Array.isArray(userIds) || userIds.length === 0) {
        res.status(400).json({ error: 'userIds must be a non-empty array' });
        return;
      }
      const users = await authRepository.findUsersByIds(userIds as string[]);
      res.json({ users });
    } catch (error: any) {
      logger.error(error, 'Batch get users internal error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async getUserInternal(req: Request, res: Response): Promise<void> {
    try {
      const serviceSecret = req.headers['x-service-secret'];
      const secret = Array.isArray(serviceSecret) ? serviceSecret[0] : serviceSecret;

      // Defense-in-depth: server.ts already fails to start without
      // INTERNAL_SERVICE_SECRET, but we re-check here so a future code path can't
      // accidentally bypass it.
      if (!INTERNAL_SERVICE_SECRET) {
        res.status(503).json({ error: 'Internal endpoint disabled' });
        return;
      }
      if (!secret || secret !== INTERNAL_SERVICE_SECRET) {
        res.status(401).json({ error: 'Invalid service secret' });
        return;
      }

      const user = await authRepository.findUserById(req.params.userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      // Minimal response shape — never leak password/refresh-token.
      res.json({
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName ?? null,
          lastName: user.lastName ?? null,
          role: user.role,
          isActive: (user as any).isActive ?? true,
        },
      });
    } catch (error: any) {
      logger.error(error, 'Internal get user error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Admin disable/enable user (BUG-002, BUG-025, BUG-026).
  // Admin token-protected (route attaches no service-secret); we check role via JWT
  // — reuse the existing verify-token middleware pattern by calling authService.verify.
  async setUserActive(req: Request, res: Response): Promise<void> {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'No token provided' });
        return;
      }
      const token = authHeader.substring(7);
      const verified = await authService.verifyToken(token);
      if (!verified || verified.role !== 'ADMIN') {
        res.status(403).json({ error: 'Admin role required' });
        return;
      }
      const desired = req.body?.isActive;
      const isActive = desired !== undefined ? !!desired : (req.path.endsWith('/disable') ? false : true);
      const updated = await authService.setUserActive(req.params.userId, isActive);
      res.json({ user: updated });
    } catch (error: any) {
      if (error.status) { res.status(error.status).json({ error: error.message }); return; }
      logger.error(error, 'setUserActive error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async updateUserRoleInternal(req: Request, res: Response): Promise<void> {
    try {
      const serviceSecret = req.headers['x-service-secret'];
      const secret = Array.isArray(serviceSecret)
        ? serviceSecret[0]
        : serviceSecret;

      if (!secret || secret !== INTERNAL_SERVICE_SECRET) {
        res.status(403).json({ error: 'Forbidden: invalid service secret' });
        return;
      }

      const body = updateUserRoleSchema.parse(req.body);
      if (body.role === 'ADMIN') {
        res.status(403).json({ error: 'Forbidden: assigning ADMIN role is not allowed' });
        return;
      }
      const result = await authService.updateUserRole(req.params.userId, body);
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation failed', details: error.errors });
        return;
      }
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error(error, 'Internal update user role error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },
};
