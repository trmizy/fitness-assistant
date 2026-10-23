/**
 * FH-9 - decide a reserve kept in a contract's HOLDBACK (owner decision). DRY-RUN BY DEFAULT.
 *
 *   list:    DATABASE_URL=... npx tsx scripts/fh9-holdback-review.ts --op=list
 *   decide:  DATABASE_URL=... npx tsx scripts/fh9-holdback-review.ts --op=decide --id=<reviewId> \
 *              --expected-reserve=90000.00 --expected-transaction-id=<txn> --decision=VERIFIED|NOT_VERIFIED [--verified-amount=30000] \
 *              --note="what was checked" --actor=<who decides> --approved-by=<a different person> --approval-ref=<no> [--apply]
 *
 * Rules (see src/services/holdback-review.service.ts): nothing is written without --apply; a database not named *_test is refused unless
 * --i-have-owner-approval=<group> is passed; the decider and the approver must differ; the money only moves inside the review's own contract.
 */
import { databaseNameOf } from '../src/services/adjustment-cli';
import { decideHoldbackReview, listOpenHoldbackReviews } from '../src/services/holdback-review.service';
import { AdjustmentError } from '../src/services/adjustment-operations.service';

function flags(argv: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of argv) {
    const x = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (x) m.set(x[1], x[2] ?? 'true');
  }
  return m;
}

async function main(): Promise<number> {
  const f = flags(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!/_test$/.test(databaseNameOf(url)) && !f.get('i-have-owner-approval')) {
    console.error('REFUSED: the database is not an isolated *_test one; pass --i-have-owner-approval=<group> only when you hold the owner approval.');
    return 2;
  }
  const op = f.get('op');
  if (op === 'list') {
    for (const r of await listOpenHoldbackReviews()) console.log(`${r.overdue ? 'OVERDUE ' : ''}${r.id} ${r.kind} reserve=${r.reserve} txn=${r.transactionId} reviewBy=${r.reviewBy} :: ${r.reason}`);
    return 0;
  }
  if (op !== 'decide') {
    console.error('usage: --op=list | --op=decide (see the header of this file)');
    return 2;
  }
  const need = (k: string) => {
    const v = f.get(k);
    if (!v) throw new AdjustmentError('INVALID_INPUT', `--${k} is required`);
    return v;
  };
  try {
    const r = await decideHoldbackReview({
      reviewId: need('id'),
      expectedReserve: need('expected-reserve'),
      expectedTransactionId: need('expected-transaction-id'),
      decision: need('decision') as 'VERIFIED' | 'NOT_VERIFIED',
      verifiedAmount: f.get('verified-amount'),
      note: need('note'),
      actor: need('actor'),
      approvedBy: need('approved-by'),
      approvalRef: need('approval-ref'),
      dryRun: !f.get('apply'),
    });
    console.log(JSON.stringify(r, null, 2));
    return 0;
  } catch (e) {
    if (e instanceof AdjustmentError) {
      console.error(`REFUSED ${e.code}: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

main()
  .then(async (code) => {
    const { prisma } = await import('../src/repositories/prisma');
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch((e) => {
    console.error('FATAL', (e as Error).message);
    process.exit(3);
  });
