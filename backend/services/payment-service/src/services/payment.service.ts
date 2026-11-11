import type { PaymentProvider } from '../providers/payment-provider.interface';
import { VNPayProvider } from '../providers/vnpay.provider';
import { ZaloPayProvider } from '../providers/zalopay.provider';
import { isGatewayEnabledForRealMoney, productionVerificationEnvName } from './gateway-policy';

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
 *
 * MOMO and PAYOS were retired the same way (owner decision 2026-11-11): the provider code is gone, the
 * enum values stay so old rows (and their webhook events) remain readable, and they are refused here.
 * The live gateways are VNPAY and ZALOPAY.
 */
export const DEFAULT_PROVIDER = 'VNPAY';

const REMOVED_PROVIDERS = new Set(['MOCK', 'MOMO', 'PAYOS']);

function removedMessage(name: string): string {
  return `Payment provider ${name} has been removed — use VNPAY or ZALOPAY`;
}

export function getProvider(override?: string): PaymentProvider {
  const name = (override ?? process.env.PAYMENT_PROVIDER ?? DEFAULT_PROVIDER).toUpperCase();
  if (REMOVED_PROVIDERS.has(name)) {
    throw Object.assign(new Error(removedMessage(name)), { status: 400 });
  }
  switch (name) {
    case 'VNPAY':   return new VNPayProvider();
    case 'ZALOPAY': return new ZaloPayProvider();
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
  // A gateway nobody has verified against its production system may not start a real checkout (see gateway-policy.ts).
  if (!isGatewayEnabledForRealMoney(upper)) {
    return {
      configured: false,
      missing: [`${upper} is not enabled for production payments yet (set ${productionVerificationEnvName(upper)}=true once it has been verified)`],
    };
  }
  switch (upper) {
    case 'VNPAY':
      return VNPayProvider.configStatus();
    case 'ZALOPAY':
      return ZaloPayProvider.configStatus();
    default:
      return { configured: false, missing: [`unknown provider ${name}`] };
  }
}

/** True for a gateway that was retired (MOCK, MOMO, PAYOS): its DB rows are still readable, but nothing may call it. */
export function isRemovedProvider(name: string): boolean {
  return REMOVED_PROVIDERS.has(name.toUpperCase());
}
