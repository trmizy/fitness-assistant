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
