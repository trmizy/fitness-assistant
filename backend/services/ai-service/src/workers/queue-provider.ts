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
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
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
    const result = await getSqsClient().send(
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
