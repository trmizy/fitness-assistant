import path from 'path';
import fs from 'fs';
import { Response } from 'express';
import { logger } from '@gym-coach/shared';
import { contractService } from '../services/contract.service';
import { contractRepository } from '../repositories/contract.repository';
import { ContractStatus } from '../generated/prisma';
import { prisma } from '../repositories/profile.repository';

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
      const userRole = req.headers['x-user-role'] as string;
      const { status } = req.body;
      const contract = await contractService.updateStatus(req.params.id, userId, status, userRole);
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

  // INTERNAL — called by ai-service to verify that a contract is ACTIVE and get the PT user ID.
  // Security: validates clientId owns this contract and it is currently ACTIVE.
  // Response: minimal { ptUserId, contractId } — no full contract object.
  async getActivePTForClient(req: any, res: Response) {
    try {
      const { clientId, contractId } = req.query;
      if (!clientId || typeof clientId !== 'string' || clientId.trim() === '') {
        res.status(400).json({ error: 'clientId is required' });
        return;
      }
      if (contractId !== undefined && (typeof contractId !== 'string' || contractId.trim() === '')) {
        res.status(400).json({ error: 'contractId must be a non-empty string' });
        return;
      }

      const where: any = {
        clientUserId: clientId.trim(),
        status: ContractStatus.ACTIVE,
      };
      if (contractId) where.id = contractId.trim();

      const contract = await prisma.contract.findFirst({
        where,
        select: { id: true, ptUserId: true },
        orderBy: { startDate: 'desc' },
      });

      if (!contract) {
        res.json({ ptUserId: null });
        return;
      }
      res.json({ ptUserId: contract.ptUserId, contractId: contract.id });
    } catch (error: any) {
      logger.error(error, 'getActivePTForClient error');
      res.status(500).json({ error: 'Failed to verify contract' });
    }
  },

  // INTERNAL — called by chat-service to decide whether two users can chat.
  // BR-29 (loosened): client → APPROVED PT can chat for pre-contract discovery.
  // Protected by serviceSecretMiddleware (mounted under /internal).
  async chatEligibility(req: any, res: Response) {
    try {
      const { fromUserId, toUserId } = req.query;
      if (!fromUserId || !toUserId) {
        res.status(400).json({ error: 'fromUserId and toUserId are required' });
        return;
      }
      const result = await contractService.computeChatEligibility(
        String(fromUserId),
        String(toUserId),
      );
      res.json(result);
    } catch (error: any) {
      logger.error(error, 'Chat-eligibility error');
      res.status(500).json({ error: 'Failed to compute chat eligibility' });
    }
  },

  // Resend e-sign request (only for ERROR/EXPIRED status)
  async sendESign(req: any, res: Response) {
    try {
      const userId = req.headers['x-user-id'] as string;
      const userRole = req.headers['x-user-role'] as string;
      const contract = await contractRepository.findById(req.params.id);

      if (!contract) {
        res.status(404).json({ error: 'Contract not found' });
        return;
      }

      // Auth: only client/PT of this contract or admin
      if (userId !== contract.clientUserId && userId !== contract.ptUserId && userRole !== 'ADMIN') {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      if (contract.status !== ContractStatus.PENDING_SIGNATURE) {
        res.status(400).json({ error: 'Contract is not in PENDING_SIGNATURE state' });
        return;
      }

      if (contract.eSignStatus === 'SIGNED') {
        res.status(400).json({ error: 'Contract is already signed' });
        return;
      }

      const canResend = ['ERROR', 'EXPIRED'].includes(contract.eSignStatus || '');
      if (!canResend && userRole !== 'ADMIN') {
        res.status(400).json({ error: 'Cannot resend while e-sign is in progress. Contact admin if needed.' });
        return;
      }

      await contractService.resendESign(contract.id);
      res.json({ message: 'E-sign request sent' });
    } catch (error: any) {
      logger.error(error, 'Send e-sign error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to send e-sign request' });
    }
  },

  // Get e-sign status for a contract
  async getESignStatus(req: any, res: Response) {
    try {
      const userId = req.headers['x-user-id'] as string;
      const userRole = req.headers['x-user-role'] as string;
      const contract = await contractRepository.findById(req.params.id);

      if (!contract) {
        res.status(404).json({ error: 'Contract not found' });
        return;
      }

      if (userId !== contract.clientUserId && userId !== contract.ptUserId && userRole !== 'ADMIN') {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      res.json({
        eSignStatus: contract.eSignStatus,
        eSignTestMode: contract.eSignTestMode,
        clientSignedAt: contract.clientSignedAt,
        ptSignedAt: contract.ptSignedAt,
        fullySignedAt: contract.fullySignedAt,
        signedPdfUrl: contract.signedPdfUrl,
        eSignError: contract.eSignError,
      });
    } catch (error: any) {
      logger.error(error, 'Get e-sign status error');
      res.status(500).json({ error: 'Failed to get e-sign status' });
    }
  },

  // Download the generated contract PDF
  async getContractPdf(req: any, res: Response) {
    try {
      const userId = req.headers['x-user-id'] as string;
      const userRole = req.headers['x-user-role'] as string;
      const contract = await contractRepository.findById(req.params.id);

      if (!contract) {
        res.status(404).json({ error: 'Contract not found' });
        return;
      }

      if (userId !== contract.clientUserId && userId !== contract.ptUserId && userRole !== 'ADMIN') {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      if (!contract.contractPdfPath) {
        res.status(404).json({ error: 'PDF not available' });
        return;
      }

      // Use only DB-stored path — never from request input (path traversal prevention)
      const absPath = path.isAbsolute(contract.contractPdfPath)
        ? contract.contractPdfPath
        : path.join(process.cwd(), contract.contractPdfPath);

      if (!fs.existsSync(absPath)) {
        res.status(404).json({ error: 'PDF file not found' });
        return;
      }

      res.sendFile(absPath);
    } catch (error: any) {
      logger.error(error, 'Get contract PDF error');
      res.status(500).json({ error: 'Failed to retrieve PDF' });
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

  // Client pays a PENDING_PAYMENT contract via wallet-transfer
  async pay(req: any, res: Response) {
    try {
      const clientUserId = req.headers['x-user-id'] as string;
      const result = await contractService.pay(req.params.id, clientUserId);
      res.json(result);
    } catch (error: any) {
      if (error.message === 'ALREADY_PAID') {
        res.status(409).json({ error: error.message });
        return;
      }
      logger.error(error, 'Contract pay error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to pay contract' });
    }
  },

  // INTERNAL — payment-service calls this after a wallet-transfer PAID
  async activateAfterPayment(req: any, res: Response) {
    try {
      const { transactionId } = req.body;
      const contract = await contractService.activateAfterPayment(req.params.id, transactionId);
      res.json({ success: true, data: contract });
    } catch (error: any) {
      logger.error(error, 'Internal activate-after-payment error');
      res.status(error.status || 500).json({ success: false, error: { message: error.message } });
    }
  },

  // INTERNAL — payment-service calls this after a successful refund reversal
  async cancelAfterRefund(req: any, res: Response) {
    try {
      const { originalTransactionId, refundTransactionId } = req.body;
      const contract = await contractService.cancelAfterRefund(req.params.id, originalTransactionId, refundTransactionId);
      res.json({ success: true, data: contract });
    } catch (error: any) {
      logger.error(error, 'Internal cancel-after-refund error');
      res.status(error.status || 500).json({ success: false, error: { message: error.message } });
    }
  },
};
