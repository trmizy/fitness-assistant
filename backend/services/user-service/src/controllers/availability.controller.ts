import { Response } from 'express';
import { logger } from '@gym-coach/shared';
import { availabilityService } from '../services/availability.service';

export const availabilityController = {
  // Get own availability (for the logged-in PT)
  async getMyAvailability(req: any, res: Response) {
    try {
      const ptUserId = req.headers['x-user-id'] as string;
      const slots = await availabilityService.getAvailability(ptUserId);
      res.json(slots);
    } catch (error: any) {
      logger.error(error, 'Get my availability error');
      res.status(500).json({ error: 'Failed to fetch availability' });
    }
  },

  // Get PT's weekly availability (public, by ptUserId param)
  async getAvailability(req: any, res: Response) {
    try {
      const ptUserId = req.params.ptUserId;
      const slots = await availabilityService.getAvailability(ptUserId);
      res.json(slots);
    } catch (error: any) {
      logger.error(error, 'Get availability error');
      res.status(500).json({ error: 'Failed to fetch availability' });
    }
  },

  // Set (replace) PT's weekly availability
  async setAvailability(req: any, res: Response) {
    try {
      const ptUserId = req.headers['x-user-id'] as string;
      const { slots } = req.body;
      const result = await availabilityService.setAvailability(ptUserId, slots);
      res.json(result);
    } catch (error: any) {
      logger.error(error, 'Set availability error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to set availability' });
    }
  },

  // Get PT's schedule exceptions (blocked dates)
  async getExceptions(req: any, res: Response) {
    try {
      const ptUserId = req.params.ptUserId || (req.headers['x-user-id'] as string);
      const exceptions = await availabilityService.getExceptions(ptUserId);
      res.json(exceptions);
    } catch (error: any) {
      logger.error(error, 'Get exceptions error');
      res.status(500).json({ error: 'Failed to fetch exceptions' });
    }
  },

  // Add a blocked date
  async addException(req: any, res: Response) {
    try {
      const ptUserId = req.headers['x-user-id'] as string;
      const { date, reason } = req.body;
      const exception = await availabilityService.addException(ptUserId, date, reason);
      res.status(201).json(exception);
    } catch (error: any) {
      logger.error(error, 'Add exception error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to add exception' });
    }
  },

  // Remove a blocked date
  async removeException(req: any, res: Response) {
    try {
      const ptUserId = req.headers['x-user-id'] as string;
      await availabilityService.removeException(req.params.id, ptUserId);
      res.json({ success: true });
    } catch (error: any) {
      logger.error(error, 'Remove exception error');
      res.status(500).json({ error: 'Failed to remove exception' });
    }
  },

  // Get available time slots for a date
  async getAvailableSlots(req: any, res: Response) {
    try {
      const ptUserId = req.params.ptUserId;
      const { date } = req.query;
      if (!date) {
        res.status(400).json({ error: 'date query param is required' });
        return;
      }
      const slots = await availabilityService.getAvailableSlots(ptUserId, date as string);
      res.json(slots);
    } catch (error: any) {
      logger.error(error, 'Get available slots error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to fetch available slots' });
    }
  },
};
