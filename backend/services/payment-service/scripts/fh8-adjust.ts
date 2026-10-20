/**
 * FH-8 adjustment CLI (dry-run by default). See src/services/adjustment-cli.ts for the rules and flags.
 *
 *   DATABASE_URL=... npx tsx scripts/fh8-adjust.ts --op=receivable-suspend --id=<id> \
 *     --expected-amount=70000.00 --expected-transaction-id=<txn> --reason="..." --approved-by=<name> --approval-ref=<no>
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
