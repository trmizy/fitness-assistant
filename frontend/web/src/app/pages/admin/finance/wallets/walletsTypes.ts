/**
 * G-09 / G-10 — response types of the two READ endpoints of the wallet explorer.
 * Money is always a decimal STRING exactly as stored ("299999.80"); it is only ever shown through `formatMoneyExact`.
 * The raw free-text note of a ledger entry is NEVER part of the response (internal English text) — there is no such field.
 */

export interface WalletDto {
  id: string;
  ownerType: string;
  ownerId: string;
  availableBalance: string;
  pendingBalance: string;
  lockedBalance: string;
  holdbackBalance: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface WalletListResponse {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  items: WalletDto[];
}

export interface WalletEntryDto {
  id: string;
  transactionId: string;
  entryType: string;
  bucket: string;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  kind: string;
  createdAt: string;
}

export interface WalletEntriesPage {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  items: WalletEntryDto[];
}

export interface WalletDetailResponse {
  wallet: WalletDto;
  entries: WalletEntriesPage;
}
