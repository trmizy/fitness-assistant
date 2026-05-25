import axios from 'axios';
import { ContractStatus, PackageType, PTApplicationStatus, SessionMode } from '../generated/prisma';
import { contractRepository } from '../repositories/contract.repository';
import { profileRepository } from '../repositories/profile.repository';
import { ptApplicationRepository } from '../repositories/pt_application.repository';
import { notificationService } from './notification.service';
import { generateContractPdf } from './contractPdf.service';
import { eSignService } from './esign.service';

async function fetchUserFromAuthService(userId: string) {
  const res = await axios.get(
    `${process.env.AUTH_SERVICE_URL}/auth/internal/users/${userId}`,
    { headers: { 'x-service-secret': process.env.INTERNAL_SERVICE_SECRET } },
  );
  return res.data.user as { id: string; email: string; firstName: string; lastName: string };
}

async function runESign(contractId: string, isResend = false) {
  const contract = await contractRepository.findById(contractId);
  if (!contract) throw new Error('Contract not found');

  const [clientInfo, ptInfo] = await Promise.all([
    fetchUserFromAuthService(contract.clientUserId),
    fetchUserFromAuthService(contract.ptUserId),
  ]);

  const pdfData = {
    id: contract.id,
    packageName: contract.packageName,
    sessionMode: contract.sessionMode,
    pricePerSession: contract.pricePerSession,
    price: contract.price,
    totalSessions: contract.totalSessions,
    packageType: contract.packageType,
    startDate: contract.startDate,
    clientInfo,
    ptInfo,
  };

  const pdfPath = await generateContractPdf(pdfData);

  const testMode = process.env.DROPBOX_SIGN_TEST_MODE !== 'false';

  const eSignResult = await eSignService.send({
    contractId: contract.id,
    testMode,
    signers: [
      { email: clientInfo.email, name: `${clientInfo.firstName} ${clientInfo.lastName}`, role: 'client' },
      { email: ptInfo.email, name: `${ptInfo.firstName} ${ptInfo.lastName}`, role: 'pt' },
    ],
    pdfPath,
    title: `Hop dong huan luyen - ${contract.packageName || 'Goi tap'}`,
    subject: 'Vui long ky hop dong huan luyen ca nhan',
    message: 'Hop dong nay o che do thu nghiem (test mode). Vui long ky de xac nhan.',
  });

  const resetFields = isResend
    ? { clientSignedAt: null, ptSignedAt: null, fullySignedAt: null }
    : {};

  await contractRepository.updateESignFields(contractId, {
    clientSignerEmail: clientInfo.email,
    ptSignerEmail: ptInfo.email,
    eSignProvider: eSignResult.provider,
    eSignRequestId: eSignResult.requestId,
    eSignStatus: 'SENT',
    eSignTestMode: eSignResult.testMode,
    eSignSentAt: new Date(),
    contractPdfPath: pdfPath,
    eSignError: null,
    ...resetFields,
  });
}

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
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
    totalSessions?: number;
    price?: number;
    pricePerSession?: number;
    sessionMode?: string;
    startDate?: string;
    endDate?: string;
    message?: string;
    terms?: string;
    notes?: string;
  }) {
    // ── 1. Validate packageType ────────────────────────────────────────
    if (!['PER_SESSION', 'PACKAGE'].includes(data.packageType ?? '')) {
      throw err('packageType phải là PER_SESSION hoặc PACKAGE', 400);
    }
    const isPackage = data.packageType === 'PACKAGE';

    // ── 2. Validate sessionMode ────────────────────────────────────────
    if (!data.sessionMode || !['ONLINE', 'OFFLINE'].includes(data.sessionMode)) {
      throw err('sessionMode phải là ONLINE hoặc OFFLINE', 400);
    }
    const reqMode = data.sessionMode as 'ONLINE' | 'OFFLINE';

    // ── 3. PT application phải APPROVED ───────────────────────────────
    const ptApp = await ptApplicationRepository.findByUserId(data.ptUserId);
    if (!ptApp || ptApp.status !== PTApplicationStatus.APPROVED) {
      throw err('Huấn luyện viên chưa được phê duyệt', 400);
    }

    // ── 4. PT phải hỗ trợ mode được yêu cầu ──────────────────────────
    const ptMode = ptApp.serviceMode;
    if (ptMode === 'ONLINE' && reqMode !== 'ONLINE')
      throw err('PT này chỉ coaching Online', 400);
    if (ptMode === 'OFFLINE' && reqMode !== 'OFFLINE')
      throw err('PT này chỉ coaching Offline', 400);
    // HYBRID: chấp nhận cả ONLINE lẫn OFFLINE

    // ── 5. Lookup giá từ PT application ───────────────────────────────
    let pricePerSession: number | null = null;
    let packageTotalPrice: number | null = null;

    if (reqMode === 'ONLINE') {
      pricePerSession = (ptApp.onlinePricePerSession ?? ptApp.desiredSessionPrice) || null;
      if (isPackage) packageTotalPrice = (ptApp.onlinePackagePrice ?? ptApp.packagePrice) || null;
    } else {
      pricePerSession = (ptApp.offlinePricePerSession ?? ptApp.desiredSessionPrice) || null;
      if (isPackage) packageTotalPrice = (ptApp.offlinePackagePrice ?? ptApp.packagePrice) || null;
    }

    // ── 6. Validate giá sau lookup ────────────────────────────────────
    if (!isPackage) {
      if (!pricePerSession || pricePerSession <= 0)
        throw err('PT chưa thiết lập giá per-session cho hình thức này', 400);
    } else {
      if (!packageTotalPrice || packageTotalPrice <= 0)
        throw err('PT chưa thiết lập giá gói cho hình thức này', 400);
      if (!ptApp.sessionsPerPackage || ptApp.sessionsPerPackage <= 0)
        throw err('PT chưa thiết lập số buổi trong gói', 400);
    }

    // ── 7. Tính tổng sessions và giá ──────────────────────────────────
    const packQty = Math.max(1, data.packageQuantity || 1);
    const extra = Math.max(0, data.extraSessions || 0);
    let finalSessions = 0;
    let finalPrice = 0;
    let unitPrice = 0;

    if (isPackage) {
      const sessPerPack = ptApp.sessionsPerPackage!;
      const basePrice = packageTotalPrice!;
      finalSessions = (sessPerPack * packQty) + extra;
      unitPrice = sessPerPack > 0 ? basePrice / sessPerPack : 0;
      finalPrice = (basePrice * packQty) + (extra * unitPrice);
    } else {
      finalSessions = Math.max(1, data.totalSessions || 1);
      unitPrice = pricePerSession!;
      finalPrice = finalSessions * unitPrice;
    }

    // MVP rule: one active/pending contract per client
    const existing = await contractRepository.findActiveOrPendingByClient(clientUserId);
    if (existing) {
      throw err('You already have an active or pending contract. Cancel or complete it first.', 409);
    }

    const contract = await contractRepository.create({
      ptUserId: data.ptUserId,
      clientUserId,
      status: ContractStatus.PENDING_REVIEW,
      packageType: (data.packageType as PackageType) || PackageType.PACKAGE,
      packageName: data.packageName,
      description: data.description,
      packageQuantity: isPackage ? packQty : 1,
      extraSessions: isPackage ? extra : 0,
      totalSessions: finalSessions,
      price: finalPrice,
      pricePerSession: unitPrice,
      sessionMode: reqMode as SessionMode,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      endDate: data.endDate ? new Date(data.endDate) : undefined,
      clientMessage: data.message,
      terms: data.terms,
      notes: data.notes,
    });

    // Notify PT
    await notificationService.create({
      userId: data.ptUserId,
      text: 'Nhận yêu cầu ký hợp đồng mới',
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

    // Set PENDING_SIGNATURE immediately
    await contractRepository.updateESignFields(contractId, {
      status: ContractStatus.PENDING_SIGNATURE,
      startDate: contract.startDate || new Date(),
    });

    // Notify client
    await notificationService.create({
      userId: contract.clientUserId,
      text: 'Yêu cầu hợp đồng của bạn đã được chấp nhận! Vui lòng kiểm tra email để ký điện tử.',
      eventType: 'CONTRACT_ACCEPTED',
      entityType: 'CONTRACT',
      entityId: contractId,
      link: '/client/contracts',
    }).catch(() => {});

    // Generate PDF + send Dropbox Sign (errors recorded in eSignStatus, do not crash accept flow)
    try {
      await runESign(contractId);
    } catch (e: any) {
      await contractRepository.updateESignFields(contractId, {
        eSignStatus: 'ERROR',
        eSignError: e?.message?.slice(0, 500) || 'Unknown error',
      });
    }

    return contractRepository.findById(contractId);
  },

  // ── Resend e-sign request (after ERROR or EXPIRED) ─────────────────
  async resendESign(contractId: string) {
    const contract = await contractRepository.findById(contractId);
    if (!contract) throw err('Contract not found', 404);
    if (contract.status !== ContractStatus.PENDING_SIGNATURE) {
      throw err('Contract is not in PENDING_SIGNATURE state', 400);
    }
    if (contract.eSignStatus === 'SIGNED') {
      throw err('Contract is already signed', 400);
    }
    await runESign(contractId, true);
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
      text: 'Yêu cầu hợp đồng của bạn đã bị từ chối',
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
    const cancellable = [ContractStatus.ACTIVE, ContractStatus.PENDING_REVIEW, ContractStatus.PENDING_SIGNATURE];
    if (!cancellable.includes(contract.status)) {
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
      text: isClient ? 'Học viên đã hủy hợp đồng' : 'Huấn luyện viên đã hủy hợp đồng',
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

    const clientIds = [...new Set(contracts.map(c => c.clientUserId))];
    const profiles = clientIds.length
      ? await profileRepository.findByUserIds(clientIds)
      : [];
    const nameMap = Object.fromEntries(
      profiles.map(p => [p.userId, `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim()])
    );

    return contracts.map(c => ({
      ...c,
      clientName: nameMap[c.clientUserId] ?? null,
    }));
  },

  async getByClient(clientUserId: string, status?: string) {
    const s = status ? (status as ContractStatus) : undefined;
    return contractRepository.findByClient(clientUserId, s);
  },

  async getById(id: string) {
    return contractRepository.findByIdWithSessions(id);
  },

  async updateStatus(id: string, userId: string, newStatus: string) {
    const contract = await contractRepository.findById(id);
    if (!contract) throw err('Contract not found', 404);

    if (contract.ptUserId !== userId && contract.clientUserId !== userId) {
      throw err('Not authorized', 403);
    }

    // PT accepts a PENDING_REVIEW contract → ACTIVE
    if (newStatus === 'ACTIVE' && contract.status === ContractStatus.PENDING_REVIEW && contract.ptUserId === userId) {
      return this.acceptContract(id, userId);
    }

    // Either party can cancel
    if (newStatus === 'CANCELLED') {
      return this.cancelContract(id, userId, 'Status changed to cancelled');
    }

    // PT can mark expired
    if (newStatus === 'EXPIRED' && contract.ptUserId === userId) {
      return contractRepository.updateStatus(id, ContractStatus.EXPIRED);
    }

    throw err(`Invalid status transition: ${contract.status} → ${newStatus}`, 400);
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

  // ── Check relationship (for call permission) ──────────────────────
  async checkRelationship(userAId: string, userBId: string) {
    // Check if either user is a PT
    const [profileA, profileB] = await Promise.all([
      profileRepository.findByUserId(userAId),
      profileRepository.findByUserId(userBId),
    ]);

    if (profileA?.isPT || profileB?.isPT) {
      return { allowed: true };
    }

    // Check for active contract between them
    const contract = await contractRepository.findActiveByPair(userAId, userBId);
    if (contract) {
      return { allowed: true };
    }

    // Also check reverse direction
    const contractReverse = await contractRepository.findActiveByPair(userBId, userAId);
    if (contractReverse) {
      return { allowed: true };
    }

    return { allowed: false };
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
};
