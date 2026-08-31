import path from "path";
import fs from "fs";
import { Response } from "express";
import { logger } from "@gym-coach/shared";
import { contractService } from "../services/contract.service";
import {
  moneyBreakdown,
  terminateContractMoney,
} from '../services/contract-payout.service';
import { auditService, auditMeta } from "../services/audit.service";
import { contractRepository } from "../repositories/contract.repository";
import { AuditEntityType, ContractStatus } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import {
  createPresignedGetObject,
  isS3Ref,
  keyFromS3Ref,
} from "../services/s3-upload.service";

export const contractController = {
  // Client requests a contract with a PT
  async requestContract(req: any, res: Response) {
    try {
      const clientUserId = req.headers["x-user-id"] as string;
      const contract = await contractService.requestContract(
        clientUserId,
        req.body,
      );
      res.status(201).json(contract);
    } catch (error: any) {
      logger.error(error, "Request contract error");
      // LOW_AVAILABILITY carries the fields the client UI's warning dialog needs
      // (availableSlots, packageSessions, nearestAvailableSlot) — a plain
      // { error: message } here was silently swallowing all three, so the dialog's
      // `code === "LOW_AVAILABILITY"` check could never match and it never rendered.
      res.status(error.status || 500).json({
        error: error.message || "Failed to request contract",
        ...(error.code === "LOW_AVAILABILITY"
          ? {
              code: error.code,
              availableSlots: error.availableSlots,
              packageSessions: error.packageSessions,
              nearestAvailableSlot: error.nearestAvailableSlot,
            }
          : {}),
      });
    }
  },

  // PT accepts a pending contract
  async acceptContract(req: any, res: Response) {
    try {
      const ptUserId = req.headers["x-user-id"] as string;
      const contract = await contractService.acceptContract(
        req.params.id,
        ptUserId,
      );
      res.json(contract);
    } catch (error: any) {
      logger.error(error, "Accept contract error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to accept contract" });
    }
  },

  // PT rejects a pending contract
  async rejectContract(req: any, res: Response) {
    try {
      const ptUserId = req.headers["x-user-id"] as string;
      const { reason } = req.body;
      const contract = await contractService.rejectContract(
        req.params.id,
        ptUserId,
        reason,
      );
      res.json(contract);
    } catch (error: any) {
      logger.error(error, "Reject contract error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to reject contract" });
    }
  },

  // Either party cancels
  async cancelContract(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      const { reason } = req.body;
      const contract = await contractService.cancelContract(
        req.params.id,
        userId,
        reason,
      );
      res.json(contract);
    } catch (error: any) {
      logger.error(error, "Cancel contract error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to cancel contract" });
    }
  },

  // PT creates a contract for a client (legacy)
  async create(req: any, res: Response) {
    try {
      const ptUserId = req.headers["x-user-id"] as string;
      const contract = await contractService.create(ptUserId, req.body);
      res.status(201).json(contract);
    } catch (error: any) {
      logger.error(error, "Create contract error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to create contract" });
    }
  },

  // Get contracts for PT (trainer view)
  async getByPT(req: any, res: Response) {
    try {
      const ptUserId = req.headers["x-user-id"] as string;
      const { status } = req.query;
      const contracts = await contractService.getByPT(
        ptUserId,
        status as string,
      );
      res.json(contracts);
    } catch (error: any) {
      logger.error(error, "Get PT contracts error");
      res.status(500).json({ error: "Failed to fetch contracts" });
    }
  },

  // Get contracts for client
  async getByClient(req: any, res: Response) {
    try {
      const clientUserId = req.headers["x-user-id"] as string;
      const { status } = req.query;
      const contracts = await contractService.getByClient(
        clientUserId,
        status as string,
      );
      res.json(contracts);
    } catch (error: any) {
      logger.error(error, "Get client contracts error");
      res.status(500).json({ error: "Failed to fetch contracts" });
    }
  },

  // Get single contract by ID (with sessions) — either party may read it, nobody else
  // (money-flow plan 2.1; same pattern moneyBreakdown/terminate below already use).
  async getById(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      const role = req.headers["x-user-role"] as string;
      const contract = await contractService.getById(req.params.id);
      if (!contract) {
        res.status(404).json({ error: "Contract not found" });
        return;
      }
      const isParty = contract.clientUserId === userId || contract.ptUserId === userId;
      if (!isParty && role !== "ADMIN") {
        res.status(403).json({ error: "Not authorized" });
        return;
      }
      res.json(contract);
    } catch (error: any) {
      logger.error(error, "Get contract error");
      res.status(500).json({ error: "Failed to fetch contract" });
    }
  },

  // Update contract status (legacy generic endpoint)
  async updateStatus(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      const userRole = req.headers["x-user-role"] as string;
      const { status } = req.body;
      const contract = await contractService.updateStatus(
        req.params.id,
        userId,
        status,
        userRole,
      );
      res.json(contract);
    } catch (error: any) {
      logger.error(error, "Update contract status error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to update status" });
    }
  },

  // PT updates contract details
  async update(req: any, res: Response) {
    try {
      const ptUserId = req.headers["x-user-id"] as string;
      const contract = await contractService.update(
        req.params.id,
        ptUserId,
        req.body,
      );
      res.json(contract);
    } catch (error: any) {
      logger.error(error, "Update contract error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to update contract" });
    }
  },

  // PT logs a completed session (legacy)
  async logSession(req: any, res: Response) {
    try {
      const ptUserId = req.headers["x-user-id"] as string;
      const contract = await contractService.incrementSession(
        req.params.id,
        ptUserId,
      );
      res.json(contract);
    } catch (error: any) {
      logger.error(error, "Log session error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to log session" });
    }
  },

  // Check relationship between two users (for call permission)
  async checkRelationship(req: any, res: Response) {
    try {
      const { userAId, userBId } = req.query;
      if (!userAId || !userBId) {
        res.status(400).json({ error: "userAId and userBId are required" });
        return;
      }
      const result = await contractService.checkRelationship(
        userAId as string,
        userBId as string,
      );
      res.json(result);
    } catch (error: any) {
      logger.error(error, "Check relationship error");
      res.status(500).json({ error: "Failed to check relationship" });
    }
  },

  // INTERNAL — Phase 6 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md, called
  // by fitness-service before every PT/coach client-data or plan-assignment
  // request. Strictly ACTIVE + PT->client direction — see
  // contract.service.ts's checkActivePtClientRelationship doc comment.
  async checkActivePtClientRelationship(req: any, res: Response) {
    try {
      const { ptUserId, clientUserId } = req.query;
      if (!ptUserId || !clientUserId || typeof ptUserId !== "string" || typeof clientUserId !== "string") {
        res.status(400).json({ error: "ptUserId and clientUserId are required" });
        return;
      }
      const result = await contractService.checkActivePtClientRelationship(ptUserId, clientUserId);
      res.json(result);
    } catch (error: any) {
      logger.error(error, "checkActivePtClientRelationship error");
      res.status(500).json({ error: "Failed to verify PT-client relationship" });
    }
  },

  // INTERNAL — called by ai-service to verify that a contract is ACTIVE and get the PT user ID.
  // Security: validates clientId owns this contract and it is currently ACTIVE.
  // Response: minimal { ptUserId, contractId } — no full contract object.
  async getActivePTForClient(req: any, res: Response) {
    try {
      const { clientId, contractId } = req.query;
      if (!clientId || typeof clientId !== "string" || clientId.trim() === "") {
        res.status(400).json({ error: "clientId is required" });
        return;
      }
      if (
        contractId !== undefined &&
        (typeof contractId !== "string" || contractId.trim() === "")
      ) {
        res
          .status(400)
          .json({ error: "contractId must be a non-empty string" });
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
        orderBy: { startDate: "desc" },
      });

      if (!contract) {
        res.json({ ptUserId: null });
        return;
      }
      res.json({ ptUserId: contract.ptUserId, contractId: contract.id });
    } catch (error: any) {
      logger.error(error, "getActivePTForClient error");
      res.status(500).json({ error: "Failed to verify contract" });
    }
  },

  // INTERNAL — called by ai-service right after a Marketplace Personalized
  // PT Service purchase is paid. See contractService.createMarketplaceContract's
  // doc comment for why this bypasses the normal request/accept/sign flow.
  async createMarketplaceContract(req: any, res: Response) {
    try {
      const { ptUserId, clientUserId, packageName, description, price, paymentTransactionId } = req.body ?? {};
      if (!ptUserId || !clientUserId || !packageName || typeof price !== "number") {
        res.status(400).json({ error: "ptUserId, clientUserId, packageName, and price are required" });
        return;
      }
      const contract = await contractService.createMarketplaceContract({
        ptUserId,
        clientUserId,
        packageName,
        description,
        price,
        paymentTransactionId,
      });
      res.status(201).json({ contractId: contract.id });
    } catch (error: any) {
      logger.error(error, "createMarketplaceContract error");
      res.status(500).json({ error: "Failed to create marketplace contract" });
    }
  },

  // INTERNAL — called by chat-service to decide whether two users can chat.
  // BR-29 (loosened): client → APPROVED PT can chat for pre-contract discovery.
  // Protected by serviceSecretMiddleware (mounted under /internal).
  async chatEligibility(req: any, res: Response) {
    try {
      const { fromUserId, toUserId } = req.query;
      if (!fromUserId || !toUserId) {
        res.status(400).json({ error: "fromUserId and toUserId are required" });
        return;
      }
      const result = await contractService.computeChatEligibility(
        String(fromUserId),
        String(toUserId),
      );
      res.json(result);
    } catch (error: any) {
      logger.error(error, "Chat-eligibility error");
      res.status(500).json({ error: "Failed to compute chat eligibility" });
    }
  },

  // Resend e-sign request (only for ERROR/EXPIRED status)
  async sendESign(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      const userRole = req.headers["x-user-role"] as string;
      const contract = await contractRepository.findById(req.params.id);

      if (!contract) {
        res.status(404).json({ error: "Contract not found" });
        return;
      }

      // Auth: only client/PT of this contract or admin
      if (
        userId !== contract.clientUserId &&
        userId !== contract.ptUserId &&
        userRole !== "ADMIN"
      ) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      if (contract.status !== ContractStatus.PENDING_SIGNATURE) {
        res
          .status(400)
          .json({ error: "Contract is not in PENDING_SIGNATURE state" });
        return;
      }

      if (contract.eSignStatus === "SIGNED") {
        res.status(400).json({ error: "Contract is already signed" });
        return;
      }

      const canResend = ["ERROR", "EXPIRED"].includes(
        contract.eSignStatus || "",
      );
      if (!canResend && userRole !== "ADMIN") {
        res.status(400).json({
          error:
            "Cannot resend while e-sign is in progress. Contact admin if needed.",
        });
        return;
      }

      await contractService.resendESign(contract.id);
      res.json({ message: "E-sign request sent" });
    } catch (error: any) {
      logger.error(error, "Send e-sign error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to send e-sign request" });
    }
  },

  // Get e-sign status for a contract
  async getESignStatus(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      const userRole = req.headers["x-user-role"] as string;
      const contract = await contractRepository.findById(req.params.id);

      if (!contract) {
        res.status(404).json({ error: "Contract not found" });
        return;
      }

      if (
        userId !== contract.clientUserId &&
        userId !== contract.ptUserId &&
        userRole !== "ADMIN"
      ) {
        res.status(403).json({ error: "Forbidden" });
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
      logger.error(error, "Get e-sign status error");
      res.status(500).json({ error: "Failed to get e-sign status" });
    }
  },

  // Download the generated contract PDF
  async getContractPdf(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      const userRole = req.headers["x-user-role"] as string;
      const contract = await contractRepository.findById(req.params.id);

      if (!contract) {
        res.status(404).json({ error: "Contract not found" });
        return;
      }

      if (
        userId !== contract.clientUserId &&
        userId !== contract.ptUserId &&
        userRole !== "ADMIN"
      ) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      if (!contract.contractPdfPath) {
        res.status(404).json({ error: "PDF not available" });
        return;
      }

      // Use only DB-stored path — never from request input (path traversal prevention)
      if (isS3Ref(contract.contractPdfPath)) {
        const key = keyFromS3Ref(contract.contractPdfPath);
        const signedUrl = await createPresignedGetObject({ key });
        res.redirect(302, signedUrl);
        return;
      }

      const absPath = path.isAbsolute(contract.contractPdfPath)
        ? contract.contractPdfPath
        : path.join(process.cwd(), contract.contractPdfPath);

      if (!fs.existsSync(absPath)) {
        res.status(404).json({ error: "PDF file not found" });
        return;
      }

      res.sendFile(absPath);
    } catch (error: any) {
      logger.error(error, "Get contract PDF error");
      res.status(500).json({ error: "Failed to retrieve PDF" });
    }
  },

  // PT earnings summary
  async getEarnings(req: any, res: Response) {
    try {
      const ptUserId = req.headers["x-user-id"] as string;
      const earnings = await contractService.getEarnings(ptUserId);
      res.json(earnings);
    } catch (error: any) {
      logger.error(error, "Get earnings error");
      res.status(500).json({ error: "Failed to fetch earnings" });
    }
  },

  // Client starts payment for a PENDING_PAYMENT contract at their chosen gateway.
  // Responds with a redirect URL; the contract activates on the webhook, not here.
  async pay(req: any, res: Response) {
    try {
      const clientUserId = req.headers['x-user-id'] as string;
      const provider = typeof req.body?.provider === 'string' ? req.body.provider.toUpperCase() : undefined;
      const result = await contractService.pay(req.params.id, clientUserId, provider);
      res.json(result);
    } catch (error: any) {
      if (error.message === 'ALREADY_PAID') {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error.code === 'PROVIDER_NOT_CONFIGURED') {
        res.status(400).json({ error: error.message, code: error.code });
        return;
      }
      logger.error(error, 'Contract pay error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to pay contract' });
    }
  },

  // Roadmap P4.1 "Notifications/reminders" (§27) — PT sends a feedback
  // message to their client on an active contract. Uses req.user (set by
  // authMiddleware, applied directly to this route) rather than this
  // file's other methods' `x-user-id` header convention — that header is
  // only ever populated by the GATEWAY's own proxy-time injection, so a
  // request that reaches this service directly (bypassing the gateway)
  // would silently read undefined. req.user works correctly either way.
  async sendFeedback(req: any, res: Response) {
    try {
      const ptUserId = req.user!.id as string;
      const result = await contractService.sendFeedback(req.params.id, ptUserId, req.body?.text);
      res.json(result);
    } catch (error: any) {
      if (error.status) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error(error, 'Contract sendFeedback error');
      res.status(500).json({ error: 'Failed to send feedback' });
    }
  },

  // Money view of a contract — either party may read it, nobody else.
  async moneyBreakdown(req: any, res: Response) {
    try {
      const userId = req.headers['x-user-id'] as string;
      const role = req.headers['x-user-role'] as string;
      const contract = await contractService.getById(req.params.id);
      if (!contract) {
        res.status(404).json({ error: 'Contract not found' });
        return;
      }
      const isParty = contract.clientUserId === userId || contract.ptUserId === userId;
      if (!isParty && role !== 'ADMIN') {
        res.status(403).json({ error: 'Not authorized' });
        return;
      }
      const data = await moneyBreakdown(req.params.id);
      if (!data) {
        res.status(400).json({ error: 'Contract has no price or sessions to break down' });
        return;
      }
      res.json(data);
    } catch (error: any) {
      logger.error(error, 'Money breakdown error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to load breakdown' });
    }
  },

  /**
   * End a contract and settle the money for good.
   *
   * The reason decides who bears the cost, so it is never taken from the caller at face
   * value: a client may only ever declare their own cancellation, a PT only their own
   * withdrawal, and only an admin can invoke the reasons that carry no penalty. Letting a
   * PT self-report MUTUAL would hand them a way to dodge the cancellation fee.
   */
  async terminate(req: any, res: Response) {
    try {
      const userId = req.headers['x-user-id'] as string;
      const role = req.headers['x-user-role'] as string;
      const reason = String(req.body?.reason ?? '').toUpperCase();

      const contract = await contractService.getById(req.params.id);
      if (!contract) {
        res.status(404).json({ error: 'Contract not found' });
        return;
      }

      const isClient = contract.clientUserId === userId;
      const isPt = contract.ptUserId === userId;
      const isAdmin = role === 'ADMIN';

      const allowed: Record<string, boolean> = {
        CLIENT_CANCELLED: isClient || isAdmin,
        PT_CANCELLED: isPt || isAdmin,
        PT_BANNED: isAdmin,
        MUTUAL: isAdmin,
        EXPIRED: isAdmin,
        COMPLETED: isAdmin,
      };
      if (!(reason in allowed)) {
        res.status(400).json({ error: `Unknown termination reason: ${reason}` });
        return;
      }
      if (!allowed[reason]) {
        res.status(403).json({ error: `You may not terminate this contract as ${reason}` });
        return;
      }

      const result = await terminateContractMoney(req.params.id, reason as any);

      // The reason decides who pays, so record who declared it and under what authority.
      // "The admin ended it as MUTUAL" and "the PT ended it as MUTUAL" settle differently,
      // and only the log can tell them apart afterwards.
      await auditService.record({
        actorUserId: userId,
        action: "CONTRACT_TERMINATED",
        entityType: AuditEntityType.CONTRACT,
        entityId: req.params.id,
        metadata: {
          reason,
          actorRole: isAdmin ? "ADMIN" : isPt ? "PT" : isClient ? "CLIENT" : "UNKNOWN",
          refund: result?.refund ?? null,
          statusBefore: contract.status,
        },
        ...auditMeta(req),
      });

      res.json({ contractId: req.params.id, reason, settlement: result });
    } catch (error: any) {
      logger.error(error, 'Contract terminate error');
      res.status(error.status || 500).json({ error: error.message || 'Failed to terminate contract' });
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
