/**
 * Enqueues an "ai-tasks" job (workout-plan / nutrition-plan generation) onto
 * whichever backend this deployment actually runs:
 *
 *   - Default (container/local, docker-compose.dev.yml, docker-compose.prod.yml's
 *     single-EC2 MVP): BullMQ over Redis, unchanged from before this file
 *     existed — `aiQueue` already required REDIS_HOST/REDIS_PORT to be
 *     reachable, and still does.
 *   - QUEUE_PROVIDER=sqs (AWS Lambda deployment — see the AWS deployment
 *     audit, section 7): publishes to the SQS queue named by
 *     AI_TASKS_QUEUE_URL instead. worker-lambda.ts is the consumer side —
 *     see its own header comment for the message shape this produces.
 *
 * This is an additive, backward-compatible seam: nothing changes for any
 * existing deployment unless QUEUE_PROVIDER=sqs is explicitly set, which no
 * current docker-compose/.env file sets.
 */
import {
  SQSClient,
  SendMessageCommand,
  GetQueueAttributesCommand,
} from "@aws-sdk/client-sqs";
import { aiQueue } from "./ai.queue";

export type AiTaskName = "generate-plan" | "generate-nutrition-plan";

export interface EnqueuedAiTask {
  /** BullMQ job id, or the SQS MessageId when QUEUE_PROVIDER=sqs. */
  id: string;
}

let sqsClient: SQSClient | undefined;
function getSqsClient(): SQSClient {
  if (!sqsClient) {
    // Region/credentials come from the Lambda execution environment — no
    // explicit config needed, matching every other AWS-SDK-v3 client used
    // this way in Lambda.
    sqsClient = new SQSClient({});
  }
  return sqsClient;
}

// Test seam, same pattern as `bedrockRuntimeDeps.send` in services/bedrock.client.ts — tests
// replace these with a recorder/stub instead of hitting real SQS or mocking the SDK module.
export const sqsDeps = {
  sendMessage: (command: SendMessageCommand) => getSqsClient().send(command),
  getQueueAttributes: (command: GetQueueAttributesCommand) =>
    getSqsClient().send(command),
};

// Test seam for the BullMQ stats path — lets tests exercise success/failure/timeout without
// ever touching the real `aiQueue` (which lazily opens a Redis connection on first use).
export const bullmqStatsDeps = {
  getStats: async (): Promise<AiQueueStats> => {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      aiQueue.getWaitingCount(),
      aiQueue.getActiveCount(),
      aiQueue.getCompletedCount(),
      aiQueue.getFailedCount(),
      aiQueue.getDelayedCount(),
    ]);
    return { waiting, active, completed, failed, delayed };
  },
};

export async function enqueueAiTask(
  name: AiTaskName,
  data: Record<string, unknown>,
): Promise<EnqueuedAiTask> {
  if (process.env.QUEUE_PROVIDER === "sqs") {
    const queueUrl = process.env.AI_TASKS_QUEUE_URL;
    if (!queueUrl) {
      throw new Error(
        "QUEUE_PROVIDER=sqs but AI_TASKS_QUEUE_URL is not set — cannot enqueue ai-tasks job",
      );
    }
    // Message shape mirrors exactly what BullMQ's `aiQueue.add(name, data)`
    // already carried (job.name + job.data) — worker-lambda.ts and
    // processAiTaskJob/processNutritionPlanJob read `.name`/`.data`
    // identically regardless of which queue backend produced the job.
    const result = await sqsDeps.sendMessage(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ name, data }),
      }),
    );
    if (!result.MessageId) {
      throw new Error("SQS SendMessage succeeded but returned no MessageId");
    }
    return { id: result.MessageId };
  }

  const job = await aiQueue.add(name, data);
  return { id: job.id! };
}

export interface AiQueueStats {
  waiting: number | null;
  active: number | null;
  completed: number | null;
  failed: number | null;
  delayed: number | null;
}

const EMPTY_STATS: AiQueueStats = {
  waiting: null,
  active: null,
  completed: null,
  failed: null,
  delayed: null,
};

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/**
 * Admin dashboard queue counts (GET /admin/ai/overview, /admin/ai/queue).
 *
 * BUG (found live on AWS DEV, 2026-09-30): the old call site read these 5 counts directly off
 * `aiQueue` (BullMQ) unconditionally, even when QUEUE_PROVIDER=sqs. `aiQueue` lazily connects to
 * Redis (REDIS_HOST default "localhost") on first property access — there is no Redis reachable
 * from the AI HTTP Lambda in the AWS deployment, and ioredis's default retry strategy does not
 * reject quickly, so the connection attempt ran past the Lambda's 30s timeout on every call
 * instead of failing into the existing `.catch(() => null)`. Both endpoints returned 503 to the
 * client every time. Fix: never touch `aiQueue`/BullMQ at all when QUEUE_PROVIDER=sqs — read SQS's
 * own `GetQueueAttributes` instead — and bound whichever path runs with a hard 2s timeout so a
 * slow/unreachable stats source degrades to `null` counts instead of hanging the whole request.
 */
export async function getAiQueueStats(): Promise<AiQueueStats> {
  if (process.env.QUEUE_PROVIDER === "sqs") {
    const queueUrl = process.env.AI_TASKS_QUEUE_URL;
    if (!queueUrl) return EMPTY_STATS;

    return withTimeout(
      (async (): Promise<AiQueueStats> => {
        const result = await sqsDeps.getQueueAttributes(
          new GetQueueAttributesCommand({
            QueueUrl: queueUrl,
            AttributeNames: [
              "ApproximateNumberOfMessages",
              "ApproximateNumberOfMessagesNotVisible",
              "ApproximateNumberOfMessagesDelayed",
            ],
          }),
        );
        const attrs = result.Attributes || {};
        const num = (v: string | undefined) => (v != null ? Number(v) : null);
        return {
          waiting: num(attrs.ApproximateNumberOfMessages),
          active: num(attrs.ApproximateNumberOfMessagesNotVisible),
          delayed: num(attrs.ApproximateNumberOfMessagesDelayed),
          // SQS has no equivalent of BullMQ's completed/failed counts (a message is deleted on
          // success and moved to the DLQ after maxReceiveCount, not counted in place) — report
          // as explicitly unavailable rather than inventing a number.
          completed: null,
          failed: null,
        };
      })(),
      2000,
      EMPTY_STATS,
    );
  }

  return withTimeout(bullmqStatsDeps.getStats(), 2000, EMPTY_STATS);
}
