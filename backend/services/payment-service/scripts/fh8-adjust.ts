/**
 * FH-8 adjustment CLI (dry-run by default). See src/services/adjustment-cli.ts for the rules and flags.
 *
 *   DATABASE_URL=... npx tsx scripts/fh8-adjust.ts --op=receivable-suspend --id=<id> \
 *     --expected-amount=70000.00 --expected-transaction-id=<txn> --reason="..." --approved-by=<name> --approval-ref=<no>
 *   obligation lifecycle (NO money moves; no wallet credit, no PT debt; "paid" only after VERIFIED evidence, four-eyes):
 *     --op=obligation-review | obligation-release-review | obligation-waive | obligation-resolve-other (reason mandatory)
 *     --op=obligation-approve-payment --approved-amount=<n> --payment-source=MANUAL_BANK_TRANSFER   (FH8_PAYOUT_APPROVERS env on real data)
 *     --op=obligation-submit-evidence --transfer-ref=<ref> --paid-amount=<n> --paid-on=YYYY-MM-DD --recorded-by=<who> \
 *         (--evidence-ref=<file> | --evidence-hash=<sha256> | --bank-statement-id=<id>)
 *     --op=obligation-verify-payment --verified-by=<someone else> --observed-amount=<n> --observed-transfer-ref=<ref>
 *     --op=obligation-cancel-approval --cancelled-by=<who> --reason="..."
 *   add --apply to write; add --i-have-owner-approval=<group> for any database not named *_test.
 */
import { runCli } from '../src/services/adjustment-cli';

runCli(process.argv.slice(2), process.env, (l) => console.log(l))
  .then(async (code) => {
    const { prisma } = await import('../src/repositories/prisma');
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch((e) => {
    console.error('FATAL', (e as Error).message);
    process.exit(3);
  });
