/**
 * Which gateways may move REAL money in this deployment.
 *
 * VNPay is the gateway whose callback handling (signature, merchant, order, exact amount, status, duplicate and
 * concurrent delivery, querydr response signature) has been verified end to end. ZaloPay, PayOS and MoMo have now
 * had the same checks added, but only against simulated gateway traffic - nobody has run them against the
 * gateway's own production system. Until an operator has done that and says so, a production deployment
 * (NODE_ENV=production) neither STARTS a checkout with them nor SETTLES a payment arriving from them:
 *
 *   ZALOPAY_PRODUCTION_VERIFIED=true   MOMO_PRODUCTION_VERIFIED=true   PAYOS_PRODUCTION_VERIFIED=true
 *
 * Outside production (dev, test, the sandbox endpoints every gateway defaults to) nothing changes: they work with
 * play money exactly as before.
 *
 * Read at call time, not at import time, so a test (or an operator's env change on restart) is always honoured.
 */
const NEEDS_EXPLICIT_PRODUCTION_VERIFICATION = new Set(['ZALOPAY', 'PAYOS', 'MOMO']);

function isProduction(): boolean {
  return (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
}

export function productionVerificationEnvName(provider: string): string {
  return `${provider.toUpperCase()}_PRODUCTION_VERIFIED`;
}

export function isGatewayEnabledForRealMoney(provider: string): boolean {
  const name = provider.toUpperCase();
  if (!isProduction()) return true;
  if (name === 'VNPAY') return true;
  if (NEEDS_EXPLICIT_PRODUCTION_VERIFICATION.has(name)) {
    return (process.env[productionVerificationEnvName(name)] ?? '').toLowerCase() === 'true';
  }
  // MOCK (removed), STRIPE, MANUAL_BANK_TRANSFER, anything unknown: never a production payment gateway here.
  return false;
}

/**
 * The retired wallet top-up flow credits a wallet's AVAILABLE bucket without an escrow leg, which breaks the
 * escrow == sum-of-claims invariant. The top-up route answers 410 and the checkout schema no longer accepts the
 * purpose, so nothing legitimate can create one; this stops a stray late callback for an OLD top-up row from
 * crediting it in production. Set LEGACY_WALLET_TOPUP_SETTLEMENT=true to knowingly re-allow it.
 */
export function isLegacyWalletTopupSettlementAllowed(): boolean {
  if (!isProduction()) return true;
  return (process.env.LEGACY_WALLET_TOPUP_SETTLEMENT ?? '').toLowerCase() === 'true';
}
