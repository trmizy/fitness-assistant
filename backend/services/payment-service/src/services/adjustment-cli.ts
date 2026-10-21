/**
 * FH-8 - command-line front end for adjustment-operations.service.ts and obligation-payment-lifecycle.service.ts
 * (entry point: scripts/fh8-adjust.ts).
 *
 * Safety rules enforced here, before any query runs:
 *  1. DRY-RUN IS THE DEFAULT. Nothing is written unless `--apply` is given.
 *  2. The target database name must end with `_test`. Any other database (dev, staging, production) is REFUSED unless
 *     `--i-have-owner-approval=<group>` is passed. Real data needs the owner's approval per group (A: negative
 *     sub-ledgers, B: stuck client money, C: partner debt, D: over-refund, F: SETTLED without counterpart); the flag does
 *     not grant approval, it records that the operator holds it. The approval reference is stored on every event.
 *  3. There is no HTTP route for these writes.
 *  4. An obligation is never marked paid from here without the approve -> evidence -> verify (four-eyes) lifecycle.
 */
import { adjustObligation, adjustReceivable, AdjustmentError, AdjustmentResult } from './adjustment-operations.service';
import {
  approveObligationPayment,
  cancelObligationApproval,
  submitObligationEvidence,
  verifyObligationPayment,
  PAYMENT_SOURCES,
} from './obligation-payment-lifecycle.service';

/** Database name of a Postgres URL ("" when missing/unparsable). Same rule as the test-db guard: judge the NAME, not the whole URL. */
export function databaseNameOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ''));
  } catch {
    return '';
  }
}
const isTestDatabaseUrl = (url: string | undefined) => /_test$/.test(databaseNameOf(url));

export const OPERATIONS = [
  'receivable-suspend',
  'receivable-resume',
  'receivable-waive',
  'obligation-resolve',
  'obligation-resolve-other',
  'obligation-waive',
  'obligation-review',
  'obligation-release-review',
  'obligation-approve-payment',
  'obligation-submit-evidence',
  'obligation-verify-payment',
  'obligation-cancel-approval',
] as const;
export type Operation = (typeof OPERATIONS)[number];

/** Operations that move an obligation through the verified manual-payment lifecycle. */
const LIFECYCLE_OPS = new Set<Operation>([
  'obligation-approve-payment',
  'obligation-submit-evidence',
  'obligation-verify-payment',
  'obligation-cancel-approval',
]);

export interface CliOptions {
  op: Operation;
  id: string;
  apply: boolean;
  ownerApprovalGroup: string | null;
  expectedAmount: string;
  expectedTransactionId: string;
  amount: string | null;
  reason: string;
  approvedBy: string;
  approvalRef: string;
  /** obligation-approve-payment. */
  approvedAmount: string | null;
  paymentSource: string | null;
  /** obligation-submit-evidence. */
  transferRef: string | null;
  paidAmount: string | null;
  paidOn: string | null;
  evidenceRef: string | null;
  evidenceHash: string | null;
  bankStatementId: string | null;
  recordedBy: string | null;
  /** obligation-verify-payment: who verifies, and what they read on the real bank record. */
  verifiedBy: string | null;
  observedAmount: string | null;
  observedTransferRef: string | null;
  /** obligation-cancel-approval. */
  cancelledBy: string | null;
}

export const USAGE = `FH-8 adjustment tool (dry-run unless --apply)

  --op=receivable-suspend|receivable-resume|receivable-waive|obligation-review|obligation-release-review|obligation-waive|obligation-resolve-other|
       obligation-approve-payment|obligation-submit-evidence|obligation-verify-payment|obligation-cancel-approval|obligation-resolve(legacy)
  --id=<receivable or obligation id>
  --expected-amount=<amount you approved>        (receivable: amount; obligation: unpaid)
  --expected-transaction-id=<payment txn id | NONE>
  --amount=<amount to waive>                      (receivable-waive only)
  --reason="<why>"  (obligation: the note; say how it was handled)
  --approved-by=<who>  --approval-ref=<approval/minute number>
  --apply                                          write (default is dry-run)
  --i-have-owner-approval=<group>                  required for any database whose name does not end with _test

Obligation payment lifecycle (an obligation is money the ledger owes a CLIENT and could not pay out of the contract's own money).
This tool NEVER moves money: no wallet credit, no ledger row, no PT debt. There is no automatic payout, no goodwill fund, no use of
platform revenue. An obligation counts as PAID only after VERIFIED evidence, by a different person than the one who recorded it.
  1 obligation-approve-payment   OPEN/UNDER_REVIEW -> APPROVED_FOR_PAYMENT. --approved-amount=<exact amount <= unpaid>
                                 --payment-source=${PAYMENT_SOURCES.join('|')}  --approved-by=<authorised approver>  --approval-ref=<unique, never reusable>
                                 The recipient is taken from the ledger (the client who paid the contract). On a database not named *_test the
                                 approver must be listed in env FH8_PAYOUT_APPROVERS (comma separated); when that env is set it is always enforced.
  2 obligation-submit-evidence   APPROVED_FOR_PAYMENT -> AWAITING_EVIDENCE, after the payment was made OUTSIDE the system.
                                 --approval-ref=<of step 1> --paid-amount --transfer-ref --paid-on=YYYY-MM-DD --recorded-by=<who typed it>
                                 and at least one proof pointer: --evidence-ref=<file reference> | --evidence-hash=<sha256> | --bank-statement-id=<id>
                                 (a transfer reference alone is not proof).
  3 obligation-verify-payment    AWAITING_EVIDENCE -> PAID_VERIFIED (unpaid 0) or back to OPEN with a smaller unpaid (partial).
                                 --approval-ref=<of step 1> --verified-by=<MUST differ from --recorded-by> --observed-amount --observed-transfer-ref
                                 (typed from the real bank record; must equal the approved and recorded figures; the date may not be in the future).
  obligation-cancel-approval     APPROVED_FOR_PAYMENT/AWAITING_EVIDENCE -> OPEN. --approval-ref=<of step 1> --cancelled-by --reason (mandatory). The reference stays burned.
Other operations:
  obligation-review          OPEN -> UNDER_REVIEW (someone is looking at it).   obligation-release-review: back to OPEN.
  obligation-waive           WAIVED = the owner decided the obligation is not pursued. The client is NOT paid.
  obligation-resolve-other   RESOLVED_OTHER = settled by another method; --reason (at least 10 characters) says how. Not "paid".
  obligation-resolve         LEGACY: RESOLVED = "handled elsewhere" (kept for old callers); prefer obligation-resolve-other.
  obligation-pay-external    REMOVED: it recorded a typed-in reference as paid. Use the lifecycle above.
A row with a payment in flight cannot be waived or resolved until the payment is verified or cancelled.
Every operation leaves the obligation, its owed/paid/unpaid figures and an append-only audit event on record; nothing is deleted.

DATABASE_URL selects the database. Real data needs the owner's approval per group.`;

export function parseArgs(argv: string[]): CliOptions {
  const flags = new Map<string, string>();
  for (const a of argv) {
    if (!a.startsWith('--')) throw new AdjustmentError('USAGE', `Unexpected argument: ${a}`);
    const eq = a.indexOf('=');
    if (eq === -1) flags.set(a.slice(2), 'true');
    else flags.set(a.slice(2, eq), a.slice(eq + 1));
  }
  const need = (name: string): string => {
    const v = flags.get(name);
    if (!v || v === 'true') throw new AdjustmentError('USAGE', `--${name} is required.`);
    return v;
  };
  const opt = (name: string): string | null => {
    const v = flags.get(name);
    return v && v !== 'true' ? v : null;
  };
  const op = need('op') as Operation;
  if ((op as string) === 'obligation-pay-external') {
    throw new AdjustmentError(
      'LEGACY_DISABLED',
      'obligation-pay-external was removed: a typed-in reference is not proof of payment. Use obligation-approve-payment, then obligation-submit-evidence, then obligation-verify-payment (by a different person).',
    );
  }
  if (!OPERATIONS.includes(op)) throw new AdjustmentError('USAGE', `Unknown --op=${op}.`);
  const allowed = new Set([
    'op', 'id', 'apply', 'i-have-owner-approval', 'expected-amount', 'expected-transaction-id', 'amount', 'reason', 'approved-by', 'approval-ref',
    'approved-amount', 'payment-source', 'transfer-ref', 'paid-amount', 'paid-on', 'evidence-ref', 'evidence-hash', 'bank-statement-id', 'recorded-by',
    'verified-by', 'observed-amount', 'observed-transfer-ref', 'cancelled-by',
  ]);
  for (const k of flags.keys()) if (!allowed.has(k)) throw new AdjustmentError('USAGE', `Unknown flag --${k}.`);
  const group = flags.get('i-have-owner-approval');
  const approve = op === 'obligation-approve-payment';
  const submit = op === 'obligation-submit-evidence';
  const verify = op === 'obligation-verify-payment';
  const cancel = op === 'obligation-cancel-approval';
  return {
    op,
    id: need('id'),
    apply: flags.get('apply') === 'true',
    ownerApprovalGroup: group && group !== 'true' ? group : null,
    expectedAmount: need('expected-amount'),
    expectedTransactionId: need('expected-transaction-id'),
    amount: op === 'receivable-waive' ? need('amount') : null,
    reason: need('reason'),
    // the person acting: --approved-by, except where the step has its own role flag (recorded / verified / cancelled by)
    approvedBy: submit || verify || cancel ? (opt('approved-by') ?? '') : need('approved-by'),
    approvalRef: need('approval-ref'),
    approvedAmount: approve ? need('approved-amount') : null,
    paymentSource: approve ? need('payment-source') : null,
    transferRef: submit ? need('transfer-ref') : null,
    paidAmount: submit ? need('paid-amount') : null,
    paidOn: submit ? need('paid-on') : null,
    evidenceRef: submit ? opt('evidence-ref') : null,
    evidenceHash: submit ? opt('evidence-hash') : null,
    bankStatementId: submit ? opt('bank-statement-id') : null,
    recordedBy: submit ? need('recorded-by') : null,
    verifiedBy: verify ? need('verified-by') : null,
    observedAmount: verify ? need('observed-amount') : null,
    observedTransferRef: verify ? need('observed-transfer-ref') : null,
    cancelledBy: cancel ? need('cancelled-by') : null,
  };
}

/** Throws unless the target database is a `_test` database or the operator passed the owner-approval flag. */
export function assertDatabaseAllowed(databaseUrl: string | undefined, ownerApprovalGroup: string | null): void {
  if (!databaseUrl) throw new AdjustmentError('NO_DATABASE', 'DATABASE_URL is not set.');
  if (isTestDatabaseUrl(databaseUrl)) return;
  if (ownerApprovalGroup && /^[A-Za-z0-9_-]{1,32}$/.test(ownerApprovalGroup)) return;
  throw new AdjustmentError(
    'REFUSED_NON_TEST_DATABASE',
    `Refusing to run against database "${databaseNameOf(databaseUrl) || '<unparsable>'}": its name does not end with _test. ` +
      'Real data needs the owner\'s approval per group; pass --i-have-owner-approval=<group> only when you hold it.',
  );
}

export async function runCli(argv: string[], env: NodeJS.ProcessEnv, log: (line: string) => void): Promise<number> {
  let opts: CliOptions;
  try {
    opts = parseArgs(argv);
    assertDatabaseAllowed(env.DATABASE_URL, opts.ownerApprovalGroup);
  } catch (e) {
    if (e instanceof AdjustmentError) {
      log(`REFUSED [${e.code}] ${e.message}`);
      if (e.code === 'USAGE') log(USAGE);
      return 2;
    }
    throw e;
  }

  const dryRun = !opts.apply;
  log(`${dryRun ? 'DRY-RUN' : 'APPLY'} ${opts.op} id=${opts.id} database=${databaseNameOf(env.DATABASE_URL)}`);
  try {
    let result: AdjustmentResult;
    if (opts.op.startsWith('receivable-')) {
      result = await adjustReceivable({
        receivableId: opts.id,
        expectedAmount: opts.expectedAmount,
        expectedTransactionId: opts.expectedTransactionId,
        action: opts.op === 'receivable-suspend' ? 'SUSPEND' : opts.op === 'receivable-resume' ? 'RESUME' : 'WAIVE',
        waiveAmount: opts.amount ?? undefined,
        reason: opts.reason,
        approvedBy: opts.approvedBy,
        approvalRef: opts.approvalRef,
        dryRun,
      });
    } else if (LIFECYCLE_OPS.has(opts.op)) {
      const cas = { obligationId: opts.id, expectedUnpaid: opts.expectedAmount, expectedTransactionId: opts.expectedTransactionId };
      if (opts.op === 'obligation-approve-payment') {
        const listed = (env.FH8_PAYOUT_APPROVERS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
        if (listed.length === 0 && !isTestDatabaseUrl(env.DATABASE_URL)) {
          throw new AdjustmentError(
            'NO_APPROVER_LIST',
            'Set FH8_PAYOUT_APPROVERS (comma separated authorised approvers) before approving a payment on a non-test database.',
          );
        }
        result = await approveObligationPayment({
          ...cas,
          approvedAmount: opts.approvedAmount as string,
          paymentSource: opts.paymentSource as string,
          approvedBy: opts.approvedBy,
          approvalRef: opts.approvalRef,
          note: opts.reason,
          authorisedApprovers: listed.length ? listed : undefined,
          dryRun,
        });
      } else if (opts.op === 'obligation-submit-evidence') {
        result = await submitObligationEvidence({
          ...cas,
          approvalRef: opts.approvalRef,
          paidAmount: opts.paidAmount as string,
          transferReference: opts.transferRef as string,
          paidOn: opts.paidOn as string,
          evidenceRef: opts.evidenceRef ?? undefined,
          evidenceHash: opts.evidenceHash ?? undefined,
          bankStatementId: opts.bankStatementId ?? undefined,
          recordedBy: opts.recordedBy as string,
          note: opts.reason,
          dryRun,
        });
      } else if (opts.op === 'obligation-verify-payment') {
        result = await verifyObligationPayment({
          ...cas,
          approvalRef: opts.approvalRef,
          verifiedBy: opts.verifiedBy as string,
          observedAmount: opts.observedAmount as string,
          observedTransferReference: opts.observedTransferRef as string,
          note: opts.reason,
          dryRun,
        });
      } else {
        result = await cancelObligationApproval({
          ...cas,
          approvalRef: opts.approvalRef,
          cancelledBy: opts.cancelledBy as string,
          reason: opts.reason,
          dryRun,
        });
      }
    } else {
      result = await adjustObligation({
        obligationId: opts.id,
        expectedUnpaid: opts.expectedAmount,
        expectedTransactionId: opts.expectedTransactionId,
        action:
          opts.op === 'obligation-resolve'
            ? 'RESOLVE'
            : opts.op === 'obligation-resolve-other'
              ? 'RESOLVE_OTHER'
              : opts.op === 'obligation-review'
                ? 'REVIEW'
                : opts.op === 'obligation-release-review'
                  ? 'RELEASE_REVIEW'
                  : 'WAIVE',
        note: opts.reason,
        actor: opts.approvedBy,
        approvalRef: opts.approvalRef,
        dryRun,
      });
    }
    log(`${result.outcome} key=${result.key}`);
    log(`before: ${JSON.stringify(result.before)}`);
    log(`after:  ${JSON.stringify(result.after)}`);
    if (result.eventId) log(`event: ${result.eventId}`);
    if (dryRun) log('Nothing was written. Re-run with --apply to write.');
    return 0;
  } catch (e) {
    if (e instanceof AdjustmentError) {
      log(`REFUSED [${e.code}] ${e.message}`);
      return 1;
    }
    throw e;
  }
}
