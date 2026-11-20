import { transactionRepository } from '../repositories/transaction.repository';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

export type ReturnUiStatus = 'success' | 'failed' | 'invalid' | 'pending';

/**
 * Where the payer's browser goes after a gateway checkout, shared by the VNPay and ZaloPay return bridges:
 * the app's own deep link if the checkout started on mobile (platform is persisted on the transaction at
 * create time, since the original request is long gone), the web result page (on the payer's real origin,
 * `returnBaseUrl`) otherwise. `status` is display-only: both destinations re-ask the server via
 * POST /me/payments/:id/sync before showing anything.
 */
export async function buildResultRedirect(txnId: string, uiStatus: ReturnUiStatus): Promise<string> {
  const txn = txnId ? await transactionRepository.findById(txnId).catch(() => null) : null;
  const meta = txn?.metadata as Record<string, unknown> | null;
  const platform = meta?.platform === 'mobile' ? 'mobile' : 'web';
  const webBase = typeof meta?.returnBaseUrl === 'string' ? meta.returnBaseUrl : FRONTEND_URL;
  const qs = `txnId=${encodeURIComponent(txnId)}&status=${uiStatus}`;
  return platform === 'mobile'
    ? `fitnessassistant://client/payments/result?${qs}`
    : `${webBase}/client/payments/result?${qs}`;
}

/** Display status derived from OUR OWN stored transaction state (never from anything the gateway put in the URL). */
export function uiStatusFromDbStatus(status: string | null | undefined): ReturnUiStatus {
  if (status === 'PAID' || status === 'REFUNDED') return 'success';
  if (status === 'FAILED' || status === 'CANCELLED') return 'failed';
  return 'pending';
}
