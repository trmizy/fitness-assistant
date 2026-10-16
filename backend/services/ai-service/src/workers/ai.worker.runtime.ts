/**
 * The actual BullMQ Worker instance for the "ai-tasks" queue — container/local deployment only
 * (imported by server.ts, the Express entry point for docker-compose.dev.yml and
 * docker-compose.prod.yml's single-EC2 MVP).
 *
 * Deliberately kept OUT of ./ai.worker.ts, which only exports the pure `processAiTaskJob`
 * function this Worker delegates to. Reason (AWS DEV live bug found 2026-09-30, BUG-A2 in the
 * AI Workers E2E report): worker-lambda.ts dynamically imports `processAiTaskJob` from
 * ai.worker.ts on the AI Worker Lambda's SQS-triggered path. Any import of a module — static or
 * dynamic — runs its top-level code, so a `new Worker(...)` living in ai.worker.ts opened a real
 * ioredis connection attempt (to REDIS_HOST, default "localhost") on the very first SQS message
 * that Lambda ever processed, even though the AWS deployment sets QUEUE_PROVIDER=sqs and never
 * uses BullMQ at all. Splitting the Worker instantiation into this separate file — never
 * imported by worker-lambda.ts — means importing the processor in Lambda can no longer trigger
 * it.
 */
import { Worker } from "bullmq";
import { logger } from "@gym-coach/shared";
import { processAiTaskJob } from "./ai.worker";
import { redisConnection } from "./ai.queue";

export const aiWorker = new Worker("ai-tasks", processAiTaskJob, {
  connection: redisConnection,
  // Retry up to 2 times on transient LLM failures (network, timeout).
  // Validation failures are NOT re-thrown, so they won't consume retries.
});

aiWorker.on("failed", (job, err) => {
  logger.error(
    { jobId: job?.id, err },
    "AI worker job failed after all retries",
  );
});
