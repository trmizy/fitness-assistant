import type { PaymentProvider } from '../providers/payment-provider.interface';
import { MoMoProvider } from '../providers/momo.provider';
import { VNPayProvider } from '../providers/vnpay.provider';
import { ZaloPayProvider } from '../providers/zalopay.provider';
import { PayOSProvider } from '../providers/payos.provider';

/**
 * Every top-up now goes through a real gateway in its sandbox environment.
 *
 * The MOCK provider is gone. It auto-marked any intent PAID after 500ms with no money
 * moving and a verifyWebhookSignature() that returned valid for any bytes, which made it
 * a wallet-minting primitive one env var away from production, and made the whole payment
 * path untested where it matters — signing, redirect, signed return, querydr. Sandbox
 * gateways exercise all of that with play money instead.
 *
 * MOCK is still a value of the PaymentProviderType DB enum: transactions created before
 * the removal reference it and must remain readable. Nothing produces it any more.
 */
export const DEFAULT_PROVIDER = 'VNPAY';

const REMOVED_PROVIDERS = new Set(['MOCK']);

function removedMessage(name: string): string {
  return `Payment provider ${name} has been removed — use a sandbox gateway (VNPAY, ZALOPAY)`;
}

export function getProvider(override?: string): PaymentProvider {
  const name = (override ?? process.env.PAYMENT_PROVIDER ?? DEFAULT_PROVIDER).toUpperCase();
  if (REMOVED_PROVIDERS.has(name)) {
    throw Object.assign(new Error(removedMessage(name)), { status: 400 });
  }
  switch (name) {
    case 'MOMO':    return new MoMoProvider();
    case 'VNPAY':   return new VNPayProvider();
    case 'ZALOPAY': return new ZaloPayProvider();
    case 'PAYOS':   return new PayOSProvider();
    default: throw new Error(`Unknown payment provider: ${name}`);
  }
}

/**
 * Config presence check so callers can 400 with a clear message instead of letting a
 * half-configured provider blow up mid-request as a 500.
 */
export function providerConfigStatus(name: string): { configured: boolean; missing: string[] } {
  const upper = name.toUpperCase();
  if (REMOVED_PROVIDERS.has(upper)) {
    return { configured: false, missing: [removedMessage(upper)] };
  }
  switch (upper) {
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
