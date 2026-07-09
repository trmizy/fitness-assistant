import dotenv from 'dotenv';
dotenv.config();

import { prisma } from '../repositories/conversation.repository';
import { runWebPipeline } from '../knowledge-pipeline/service';

function readArgs() {
  const args = process.argv.slice(2);
  const sourceArg = args.find((arg) => arg.startsWith('--source='));

  return {
    sourceId: sourceArg ? sourceArg.slice('--source='.length) : undefined,
    embed: !args.includes('--no-embed'),
    force: args.includes('--force'),
  };
}

async function main(): Promise<void> {
  const result = await runWebPipeline(readArgs());
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
