import dotenv from "dotenv";
dotenv.config();

import {
  closeKnowledgePipelineQueue,
  removeKnowledgeRefreshSchedules,
  scheduleKnowledgeRefreshes,
} from "../knowledge-pipeline/queue";

async function main(): Promise<void> {
  if (process.argv.includes("--clear")) {
    const removed = await removeKnowledgeRefreshSchedules();
    console.log(JSON.stringify({ cleared: true, removed }, null, 2));
    return;
  }

  const jobs = await scheduleKnowledgeRefreshes();
  console.log(
    JSON.stringify(
      {
        scheduled: true,
        localCron: process.env.KNOWLEDGE_LOCAL_CRON || "0 2 * * *",
        pubMedCron: process.env.KNOWLEDGE_PUBMED_CRON || "30 2 * * *",
        jobs,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeKnowledgePipelineQueue();
  });
