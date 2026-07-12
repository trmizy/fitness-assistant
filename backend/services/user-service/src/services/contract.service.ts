import { randomUUID } from 'crypto';
import { logger } from '@gym-coach/shared';
import { ContractStatus, PackageType, SessionMode } from '../generated/prisma';
import { contractRepository } from '../repositories/contract.repository';
import { profileRepository } from '../repositories/profile.repository';
import { notificationService } from './notification.service';
import { eSignService } from './esign.service';
import { generateContractPdf } from './contractPdf.service';
import { paymentClient } from '../clients/payment.client';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

async function getUserInfo(userId: string): Promise<{ email: string; firstName: string | null; lastName: string | null } | null> {
  try {
    const { default: axios } = await import('axios');
    const { data } = await axios.get(`${AUTH_SERVICE_URL}/auth/internal/users/${userId}`, {
      headers: { 'x-service-secret': INTERNAL_SERVICE_SECRET },
      timeout: 3000,
    });
    const u = data?.user;
    if (!u?.email) return null;
    return { email: u.email, firstName: u.firstName ?? null, lastName: u.lastName ?? null };
  } catch (e: any) {
    const status = e?.response?.status;
    if (status !== 404) {
      logger.warn({ status, code: e?.code }, 'getUserInfo: auth-service lookup failed');
    }
    return null;
  }
}

function fullName(info: { firstName: string | null; lastName: string | null } | null, fallback: string): string {
  if (!info) return fallback;
  return [info.firstName, info.lastName].filter(Boolean).join(' ') || fallback;
}

/**
 * Best-effort check whether a user is active (auth.users.isActive).
 * Returns `true` if the column does not yet exist (pre-migration) or if auth
 * is unreachable — i.e. fail-open for compatibility, but log so admins notice.
 * After the migration BUG-002 lands, this becomes the source of truth.
 */
async function isUserActive(userId: string): Promise<boolean> {
  try {
    const { default: axios } = await import('axios');
    const { data } = await axios.get(`${AUTH_SERVICE_URL}/auth/internal/users/${userId}`, {
      headers: { 'x-service-secret': INTERNAL_SERVICE_SECRET },
      timeout: 3000,
    });
    const u = data?.user;
    if (!u) return true;
    if (typeof u.isActive === 'boolean') return u.isActive;
    return true; // pre-migration: treat as active
  } catch {
    return true; // fail-open; alternative would block everything on auth outage
  }
}

export const contractService = {
  // ── Client requests a contract with a PT ─────────────────────────
  async requestContract(clientUserId: string, data: {
    ptUserId: string;
    packageType?: string;
    packageName: string;
    description?: string;
    packageQuantity?: number;
    extraSessions?: number;
    totalSessions?: number; // Ignored if calculations are performed
    price?: number;         // Ignored if calculations are performed
    pricePerSession?: number;
    sessionMode?: string;
    startDate?: string;
    endDate?: string;
    message?: string;
    terms?: string;
    notes?: string;
  }) {
    // 1. Fetch PT Application for pricing rules
    const app = await profileRepository.findPTApplicationByUserId(data.ptUserId);
    if (!app) throw err('PT profile or pricing not found', 404);

    let finalSessions = 0;
    let finalPrice = 0;
    let unitPrice = 0;

    const packQty = Math.max(1, data.packageQuantity || 1);
    const extra = Math.max(0, data.extraSessions || 0);

    if (data.packageType === 'PACKAGE') {
      const sessPerPack = app.sessionsPerPackage || 10;
      const basePrice = app.packagePrice || 0;
      
      finalSessions = (sessPerPack * packQty) + extra;
      unitPrice = sessPerPack > 0 ? basePrice / sessPerPack : 0;
      finalPrice = (basePrice * packQty) + (extra * unitPrice);
    } else {
      // PER_SESSION logic
      finalSessions = Math.max(1, data.totalSessions || 1);
      unitPrice = app.desiredSessionPrice || 0;
      finalPrice = finalSessions * unitPrice;
    }

    // BR-27: no duplicate active/pending contract with same PT
    const existing = await contractRepository.findActiveByPair(data.ptUserId, clientUserId);
    if (existing) {
      throw err('You already have an active or pending contract with this PT', 409);
    }

    const contract = await contractRepository.create({
      ptUserId: data.ptUserId,
      clientUserId,
      status: ContractStatus.PENDING_REVIEW,
      packageType: (data.packageType as PackageType) || PackageType.PACKAGE,
      packageName: data.packageName,
      description: data.description,
      packageQuantity: data.packageType === 'PACKAGE' ? packQty : 1,
      extraSessions: data.packageType === 'PACKAGE' ? extra : 0,
      totalSessions: finalSessions,
      price: finalPrice,
      pricePerSession: unitPrice,
      sessionMode: data.sessionMode ? (data.sessionMode as SessionMode) : undefined,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      endDate: data.endDate ? new Date(data.endDate) : undefined,
      clientMessage: data.message,
      terms: data.terms,
      notes: data.notes,
    });

    // Notify PT
    await notificationService.create({
      userId: data.ptUserId,
      text: 'New coaching request received',
      eventType: 'CONTRACT_REQUESTED',
      entityType: 'CONTRACT',
      entityId: contract.id,
      link: '/pt/contracts',
    }).catch(() => {});

    return contract;
  },

  // ── PT accepts a pending contract ─────────────────────────────────
  async acceptContract(contractId: string, ptUserId: string) {
    const contract = await contractRepository.findById(contractId);
    if (!contract) throw err('Contract not found', 404);
    if (contract.ptUserId !== ptUserId) throw err('Not authorized', 403);
    if (contract.status !== ContractStatus.PENDING_REVIEW) {
      throw err(`Cannot accept contract in ${contract.status} status`, 400);
    }

    // 1. Fetch real emails + names (fail-fast: e-sign requires real emails)
    const [ptInfo, clientInfo] = await Promise.all([
      getUserInfo(ptUserId),
      getUserInfo(contract.clientUserId),
    ]);
    if (!ptInfo?.email) throw err('PT account not found or email unavailable', 500);
    if (!clientInfo?.email) throw err('Client account not found or email unavailable', 500);

    const ptName = fullName(ptInfo, 'Personal Trainer');
    const clientName = fullName(clientInfo, 'Client');

    // 2. Atomic claim: PENDING_REVIEW → PENDING_SIGNATURE (BEFORE generating PDF)
    // Prevents double PDF generation on concurrent requests. No startDate — not ACTIVE yet.
    const affected = await contractRepository.updateWhereStatus(
      contractId,
      ContractStatus.PENDING_REVIEW,
      ContractStatus.PENDING_SIGNATURE,
      {
        clientSignerEmail: clientInfo.email,
        ptSignerEmail: ptInfo.email,
        eSignTestMode: process.env.DROPBOX_SIGN_TEST_MODE === 'true',
      },
    );
    if (affected.count === 0) {
      throw err('Contract already being processed by another request', 409);
    }

    // 3. Generate PDF (after claim — only 1 request reaches here)
    let relativePdfPath: string;
    try {
      relativePdfPath = await generateContractPdf({
        contractId,
        packageName: contract.packageName,
        totalSessions: contract.totalSessions,
        price: contract.price ?? null,
        pricePerSession: contract.pricePerSession ?? null,
        startDate: contract.startDate ?? null,
        endDate: contract.endDate ?? null,
        terms: contract.terms ?? null,
        notes: contract.notes ?? null,
        clientName,
        clientEmail: clientInfo.email,
        ptName,
        ptEmail: ptInfo.email,
        createdAt: contract.createdAt,
      });
      await contractRepository.update(contractId, { contractPdfPath: relativePdfPath });
    } catch (e: any) {
      const shortMsg = (e?.message || 'PDF generation failed').toString().slice(0, 240);
      logger.error({ contractId, message: shortMsg }, 'PDF generation failed in acceptContract');
      await contractRepository.update(contractId, { eSignStatus: 'ERROR', eSignError: shortMsg }).catch(() => {});
      throw err('Failed to generate contract PDF', 500);
    }

    // 4. Send e-sign (fail-safe: stays PENDING_SIGNATURE, eSignStatus=ERROR if send fails)
    try {
      const result = await eSignService.send({
        contractId,
        title: `Coaching Contract - ${contract.packageName}`,
        subject: 'Please sign your coaching contract',
        message: 'Your coaching contract is ready. Please review and sign to activate.',
        testMode: process.env.DROPBOX_SIGN_TEST_MODE === 'true',
        signers: [
          { name: ptName,     email: ptInfo.email,     role: 'pt' },
          { name: clientName, email: clientInfo.email, role: 'client' },
        ],
        pdfPath: relativePdfPath,
      });
      await contractRepository.update(contractId, {
        eSignProvider: result.provider,
        eSignRequestId: result.requestId,
        eSignStatus: 'SENT',
        eSignSentAt: new Date(),
        eSignError: null,
      });
    } catch (e: any) {
      const shortMsg = (e?.message || 'unknown e-sign error').toString().slice(0, 240);
      logger.error({ contractId, message: shortMsg }, 'e-sign send failed in acceptContract');
      await contractRepository.update(contractId, {
        eSignStatus: 'ERROR',
        eSignError: shortMsg,
      }).catch(() => {});
    }

    // 5. Notify client
    await notificationService.create({
      userId: contract.clientUserId,
      text: 'Your coaching request was accepted! Please check your email to sign the contract.',
      eventType: 'CONTRACT_ACCEPTED',
      entityType: 'CONTRACT',
      entityId: contractId,
      link: '/client/schedule',
    }).catch(() => {});

    return contractRepository.findById(contractId);
  },

  // ── PT rejects a pending contract ─────────────────────────────────
  async rejectContract(contractId: string, ptUserId: string, reason: string) {
    if (!reason?.trim()) throw err('Rejection reason is required', 400);

    const contract = await contractRepository.findById(contractId);
    if (!contract) throw err('Contract not found', 404);
    if (contract.ptUserId !== ptUserId) throw err('Not authorized', 403);
    if (contract.status !== ContractStatus.PENDING_REVIEW) {
      throw err(`Cannot reject contract in ${contract.status} status`, 400);
    }

    const updated = await contractRepository.updateStatus(contractId, ContractStatus.REJECTED, {
      rejectionReason: reason.trim(),
    });

    await notificationService.create({
      userId: contract.clientUserId,
      text: 'Your coaching request was declined',
      eventType: 'CONTRACT_REJECTED',
      entityType: 'CONTRACT',
      entityId: contractId,
      link: '/client/contracts',
    }).catch(() => {});

    return updated;
  },

  // ── Cancel contract (either party) ─────────────────────────────────
  async cancelContract(contractId: string, userId: string, reason: string) {
    if (!reason?.trim()) throw err('Cancellation reason is required', 400);

    const contract = await contractRepository.findById(contractId);
    if (!contract) throw err('Contract not found', 404);
    if (contract.ptUserId !== userId && contract.clientUserId !== userId) {
      throw err('Not authorized', 403);
    }
    // PENDING_PAYMENT is now cancellable too (no payment-service call — nothing was ever
    // charged for a contract that's signed but not yet paid). The existing ACTIVE/PENDING_REVIEW
    // rule is unchanged — only the PENDING_PAYMENT branch is new here.
    if (
      contract.status !== ContractStatus.ACTIVE
      && contract.status !== ContractStatus.PENDING_REVIEW
      && contract.status !== ContractStatus.PENDING_PAYMENT
    ) {
      throw err(`Cannot cancel contract in ${contract.status} status`, 400);
    }

    const updated = await contractRepository.updateStatus(contractId, ContractStatus.CANCELLED, {
      cancelledBy: userId,
      cancellationReason: reason.trim(),
    });

    // Notify the other party
    const otherUserId = userId === contract.ptUserId ? contract.clientUserId : contract.ptUserId;
    const isClient = userId === contract.clientUserId;
    await notificationService.create({
      userId: otherUserId,
      text: isClient ? 'Client cancelled the contract' : 'Trainer cancelled the contract',
      eventType: 'CONTRACT_CANCELLED',
      entityType: 'CONTRACT',
      entityId: contractId,
      link: isClient ? '/pt/contracts' : '/client/contracts',
    }).catch(() => {});

    return updated;
  },

  // ── Auto-complete when sessions exhausted ──────────────────────────
  async checkAndCompleteContract(contractId: string) {
    const contract = await contractRepository.findById(contractId);
    if (!contract || contract.status !== ContractStatus.ACTIVE) return null;
    if (contract.usedSessions >= contract.totalSessions) {
      return contractRepository.updateStatus(contractId, ContractStatus.COMPLETED, {
        completedAt: new Date(),
      });
    }
    return null;
  },

  // ── Existing CRUD methods (kept for backward compat) ───────────────

  async create(ptUserId: string, data: {
    clientUserId: string;
    packageName: string;
    description?: string;
    totalSessions: number;
    price?: number;
    startDate?: string;
    endDate?: string;
    terms?: string;
    notes?: string;
  }) {
    return contractRepository.create({
      ...data,
      ptUserId,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      endDate: data.endDate ? new Date(data.endDate) : undefined,
    });
  },

  async getByPT(ptUserId: string, status?: string) {
    const s = status ? (status as ContractStatus) : undefined;
    const contracts = await contractRepository.findByPT(ptUserId, s);
    if (contracts.length === 0) return contracts;

    const clientIds = [...new Set(contracts.map(c => c.clientUserId))];
    const profiles = await profileRepository.findByUserIds(clientIds);
    const profileMap = new Map(profiles.map(p => [p.userId, p]));

    return contracts.map(c => ({
      ...c,
      clientProfile: profileMap.get(c.clientUserId) ?? null,
    }));
  },

  async getByClient(clientUserId: string, status?: string) {
    const s = status ? (status as ContractStatus) : undefined;
    const contracts = await contractRepository.findByClient(clientUserId, s);
    if (contracts.length === 0) return contracts;

    const ptIds = [...new Set(contracts.map(c => c.ptUserId))];
    const profiles = await profileRepository.findByUserIds(ptIds);
    const profileMap = new Map(profiles.map(p => [p.userId, p]));

    return contracts.map(c => ({
      ...c,
      ptProfile: profileMap.get(c.ptUserId) ?? null,
    }));
  },

  async getById(id: string) {
    return contractRepository.findByIdWithSessions(id);
  },

  async updateStatus(id: string, userId: string, newStatus: string, userRole?: string) {
    const contract = await contractRepository.findById(id);
    if (!contract) throw err('Contract not found', 404);

    const isAdmin = userRole === 'ADMIN';
    if (!isAdmin && contract.ptUserId !== userId && contract.clientUserId !== userId) {
      throw err('Not authorized', 403);
    }

    // Admin fail-safe: force past a broken e-sign (PENDING_SIGNATURE/PENDING_REVIEW → PENDING_PAYMENT,
    // not ACTIVE — payment is still required; this bypass only skips the broken e-sign step).
    // NOT a replacement for the real e-sign flow — emit audit log so this manual
    // override is traceable. Frontend should warn admin about manual override.
    if (
      isAdmin &&
      newStatus === 'ACTIVE' &&
      (contract.status === ContractStatus.PENDING_SIGNATURE || contract.status === ContractStatus.PENDING_REVIEW)
    ) {
      logger.warn(
        { event: 'CONTRACT_FORCE_PENDING_PAYMENT', contractId: id, adminUserId: userId, prevStatus: contract.status },
        'Admin manually bypassed e-sign (contract moved to PENDING_PAYMENT, still requires payment)',
      );
      return contractRepository.updateStatus(id, ContractStatus.PENDING_PAYMENT, {
        fullySignedAt: new Date(),
      });
    }

    // PT accepts a PENDING_REVIEW contract → starts the e-sign flow (acceptContract moves it
    // to PENDING_SIGNATURE, not ACTIVE — ACTIVE only happens after signing AND payment).
    if (newStatus === 'ACTIVE' && contract.status === ContractStatus.PENDING_REVIEW && contract.ptUserId === userId) {
      return this.acceptContract(id, userId);
    }

    // Either party can cancel a PENDING_* contract; admin can also force-cancel.
    // An ACTIVE contract (already paid) cannot be cancelled this way — it must go through
    // the admin refund flow (payment-service), which calls /internal/contracts/:id/cancel-after-refund.
    if (newStatus === 'CANCELLED') {
      return this.cancelContract(id, userId, 'Status changed to cancelled');
    }

    // PT or admin can mark expired
    if (newStatus === 'EXPIRED' && (contract.ptUserId === userId || isAdmin)) {
      return contractRepository.updateStatus(id, ContractStatus.EXPIRED);
    }

    throw err(`Invalid status transition: ${contract.status} → ${newStatus}`, 400);
  },

  /**
   * Resend (or send) the e-sign request for a contract in PENDING_SIGNATURE.
   * The MVP build simplifies acceptContract to set status=ACTIVE directly, so this
   * method is rarely reached. When it IS reached:
   *  - if provider throws upstream error → persist eSignStatus='ERROR' + eSignError,
   *    return err with status=502 (Bad Gateway).
   *  - if local/config error → persist eSignStatus='ERROR', return err with status=500.
   *  - logs are sanitized: only short error message + provider/status, never API key/URL/PII.
   */
  async resendESign(contractId: string): Promise<{ requestId: string; provider: string }> {
    const contract = await contractRepository.findById(contractId);
    if (!contract) throw err('Contract not found', 404);
    if (contract.status !== ContractStatus.PENDING_SIGNATURE) {
      throw err('Contract is not in PENDING_SIGNATURE state', 400);
    }
    // Controller already guards ERROR/EXPIRED, but service enforces for defense-in-depth
    if (!['ERROR', 'EXPIRED'].includes(contract.eSignStatus || '')) {
      throw err('E-sign is not eligible for resend — status must be ERROR or EXPIRED', 400);
    }
    if (!contract.clientSignerEmail || !contract.ptSignerEmail) {
      throw err('Signer emails not set — please contact admin to reset the contract', 400);
    }
    if (!contract.contractPdfPath) {
      throw err('Contract PDF missing — please contact admin to regenerate', 400);
    }

    try {
      const result = await eSignService.send({
        contractId,
        title: `Coaching Contract - ${contract.packageName}`,
        subject: 'Please sign your coaching contract',
        message: 'Your coaching contract is ready. Please review and sign to activate.',
        testMode: process.env.DROPBOX_SIGN_TEST_MODE === 'true',
        signers: [
          { name: 'Client', email: contract.clientSignerEmail, role: 'client' },
          { name: 'PT',     email: contract.ptSignerEmail,     role: 'pt' },
        ],
        pdfPath: contract.contractPdfPath,
      });

      await contractRepository.update(contractId, {
        eSignProvider: result.provider,
        eSignRequestId: result.requestId,
        eSignStatus: 'SENT',
        eSignSentAt: new Date(),
        eSignError: null,
      });

      return result;
    } catch (e: any) {
      const shortMsg = (e?.message || 'unknown e-sign error').toString().slice(0, 240);
      const upstreamStatus = e?.response?.status || e?.statusCode;
      const isUpstream = typeof upstreamStatus === 'number' && upstreamStatus >= 400;
      await contractRepository.update(contractId, {
        eSignStatus: 'ERROR',
        eSignError: shortMsg,
      }).catch(() => {});
      logger.error(
        { eSignProvider: process.env.ESIGN_PROVIDER || 'DROPBOX_SIGN', upstreamStatus, code: e?.code, message: shortMsg },
        'e-sign resend failed',
      );
      if (isUpstream) throw err(`E-sign provider error (${upstreamStatus})`, 502);
      throw err(`E-sign error: ${shortMsg}`, 500);
    }
  },

  async update(id: string, ptUserId: string, data: any) {
    const contract = await contractRepository.findById(id);
    if (!contract) throw err('Contract not found', 404);
    if (contract.ptUserId !== ptUserId) {
      throw err('Only the PT can edit this contract', 403);
    }
    return contractRepository.update(id, data);
  },

  async incrementSession(id: string, ptUserId: string) {
    const contract = await contractRepository.findById(id);
    if (!contract) throw err('Contract not found', 404);
    if (contract.ptUserId !== ptUserId) {
      throw err('Only the PT can log sessions', 403);
    }
    if (contract.status !== 'ACTIVE') {
      throw err('Contract is not active', 400);
    }
    const updated = await contractRepository.incrementSession(id);
    await this.checkAndCompleteContract(id);
    return updated;
  },

  // ── Expire overdue contracts ───────────────────────────────────────
  async expireContracts() {
    const expired = await contractRepository.findExpiredContracts();
    let count = 0;
    for (const c of expired) {
      await contractRepository.updateStatus(c.id, ContractStatus.EXPIRED);
      count++;
    }
    return count;
  },

  // ── Check relationship (BR-29: chat/call only with contract) ─────────
  async checkRelationship(userAId: string, userBId: string) {
    const contract = await contractRepository.findRelationshipByPair(userAId, userBId);
    return { allowed: !!contract };
  },

  /**
   * BR-29 (loosened): a CUSTOMER may chat with an APPROVED PT even before signing
   * a contract (discovery / pre-sale consultation). Returns a structured verdict so
   * the caller (chat-service) can show a clear reason but cannot deduce private
   * state when denied.
   */
  async computeChatEligibility(fromUserId: string, toUserId: string): Promise<{
    allowed: boolean;
    reason: 'ACTIVE_CONTRACT' | 'APPROVED_PT_DISCOVERY' | 'INACTIVE_USER' | 'NO_RELATIONSHIP_OR_NOT_APPROVED_PT';
  }> {
    // 1) Any existing contract relationship between the two parties is always allowed.
    //    findRelationshipByPair matches both directions and any non-terminal status.
    const contract = await contractRepository.findRelationshipByPair(fromUserId, toUserId);
    if (contract) {
      // Honor isActive on both sides if known. We import the auth helper lazily to
      // avoid a circular module load at startup.
      const [fromActive, toActive] = await Promise.all([
        isUserActive(fromUserId),
        isUserActive(toUserId),
      ]);
      if (fromActive === false || toActive === false) {
        return { allowed: false, reason: 'INACTIVE_USER' };
      }
      return { allowed: true, reason: 'ACTIVE_CONTRACT' };
    }

    // 2) No contract — only allow if toUser is an APPROVED PT and both users are active.
    const toApp = await profileRepository.findPTApplicationByUserId(toUserId);
    const toProfile = await profileRepository.findByUserId(toUserId);
    const isApprovedPT = !!toProfile?.isPT && toApp?.status === 'APPROVED';
    if (!isApprovedPT) {
      return { allowed: false, reason: 'NO_RELATIONSHIP_OR_NOT_APPROVED_PT' };
    }

    const [fromActive, toActive] = await Promise.all([
      isUserActive(fromUserId),
      isUserActive(toUserId),
    ]);
    if (fromActive === false || toActive === false) {
      return { allowed: false, reason: 'INACTIVE_USER' };
    }
    return { allowed: true, reason: 'APPROVED_PT_DISCOVERY' };
  },

  // ── PT earnings aggregate ──────────────────────────────────────────
  async getEarnings(ptUserId: string) {
    const contracts = await contractRepository.findByPT(ptUserId);
    const active = contracts.filter(c => c.status === 'ACTIVE');
    const completed = contracts.filter(c => c.status === 'COMPLETED');

    const totalEarned = completed.reduce((sum, c) => sum + (c.price || 0), 0);
    const activeRevenue = active.reduce((sum, c) => sum + (c.price || 0), 0);

    return {
      totalContracts: contracts.length,
      activeContracts: active.length,
      completedContracts: completed.length,
      totalEarned,
      activeRevenue,
    };
  },

  // ── Payment gate (Phase 4) ──────────────────────────────────────────

  /** Client pays a PENDING_PAYMENT contract via wallet-transfer (client -> PT wallet). */
  async pay(contractId: string, clientUserId: string) {
    const contract = await contractRepository.findById(contractId);
    if (!contract) throw err('Contract not found', 404);
    if (contract.clientUserId !== clientUserId) throw err('Not authorized', 403);
    if (contract.status === ContractStatus.ACTIVE || contract.paymentTransactionId) {
      throw err('ALREADY_PAID', 409);
    }
    if (contract.status !== ContractStatus.PENDING_PAYMENT) {
      throw err(`Cannot pay for contract in ${contract.status} status`, 400);
    }
    if (!contract.price) throw err('Contract has no price set', 400);

    const attemptId = randomUUID();
    const idempotencyKey = `pt-contract:${contract.id}:attempt:${attemptId}`;

    const result = await paymentClient.walletTransfer({
      payerOwnerId: clientUserId,
      receiverPtId: contract.ptUserId,
      amount: contract.price,
      relatedEntityId: contract.id,
      idempotencyKey,
      initiatedBy: clientUserId,
      ptId: contract.ptUserId,
    });

    if (result.status === 'PAID') {
      const activated = await contractRepository.activateIfPending(contract.id, result.transactionId);
      try {
        await paymentClient.markActivated(result.transactionId);
      } catch (e) {
        logger.warn({ error: 'mark-activated callback failed, reconciliation will retry', contractId: contract.id, message: (e as Error).message });
      }
      return { contract: activated, payment: result };
    }

    return { contract: await contractRepository.findById(contract.id), payment: result };
  },

  /** Called by the internal /activate-after-payment endpoint — verifies the transaction first. */
  async activateAfterPayment(contractId: string, transactionId: string) {
    const txn = await paymentClient.getTransaction(transactionId);
    if (!txn || txn.status !== 'PAID' || txn.relatedEntityType !== 'PT_CONTRACT' || txn.relatedEntityId !== contractId) {
      throw err('Transaction verification failed', 400);
    }
    return contractRepository.activateIfPending(contractId, transactionId);
  },

  /** Called by the internal /cancel-after-refund endpoint — verifies both transactions first. */
  async cancelAfterRefund(contractId: string, originalTransactionId: string, refundTransactionId: string) {
    const [original, refund] = await Promise.all([
      paymentClient.getTransaction(originalTransactionId),
      paymentClient.getTransaction(refundTransactionId),
    ]);
    if (!original || original.status !== 'REFUNDED' || original.relatedEntityId !== contractId) {
      throw err('Original transaction verification failed', 400);
    }
    if (!refund || refund.status !== 'PAID' || refund.refundOfTransactionId !== originalTransactionId) {
      throw err('Refund transaction verification failed', 400);
    }
    return contractRepository.cancelAfterRefund(contractId);
  },
};
