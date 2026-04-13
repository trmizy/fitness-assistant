import { ContractStatus, PackageType } from '../generated/prisma';
import { contractRepository } from '../repositories/contract.repository';
import { profileRepository } from '../repositories/profile.repository';
import { notificationService } from './notification.service';

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
    totalSessions?: number; // Ignored if calculations are performed
    price?: number;         // Ignored if calculations are performed
    pricePerSession?: number;
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
      packageQuantity: data.packageType === 'PACKAGE' ? packQty : 1,
      extraSessions: data.packageType === 'PACKAGE' ? extra : 0,
      totalSessions: finalSessions,
      price: finalPrice,
      pricePerSession: unitPrice,
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

    const updated = await contractRepository.updateStatus(contractId, ContractStatus.ACTIVE, {
      startDate: contract.startDate || new Date(),
    });

    await notificationService.create({
      userId: contract.clientUserId,
      text: 'Your coaching request has been accepted!',
      eventType: 'CONTRACT_ACCEPTED',
      entityType: 'CONTRACT',
      entityId: contractId,
      link: '/client/contracts',
    }).catch(() => {});

    return updated;
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
    if (contract.status !== ContractStatus.ACTIVE && contract.status !== ContractStatus.PENDING_REVIEW) {
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
    return contractRepository.findByPT(ptUserId, s);
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
