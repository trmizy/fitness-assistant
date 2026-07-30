import type { PaymentProvider } from '../providers/payment-provider.interface';
import { MockProvider } from '../providers/mock.provider';
import { MoMoProvider } from '../providers/momo.provider';
import { VNPayProvider } from '../providers/vnpay.provider';
import { ZaloPayProvider } from '../providers/zalopay.provider';
import { PayOSProvider } from '../providers/payos.provider';

// MOCK auto-completes any created payment intent to PAID after 500ms with no real money
// ever moving, and its verifyWebhookSignature() always returns valid — it exists purely
// for local/dev/test. Allowing it in production would let any authenticated caller credit
// their own wallet for free by passing provider: 'MOCK'. Fail closed: this is the single
// choke point every caller (topup route, webhook route) goes through to obtain a provider.
function isMockAllowed(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export function getProvider(override?: string): PaymentProvider {
  const name = (override ?? process.env.PAYMENT_PROVIDER ?? 'MOCK').toUpperCase();
  switch (name) {
    case 'MOMO':    return new MoMoProvider();
    case 'MOCK':
      if (!isMockAllowed()) {
        throw new Error('MOCK payment provider is not permitted in production');
      }
      return new MockProvider();
    case 'VNPAY':   return new VNPayProvider();
    case 'ZALOPAY': return new ZaloPayProvider();
    case 'PAYOS':   return new PayOSProvider();
    default: throw new Error(`Unknown payment provider: ${name}`);
  }
}

/**
 * Config presence check so callers can 400 with a clear message instead of letting a
 * half-configured provider blow up mid-request as a 500. MOCK never needs config.
 */
export function providerConfigStatus(name: string): { configured: boolean; missing: string[] } {
  switch (name.toUpperCase()) {
    case 'MOCK':
      return isMockAllowed()
        ? { configured: true, missing: [] }
        : { configured: false, missing: ['MOCK is not permitted in production'] };
    case 'VNPAY':
      return VNPayProvider.configStatus();
    case 'ZALOPAY':
      return ZaloPayProvider.configStatus();
    case 'PAYOS':
      return PayOSProvider.configStatus();
    case 'MOMO': {
      const missing = ['MOMO_PARTNER_CODE', 'MOMO_ACCESS_KEY', 'MOMO_SECRET_KEY'].filter((k) => !process.env[k]);
      return { configured: missing.length === 0, missing };
    }
    default:
      return { configured: false, missing: [`unknown provider ${name}`] };
  }
}
