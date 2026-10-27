# 02 - Financial admin API contract audit

Evidence label for every statement below: **CODE AUDIT** (source read only, nothing executed, no DB touched, no service started).
Paths are relative to `D:\FitnessAssistant\backend`. `ps` = `services/payment-service/src`. Code is authoritative over docs.
Date: 2026-10-26. Branch `feature/payment-gateways` (working tree dirty, not mine).

Abbreviations: ES = ESCROW platform wallet (`ownerType=PLATFORM, ownerId='ESCROW'`), REV = REVENUE platform wallet.

---------------------------------------------------------------------------------------------------

## 0. How admin is enforced (applies to every row in section 1)

| Layer | Mechanism | Evidence |
|---|---|---|
| Gateway | `authMiddleware` (POST `AUTH_SERVICE_URL/auth/verify`, copies `x-user-id/-email/-role` headers) then `requireRoles('ADMIN')`. Role set is exactly `ADMIN \| CUSTOMER \| PT \| GYM_OWNER` (`GYM_STAFF` removed). | `gateway/src/middleware/auth.middleware.ts:9,17-60,64-77` |
| Gateway mounts | `/admin/payments` -> payment-service (`proxy.routes.ts:1647-1656`); `/admin/sessions` -> user-service (`:1379-1387`); `/admin/gym-memberships`, `/admin/commission-rate` -> gym-service (`:1882-1886`, `:1903-1907`); `/ai/*` -> ai-service with plain `authMiddleware` only, no ADMIN gate (`:1230-1250`); `/contracts` -> user-service plain `authMiddleware` (`:1329-1336`). | same file |
| payment-service | Re-verifies the Bearer token itself against auth-service on every request (`extractUser`), then `requireAuth`, then `requireRoles('ADMIN')` on the whole router and again on `/obligations`. Does NOT trust gateway headers. | `ps/middleware/auth.middleware.ts:41-80`; `ps/routes/admin.routes.ts:27`; `ps/routes/admin-obligations.routes.ts:17` |
| user-service | `authMiddleware` (verifies token with auth-service) + `roleMiddleware(["ADMIN"])` on the whole admin router; reconciliation controller re-checks `x-user-role`. | `user-service/src/routes/admin.routes.ts:14`; `controllers/admin-reconciliation.controller.ts:18` |
| gym-service | `extractUser, requireAuth, requireRoles('ADMIN')` on router. | `gym-service/src/routes/admin.routes.ts:25` |
| ai-service | Role checked inside each controller (`req.context.role !== "ADMIN"` -> 403 `PERSONALIZED_SERVICE_ADMIN_ONLY`). | `ai-service/src/controllers/personalized-service.controller.ts:374,386,398` |

**Permission granularity: there is none.** A single `ADMIN` role. No finance role, no read-only auditor, no per-action scopes, no
amount limits. Anyone who is ADMIN can approve and pay a withdrawal, refund, resolve a dispute. See G-01.

Response envelope in payment-service: `{ success: true, data }` / `{ success: false, error: { code, message?, details? } }`.
user-service uses `{ error: "<vi text>", code? }` (no `success`). gym-service uses `{ success, error: { code: <message>, message } }`
(code is the raw `e.message`, not a stable code - `membership.controller.ts:146`). Three error styles = admin UI needs one adapter.

---------------------------------------------------------------------------------------------------

## 1. Admin endpoint table (28 rows: 13 payment-service, 5 user-service, 6 gym-service, 3 ai-service, 1 gateway aggregate)

Pagination/filter/sort legend: "none" = no query params, fixed query. All lists below are **server-side capped, not paged**.

### 1a. payment-service (mounted `/admin/payments`, `ps/app.ts:34`)

| # | METHOD path | handler file:line | auth | query params | response top-level (`data`) | mutating? guard | audit written | errors |
|---|---|---|---|---|---|---|---|---|
| P1 | GET `/admin/payments` | `ps/routes/admin.routes.ts:34` -> `transaction.repository.ts:155` | ADMIN | none. Hard `take 200`, `createdAt desc`. No filter/sort/cursor. | raw `PaymentTransaction[]` (all columns incl. `metadata`, `extraData`, `idempotencyKey`) | read | - | 401/403 |
| P2 | GET `/admin/payments/gateway-discrepancies` | `admin.routes.ts:43` -> `transaction.repository.ts:167` | ADMIN | none; `take 200`, `updatedAt desc` | `PaymentTransaction[]` having `metadata.gatewayDiscrepancy` `{kind, source, expectedAmountVnd, reportedAmountVnd, reportedMinorUnits, gatewayTransactionNo, firstDetectedAt, resolved:false, occurrences, lastSeenAt, provider}` | read | discrepancy is written into `payment_transactions.metadata` by `gateway-amount.ts:76-135` (no separate table). `resolved` is never set true anywhere in code (grep) | 401/403 |
| P3 | GET `/admin/payments/reconciliation` | `admin.routes.ts:57` -> `ps/services/reconcile.service.ts:59` | ADMIN | none | `{escrow, claims, drift, balanced, breakdown{clientBalances, ptPending, ptAvailable, ptLocked, ptHoldback, gymPending, gymAvailable, gymLocked, platformRevenuePending, platformRevenueAvailable}, negativeWallets[{id, ownerType, ownerId, available, pending, locked, holdback}]}` (strings, `toFixed(2)`, except negativeWallets raw DB text) | read | - | **HTTP 409 with `success:false` AND a full `data` body when `drift != 0`** (`admin.routes.ts:59`). UI must not treat 409 as a transport error |
| P4 | GET `/admin/payments/finance-overview` | `admin.routes.ts:69` -> `ps/services/finance-report.service.ts:73` | ADMIN | `groupBy=day\|week\|month\|quarter` (default day), `from`, `to` ISO (default last 30d). Whitelisted | `{groupBy, from, to, buckets[{period, income, expense, netRevenue, transactionCount}], totals{...}, platformRevenue{available, pending, asOf}}` | read | - | 400 `INVALID_RANGE` |
| P5 | GET `/admin/payments/commissions` | `admin.routes.ts:84` -> `transaction.repository.ts:182` | ADMIN | none; `take 200` | raw `PlatformCommission[]`. Legacy: only written by wallet-to-wallet `transferInternal` (`wallet.service.ts:343`), NOT by gateway checkout | read | - | 401/403 |
| P6 | PATCH `/admin/payments/commissions/:id/settle` | `admin.routes.ts:97` | ADMIN | - | `410 ENDPOINT_RETIRED` | no-op | - | 410 |
| P7 | GET `/admin/payments/withdrawals` | `admin.routes.ts:110` -> `withdrawal.repository.ts:29` | ADMIN | none; only `PENDING`+`APPROVED`, `createdAt asc`, `take 100` | raw `WithdrawalRequest[]` (`id, walletId, ownerType, ownerId, amount, status, payoutInfo, bankReference, rejectionReason, reviewedBy, reviewedAt, paidAt, createdAt, updatedAt`) | read | - | 401/403 |
| P8 | POST `/admin/payments/withdrawals/:id/approve` | `admin.routes.ts:118` -> `withdrawal.service.ts:175` | ADMIN; actor = `req.user.userId` (token, good) | none | updated `WithdrawalRequest` | **yes**: AVAILABLE->LOCKED. Re-reads status under wallet `FOR UPDATE`; replays if already `APPROVED`; ledger op key `WITHDRAWAL_LOCK:<id>` | ledger rows (2) + `reviewedBy/reviewedAt` on request. No separate audit table | 404 `NOT_FOUND`; **400** `INVALID_STATUS` (not 409); `InsufficientBalanceError`/`WalletNotActiveError` have no `status` -> **500 `INTERNAL_ERROR`** (`admin.routes.ts:124`) |
| P9 | POST `.../withdrawals/:id/reject` | `admin.routes.ts:128` -> `withdrawal.service.ts:204` | ADMIN | body `{reason}` required | updated request | yes if it was APPROVED: LOCKED->AVAILABLE, key `WITHDRAWAL_UNLOCK:<id>`; PENDING = status flip only. Idempotent if already `REJECTED` | `rejectionReason, reviewedBy, reviewedAt`; ledger rows | 400 `REASON_REQUIRED`, 400 `ALREADY_PAID`, 404 |
| P10 | POST `.../withdrawals/:id/mark-paid` | `admin.routes.ts:142` -> `withdrawal.service.ts:242` | ADMIN | body `{bankReference}` required, free text | updated request | **yes - the only place money leaves the platform**: debit LOCKED(+lock first if still PENDING) and debit ES; creates/flips a `PaymentTransaction(purpose=WITHDRAWAL)`; key `WITHDRAWAL:<id>` under wallet locks; replays if already `PAID` | `bankReference, paidAt, reviewedBy`; ledger rows; the WITHDRAWAL `PaymentTransaction` (`initiatedBy=adminId`). No four-eyes: same admin may approve then pay | 400 `BANK_REFERENCE_REQUIRED`, `INVALID_STATUS`; 404; balance/wallet-state errors -> 500 |
| P11 | POST `/admin/payments/:id/refund` | `admin.routes.ts:164` | ADMIN, **but `adminId` is taken from the request BODY** (`refundSchema` `admin.routes.ts:156-159`, used at `:169`) not from the token | body `{adminId, reason}` | `{transactionId, status:'PAID'}` | yes (legacy wallet-reversal engine `wallet.service.ts:371`). Idempotency key is `refund:<randomUUID()>` generated per call (`:193`) = **no real idempotency**; guard is only `original.status==='PAID'` read before the transaction (race window between check and `reverseTransfer`) | `payment_transactions` row `purpose=REFUND`, `refundOfTransactionId`, `initiatedBy=<body adminId>`, `metadata.reason`; `PlatformCommission.status=CANCELLED` | 404 `NOT_FOUND`; 409 `ALREADY_REFUNDED`/`NOT_REFUNDABLE`/`INSUFFICIENT_REFUND_FUNDS`/`IDEMPOTENCY_KEY_CONFLICT`; 400 `NOT_REFUNDABLE` (no wallet refs); 500 `MISSING_COMMISSION_RECORD`/`REFUND_FAILED`. **Practically dead for new money**: gateway-checkout rows have no `payerWalletId/receiverWalletId` and no `PlatformCommission` (`internal.routes.ts:418-456`), so they always return 400 `NOT_REFUNDABLE`. Only pre-redesign wallet-transfer rows pass |
| P12 | POST `/admin/payments/:transactionId/retry-activation` | `admin.routes.ts:294` | ADMIN | none | `{outcome}` or `{}` | yes: calls owning service `activate` / `cancel-after-refund`; PT_CONTRACT goes through `activateOrRefund` (may auto-REFUND the client). Idempotent on the owning-service side | `activationStatus`, `activationRetryCount` only | 404; 400 `NOTHING_TO_RETRY`; 502 `RETRY_FAILED` |
| P13 | GET `/admin/payments/obligations` | `ps/routes/admin-obligations.routes.ts:19` -> `admin-obligations.service.ts:~313` | ADMIN | `limit` 1-200 (default 50, caps EACH list), `staleMinutes` (default 30) | `ObligationsReport`: `generatedAt, params, summary{ptHoldback, negativeWallets, negativeSubledgers, walletMismatches, receivables, unpaidObligations{...}, paidNotActivated, targetUnverified, productPayments}`, lists `negativeWallets, negativeSubledgers, walletMismatches, ptHoldbacks, receivables, unpaidObligations, inFlightObligations, closedObligations, paidNotActivated, targetUnverified, cancelledPaid, refundOutcomes`, `truncated{...}` | read-only: built inside a `SET TRANSACTION READ ONLY` tx | - | 500 `OBLIGATIONS_REPORT_FAILED` |

NOT exposed by any HTTP route (CLI only, `DATABASE_URL` must be `*_test` unless `--i-have-owner-approval`): pt_holdback_reviews list/decide
(`scripts/fh9-holdback-review.ts`, `holdback-review.service.ts:82,207`), obligation lifecycle approve/evidence/verify/waive and PartnerReceivable
suspend/resume/waive (`adjustment-cli.ts:44-55`). `listOpenHoldbackReviews` is only referenced by that script. Four-eyes (`actor != approvedBy`) is enforced there
(`holdback-review.service.ts:87`; `obligation-payment-lifecycle.service.ts` verifier != recorder), as strings typed on a command line, not tied to authenticated admin ids.

Internal-only (service secret, not reachable from admin UI, listed because a UI may need them exposed): `GET /internal/payments/:id`, `GET /internal/wallets/:ownerType/:ownerId`
(`internal.routes.ts:968,975`; note it **creates** the wallet if absent), `GET /internal/ledger-operations` (cursor-paged list + key lookup, read-only tx, `ledger-operations.routes.ts:94-167`).

### 1b. user-service (gateway `/admin/sessions` for 1-3; `/contracts` for 4-5)

| # | METHOD path | handler file:line | auth | params | response | mutating? guard | audit | errors |
|---|---|---|---|---|---|---|---|---|
| U1 | GET `/admin/sessions/disputed` | `user-service/src/routes/admin.routes.ts:17` -> `booking.controller.ts:210`, `session.repository.ts:224` | ADMIN | none, unbounded `findMany`, `disputedAt asc`, includes `contract` | raw `Session[]` with `contract`, passed through `redactContractSplit` | read | - | 401/403 |
| U2 | GET `/admin/sessions/reconciliation` | `admin.routes.ts:19` -> `admin-reconciliation.controller.ts:17` -> `admin-reconciliation.service.ts:129` | ADMIN (checked twice) | `limit` (1-200, def 50), `endingMinAgeMinutes`, `endedMinAgeMinutes` (def 15) | `{generatedAt, params, needsAttention{items,truncated}, endingsUnconfirmed, endedWithoutSettledEnding, disputes{items,truncated,sla}}`; amounts are JS `number` (`amountAtStake`) | read-only | - | 403, 500 |
| U3 | POST `/admin/sessions/:id/resolve` | `admin.routes.ts:20` -> `booking.controller.ts:219` -> `booking.service.ts:737` | ADMIN; actor = `x-user-id` (token-derived after `installVerifiedIdentity`) | body `{resolution: COMPLETED\|CANCELLED\|PT_NO_SHOW_CONFIRMED, note}` | updated `Session` | yes; status CAS `DISPUTED -> next` under contract lock (`:762-779`); second admin gets "already processed"; money step is an intent row then idempotent call to payment-service (`UNRESOLVED_SESSION:<sessionId>` / no-show keys); ended contract -> 409 `CONTRACT_ENDING` | `Session.resolvedBy, resolutionNote, resolvedAt, ptAtFault`; settlement intent row (`session_settlements`). No `AuditLog` row for the ruling itself (the `auditService.record` calls at `booking.service.ts:1590,1646,1766` are other actions - not verified for dispute) | 400 (note/resolution), 404, 400 not DISPUTED, 409 `CONTRACT_ENDING`/already processed |
| U4 | POST `/contracts/:id/terminate` (admin acts via this, no admin-only route) | `routes/contract.routes.ts:122` -> `contract.controller.ts:665` | any authed user; **reason map** decides: admin-only reasons `SERVICE_DISCONTINUED_BY_PLATFORM, MUTUAL, EXPIRED, COMPLETED`; `PT_BANNED` -> 400 `REASON_RETIRED` | body `{reason}` | `{contractId, reason, requestedReason?, alreadyTerminated?, settlement}` (redacted per viewer) | yes: calls payment-service `/internal/contracts/terminate` with key `CONTRACT_TERMINATE:<contractId>`; replays | `AuditLog` action `CONTRACT_TERMINATED` with `actorRole`, `refund`, `statusBefore` (`contract.controller.ts:~770`) | 400 invalid reason, 403, 404, 409 codes via `errorCodeBody` |
| U5 | GET `/contracts/:id/money-breakdown` | `contract.routes.ts:114` -> `contract.controller.ts:~625` | party or ADMIN | - | refund preview + released/pending split | read | - | 403, 404, 400 |

### 1c. gym-service (gateway `/admin/gym-memberships`, `/admin/commission-rate`)

| # | METHOD path | handler file:line | auth | params | response | mutating? guard | audit | errors |
|---|---|---|---|---|---|---|---|---|
| G1 | POST `/admin/gym-memberships/:id/refund` | `gym-service/src/routes/admin.routes.ts:73` -> `membership.controller.ts:132` -> `membership.service.ts:338` | ADMIN | body `{reason}` in fixed list `GYM_VIOLATION_SUSPENDED\|GYM_CLOSED\|TRANSACTION_ERROR` | `{membership, refundAmount, remainingDays, clawback, release}` | yes: payment-service keys `REFERRAL_CLAWBACK:<id>`, `MEMBERSHIP_RELEASE:<id>`; only for `ACTIVE` memberships; step flags `refundClawbackDone`, payout released | **logger line only** (`membership.service.ts:390`); `adminId` is not persisted on the membership. The ledger carries the label text only | 400 `INVALID_REFUND_REASON`; 404 "Membership not found"; 409 expired / not ACTIVE / no payment on record |
| G2 | GET `/admin/gym-memberships/pending-issues` | `admin.routes.ts:77` -> `membership.controller.ts:151` | ADMIN | none, unpaged | `{success, data: [membership]}` | read | - | - |
| G3 | POST `/admin/gym-memberships/:id/resolve-pending-issue` | `admin.routes.ts:78` -> `membership.controller.ts:157` -> `membership.service.ts:570` | ADMIN | none | membership | yes: retries the auto-refund; idempotent through ledger keys | logger line only | 404, 409 not `PENDING_ISSUE` / no payment |
| G4 | GET `/admin/commission-rate` | `admin.routes.ts:153` | ADMIN | - | `{rate}` | read | - | - |
| G5 | GET `/admin/commission-rate/history` | `admin.routes.ts:154` | ADMIN | - | `PlatformCommissionRate[]` (`rate Decimal(5,4)`, `effectiveFrom`, `createdBy`) | read | - | - |
| G6 | POST `/admin/commission-rate` | `admin.routes.ts:155` -> `commission-rate.controller.ts:13` | ADMIN | body `{rate, effectiveFrom}` | row (201) | yes (append-only history) | `platform_commission_rates.createdBy = adminId` | `e.status` or 500 |

### 1d. ai-service personalized-order refunds (listed only, no deep dive). Reached via gateway `/ai/marketplace/...` with NO gateway ADMIN gate (role is checked in the controller)

| # | METHOD path | handler | note |
|---|---|---|---|
| A1 | GET `/marketplace/orders/refund-requests` | `ai-service/src/routes/personalized-service.routes.ts:21` -> controller `:372` | unpaged list of `REFUND_REQUESTED` orders |
| A2 | GET `/marketplace/orders/:id/refund-calculation` | routes `:33` -> controller `:384` | `{orderId,status,totalPaid,alreadyRefunded,refundableCeiling,milestones,disputeReason}` - numbers are JS floats |
| A3 | POST `/marketplace/orders/:id/refund-resolve` | routes `:34` -> controller `:396` -> `personalized-service.service.ts:875` | body `{decision: APPROVE\|DENY, refundAmount?, note}`; key `PERSONALIZED_REFUND:<orderId>:<amount>`; audit = `refundResolvedBy/At/Note` on the order; 409 `..._REFUND_INVALID_STATE`, 400 `..._INVALID_AMOUNT` |

### 1e. gateway aggregate

| # | METHOD path | handler | note |
|---|---|---|---|
| W1 | GET `/admin/dashboard` | `gateway/src/routes/proxy.routes.ts:253-510` | fans out to user, PT, stats, system-monitor, and `payment-service /admin/payments/reconciliation` (`:281`); money state tolerated when the 409 body is returned |

---------------------------------------------------------------------------------------------------

## 2. Financial data contract

### 2.0 Serialization rules (affect every field)

- All money columns in payment-service are Prisma `Decimal` -> JSON **string** when a raw row is returned (decimal.js `toJSON`). Raw-row endpoints (P1, P2, P5, P7) emit
  e.g. `"100000"` or `"100000.5"` - trailing zeros are NOT guaranteed. Computed reports (P3, P4, P13) emit `toFixed(2)` strings (`"100000.00"`). A UI must parse both.
- Currency: single currency, `PaymentTransaction.currency` default `"VND"`; no currency on wallets, ledger, withdrawals, commissions. VND is whole dong in practice (checkout rounds, split floors to 0 dp), the columns allow 2 dp.
- Timestamps: Prisma `DateTime` -> ISO-8601 UTC string. `finance-overview` buckets use SQL `date_trunc` on UTC timestamps - day/week buckets are UTC, not Vietnam time (+7), so a payment at 02:00 local lands in the previous day bucket.
- All signs are positive magnitudes; direction is carried by `entryType` / `purpose` / `status`, never by a negative number. Negative balances are a defect (P3 `negativeWallets`).
- Money in other services is not uniform: user-service `Contract.price` Decimal(14,2); gym-service `priceAtPurchase` Decimal(12,2); **ai-service `PersonalizedServiceOrder.priceAtPurchase`, `cumulativeRefundedAmount`, `price` are `Float`** (`ai-service/prisma/schema.prisma:470,350,398`); user-service reconciliation DTO amounts are JS `number`.

### 2.1 PaymentTransaction (`payment_transactions`, `prisma/schema.prisma:206-255`)

| Field | Business meaning | column / DTO | type & precision | signed | time basis | status rules | source of truth |
|---|---|---|---|---|---|---|---|
| id | Payment identity; also the FK all ledger rows hang on; for VNPay it IS `vnp_TxnRef` | `id` uuid | string | - | - | - | payment-service |
| purpose | Why money moved | `purpose` enum `GYM_MEMBERSHIP, PT_CONTRACT, GYM_PT_COMBO, WALLET_TOPUP(legacy), REFUND(legacy wallet path), TRAINING_PACKAGE_PURCHASE, PERSONALIZED_SERVICE_PURCHASE, WITHDRAWAL(payout row)` | enum | - | - | - | payment-service |
| status | Gateway/settlement state | `status` `PENDING, PROCESSING, PAID, FAILED, CANCELLED, REFUNDED` | enum | - | `paidAt`, `failedAt`, `refundedAt`, else `createdAt/updatedAt` | PENDING -> PAID via CAS in `settleContractPayment` (`contract-ledger.service.ts:474`); stale PENDING/PROCESSING -> FAILED after 10 min (non-topup) by sweep; amount mismatch -> FAILED; a later correct PAID callback still settles FAILED (not REFUNDED) rows; REFUNDED set only by legacy `reverseTransfer` | payment-service |
| provider | Gateway used | `provider` `MOCK, VNPAY, MOMO, ZALOPAY, PAYOS, STRIPE, MANUAL_BANK_TRANSFER` (MOCK default for old rows; STRIPE/MANUAL have no handler) | enum | - | - | gateway enabled for real money gated by `gateway-policy.ts` | payment-service |
| providerTransactionId | Our key to the gateway's order: VNPay `vnp_TxnRef`(=txn id), ZaloPay `app_trans_id`, PayOS `orderCode`, MoMo order id. **It is NOT the gateway's own settlement id** (VNPay `vnp_TransactionNo`, ZaloPay `zp_trans_id`, PayOS `reference`, MoMo `transId`) - those exist only inside `PaymentWebhookEvent.payload` and `metadata.gatewayDiscrepancy.gatewayTransactionNo` (mismatch case only) | `provider_transaction_id`, indexed, not unique | string? | - | - | - | gateway-assigned for ZaloPay/PayOS, ours for VNPay |
| amount | Gross price the payer owes/paid | `amount` | `Decimal(12,2)` (JSON string) | positive | - | must equal gateway-reported VND exactly or no settlement (`gateway-amount.ts`, `webhook.service.ts:135-148`) | payment-service; frozen at checkout |
| currency | - | `currency` | string `"VND"` | - | - | - | - |
| paymentMethod / extraData | Free text, mostly unused in current flow | `payment_method`, `extra_data` | string? | - | - | - | - |
| idempotencyKey / requestFingerprint | Caller-supplied dedupe key + sha256 of immutable fields; same key + other fingerprint = 409 | `idempotency_key` unique, `request_fingerprint` | string | - | - | - | caller service |
| paidAt / failedAt / refundedAt | When settlement/failure/refund flip happened | `paid_at`, `failed_at`, `refunded_at` | timestamp? | - | **paidAt is the income time basis in P4** | set with status | payment-service |
| fees | **No gateway fee, no net-of-fee amount, no MDR column anywhere.** Platform fee exists only as the split (2.5) and legacy `PlatformCommission.platformFeeAmount` | - | - | - | - | - | **MISSING** |
| payerId / ptId / gymId / membershipId / ptContractId | Parties and owning entity ids (no names) | columns | string? | - | - | - | other services own the entities |
| relatedEntityType / relatedEntityId | Which entity this pays for (`GYM_MEMBERSHIP, PT_CONTRACT, WALLET_TOPUP, TRAINING_PACKAGE_PURCHASE, PERSONALIZED_SERVICE_PURCHASE`) | columns | enum / string | - | - | - | owning service |
| activationStatus / activationRetryCount / lastActivationRetryAt | Has the owning service been told "paid" (or, for REFUND rows, "cancel after refund") | `NOT_APPLICABLE, PENDING, ACTIVATED, ACTIVATION_FAILED` | enum / int | - | `lastActivationRetryAt` | PAID but PENDING for > staleMinutes shows in P13 `paidNotActivated`; retry cap 10 then manual P12 | payment-service |
| initiatedBy / sourceService | Who/what created the row (`SYSTEM`, a user id, an admin id, service name) | columns | string | - | - | for P11 refunds `initiatedBy` is the **body-supplied** adminId | - |
| refundOfTransactionId | Legacy refund row -> original | column, indexed | string? | - | - | only legacy REFUND rows | - |
| metadata | JSON bag, see 2.9 | `metadata` | Json? | - | - | - | payment-service |

### 2.2 Wallet (`wallets`, `schema.prisma:123-141`)

| Field | Meaning | type | Rules |
|---|---|---|---|
| ownerType/ownerId | `CLIENT, PT, GYM, PLATFORM` + user id / gym id / `'ESCROW'` / `'REVENUE'`; unique pair. **GYM wallet is keyed by gymId (branch), not partnerId** | enum/string | created lazily on first use (`getOrCreateWallet`) |
| availableBalance | Withdrawable now | `Decimal(14,2)` | ES.available = every dong held for others (invariant) |
| pendingBalance | Attributed to owner but not yet earned (backs future sessions) | `Decimal(14,2)` | **pooled across all of a party's contracts**; per-contract pending is derived by summing ledger rows per `transactionId` (`pendingForTransaction`, `wallet.service.ts:176`) |
| lockedBalance | Approved withdrawal reservation | `Decimal(14,2)` | only `withdrawal.service` touches it |
| holdbackBalance | PT earned-but-held (FH-9), not withdrawable | `Decimal(14,2)` | feature flag `PT_HOLDBACK_NEW_CONTRACTS_ENABLED` default off per handoff doc |
| status | `ACTIVE, FROZEN, CLOSED` | enum | non-ACTIVE wallet makes any movement throw `WalletNotActiveError`. **No admin endpoint sets it** (grep: no writer in routes) |
| createdAt/updatedAt | - | timestamp | - |

Aggregates per bucket and owner type are exposed only as sums by P3 (`SUM() GROUP BY owner_type`). No per-wallet read for an admin (BACKEND GAP, see 5).

### 2.3 WalletLedgerEntry (`wallet_ledger_entries`, `schema.prisma:143-164`)

| Field | Meaning | type | Rules |
|---|---|---|---|
| id, walletId, transactionId | Entry id; wallet; **hard FK to PaymentTransaction** (indexed) - this is the reliable join key | uuid/uuid/uuid | every posting is stamped with the *payment's* transaction id by `withWallets(.., transactionId, ..)` (`wallet.service.ts:231-255`) - including session release, termination, holdback, referral, personalized flows (`contract-ledger.service.ts:470,567,725,947,982,1051,1261,1636,1782`; `membership-ledger.service.ts:90,188,296`). Exception: withdrawal postings point at the dedicated `purpose=WITHDRAWAL` payout row |
| entryType | `DEBIT` / `CREDIT` | enum | direction relative to the wallet bucket |
| bucket | `PENDING, AVAILABLE, LOCKED, HOLDBACK` (default AVAILABLE) | enum | a PENDING->AVAILABLE release = 2 rows sharing one transactionId |
| amount | magnitude | `Decimal(14,2)` | > 0 |
| balanceBefore / balanceAfter | Running total of THAT bucket of THAT wallet at write time | `Decimal(14,2)` | chain per (wallet, bucket); can be audited for gaps |
| description | **Free-form English text, the only "what is this" label** (e.g. `"<label> - PT share"`, `"Withdrawal <id> paid - ref <bankRef>"`). No structured `kind`, no operation key, no actor | string? | `wallet-entry-category.ts` derives a `category` by regexing it; that classifier runs only on `/me/*` history, not on any admin endpoint |
| createdAt | Posting time (basis for REV net revenue in P4) | timestamp | no `valueDate`/`postedBy` |

### 2.4 WithdrawalRequest (`withdrawal_requests`, `schema.prisma:178-204`)

| Field | Meaning | type | Rules |
|---|---|---|---|
| id, walletId, ownerType, ownerId | Request and requester wallet. Requester identity is **only the ids**, no name/phone/email joined | uuid, string | PT/CLIENT self-service via `/me/withdrawals`; GYM via gym-service proxy `/internal/withdrawals/gym/:gymId` |
| amount | Requested payout | `Decimal(14,2)` | `> 0`, `>= MIN_WITHDRAWAL_AMOUNT` (env, default **10,000**) (`withdrawal.service.ts:25-33,92`); **allowed-amount rule**: non-CLIENT `<= availableBalance - Σ PENDING requests`; CLIENT `<= refund-sourced credits - paid - open` (description-matching `sumRefundSourcedCredits`) and also `<= availableBalance - Σ PENDING` (`:107-143`). Checked at request time only; markPaid can still fail on balance |
| status | `PENDING -> APPROVED -> PAID` or `PENDING/APPROVED -> REJECTED` | enum | PENDING->PAID shortcut allowed (`markPaid` locks inline); PAID and REJECTED terminal |
| payoutInfo | Bank/e-wallet details typed by the requester | free text, **PII** | not validated; returned verbatim by P7 |
| bankReference | Admin-typed transfer reference after paying manually | string? | mandatory at markPaid; free text, not unique, not validated against any statement |
| rejectionReason | Mandatory at reject | string? | - |
| reviewedBy / reviewedAt | First admin touch (approve, reject, or markPaid for a never-approved) | string?/timestamp? | token-derived admin id; `markPaid` keeps an earlier approver, so **the payer is not recorded separately from the approver** (the payout `PaymentTransaction.initiatedBy` holds the latest admin that called approve/reject/markPaid first) |
| paidAt | When admin marked paid | timestamp? | time basis for "expense" is the payout transaction's `paidAt` |
| createdAt/updatedAt | Request time | timestamp | queue sorted `createdAt asc` |

### 2.5 Refunds (there are four distinct shapes - an admin UI must not call them all "refund")

| Path | Where the money goes | Record that proves it | Fields |
|---|---|---|---|
| Legacy admin refund P11 | back to payer's **wallet** by reversing the wallet transfer | new `PaymentTransaction purpose=REFUND`, `refundOfTransactionId`, original -> `REFUNDED` | `amount`, `metadata.reason`, `initiatedBy` |
| Partial refund `POST /internal/payments/:id/refund` (gym early cancel, legacy) | wallet | same shape, `metadata.partialRefund`, `originalAmount` | commission prorated at 2 dp (`internal.routes.ts:219-221`) |
| **Current flow**: contract termination, membership release/refund, unactivated-purchase auto-refund, personalized refund | **credit to the client's CLIENT wallet AVAILABLE** (not back to the gateway), no new PaymentTransaction | `wallet_ledger_entries` CREDIT on the client wallet under the ORIGINAL transaction id + `ledger_operations` row (`CONTRACT_TERMINATE:<id>`, `MEMBERSHIP_RELEASE:<id>`, `CONTRACT_UNACTIVATED_REFUND:<txnId>` ...) + for unactivated: `metadata.unactivatedRefund{refundedAt, amount, owed, unpaid, obligationId, reason, contractStatus}` and `activationStatus=ACTIVATION_FAILED` (`contract-ledger.service.ts:625-640`) | cash only leaves the platform when the client files a withdrawal that an admin pays (P10) |
| Gateway-side refund (money back to card/bank) | - | **not implemented as an admin flow**. `zalopay.provider.ts:221` has a refund helper; no route calls it | - |

Consequence: P4 `expense` (PAID REFUND+WITHDRAWAL rows) counts the second category only for legacy rows; refunds credited to client wallets are not "expense" until paid out as a withdrawal.

### 2.6 PlatformCommission (`platform_commissions`, `schema.prisma:257-275`) - LEGACY

`grossAmount`, `platformFeeAmount`, `partnerPayoutAmount` Decimal(12,2); `commissionRate` Decimal(5,4); `status PENDING/SETTLED/CANCELLED`; `partnerType/partnerId`. Written only by the retired wallet-to-wallet transfer; `SETTLED` is never written (settle route is 410). Gateway-checkout revenue lives only in the ledger (REV wallet) and in `metadata.rates`.

### 2.7 PartnerReceivable (`partner_receivables`, `schema.prisma:284-315`)

`partnerType`, `partnerId`, `amount`, `recovered`, `waived` all `Decimal(14,2)`; outstanding = `amount - recovered - waived` (computed in P13 SQL, `admin-obligations.service.ts:~346`). `settledAt` null = open; `suspendedAt/By/Reason/Ref`, `waivedAt/By/Reason/Ref`. History in append-only `partner_receivable_events` (action SUSPEND/RESUME/WAIVE, `approvedBy`, `approvalRef`, `beforeJson/afterJson`, unique `idempotencyKey`). Read: P13 `receivables` (partner id truncated to 8 chars, `short()`). Write: CLI only. Note `d48-no-fronting` tests: new code does not create receivables for PT faults - they became `ContractUnpaidObligation` (`schema.prisma:383`, kinds `NO_SHOW, LATE_ARRIVAL, REFUND_SHORT, OVER_RELEASED`; `owed/paid/unpaid/externallyPaid/verifiedPaid` Decimal(14,2); 9-state lifecycle; events + payments tables append-only).

### 2.8 pt_holdback_reviews (`schema.prisma:438-492`)

| Field | Meaning |
|---|---|
| id, key `HBR:<txnId>:<kind>[:<obligationId>]` unique | one row per cause |
| transactionId | FK to the contract's PaymentTransaction |
| kind | `OPEN_OBLIGATION, UNSECURED_DISPUTE, UNCOMPUTABLE` |
| status | `OPEN, SETTLED_VERIFIED, SETTLED_PARTIAL, NOT_VERIFIED, RELEASED_AUTO` |
| reserve | `Decimal(14,2)` PT-borne amount kept in HOLDBACK |
| reason, relatedRef, handler (default `ADMIN_FINANCE_QUEUE`), reviewBy (SLA 14d via `PT_HOLDBACK_REVIEW_DAYS`) | context; overdue = `reviewBy < now` computed by reader |
| decidedAt/By, approvedBy, approvalRef, verifiedAmount, releasedToPt, note | decision record; event table `pt_holdback_review_events` append-only (UPDATE/DELETE rejected by migration), unique `idempotencyKey` `HBR_EVENT:<reviewId>:<approvalRef>` |

Read via P13 `ptHoldbacks[]` (derived from ledger per contract: `held, ended, openObligations, undecidedSessions, state RUNNING/WAITING_RECONCILIATION/STUCK, reserved, reviewBy, overdue, reviewKinds`) and summary counts. The **review rows themselves (id needed to decide) are not returned by any HTTP endpoint**. Decision: CLI only (CAS on `expectedReserve` + `expectedTransactionId`, dry-run default).

### 2.9 Revenue split frozen at checkout

`payment_transactions.metadata` (JSON, set in `internal.routes.ts:438-455`):

| Key | Content | Notes |
|---|---|---|
| `rates` | `{platformRate, ptRate, gymRate}` as decimal **strings** | frozen at checkout; settlement and replays read ONLY this (`webhook.service.ts:262-270`); `assertRatesValid` at entry. Split = pt and gym floored to whole dong, platform = remainder (`contract-money.ts:269-289`) |
| `parties` | `{ptUserId, gymId\|null, clientUserId}` | same freeze |
| `redirectUrl`, `qrCodeUrl`, `platform`, `returnBaseUrl` | checkout plumbing | **returned verbatim by P1** (signed gateway URLs) |
| intent metadata | provider specific (`vnp_TxnRef`, `paymentLinkId`, `orderCode`, `app_trans_id`, ...) | used by reference-binding check for PayOS |
| `gatewayDiscrepancy` | see P2 | merged with jsonb `||` |
| `unactivatedRefund` | see 2.5 | - |
| `ptHoldbackRate` | **not stored in metadata** - sent per call by user-service on release/terminate | so the admin cannot see the contract's holdback rate from the payment row |

The monetary per-party amounts of a payment are NOT stored as columns; they are only visible as the 3 PENDING-bucket CREDIT ledger rows (`"... - PT share"`, `"... - gym share"`, `"... - platform share"`) + ES CREDIT (`"... - received"`) written at `contract-ledger.service.ts:~495-500`. Current platform rate config: gym-service `platform_commission_rates` (G4-G6), and that is the rate user-service reads when it creates a contract (not verified in this audit).

---------------------------------------------------------------------------------------------------

## 3. Reconciliation reality

**What `GET /admin/payments/reconciliation` computes** (`reconcile.service.ts:59-131`): one raw SQL `SUM` of all four balance columns of `wallets` grouped by `owner_type` (PLATFORM split by `owner_id`), then
`claims = Σ(pending+available+locked+holdback)` of CLIENT, PT, GYM and REV; `escrow = ES.available`; `drift = escrow - claims`; `balanced = drift == 0`; plus a list of wallets with any negative bucket.
That is an **internal ledger-to-ledger invariant only**. It reads wallet *balance columns*, not ledger rows, not payments, not any external data.

Therefore it can NOT tell: (a) whether gateway cash actually arrived, (b) whether `Σ PAID payments - Σ paid withdrawals - Σ legacy refunds = ES.available`, (c) wallet column vs ledger last `balanceAfter` (that check exists elsewhere - P13 `walletMismatches`, `ledger-state-checks.ts:96`, flags escrow row as informational because seeded data is not fully ledgered), (d) ES pending/locked/holdback are ignored.

**Stored external gateway data** - partly yes:
- `payment_webhook_events` (`PaymentWebhookEvent`, `schema.prisma:619-633`): `provider`, `providerEventId` (unique per provider), `providerTransactionId`, **`payload` JSON (the provider-normalized raw)**, `processedAt`, `retryCount`, `lastRetryAt`. Written by `handleEvent` for IPN, VNPay return, and synthetic `poll_<txnId>_<ts>` events (`webhook.service.ts:82-87,384-392`; `vnpay-callback.service.ts:90,133`). Not written for callbacks failing signature (`webhook.routes.ts:153-156`). **No FK to `payment_transactions`** (join by `providerTransactionId` string, indexed on the other side only) and **no admin endpoint exposes it**.
- Gateway own ids: VNPay `vnp_TransactionNo`, ZaloPay `zp_trans_id`, PayOS `reference`, MoMo `transId` live only inside that `payload` (and in `metadata.gatewayDiscrepancy` on mismatch).
- Raw payload of a POLL is `gw.raw` only for providers implementing `queryGatewayResult` (VNPay querydr); others store `{}` (`webhook.service.ts:373-379`). Poll results that are not PAID are not stored at all.
- No settlement/statement import, no bank-statement table (the only `bankStatementId` is a free-text evidence pointer inside the obligation payment lifecycle, `schema.prisma:563,603`), no per-day gateway totals, no gateway fee/net, no payout-batch.

**Payment <-> ledger matching key:** yes and reliable - `WalletLedgerEntry.transactionId` is a NOT NULL FK to `PaymentTransaction.id`, indexed (`schema.prisma:158,162`); all flows stamp the originating payment id. Weak points: description-only labels (no `kind`), pooled PENDING buckets (per-contract view requires summing by transactionId), withdrawal postings point at the payout row not the origin.

**Reversal / chargeback model:** none for gateways. No chargeback status, no dispute-with-gateway entity, no `REVERSED` status. `REFUNDED` exists only via legacy wallet reversal. A late `PAID` callback on a `REFUNDED` row is refused as `NOT_PAYABLE` (`webhook.service.ts:174-178`). A wrong-amount callback is parked as `metadata.gatewayDiscrepancy` with `resolved:false`, nothing in code ever sets it to true or records the resolution (who refunded at the gateway, when).

**"Mark reconciled"/matching state:** none. No `reconciledAt`, no match status on payments, no admin acknowledgement of drift, no history of past reconciliation runs (P3 is computed live, nothing is persisted, no snapshot, no trend).

**Background jobs** (`reconciliation.service.ts:21-32`, every 5 min via `setInterval` in `server.ts`, or the `reconciliation` Lambda job `jobs-lambda.ts:15`), in order:
1. `reconcileTopupWebhookBookkeeping` - marks unprocessed webhook events processed when their transaction is already PAID (bookkeeping flag only).
2. `pollGatewayConfirmations` - for **every PENDING/PROCESSING non-topup transaction** calls the provider's query API (`pollAndSettle`, `webhook.service.ts:346`), and on PAID routes through the same `handleEvent`. Stores: a `payment_webhook_events` row only when PAID; nothing for "still pending"/"failed at gateway".
3. `reconcilePendingActivations` - retries `activate` (max 10) on PAID-not-ACTIVATED rows, auto-refunds on definite "not activatable".
4. `reconcilePendingRefundCancellations` - retries cancel-after-refund.
5. `sweepStaleProcessing` - PENDING/PROCESSING older than 10 min (60 for topup) -> FAILED.
No job compares gateway settlement reports to our ledger. A job result is only logged, not stored (no job-run table).

user-service has its own money-sync report (U2) over `session_settlements` / terminations, not joined to payment-service.

---------------------------------------------------------------------------------------------------

## 4. Money journey traceability (from one `PaymentTransaction.id`)

| Step | Record | Join key to the payment | Gap |
|---|---|---|---|
| 1 Checkout created | `payment_transactions` row (P1 shows it) incl. `metadata.rates/parties/redirectUrl`, `idempotencyKey`, `relatedEntityType/Id` | PK | initiator is `initiatedBy` id only, no request/correlation id, no client IP/UA |
| 2 Gateway callbacks | `payment_webhook_events` (`payload`, `processedAt`, `retryCount`) | **string match** `webhook.provider_transaction_id = txn.provider_transaction_id` AND provider; VNPay return/IPN ids are prefixed `vnpay_ipn:`/`vnpay_return:` | no FK; no endpoint; unmatched events (NOT_FOUND) stay `processedAt=null` forever and are only found by an ad-hoc SQL. Refused/bad-signature callbacks leave no row |
| 3 Status flips | `status`, `paidAt`, `failedAt` columns | PK | **no status history table** - only the latest status; FAILED->PAID resurrection overwrites the previous state with no trace except webhook rows |
| 4 Settlement postings | ES CREDIT(AVAILABLE) + 3 PENDING credits (PT, gym, REV) in `wallet_ledger_entries` | `transaction_id = txn.id` | description is the only label; no `ledger_operations` row for the settlement itself (CAS on status is the guard), so it is invisible in `/internal/ledger-operations` |
| 5 Session releases | PENDING debit + AVAILABLE credit per party (+ HOLDBACK credit if enabled) | same `transaction_id` | which session is released is in `ledger_operations.key` (`SESSION_RELEASE:<sessionId>`, `.transactionId` indexed) not on the ledger row; ledger row -> operation link must be inferred by time/description |
| 6 No-show / late arrival | ledger rows + `ledger_operations` (`PT_NO_SHOW:<sid>`, `PT_LATE_ARRIVAL:<sid>`) + possibly `contract_unpaid_obligations` (FK `transaction_id`) | `ledger_operations.transaction_id`, `contract_unpaid_obligations.transaction_id` | same description-only labelling |
| 7 Termination / refund | ledger rows (client CREDIT, PENDING reversals) + `ledger_operations` `CONTRACT_TERMINATE:<contractId>` (+ `requestFingerprint`, `result` JSON) + `pt_holdback_reviews` (FK `transaction_id`) + user-service `AuditLog CONTRACT_TERMINATED` and `session_settlements` | `transaction_id`; contract id = `relatedEntityId` | user-service rows join to payment-service only via `contractId == payment.relatedEntityId` / `transactionId` stored in user-service (cross-DB, no admin query); no correlation id spanning services |
| 8 Unactivated auto-refund | `metadata.unactivatedRefund`, `ledger_operations CONTRACT_UNACTIVATED_REFUND:<txnId>`, optional obligation | PK | notification outcome (`refund-notification.service`) not visible |
| 9 Membership / personalized | `ledger_operations MEMBERSHIP_*`, `PERSONALIZED_*`; gym-service membership row `paymentTxnId`; ai-service order `paymentTransactionId` | `transaction_id`; other DBs by id | admin who triggered a membership refund (G1) is only in a log line |
| 10 Withdrawal | `withdrawal_requests` (wallet-scoped) -> postings under a **separate** `payment_transactions` row `purpose=WITHDRAWAL, idempotencyKey=WITHDRAWAL:<requestId>` + `ledger_operations` `WITHDRAWAL_LOCK/WITHDRAWAL/WITHDRAWAL_UNLOCK:<id>` | request id embedded in the payout row's `idempotency_key` (string parse) | withdrawal is a claim on the wallet, never on a specific origin payment: **cannot trace "which payment funded this payout"** (pooled AVAILABLE). Payout row has no FK to the request |

**Missing for a full explorer:** webhook-log FK/endpoint; status-change history; structured ledger `kind`/`operationKey`/`actor` columns; correlation id across checkout -> webhook -> ledger -> owning-service call; per-payment party amounts as columns; link from `WithdrawalRequest` to its payout `PaymentTransaction`; admin actor on membership/dispute/terminate-by-admin in payment-service ledger (`ledger_operations` has no actor).

---------------------------------------------------------------------------------------------------

## 5. Lists available for an explorer UI

| Need | Exists? | Detail |
|---|---|---|
| Transactions | **Partial** - P1 only: newest 200, no pagination/cursor/filter/sort/search/date range/total count | BACKEND GAP |
| Transactions by status/provider/purpose/date/payer/amount | **No** (DB has `@@index([status])`, `[payerId,status]`, `[purpose,status,activationStatus]`, `[providerTransactionId]`, so the indexes mostly exist) | BACKEND GAP |
| Single transaction detail | **No admin route** (`GET /me/payments/:id` is owner-only 404; `/internal/payments/:id` service-secret) | BACKEND GAP |
| Ledger entries | **No** admin endpoint. Only wallet owner history `GET /me/wallet/transactions`, `/me/pt-wallet/transactions` (own wallet, newest 50, adds derived `category`) | BACKEND GAP |
| Ledger entries by transaction id | **No** | BACKEND GAP (highest value for explorer) |
| Wallets | **No** list/detail for admin. `/internal/wallets/:type/:id` (service secret, creates on read). Totals only through P3 | BACKEND GAP |
| Withdrawals | Queue only (P7): PENDING+APPROVED, max 100, oldest first. **No history of PAID/REJECTED, no per-owner, no filters** (`listByStatus` repository helper exists but no route) | BACKEND GAP |
| Webhook events | **No** | BACKEND GAP |
| Commissions | P5 legacy, newest 200 | legacy |
| Obligations / receivables / holdbacks | P13, capped lists per group (`limit` <= 200), `truncated` flags, no cursor/filter | partial |
| Disputed sessions | U1 unbounded list; U2 with limit | partial |
| Pending memberships (refund failures) | G2 unpaged | partial |
| Ledger operations by key/prefix | `/internal/ledger-operations` cursor-paged (service secret only) | good shape, not admin-reachable |
| Gateway discrepancies | P2 (200 cap), no resolve action | partial |
| Names | Every list returns ids only (payerId, ptId, ownerId). No join to user/gym names; the UI would need N lookups | BACKEND GAP (denormalise `displayName` server-side) |

---------------------------------------------------------------------------------------------------

## 6. Gaps and risks register

| ID | Gap | Impact on admin UX | Suggested backend contract | Pri |
|---|---|---|---|---|
| G-01 | Single `ADMIN` role; no finance/auditor/support split; no amount limits | A support admin can pay out money, refund, resolve disputes. A redesigned admin cannot hide dangerous buttons per role | Add permission claims in auth-service token (`finance:read`, `finance:approve_withdrawal`, `finance:pay_withdrawal`, `finance:refund`, `finance:holdback_decide`); enforce in each service (`requirePermission`); expose `GET /admin/me/permissions` | P0 |
| G-02 | No four-eyes in HTTP. Same admin can approve and mark-paid a withdrawal; holdback/obligation four-eyes exist only as typed strings in a CLI | UI cannot offer "waiting for second approver"; real control is missing for the largest money action | `POST withdrawals/:id/mark-paid` requires `approvedBy != paidBy` (both token ids) and a rule `amount > threshold => second approver`; store `approvedBy`, `paidBy` as separate columns | P0 |
| G-03 | `POST /admin/payments/:id/refund` takes `adminId` from the body and uses a random idempotency key per call (`admin.routes.ts:156-159,193`) | Audit trail can be forged by any ADMIN; double-click can race into two reversal attempts; and the endpoint rejects every current gateway-paid transaction (400 `NOT_REFUNDABLE`) so a "Refund" button on a payment would never work | Use `req.user.userId`, accept client `Idempotency-Key`, CAS `status PAID->REFUNDING` inside the transaction; and design the real refund path for gateway payments (client wallet credit vs gateway refund) | P0 |
| G-04 | No paginated/filterable transactions endpoint (P1 = 200 newest) | Explorer, search by payer/provider/status/date, CSV export impossible | `GET /admin/payments/transactions?cursor=&limit<=100&status=&provider=&purpose=&from=&to=&payerId=&relatedEntityId=&q=&sort=createdAt:desc` -> `{items[], nextCursor, total?}`; items include `payerName`, `amount` string, `fee?` | P0 |
| G-05 | No transaction detail / ledger-by-transaction endpoint | Cannot answer "where did this payment's money go" without SQL | `GET /admin/payments/transactions/:id` -> `{transaction, webhookEvents[], ledgerEntries[] (wallet owner, bucket, direction, amount, before/after, description), ledgerOperations[], commissions[], obligations[], holdbackReviews[], refundChildren[], withdrawal?, statusHistory[]}` | P0 |
| G-06 | Reconciliation returns HTTP 409 on drift and is live-only (no history, no ack) | UI error handlers will show "failed" for the most important state; no trend, no "who looked at this drift" | Return 200 with `status: 'DRIFT'`; add `reconciliation_runs` table (periodic snapshot: escrow, claims, drift, counts, runBy) and `GET /admin/payments/reconciliation/history`; add per-day `paymentsPaid - withdrawalsPaid - legacyRefunds` vs ES delta | P0 |
| G-07 | No gateway-vs-ledger reconciliation: no settlement import, no gateway fee/net, no gateway id column, webhook log not exposed or FK'd | Finance cannot prove bank cash = PAID payments; fees invisible; can't match a VNPay report | Add `PaymentTransaction.gatewayTransactionNo`, `gatewayFee`, `netAmount`, `settledAt`; table `gateway_settlement_lines` + `POST /admin/payments/settlements/import`; `GET /admin/payments/webhook-events?providerTransactionId=` with FK `paymentTransactionId` | P1 |
| G-08 | Withdrawal queue lists only PENDING/APPROVED, cap 100, ids only, no history, no payer bank-detail validation, `payoutInfo` free text, `bankReference` unvalidated/non-unique | Cannot show completed payouts, search by user, detect duplicate bank refs, or see who the requester is | `GET /admin/payments/withdrawals?status=&ownerType=&from=&to=&cursor=` with `ownerName`, `walletAvailableNow`, `ageHours`; unique index on `bankReference`; structured `payoutInfo {bank, accountNo, holder}` | P1 |
| G-09 | Wallet/ledger explorer missing (no wallets list, no ledger list, no per-wallet balances by bucket) | Cannot investigate a partner's balance or a negative wallet found by P3/P13 | `GET /admin/wallets?ownerType=&q=&hasNegative=`, `GET /admin/wallets/:id/ledger?bucket=&from=&cursor=`; ledger rows with structured `kind`, `operationKey` | P1 |
| G-10 | Ledger rows are labelled only by free English text; classifier exists only for `/me/*` | Admin ledger table would show raw text with ids; cannot filter by event type | Add columns `kind` (enum, same set as `WalletEntryCategory`), `operationKey` (FK-ish to `ledger_operations.key`), `actorId`; backfill by the existing classifier | P1 |
| G-11 | Holdback reviews and obligation lifecycle are CLI-only; review ids not returned over HTTP | The "Admin finance queue" designed by FH-9 has no UI action; ops must SSH | `GET /admin/payments/holdback-reviews?status=`, `POST .../:id/decide` (dry-run flag, CAS fields, `approvalRef`, second approver = separate admin session), same for obligations/receivables. Decide the production gate first (CLI refuses non-`_test` DB without owner approval) | P1 |
| G-12 | Admin actor not recorded for gym-service membership refund (G1/G3) or payment-service ledger operations; dispute ruling has `resolvedBy` only on the session | "Who refunded this?" unanswerable from finance data | `ledger_operations.actorId/actorRole/reason` (pass `x-actor-*` through the internal call); `membership_events` table | P1 |
| G-13 | Error contract inconsistent: payment-service `{success,error{code}}`; user-service `{error:string,code?}`; gym-service code = free-text message; `InsufficientBalanceError` on withdrawal approve/pay -> 500; invalid state uses 400 not 409 | UI cannot map to localized messages; retry logic unsafe | Standardise `{success:false,error:{code,message,details}}` in the three services; map `InsufficientBalance->409 INSUFFICIENT_BALANCE`, `WalletNotActive->409`, state conflicts -> 409 | P1 |
| G-14 | `GET /admin/payments` returns raw rows including `metadata.redirectUrl`/`qrCodeUrl`, `idempotencyKey`, `extraData` | Leaks live checkout URLs and internals to any ADMIN browser; extra payload | Whitelisted DTO; hide `metadata` except `rates`, `parties`, `gatewayDiscrepancy`, `unactivatedRefund` | P1 |
| G-15 | Gateway discrepancy has no resolve workflow (`resolved:false` forever) | Items pile up in P2; no way to record "refunded at gateway on <date> ref <x>" | `POST /admin/payments/:id/discrepancy/resolve {action, gatewayRefundRef, note}` + `resolved*` columns/audit | P1 |
| G-16 | `GET /admin/sessions/disputed` unbounded; `pending-issues`, `refund-requests` unpaged; admin dispute ruling has no `AuditLog` | Large lists freeze the table; incomplete audit | Add `limit/cursor`; write `AuditLog DISPUTE_RESOLVED` | P2 |
| G-17 | Money types differ across services (ai-service Float, user-service report `number`, payment Decimal strings w/ variable trailing zeros) | Rounding drift in UI; mixed formatting | One DTO rule: money = string with 0 dp for VND; add `amountMinor` ints; migrate ai-service to Decimal | P2 |
| G-18 | `finance-overview` buckets in UTC; income counts WALLET_TOPUP; refunds credited to client wallets not in `expense` | Daily charts shifted 7h; "expense" understates real refund liability | Accept `tz=Asia/Ho_Chi_Minh`; add `refundsToWallets` series from CLIENT-wallet credits by ledger; exclude legacy purpose | P2 |
| G-19 | `PlatformCommission` endpoint (P5) and `commissions/settle` (410) are legacy; real revenue is REV wallet | A "Commissions" screen backed by P5 would be empty/wrong | Remove P5 from UI; build "Platform revenue" from ledger (REV AVAILABLE/PENDING by day, by purpose) | P2 |
| G-20 | Wallet `status` (FROZEN/CLOSED) has no admin setter; no admin action to freeze a suspicious wallet | No emergency stop in UI | `POST /admin/wallets/:id/freeze|unfreeze {reason}` with audit | P2 |
| G-21 | `/ai/*` is not role-gated at the gateway; admin refund endpoints for personalized orders rely on controller checks only | Defense in depth missing; easy to forget in a future route | Add `requireRoles('ADMIN')` gateway prefix for `/ai/marketplace/orders/refund-requests`, `/orders/:id/refund-resolve`, `/orders/:id/refund-calculation` | P2 |
| G-22 | `GET /internal/wallets/...` creates wallets on read | An explorer built on it would create empty wallets | Separate read-only admin lookup | P2 |

---------------------------------------------------------------------------------------------------

## 7. Notes for the next audit steps / things I did not verify

- I did not run anything; amounts' JSON formatting is from reading Prisma/decimal.js behavior and the report code, not from a live response (CODE AUDIT).
- Whether `auditService.record` covers dispute resolution (U3) - the three call sites in `booking.service.ts` (1590, 1646, 1766) were not read.
- Which rate user-service uses at contract creation (config vs `platform_commission_rates`) - not traced.
- Lambda deployment entrypoints (`lambda.ts`, `jobs-lambda.ts`) mirror the Express app; assumed identical admin protections.
- The gateway test suite and `docs/money-flow.md` were not re-read (already known background).
