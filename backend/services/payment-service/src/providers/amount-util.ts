/**
 * Turns whatever a gateway put in its "amount" field into a whole-VND digit string, or null when the value cannot be
 * trusted as a payment amount: absent, negative, fractional, in exponent notation, not a number, or beyond what a JS
 * number holds exactly. Gateways report amounts as JSON numbers (ZaloPay, PayOS, MoMo) or as strings; both are
 * accepted, nothing is guessed. UNITS are the caller's business: this takes a figure that is already in whole VND
 * (VNPay's x100 figure goes through vnpayMinorToVnd first; ZaloPay, PayOS and MoMo all report plain VND).
 */
export function parseGatewayAmountVnd(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value === 'string' && /^\d{1,18}$/.test(value)) return BigInt(value).toString();
  return null;
}
