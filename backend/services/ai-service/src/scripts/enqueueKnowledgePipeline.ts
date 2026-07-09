import dotenv from 'dotenv';
dotenv.config();

import { closeKnowledgePipelineQueue, enqueueLocalEvidenceRefresh } from '../knowledge-pipeline/queue';

function readArgs() {
  const args = process.argv.slice(2);
  const limitArg = args.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number.parseInt(limitArg.split('=')[1] ?? '', 10) : undefined;

  return {
    limit: Number.isFinite(limit) ? limit : undefined,
    embed: !args.includes('--no-embed'),
    force: args.includes('--force'),
  };
}

async function main(): Promise<void> {
  const job = await enqueueLocalEvidenceRefresh(readArgs());
  console.log(JSON.stringify({ queued: true, jobId: job.id, queue: job.queueName }, null, 2));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeKnowledgePipelineQueue();
  });
