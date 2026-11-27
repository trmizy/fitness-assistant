import { prisma } from '../repositories/prisma';
import { resolvePartnerId } from './gym-listing.helpers';

/**
 * Gym Owner handoff item 1 (owner decision 22/11/2026): a GYM withdrawal ALWAYS pays the partner's REGISTERED payout account.
 *
 * The destination is read here from `GymPartner.payoutBank*` (the account the owner declared in onboarding / partner profile, whose changes
 * already write a PartnerAuditLog row and e-mail the owner), never from the request body. The text built here is what payment-service stores
 * as `payoutInfo` (with `payoutSource = REGISTERED_ACCOUNT`) and what the admin reads before transferring.
 */

export const PAYOUT_SOURCE_REGISTERED = 'REGISTERED_ACCOUNT' as const;

export interface RegisteredPayoutAccount {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
}

type PartnerPayoutRow = {
  payoutBankName: string | null;
  payoutBankAccountNumber: string | null;
  payoutBankAccountHolder: string | null;
} | null;

/** The payout fields of a partner row as a COMPLETE account, or null when any of the three is missing / blank. Pure. */
export function registeredPayoutFrom(partner: PartnerPayoutRow): RegisteredPayoutAccount | null {
  if (!partner) return null;
  const bankName = partner.payoutBankName?.trim();
  const accountNumber = partner.payoutBankAccountNumber?.trim();
  const accountHolder = partner.payoutBankAccountHolder?.trim();
  if (!bankName || !accountNumber || !accountHolder) return null;
  return { bankName, accountNumber, accountHolder };
}

/** The text the admin sees as "Nhận tiền vào" — same shape the owner UI used for the saved account ("Ngân hàng — số tài khoản — chủ tài khoản"). */
export function formatRegisteredPayout(account: RegisteredPayoutAccount): string {
  return `${account.bankName} — ${account.accountNumber} — ${account.accountHolder}`;
}

export class PayoutAccountRequiredError extends Error {
  readonly status = 409;
  readonly code = 'PAYOUT_ACCOUNT_REQUIRED';
  constructor() {
    super('Chưa có tài khoản nhận tiền đã đăng ký. Hãy khai báo tài khoản nhận tiền trong Hồ sơ đối tác rồi gửi lại yêu cầu rút.');
  }
}

export interface PayoutDb {
  gymPartnerAccount: { findUnique(args: any): Promise<{ partnerId: string } | null> };
  gymPartner: {
    findFirst(args: any): Promise<{ id: string } | null>;
    findUnique(args: any): Promise<PartnerPayoutRow>;
  };
}

/**
 * The registered payout account of the partner that owns this branch, as the text to store. Throws PayoutAccountRequiredError (409
 * PAYOUT_ACCOUNT_REQUIRED) when the branch has no partner record or the partner has not declared a complete account.
 */
export async function resolveRegisteredPayoutInfo(
  gym: { ownerId: string; brandId?: string | null },
  db: PayoutDb = prisma as unknown as PayoutDb,
): Promise<{ payoutInfo: string; account: RegisteredPayoutAccount }> {
  const partnerId = await resolvePartnerId(db as any, gym);
  if (!partnerId) throw new PayoutAccountRequiredError();
  const partner = await db.gymPartner.findUnique({
    where: { id: partnerId },
    select: { payoutBankName: true, payoutBankAccountNumber: true, payoutBankAccountHolder: true },
  });
  const account = registeredPayoutFrom(partner);
  if (!account) throw new PayoutAccountRequiredError();
  return { payoutInfo: formatRegisteredPayout(account), account };
}
