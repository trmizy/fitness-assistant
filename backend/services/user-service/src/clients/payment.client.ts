import axios from 'axios';

const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3007';
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

const headers = { 'x-service-secret': INTERNAL_SERVICE_SECRET };

export interface WalletTransferResult {
  status: 'PAID' | 'FAILED';
  transactionId: string;
  failureReason?: string;
}

export interface CheckoutResult {
  transactionId: string;
  status: string;
  redirectUrl: string | null;
  qrCodeUrl: string | null;
  provider: string;
}

/**
 * FH-1: what a PT-fault money step could actually pay out of the contract's OWN money. `owed` is what the formulas ask
 * for, `paid` what was credited to the client (and the only figure that may be reported as paid), `unpaid` the rest -
 * an OPEN obligation (`obligationId`), never a PT debt. Absent on results stored before FH-1 (treat as paid = owed).
 */
export interface MoneyOutcomeFigures {
  owed?: string;
  paid?: string;
  unpaid?: string;
  obligationId?: string;
}

/** FH-2a: one stored ledger operation, as `GET /internal/ledger-operations/:key` and `/lookup` return it. */
export interface LedgerOperationRecord {
  key: string;
  /** RELEASE_SESSION | NO_SHOW | LATE_ARRIVAL | TERMINATE | RESOLVE_UNRESOLVED | RELEASE_HOLDBACK | ... (null if unknown). */
  kind: string | null;
  transactionId: string | null;
  /** The result payment-service stored and replays for this key. */
  result: Record<string, unknown>;
  createdAt: string;
  /** false for rows written before request fingerprints existed. */
  fingerprinted: boolean;
  /**
   * Present when `result.obligationId` names an unpaid obligation: its LIVE status. OPEN = still owed; RESOLVED = handled outside
   * the ledger with a reference; WAIVED = the owner decided it is not pursued (the client was not paid).
   */
  obligation?: { id: string; status: 'OPEN' | 'RESOLVED' | 'WAIVED' | string; owed: string; paid: string; unpaid: string };
}

export const paymentClient = {
  /**
   * Start a gateway checkout for a contract. The client pays the gateway directly — no wallet
   * pre-funding — and nothing moves in the ledger until payment-service receives the signed
   * webhook, which then splits the price across escrow and the three pending buckets.
   *
   * The rate table travels with the request and is frozen into the transaction, so the split
   * later uses the terms in force at signing rather than whatever is current at settlement.
   */
  async checkout(params: {
    relatedEntityId: string;
    amount: number;
    rates: { platformRate: string; ptRate: string; gymRate: string };
    parties: { ptUserId: string; gymId?: string | null; clientUserId: string };
    idempotencyKey: string;
    initiatedBy: string;
    provider?: string;
    orderInfo?: string;
    platform?: 'web' | 'mobile';
    returnBaseUrl?: string;
  }): Promise<CheckoutResult> {
    try {
      const { data } = await axios.post(
        `${PAYMENT_SERVICE_URL}/internal/payments/checkout`,
        {
          purpose: 'PT_CONTRACT',
          relatedEntityType: 'PT_CONTRACT',
          relatedEntityId: params.relatedEntityId,
          amount: params.amount,
          rates: params.rates,
          parties: params.parties,
          idempotencyKey: params.idempotencyKey,
          initiatedBy: params.initiatedBy,
          sourceService: 'user-service',
          provider: params.provider,
          orderInfo: params.orderInfo,
          platform: params.platform,
          returnBaseUrl: params.returnBaseUrl,
        },
        { headers, timeout: 20_000 },
      );
      return data.data as CheckoutResult;
    } catch (e: any) {
      const code = e?.response?.data?.error?.code || 'CHECKOUT_FAILED';
      throw Object.assign(new Error(e?.response?.data?.error?.message || code), {
        code,
        status: e?.response?.status || 502,
      });
    }
  },

  /** Money movements for a contract, all owned by payment-service. */
  async releaseSession(body: Record<string, unknown>): Promise<any> {
    const { data } = await axios.post(`${PAYMENT_SERVICE_URL}/internal/contracts/release-session`, body, { headers, timeout: 15_000 });
    return data.data;
  },

  async noShow(body: Record<string, unknown>): Promise<any> {
    const { data } = await axios.post(`${PAYMENT_SERVICE_URL}/internal/contracts/no-show`, body, { headers, timeout: 15_000 });
    return data.data;
  },

  /** Open-room online session — PT joined after the grace window (half a no-show's rate). */
  async lateArrival(body: Record<string, unknown>): Promise<any> {
    const { data } = await axios.post(`${PAYMENT_SERVICE_URL}/internal/contracts/late-arrival`, body, { headers, timeout: 15_000 });
    return data.data;
  },

  /**
   * D77, RECORD-ONLY: the late-arrival compensation of a session was never performed by the ledger and the contract is ending.
   * payment-service writes it down as an OPEN unpaid obligation to the client under the ORIGINAL `PT_LATE_ARRIVAL:<sessionId>` key
   * (owed = the late-arrival formula, paid = 0, `reason` in words). NO MONEY MOVES. Idempotent per key; if the compensation had in
   * fact been performed the stored real result comes back instead (no `recordedOnly: true`).
   */
  async recordLateArrivalObligation(body: Record<string, unknown>): Promise<any> {
    const { data } = await axios.post(`${PAYMENT_SERVICE_URL}/internal/contracts/late-arrival-obligation`, body, { headers, timeout: 15_000 });
    return data.data;
  },

  /**
   * RECORD-ONLY PT no-show compensation (same contract as {@link recordLateArrivalObligation}): the `PT_NO_SHOW:<sessionId>` step was never
   * performed by the ledger and the contract has ended. One OPEN unpaid obligation of kind NO_SHOW (owed = one session's value, paid 0)
   * under the ORIGINAL key; no money moves. Idempotent per key.
   */
  async recordNoShowObligation(body: Record<string, unknown>): Promise<any> {
    const { data } = await axios.post(`${PAYMENT_SERVICE_URL}/internal/contracts/no-show-obligation`, body, { headers, timeout: 15_000 });
    return data.data;
  },

  /**
   * A session whose value payment-service HELD at termination (`unresolvedSessions` on terminate) has been
   * decided: DELIVERED releases it to PT/gym/platform like a completed session, NOT_DELIVERED refunds it to
   * the client. Idempotent per `UNRESOLVED_SESSION:<sessionId>`; a session is never resolved twice or both ways.
   */
  async resolveUnresolvedSession(body: Record<string, unknown>): Promise<any> {
    const { data } = await axios.post(`${PAYMENT_SERVICE_URL}/internal/contracts/resolve-unresolved-session`, body, { headers, timeout: 15_000 });
    return data.data;
  },

  async terminate(body: Record<string, unknown>): Promise<any> {
    const { data } = await axios.post(`${PAYMENT_SERVICE_URL}/internal/contracts/terminate`, body, { headers, timeout: 20_000 });
    return data.data;
  },

  /** Idle contract: hand the PT the amount held back on it (payment-service reads the amount from its ledger). */
  async releaseHoldback(body: Record<string, unknown>): Promise<any> {
    const { data } = await axios.post(`${PAYMENT_SERVICE_URL}/internal/contracts/release-holdback`, body, { headers, timeout: 15_000 });
    return data.data;
  },

  /**
   * FH-2a, read-only: did payment-service already perform the operation with this idempotency key, and with what
   * result? Returns null when it has not (404). Any other failure (payment-service unreachable, 5xx) throws -
   * "unknown" must never be read as "not done".
   */
  async lookupLedgerOperation(key: string): Promise<LedgerOperationRecord | null> {
    try {
      const { data } = await axios.get(`${PAYMENT_SERVICE_URL}/internal/ledger-operations/${encodeURIComponent(key)}`, { headers, timeout: 10_000 });
      return data.data as LedgerOperationRecord;
    } catch (e: any) {
      if (e?.response?.status === 404) return null;
      throw e;
    }
  },

  /** FH-2a, read-only: up to 100 keys at once. `missing` are the keys payment-service has no record of. */
  async lookupLedgerOperations(keys: string[]): Promise<{ operations: LedgerOperationRecord[]; missing: string[] }> {
    if (keys.length === 0) return { operations: [], missing: [] };
    if (keys.length > 100) throw new Error('lookupLedgerOperations: at most 100 keys per call');
    const { data } = await axios.post(`${PAYMENT_SERVICE_URL}/internal/ledger-operations/lookup`, { keys }, { headers, timeout: 15_000 });
    return data.data as { operations: LedgerOperationRecord[]; missing: string[] };
  },

  async moneyBreakdown(body: Record<string, unknown>): Promise<any> {
    const { data } = await axios.post(`${PAYMENT_SERVICE_URL}/internal/contracts/money-breakdown`, body, { headers, timeout: 10_000 });
    return data.data;
  },

  async walletTransfer(params: {
    payerOwnerId: string;
    receiverPtId: string;
    amount: number;
    relatedEntityId: string;
    idempotencyKey: string;
    initiatedBy: string;
    ptId: string;
  }): Promise<WalletTransferResult> {
    const { data } = await axios.post(
      `${PAYMENT_SERVICE_URL}/internal/payments/wallet-transfer`,
      {
        payerOwnerType: 'CLIENT',
        payerOwnerId: params.payerOwnerId,
        receiverOwnerType: 'PT',
        receiverOwnerId: params.receiverPtId,
        amount: params.amount,
        purpose: 'PT_CONTRACT',
        relatedEntityType: 'PT_CONTRACT',
        relatedEntityId: params.relatedEntityId,
        idempotencyKey: params.idempotencyKey,
        initiatedBy: params.initiatedBy,
        sourceService: 'user-service',
        ptId: params.ptId,
        ptContractId: params.relatedEntityId,
      },
      { headers, timeout: 15_000 },
    );
    return data.data as WalletTransferResult;
  },

  async markActivated(transactionId: string): Promise<void> {
    await axios.post(`${PAYMENT_SERVICE_URL}/internal/payments/${transactionId}/mark-activated`, {}, { headers, timeout: 10_000 });
  },

  async getTransaction(transactionId: string): Promise<any> {
    const { data } = await axios.get(`${PAYMENT_SERVICE_URL}/internal/payments/${transactionId}`, { headers, timeout: 10_000 });
    return data.data;
  },

  /**
   * Prorated refund of a PT-contract payment. payment-service owns the ledger: it reverses
   * the entries, claws the platform's commission back proportionally and flips the original
   * transaction — none of that is reimplemented here.
   *
   * Throws with a `code` so the caller can tell an unaffordable refund (the PT's wallet no
   * longer holds the money) apart from a genuine failure.
   */
  async refund(params: {
    originalTransactionId: string;
    refundAmount: number;
    idempotencyKey: string;
    initiatedBy: string;
    reason: string;
  }): Promise<{ transactionId: string; status: string; refundAmount: number }> {
    try {
      const { data } = await axios.post(
        `${PAYMENT_SERVICE_URL}/internal/payments/${params.originalTransactionId}/refund`,
        {
          refundAmount: params.refundAmount,
          idempotencyKey: params.idempotencyKey,
          initiatedBy: params.initiatedBy,
          reason: params.reason,
        },
        { headers, timeout: 15_000 },
      );
      return data.data;
    } catch (e: any) {
      const code = e?.response?.data?.error?.code || 'REFUND_FAILED';
      throw Object.assign(new Error(code), {
        code,
        status: e?.response?.status || 502,
      });
    }
  },
};
