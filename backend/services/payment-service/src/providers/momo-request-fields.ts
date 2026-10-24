/**
 * Pure builders for the two MoMo create-request fields the payer actually SEES or is sent back
 * to (B25): the order description on MoMo's page and the "Quay về" redirect.
 */

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// Any other opaque id-looking token (long hex / digit runs) must not reach a payer's screen either.
const OPAQUE_ID_RE = /\b(?=[0-9a-f-]*\d)[0-9a-f-]{16,}\b/gi;

const PURPOSE_LABEL: Record<string, string> = {
  PT_CONTRACT: 'Thanh toan hop dong PT',
  GYM_MEMBERSHIP: 'Thanh toan goi hoi vien',
  TRAINING_PACKAGE_PURCHASE: 'Thanh toan goi tap',
  PERSONALIZED_SERVICE_PURCHASE: 'Thanh toan dich vu ca nhan hoa',
};

const FALLBACK = 'Thanh toan Gymini';
export const MOMO_ORDER_INFO_MAX = 100;

function toAscii(s: string): string {
  return s
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * A short, human, ASCII order description for MoMo's payment page: never an internal id.
 * "Goi hoi vien <uuid>" -> "Thanh toan goi hoi vien"; "GYM_MEMBERSHIP <uuid>" -> the same;
 * a caller-supplied plan/gym name after the prefix is kept ("Goi hoi vien Gold" ->
 * "Thanh toan goi hoi vien Gold"). Truncated to the length we send (MoMo limit is well above it).
 */
export function buildMomoOrderInfo(raw: string | undefined | null): string {
  let s = toAscii(String(raw ?? ''))
    .replace(UUID_RE, ' ')
    .replace(OPAQUE_ID_RE, ' ')
    .replace(/[^A-Za-z0-9 ,.\-_()/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const purpose = s.match(/^(PT_CONTRACT|GYM_MEMBERSHIP|TRAINING_PACKAGE_PURCHASE|PERSONALIZED_SERVICE_PURCHASE)\b\s*/);
  if (purpose) {
    s = `${PURPOSE_LABEL[purpose[1]]} ${s.slice(purpose[0].length)}`.trim();
  } else if (/^goi hoi vien\b/i.test(s)) {
    s = `Thanh toan ${s.charAt(0).toLowerCase()}${s.slice(1)}`;
  }
  s = s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) s = FALLBACK;
  return s.slice(0, MOMO_ORDER_INFO_MAX).trim();
}

/**
 * Where MoMo's "Quay ve" button sends the payer. Same rule as ZaloPay (which redirects straight to
 * the embedded URL, no hop through this service): the app's own deep link for the mobile app, else
 * the payer's actual origin (gateway x-public-base-url), else the static configured fallback. The
 * transaction id is appended so the result page can find the payment (MoMo adds its own params).
 */
export function buildMomoRedirectUrl(params: {
  transactionId: string;
  platform?: 'web' | 'mobile';
  returnBaseUrl?: string;
  staticFallback: string;
}): string {
  const base =
    params.platform === 'mobile'
      ? 'fitnessassistant://client/payments/result'
      : params.returnBaseUrl
        ? `${params.returnBaseUrl.replace(/\/+$/, '')}/client/payments/result`
        : params.staticFallback;
  return `${base}${base.includes('?') ? '&' : '?'}txnId=${encodeURIComponent(params.transactionId)}`;
}
