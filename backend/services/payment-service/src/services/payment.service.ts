import type { PaymentProvider } from '../providers/payment-provider.interface';
import { MockProvider } from '../providers/mock.provider';
import { MoMoProvider } from '../providers/momo.provider';
import { VNPayProvider } from '../providers/vnpay.provider';
import { ZaloPayProvider } from '../providers/zalopay.provider';
import { PayOSProvider } from '../providers/payos.provider';

export function getProvider(override?: string): PaymentProvider {
  const name = (override ?? process.env.PAYMENT_PROVIDER ?? 'MOCK').toUpperCase();
  // MOCK auto-marks payments PAID with no real money and no signature check — it must never be
  // reachable in production (would let anyone mint wallet balance). Dev/test set NODE_ENV!=production.
  if (name === 'MOCK' && process.env.NODE_ENV === 'production' && process.env.ALLOW_MOCK_PAYMENTS !== 'true') {
    throw Object.assign(new Error('MOCK payment provider is disabled in production'), { status: 400 });
  }
  switch (name) {
    case 'MOMO':    return new MoMoProvider();
    case 'MOCK':    return new MockProvider();
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
      return { configured: true, missing: [] };
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
