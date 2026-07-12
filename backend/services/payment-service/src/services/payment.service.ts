import type { PaymentProvider } from '../providers/payment-provider.interface';
import { MockProvider } from '../providers/mock.provider';
import { MoMoProvider } from '../providers/momo.provider';
import { VNPayProvider } from '../providers/vnpay.provider';

export function getProvider(override?: string): PaymentProvider {
  const name = (override ?? process.env.PAYMENT_PROVIDER ?? 'MOCK').toUpperCase();
  switch (name) {
    case 'MOMO':  return new MoMoProvider();
    case 'MOCK':  return new MockProvider();
    case 'VNPAY': return new VNPayProvider();
    default: throw new Error(`Unknown payment provider: ${name}`);
  }
}
