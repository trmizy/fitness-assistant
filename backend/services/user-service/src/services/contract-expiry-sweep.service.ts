import { logger } from "@gym-coach/shared";
import { contractService } from "./contract.service";

const INTERVAL_MS = Number(process.env.CONTRACT_EXPIRY_SWEEP_INTERVAL_MS ?? 10 * 60 * 1000);

/**
 * P0 cluster A3 — periodically settles contracts that have drifted past their endDate while
 * still ACTIVE.
 *
 * Before this job existed, nothing ever called contractService.expireContracts() at all — a
 * contract just sat ACTIVE forever once its endDate passed, and any money still in the three
 * parties' pending buckets for never-booked sessions stayed stuck there permanently (the
 * reconciliation invariant kept holding, since the money was still validly claimed by
 * someone — but nobody could withdraw it, because nothing had released it out of pending).
 *
 * Mirrors reschedule-expiry.service.ts: same interval shape, same overlap guard. The actual
 * per-contract work (and its own error isolation, so one bad contract does not block the
 * rest of the batch) lives in contractService.expireContracts() — this file is only the
 * timer.
 */
let running = false;
let paymentDeadlineRunning = false;
let holdbackRunning = false;

/** Idle release of the PT holdback: the threshold is days, so an hourly pass is plenty. */
const HOLDBACK_SWEEP_INTERVAL_MS = Number(process.env.CONTRACT_HOLDBACK_SWEEP_INTERVAL_MS ?? 60 * 60 * 1000);

/** Hạn thanh toán (12h) chỉ cần độ chính xác cỡ vài phút — `pay` đã tự từ chối hợp đồng quá hạn
 * ngay cả khi sweep chưa chạy, nên sweep này chỉ dọn dẹp trạng thái. */
const PAYMENT_DEADLINE_INTERVAL_MS = Number(
  process.env.CONTRACT_PAYMENT_DEADLINE_SWEEP_INTERVAL_MS ?? 5 * 60 * 1000,
);

export function startContractExpirySweepJob(): void {
  logger.info(`Contract expiry sweep started (interval: ${Math.round(INTERVAL_MS / 60000)} min)`);
  setInterval(() => {
    void runContractExpirySweep();
  }, INTERVAL_MS);

  logger.info(
    `Contract payment-deadline sweep started (interval: ${Math.round(PAYMENT_DEADLINE_INTERVAL_MS / 60000)} min)`,
  );
  setInterval(() => {
    void runContractPaymentDeadlineSweep();
  }, PAYMENT_DEADLINE_INTERVAL_MS);

  logger.info(`Contract holdback sweep started (interval: ${Math.round(HOLDBACK_SWEEP_INTERVAL_MS / 60000)} min)`);
  setInterval(() => {
    void runContractHoldbackSweep();
  }, HOLDBACK_SWEEP_INTERVAL_MS);
}

/**
 * Hands the PT the held-back amount on contracts that have had no session for
 * PT_HOLDBACK_IDLE_DAYS (see contractService.releaseIdleHoldbacks for the rule and the
 * per-contract error isolation). Same timer shape and overlap guard as the sweeps above. A no-op
 * while no contract carries a holdback rate, which is the case today.
 */
export async function runContractHoldbackSweep(): Promise<{ released: number }> {
  if (holdbackRunning) {
    logger.info("[ContractHoldbackSweep] Previous run still in progress — skipping tick");
    return { released: 0 };
  }
  holdbackRunning = true;

  try {
    const released = await contractService.releaseIdleHoldbacks();
    if (released > 0) {
      logger.info(`[ContractHoldbackSweep] Released the holdback on ${released} idle contract(s)`);
    }
    return { released };
  } catch (err) {
    logger.error({ error: "[ContractHoldbackSweep] sweep failed", message: (err as Error).message });
    return { released: 0 };
  } finally {
    holdbackRunning = false;
  }
}

/**
 * Tự huỷ hợp đồng PENDING_PAYMENT quá hạn thanh toán (paymentDueAt). Cùng khuôn với
 * runContractExpirySweep: cùng kiểu timer, cùng overlap guard; việc từng hợp đồng (và bắt lỗi
 * riêng từng cái) nằm trong contractService.cancelOverduePaymentContracts().
 */
export async function runContractPaymentDeadlineSweep(): Promise<{ cancelled: number }> {
  if (paymentDeadlineRunning) {
    logger.info("[ContractPaymentDeadlineSweep] Previous run still in progress — skipping tick");
    return { cancelled: 0 };
  }
  paymentDeadlineRunning = true;

  try {
    const cancelled = await contractService.cancelOverduePaymentContracts();
    if (cancelled > 0) {
      logger.info(`[ContractPaymentDeadlineSweep] Cancelled ${cancelled} overdue contract(s)`);
    }
    return { cancelled };
  } catch (err) {
    logger.error({
      error: "[ContractPaymentDeadlineSweep] sweep failed",
      message: (err as Error).message,
    });
    return { cancelled: 0 };
  } finally {
    paymentDeadlineRunning = false;
  }
}

export async function runContractExpirySweep(): Promise<{ expired: number }> {
  if (running) {
    logger.info("[ContractExpirySweep] Previous run still in progress — skipping tick");
    return { expired: 0 };
  }
  running = true;

  try {
    const expired = await contractService.expireContracts();
    if (expired > 0) {
      logger.info(`[ContractExpirySweep] Settled ${expired} expired contract(s)`);
    }
    return { expired };
  } catch (err) {
    logger.error({ error: "[ContractExpirySweep] sweep failed", message: (err as Error).message });
    return { expired: 0 };
  } finally {
    running = false;
  }
}
