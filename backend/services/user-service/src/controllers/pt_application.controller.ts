import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ptApplicationService } from '../services/pt_application.service';
import { logger } from '@gym-coach/shared';

export const ptApplicationController = {
  async getMe(req: AuthRequest, res: Response) {
    try {
      const app = await ptApplicationService.getMe(req.user!.id);
      return res.json(app);
    } catch (error: any) {
      logger.error(error, 'Get my PT application error');
      return res.status(500).json({ error: 'Internal server error' });
    }
  },

  async saveDraft(req: AuthRequest, res: Response) {
    try {
      const app = await ptApplicationService.saveDraft(req.user!.id, req.body);
      return res.json(app);
    } catch (error: any) {
      logger.error(error, 'Save PT application draft error');
      return res.status(400).json({ error: error.message });
    }
  },

  async submit(req: AuthRequest, res: Response) {
    try {
      const app = await ptApplicationService.submit(req.user!.id);
      return res.json(app);
    } catch (error: any) {
      logger.error(error, 'Submit PT application error');
      return res.status(400).json({ error: error.message });
    }
  },

  async upload(req: AuthRequest, res: Response) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      // Return the file path/URL to the frontend
      // The file is stored in uploads/pt-applications/
      return res.json({ 
        url: `/uploads/pt-applications/${req.file.filename}`, 
        filename: req.file.originalname 
      });
    } catch (error: any) {
      logger.error(error, 'PT application upload error');
      return res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Admin endpoints
  async listApplications(req: AuthRequest, res: Response) {
    try {
      const apps = await ptApplicationService.listApplications(req.query);
      const mapped = apps.map((app: any) => ({
        ...app,
        user: {
          firstName: app.userProfile?.firstName,
          lastName: app.userProfile?.lastName,
          email: app.userProfile?.email || 'N/A' // Fallback if email not in profile
        }
      }));
      return res.json(mapped);
    } catch (error: any) {
      logger.error(error, 'List PT applications error');
      return res.status(500).json({ error: 'Internal server error' });
    }
  },

  async getById(req: AuthRequest, res: Response) {
    try {
      const app: any = await ptApplicationService.getById(req.params.id);
      if (!app) return res.status(404).json({ error: 'Application not found' });
      
      const mapped = {
        ...app,
        user: {
          firstName: app.userProfile?.firstName,
          lastName: app.userProfile?.lastName,
          email: app.userProfile?.email || 'N/A'
        }
      };
      return res.json(mapped);
    } catch (error: any) {
      logger.error(error, 'Get PT application by ID error');
      return res.status(500).json({ error: 'Internal server error' });
    }
  },

  async reviewAction(req: AuthRequest, res: Response) {
    try {
      const { action } = req.params;
      const app = await ptApplicationService.adminReviewAction(req.params.id, action as any, req.body);
      return res.json(app);
    } catch (error: any) {
      logger.error(error, 'Admin review action error');
      return res.status(400).json({ error: error.message });
    }
  }
};
