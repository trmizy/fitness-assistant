import { Response } from 'express';
import { logger } from '@gym-coach/shared';
import { contractService } from '../services/contract.service';

export const contractController = {
  // Client requests a contract with a PT
  async requestContract(req: any, res: Response) {
    try {
      const clientUserId = req.headers['x-user-id'] as string;
      const contract = await contractService.requestContract(clientUserId, req.body);
      res.status(201).json(contract);
    } catch (error: any) {
      logger.error(error, 'Request contract error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to request contract' });
    }
  },

  // PT accepts a pending contract
  async acceptContract(req: any, res: Response) {
    try {
      const ptUserId = req.headers['x-user-id'] as string;
      const contract = await contractService.acceptContract(req.params.id, ptUserId);
      res.json(contract);
    } catch (error: any) {
      logger.error(error, 'Accept contract error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to accept contract' });
    }
  },

  // PT rejects a pending contract
  async rejectContract(req: any, res: Response) {
    try {
      const ptUserId = req.headers['x-user-id'] as string;
      const { reason } = req.body;
      const contract = await contractService.rejectContract(req.params.id, ptUserId, reason);
      res.json(contract);
    } catch (error: any) {
      logger.error(error, 'Reject contract error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to reject contract' });
    }
  },

  // Either party cancels
  async cancelContract(req: any, res: Response) {
    try {
      const userId = req.headers['x-user-id'] as string;
      const { reason } = req.body;
      const contract = await contractService.cancelContract(req.params.id, userId, reason);
      res.json(contract);
    } catch (error: any) {
      logger.error(error, 'Cancel contract error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to cancel contract' });
    }
  },

  // PT creates a contract for a client (legacy)
  async create(req: any, res: Response) {
    try {
      const ptUserId = req.headers['x-user-id'] as string;
      const contract = await contractService.create(ptUserId, req.body);
      res.status(201).json(contract);
    } catch (error: any) {
      logger.error(error, 'Create contract error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to create contract' });
    }
  },

  // Get contracts for PT (trainer view)
  async getByPT(req: any, res: Response) {
    try {
      const ptUserId = req.headers['x-user-id'] as string;
      const { status } = req.query;
      const contracts = await contractService.getByPT(ptUserId, status as string);
      res.json(contracts);
    } catch (error: any) {
      logger.error(error, 'Get PT contracts error');
      res.status(500).json({ error: 'Failed to fetch contracts' });
    }
  },

  // Get contracts for client
  async getByClient(req: any, res: Response) {
    try {
      const clientUserId = req.headers['x-user-id'] as string;
      const { status } = req.query;
      const contracts = await contractService.getByClient(clientUserId, status as string);
      res.json(contracts);
    } catch (error: any) {
      logger.error(error, 'Get client contracts error');
      res.status(500).json({ error: 'Failed to fetch contracts' });
    }
  },

  // Get single contract by ID (with sessions)
  async getById(req: any, res: Response) {
    try {
      const contract = await contractService.getById(req.params.id);
      if (!contract) {
        res.status(404).json({ error: 'Contract not found' });
        return;
      }
      res.json(contract);
    } catch (error: any) {
      logger.error(error, 'Get contract error');
      res.status(500).json({ error: 'Failed to fetch contract' });
    }
  },

  // Update contract status (legacy generic endpoint)
  async updateStatus(req: any, res: Response) {
    try {
      const userId = req.headers['x-user-id'] as string;
      const { status } = req.body;
      const contract = await contractService.updateStatus(req.params.id, userId, status);
      res.json(contract);
    } catch (error: any) {
      logger.error(error, 'Update contract status error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to update status' });
    }
  },

  // PT updates contract details
  async update(req: any, res: Response) {
    try {
      const ptUserId = req.headers['x-user-id'] as string;
      const contract = await contractService.update(req.params.id, ptUserId, req.body);
      res.json(contract);
    } catch (error: any) {
      logger.error(error, 'Update contract error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to update contract' });
    }
  },

  // PT logs a completed session (legacy)
  async logSession(req: any, res: Response) {
    try {
      const ptUserId = req.headers['x-user-id'] as string;
      const contract = await contractService.incrementSession(req.params.id, ptUserId);
      res.json(contract);
    } catch (error: any) {
      logger.error(error, 'Log session error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to log session' });
    }
  },

  // Check relationship between two users (for call permission)
  async checkRelationship(req: any, res: Response) {
    try {
      const { userAId, userBId } = req.query;
      if (!userAId || !userBId) {
        res.status(400).json({ error: 'userAId and userBId are required' });
        return;
      }
      const result = await contractService.checkRelationship(userAId as string, userBId as string);
      res.json(result);
    } catch (error: any) {
      logger.error(error, 'Check relationship error');
      res.status(500).json({ error: 'Failed to check relationship' });
    }
  },

  // PT earnings summary
  async getEarnings(req: any, res: Response) {
    try {
      const ptUserId = req.headers['x-user-id'] as string;
      const earnings = await contractService.getEarnings(ptUserId);
      res.json(earnings);
    } catch (error: any) {
      logger.error(error, 'Get earnings error');
      res.status(500).json({ error: 'Failed to fetch earnings' });
    }
  },
};
