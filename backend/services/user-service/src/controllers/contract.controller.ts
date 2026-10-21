import path from "path";
import fs from "fs";
import { Response } from "express";
import { logger } from "@gym-coach/shared";
import { contractService, CONTRACT_NOT_ACTIVATABLE } from "../services/contract.service";
import {
  settleContractTermination,
} from '../services/contract-payout.service';
import { auditService, auditMeta } from "../services/audit.service";
import { contractRepository } from "../repositories/contract.repository";
import { AuthServiceUnavailableError } from "../clients/auth-service.client";
import { assertPtMayActOnContract } from "../services/pt-restriction.service";
import { previewClientExit, terminateAsClient } from "../services/client-exit.service";
import { errorCodeBody } from "../utils/error-code.util";
import { clientHeaderOf } from "../services/client-compat.service";
import {
  MEMBERSHIP_REQUIRED,
  MEMBERSHIP_DOES_NOT_COVER_CONTRACT,
  OPEN_ENDED_CONTRACT_MEMBERSHIP_UNPROVEN,
} from "../services/contract-gym-membership.service";
import { AuditEntityType, ContractStatus } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import {
  createPresignedGetObject,
  isS3Ref,
  keyFromS3Ref,
} from "../services/s3-upload.service";

import { redactBreakdownForViewer, redactContractSplit, redactSettlementForViewer, type ContractViewer } from "../services/contract-dto";

/** Who is asking, as the gateway authenticated them: decides whether a contract row comes back with its money split. */
const viewerOf = (req: any): ContractViewer => ({
  userId: req.headers["x-user-id"] as string | undefined,
  role: req.headers["x-user-role"] as string | undefined,
});

export const contractController = {
  // Client requests a contract with a PT
  async requestContract(req: any, res: Response) {
    try {
      const clientUserId = req.headers["x-user-id"] as string;
      const contract = await contractService.requestContract(
        clientUserId,
        req.body,
        undefined,
        { clientHeader: clientHeaderOf(req) },
      );
      res.status(201).json(redactContractSplit(contract, viewerOf(req)));
    } catch (error: any) {
      logger.error(error, "Request contract error");
      // LOW_AVAILABILITY carries the fields the client UI's warning dialog needs
      // (availableSlots, packageSessions, nearestAvailableSlot) — a plain
      // { error: message } here was silently swallowing all three, so the dialog's
      // `code === "LOW_AVAILABILITY"` check could never match and it never rendered.
      res.status(error.status || 500).json({
        ...errorCodeBody(error),
        error: error.message || "Failed to request contract",
        // 409 PACKAGE_CHANGED carries the package as it is NOW (with its version), so the UI can show the new terms.
        ...(error.code === "PACKAGE_CHANGED" && error.package ? { package: error.package } : {}),
        ...(error.code === "LOW_AVAILABILITY"
          ? {
              code: error.code,
              availableSlots: error.availableSlots,
              packageSessions: error.packageSessions,
              nearestAvailableSlot: error.nearestAvailableSlot,
            }
          : {}),
        // Phase 3 / P3.3: the membership refusals carry the facts the UI needs (gymId/brandId to link to
        // buying a plan; membershipEndDate/contractEndDate to explain the gap), both under `details`
        // and flat, so a client may read either.
        ...(((error.status === 422 &&
          (error.code === MEMBERSHIP_REQUIRED || error.code === MEMBERSHIP_DOES_NOT_COVER_CONTRACT)) ||
          (error.status === 409 && error.code === OPEN_ENDED_CONTRACT_MEMBERSHIP_UNPROVEN)) &&
        error.details
          ? { details: error.details, ...error.details }
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
      res.json(redactContractSplit(contract, viewerOf(req)));
    } catch (error: any) {
      logger.error(error, "Accept contract error");
      res.status(error.status || 500).json({
        error: error.message || "Failed to accept contract",
        ...(error.status && typeof error.code === "string" ? { code: error.code } : {}),
        ...(error.code === "PT_TERMS_NOT_ACCEPTED" && error.termsVersion ? { termsVersion: error.termsVersion } : {}),
      });
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
      res.json(redactContractSplit(contract, viewerOf(req)));
    } catch (error: any) {
      logger.error(error, "Reject contract error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to reject contract", ...errorCodeBody(error) });
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
      res.json(redactContractSplit(contract, viewerOf(req)));
    } catch (error: any) {
      logger.error(error, "Cancel contract error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to cancel contract", ...errorCodeBody(error) });
    }
  },

  // PT creates a contract for a client (legacy)
  async create(req: any, res: Response) {
    try {
      const ptUserId = req.headers["x-user-id"] as string;
      const contract = await contractService.create(ptUserId, req.body);
      res.status(201).json(redactContractSplit(contract, viewerOf(req)));
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
      res.json(redactContractSplit(contracts, viewerOf(req)));
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
      res.json(redactContractSplit(contracts, viewerOf(req)));
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
      res.json(redactContractSplit(contract, viewerOf(req)));
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
      res.json(redactContractSplit(contract, viewerOf(req)));
    } catch (error: any) {
      logger.error(error, "Update contract status error");
      res.status(error.status || 500).json({
        error: error.message || "Failed to update status",
        ...(error.status && typeof error.code === "string" ? { code: error.code } : {}),
        ...(error.code === "PT_TERMS_NOT_ACCEPTED" && error.termsVersion ? { termsVersion: error.termsVersion } : {}),
      });
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
      res.json(redactContractSplit(contract, viewerOf(req)));
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
      res.json(redactContractSplit(contract, viewerOf(req)));
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
      if (error instanceof AuthServiceUnavailableError) {
        res.status(503).json({ error: "Account status cannot be verified right now" });
        return;
      }
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

  // INTERNAL — called by ai-service BEFORE a personalized service checkout starts: is there already a live
  // (non-terminal, PENDING_PAYMENT included) PT contract between this PT and this client? Marketplace-originated
  // contracts do not count. See contractService.hasStandingPtContract.
  async hasStandingPtContract(req: any, res: Response) {
    try {
      const { ptUserId, clientUserId } = req.query;
      if (!ptUserId || !clientUserId || typeof ptUserId !== "string" || typeof clientUserId !== "string") {
        res.status(400).json({ error: "ptUserId and clientUserId are required" });
        return;
      }
      res.json({ conflict: await contractService.hasStandingPtContract(ptUserId, clientUserId) });
    } catch (error: any) {
      logger.error(error, "hasStandingPtContract error");
      res.status(500).json({ error: "Failed to check existing PT contract" });
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
      if (error instanceof AuthServiceUnavailableError) {
        res.status(503).json({ error: "Account status cannot be verified right now" });
        return;
      }
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
      // Same signal as ai-service/gym-service's own detectPlatform: the Capacitor app's
      // WebView has a fixed `http://localhost` origin a real browser never sends.
      const platform: 'web' | 'mobile' = req.headers.origin === 'http://localhost' ? 'mobile' : 'web';
      const returnBaseUrl = typeof req.headers['x-public-base-url'] === 'string' ? req.headers['x-public-base-url'] : undefined;
      const result = await contractService.pay(req.params.id, clientUserId, provider, platform, returnBaseUrl);
      // `result.contract` is the raw row (frozen split, holdback, released-to-*): the client gets it without those fields.
      res.json(redactContractSplit(result, viewerOf(req)));
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
      res.status(error.status || 500).json({
        error: error.message || 'Failed to pay contract',
        ...(error.status && typeof error.code === 'string' ? { code: error.code } : {}),
      });
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
        res.status(error.status).json({ error: error.message, ...errorCodeBody(error) });
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
      // The preview is priced with the SAME terms the termination would send (reason + sessions held), via
      // the one shared helper in client-exit.service.ts - so `refundIfCancelledNow` is what cancelling now
      // really refunds, `exitReasonIfCancelledNow` says which reason that is, `unresolvedSessions` how many
      // sessions' value would stay held, and payment-service's `reasonUsed` / `unresolvedAmountHeld` pass through.
      const data = await previewClientExit(req.params.id);
      if (!data) {
        res.status(400).json({ error: 'Contract has no price or sessions to break down' });
        return;
      }
      res.json(redactBreakdownForViewer(data, viewerOf(req), contract.ptUserId));
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
        // Vòng 4 / Phase E2 — a RIGHT the client exercises themselves (not automatic, not
        // admin-only) — but only once actually earned. The count check right below is what
        // stops a client from just declaring this reason on any contract; the boolean here
        // only says "a client is the kind of caller who is ever allowed to pick this reason".
        PT_REPEATED_NO_SHOW: isClient || isAdmin,
      };
      if (!(reason in allowed)) {
        res.status(400).json({ error: `Unknown termination reason: ${reason}` });
        return;
      }
      if (!allowed[reason]) {
        res.status(403).json({ error: `You may not terminate this contract as ${reason}` });
        return;
      }

      // Vòng 4 / Phase E2 — never trust the caller's say-so for the ONE reason a client can
      // self-declare a full refund: re-count ptAtFault sessions on THIS contract server-side.
      // An admin invoking the same reason (e.g. on the client's behalf, over support) is
      // exempt from the count — admins can already invoke PT_BANNED/MUTUAL with no precondition
      // at all, so gating admin use of this reason more strictly would be inconsistent.
      if (reason === "PT_REPEATED_NO_SHOW" && !isAdmin) {
        const { eligible, count, threshold } = await contractService.repeatedNoShowEligibility(req.params.id);
        if (!eligible) {
          res.status(403).json({
            error: `Chưa đủ điều kiện — cần ít nhất ${threshold} lần huấn luyện viên vắng mặt được xác nhận (hiện tại: ${count})`,
          });
          return;
        }
      }

      // Restricted mode: a suspended PT cannot end a contract on their own account (PT_CANCELLED carries
      // a fine on the PT) — otherwise the system would book a PT-fault termination against a PT who
      // is only paused. Admin terminations keep their own reasons and formulas.
      if (isPt && !isAdmin) await assertPtMayActOnContract(userId, req.params.id);

      // The client's own cancellation goes through the exit check (client-exit.service.ts): while the
      // contract's PT is restricted the SERVER swaps the reason for CLIENT_EXIT_DUE_TO_PT_RESTRICTION
      // (100% of the unused value back, no fee). The request never carries that reason, and it is
      // never accepted from one (it is not in the `allowed` table above). Every other caller and
      // reason takes the unchanged path below.
      let result: any;
      // D59: an ending that was already ACCEPTED (recorded) keeps its recorded reason - a retry, or another caller asking for
      // a different reason, completes THAT ending and is told which reason it ended with.
      let recordedReason: string = reason;
      let alreadyEnding = false;
      let exit: Awaited<ReturnType<typeof terminateAsClient>> | null = null;
      if (reason === 'CLIENT_CANCELLED' && isClient) {
        const outcome = await terminateAsClient(req.params.id, userId, {
          audit: auditMeta(req),
          // The client confirmed the no-fee terms they were shown: refuse (409 PT_RESTRICTION_LIFTED) rather than
          // quietly charging the ordinary cancellation fee if those terms no longer hold.
          expectNoPenalty: req.body?.expectNoPenalty === true,
        });
        result = outcome.settlement;
        if (outcome.mode !== 'ORDINARY') exit = outcome;
      } else {
        const settled = await settleContractTermination(req.params.id, reason as any);
        result = settled?.result ?? null;
        recordedReason = settled?.reason ?? reason;
        alreadyEnding = !!settled && !settled.statusWritten;
      }

      if (exit) {
        // The exit service wrote its own audit row (once, by the call that changed the status).
        res.json({
          contractId: req.params.id,
          reason: exit.reason,
          requestedReason: reason,
          exitWithoutPenalty: exit.reason === 'CLIENT_EXIT_DUE_TO_PT_RESTRICTION',
          alreadyTerminated: exit.mode === 'ALREADY_EXITED' || exit.mode === 'ALREADY_ENDED',
          unresolvedSessions: exit.unresolvedSessions,
          settlement: redactSettlementForViewer(result, viewerOf(req), contract.ptUserId),
        });
        return;
      }

      // The reason decides who pays, so record who declared it and under what authority.
      // "The admin ended it as MUTUAL" and "the PT ended it as MUTUAL" settle differently,
      // and only the log can tell them apart afterwards.
      await auditService.record({
        actorUserId: userId,
        action: "CONTRACT_TERMINATED",
        entityType: AuditEntityType.CONTRACT,
        entityId: req.params.id,
        metadata: {
          reason: recordedReason,
          requestedReason: reason,
          actorRole: isAdmin ? "ADMIN" : isPt ? "PT" : isClient ? "CLIENT" : "UNKNOWN",
          refund: result?.refund ?? null,
          statusBefore: contract.status,
          alreadyEnding,
        },
        ...auditMeta(req),
      });

      res.json({
        contractId: req.params.id,
        reason: recordedReason,
        ...(recordedReason !== reason ? { requestedReason: reason } : {}),
        ...(alreadyEnding ? { alreadyTerminated: true } : {}),
        settlement: redactSettlementForViewer(result, viewerOf(req), contract.ptUserId),
      });
    } catch (error: any) {
      logger.error(error, 'Contract terminate error');
      // 409 PT_RESTRICTION_LIFTED carries the terms that hold now (a full money breakdown): a client gets the client aggregates only.
      let extra = error.status && error.extra ? error.extra : {};
      if (extra.currentTerms) {
        const owner = await contractRepository.findById(req.params.id).catch(() => null);
        extra = { ...extra, currentTerms: owner ? redactBreakdownForViewer(extra.currentTerms, viewerOf(req), owner.ptUserId) : null };
      }
      res.status(error.status || 500).json({ error: error.message || 'Failed to terminate contract', ...errorCodeBody(error), ...extra });
    }
  },

  // INTERNAL — payment-service calls this after a wallet-transfer PAID
  async activateAfterPayment(req: any, res: Response) {
    try {
      const { transactionId } = req.body;
      const contract = await contractService.activateAfterPayment(req.params.id, transactionId);
      res.json({ success: true, data: contract });
    } catch (error: any) {
      // 409 CONTRACT_NOT_ACTIVATABLE is a definite answer, not a failure (payment-service refunds
      // the client on it) — log it at warn level in the service, not as an error here.
      if (error.code === CONTRACT_NOT_ACTIVATABLE) {
        res.status(409).json({
          success: false,
          error: { code: CONTRACT_NOT_ACTIVATABLE, message: error.message, currentStatus: error.currentStatus },
        });
        return;
      }
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
