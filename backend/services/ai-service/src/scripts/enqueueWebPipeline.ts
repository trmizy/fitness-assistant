import dotenv from 'dotenv';
dotenv.config();

import { closeKnowledgePipelineQueue, enqueueWebRefresh } from '../knowledge-pipeline/queue';

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
  const job = await enqueueWebRefresh(readArgs());
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
