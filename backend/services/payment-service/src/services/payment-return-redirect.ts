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

export const MOBILE_DEEP_LINK_PREFIX = 'fitnessassistant://';
/** Android applicationId of the Expo app (frontend/mobile/app.json android.package). */
const ANDROID_PACKAGE = process.env.MOBILE_ANDROID_PACKAGE ?? 'vn.fitnessassistant.app';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const PAGE_TEXT: Record<ReturnUiStatus, { title: string; body: string }> = {
  success: { title: 'Thanh toán đã xong', body: 'Giao dịch của bạn đã được ghi nhận. Bấm nút dưới để quay lại ứng dụng Gymini.' },
  failed: { title: 'Thanh toán chưa thành công', body: 'Giao dịch chưa hoàn tất. Bấm nút dưới để quay lại ứng dụng Gymini.' },
  invalid: { title: 'Thanh toán đã xong', body: 'Bấm nút dưới để quay lại ứng dụng Gymini.' },
  pending: { title: 'Thanh toán đã xong', body: 'Hệ thống đang xác nhận giao dịch. Bấm nút dưới để quay lại ứng dụng Gymini.' },
};

/**
 * Mobile only. ZaloPay's page redirects on its own (no user gesture), and Chrome Custom Tabs refuse to hand such a
 * chain over to an external app scheme (tab left blank). So the bridge answers 200 with this tiny page: a real
 * tap on "Quay lại ứng dụng" (Android intent URL; plain deep link for iOS/other) is a user gesture and always works.
 * `txnId` must be a UUID, otherwise it is dropped (empty, pending) — nothing from the query is reflected raw.
 * `status` is display-only and comes from OUR DB; the app re-syncs before showing anything.
 */
export function renderMobileReturnPage(rawTxnId: string, uiStatus: ReturnUiStatus, nonce: string): string {
  const txnId = UUID_RE.test(rawTxnId) ? rawTxnId : '';
  const status: ReturnUiStatus = txnId ? uiStatus : 'pending';
  const qs = `txnId=${encodeURIComponent(txnId)}&status=${status}`;
  const deepLink = `${MOBILE_DEEP_LINK_PREFIX}client/payments/result?${qs}`;
  const intentUrl = `intent://client/payments/result?${qs}#Intent;scheme=fitnessassistant;package=${ANDROID_PACKAGE};end`;
  const text = PAGE_TEXT[status];
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(text.title)}</title>
<style>
 body{font-family:Arial,Helvetica,sans-serif;background:#f5f6f8;color:#1b1f24;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
 .card{background:#fff;border-radius:16px;box-shadow:0 6px 24px rgba(0,0,0,.1);max-width:380px;width:100%;padding:28px 22px;text-align:center}
 h1{font-size:22px;margin:0 0 10px}
 p{font-size:15px;line-height:1.5;margin:0 0 22px;color:#444}
 a.btn{display:block;background:#16a34a;color:#fff;text-decoration:none;font-weight:bold;font-size:17px;padding:16px;border-radius:12px}
 a.alt{display:inline-block;margin-top:16px;font-size:13px;color:#555}
</style></head>
<body><div class="card">
 <h1>${escapeHtml(text.title)}</h1>
 <p>${escapeHtml(text.body)}</p>
 <a class="btn" href="${escapeHtml(intentUrl)}">Quay lại ứng dụng</a>
 <a class="alt" href="${escapeHtml(deepLink)}">Mở bằng liên kết khác</a>
</div>
<script nonce="${nonce}">try{location.href=${JSON.stringify(deepLink).replace(/</g, '\\u003c')};}catch(e){}</script>
</body></html>`;
}

/** Display status derived from OUR OWN stored transaction state (never from anything the gateway put in the URL). */
export function uiStatusFromDbStatus(status: string | null | undefined): ReturnUiStatus {
  if (status === 'PAID' || status === 'REFUNDED') return 'success';
  if (status === 'FAILED' || status === 'CANCELLED') return 'failed';
  return 'pending';
}
