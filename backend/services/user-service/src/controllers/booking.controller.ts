import { Response } from 'express';
import { logger } from '@gym-coach/shared';
import { bookingService } from '../services/booking.service';

export const bookingController = {
  // Client books a session
  async bookSession(req: any, res: Response) {
    try {
      const clientUserId = req.headers['x-user-id'] as string;
      const { contractId, ...data } = req.body;
      const session = await bookingService.bookSession(clientUserId, contractId, data);
      res.status(201).json(session);
    } catch (error: any) {
      logger.error(error, 'Book session error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to book session' });
    }
  },

  // Get sessions for a contract
  async getContractSessions(req: any, res: Response) {
    try {
      const userId = req.headers['x-user-id'] as string;
      const sessions = await bookingService.getContractSessions(req.params.contractId, userId);
      res.json(sessions);
    } catch (error: any) {
      logger.error(error, 'Get contract sessions error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to fetch sessions' });
    }
  },

  // Get my upcoming sessions
  async getMyUpcoming(req: any, res: Response) {
    try {
      const userId = req.headers['x-user-id'] as string;
      const sessions = await bookingService.getMyUpcoming(userId);
      res.json(sessions);
    } catch (error: any) {
      logger.error(error, 'Get upcoming sessions error');
      res.status(500).json({ error: 'Failed to fetch upcoming sessions' });
    }
  },

  // PT confirms a session
  async confirmSession(req: any, res: Response) {
    try {
      const ptUserId = req.headers['x-user-id'] as string;
      const session = await bookingService.confirmSession(req.params.id, ptUserId);
      res.json(session);
    } catch (error: any) {
      logger.error(error, 'Confirm session error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to confirm session' });
    }
  },

  // PT completes a session
  async completeSession(req: any, res: Response) {
    try {
      const ptUserId = req.headers['x-user-id'] as string;
      const { ptNotes } = req.body;
      const session = await bookingService.completeSession(req.params.id, ptUserId, ptNotes);
      res.json(session);
    } catch (error: any) {
      logger.error(error, 'Complete session error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to complete session' });
    }
  },

  // Cancel session (either party)
  async cancelSession(req: any, res: Response) {
    try {
      const userId = req.headers['x-user-id'] as string;
      const { reason } = req.body;
      const session = await bookingService.cancelSession(req.params.id, userId, reason);
      res.json(session);
    } catch (error: any) {
      logger.error(error, 'Cancel session error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to cancel session' });
    }
  },

  // PT marks no-show
  async markNoShow(req: any, res: Response) {
    try {
      const ptUserId = req.headers['x-user-id'] as string;
      const { noShowBy } = req.body;
      const session = await bookingService.markNoShow(req.params.id, ptUserId, noShowBy);
      res.json(session);
    } catch (error: any) {
      logger.error(error, 'Mark no-show error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to mark no-show' });
    }
  },

  // Client reviews a completed session
  async reviewSession(req: any, res: Response) {
    try {
      const clientUserId = req.headers['x-user-id'] as string;
      const { rating, comment } = req.body;
      const review = await bookingService.reviewSession(req.params.id, clientUserId, rating, comment);
      res.status(201).json(review);
    } catch (error: any) {
      logger.error(error, 'Review session error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to review session' });
    }
  },
};
