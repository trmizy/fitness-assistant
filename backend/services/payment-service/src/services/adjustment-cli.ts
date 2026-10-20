/**
 * FH-8 - command-line front end for adjustment-operations.service.ts (entry point: scripts/fh8-adjust.ts).
 *
 * Safety rules enforced here, before any query runs:
 *  1. DRY-RUN IS THE DEFAULT. Nothing is written unless `--apply` is given.
 *  2. The target database name must end with `_test`. Any other database (dev, staging, production) is REFUSED unless
 *     `--i-have-owner-approval=<group>` is passed. Real data needs the owner's approval per group (A: negative
 *     sub-ledgers, B: stuck client money, C: partner debt, D: over-refund, F: SETTLED without counterpart); the flag does
 *     not grant approval, it records that the operator holds it. The approval reference is stored on every event.
 *  3. There is no HTTP route for these writes.
 */
import { adjustObligation, adjustReceivable, AdjustmentError, AdjustmentResult } from './adjustment-operations.service';

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
  'obligation-waive',
] as const;
export type Operation = (typeof OPERATIONS)[number];

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
}

export const USAGE = `FH-8 adjustment tool (dry-run unless --apply)

  --op=receivable-suspend|receivable-resume|receivable-waive|obligation-resolve|obligation-waive
  --id=<receivable or obligation id>
  --expected-amount=<amount you approved>        (receivable: amount; obligation: unpaid)
  --expected-transaction-id=<payment txn id | NONE>
  --amount=<amount to waive>                      (receivable-waive only)
  --reason="<why>"  (obligation: the note; say how it was handled)
  --approved-by=<who>  --approval-ref=<approval/minute number>
  --apply                                          write (default is dry-run)
  --i-have-owner-approval=<group>                  required for any database whose name does not end with _test

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
  const op = need('op') as Operation;
  if (!OPERATIONS.includes(op)) throw new AdjustmentError('USAGE', `Unknown --op=${op}.`);
  const allowed = new Set(['op', 'id', 'apply', 'i-have-owner-approval', 'expected-amount', 'expected-transaction-id', 'amount', 'reason', 'approved-by', 'approval-ref']);
  for (const k of flags.keys()) if (!allowed.has(k)) throw new AdjustmentError('USAGE', `Unknown flag --${k}.`);
  const group = flags.get('i-have-owner-approval');
  return {
    op,
    id: need('id'),
    apply: flags.get('apply') === 'true',
    ownerApprovalGroup: group && group !== 'true' ? group : null,
    expectedAmount: need('expected-amount'),
    expectedTransactionId: need('expected-transaction-id'),
    amount: op === 'receivable-waive' ? need('amount') : null,
    reason: need('reason'),
    approvedBy: need('approved-by'),
    approvalRef: need('approval-ref'),
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
    } else {
      result = await adjustObligation({
        obligationId: opts.id,
        expectedUnpaid: opts.expectedAmount,
        expectedTransactionId: opts.expectedTransactionId,
        action: opts.op === 'obligation-resolve' ? 'RESOLVE' : 'WAIVE',
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
