import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@gym-coach/shared';
import { authService } from '../services/auth.service';
import { authRepository } from '../repositories/auth.repository';
import { registerSchema, loginSchema, refreshSchema } from '../models/auth.models';

function auditMeta(req: Request) {
  return {
    ipAddress: req.ip || req.socket.remoteAddress || null,
    userAgent: req.get('user-agent') || null,
  };
}

export const authController = {
  async register(req: Request, res: Response): Promise<void> {
    try {
      const body = registerSchema.parse(req.body);
      const result = await authService.register(body);
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
      logger.error(error, 'Register error');
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
};
