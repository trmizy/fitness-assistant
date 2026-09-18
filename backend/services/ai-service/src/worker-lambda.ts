/**
 * AWS Lambda worker entrypoint — SQS-triggered consumer for the "ai-tasks"
 * queue (workout-plan / nutrition-plan generation). This is the Lambda-native
 * replacement for ai.worker.ts's BullMQ Worker (which needs a long-lived
 * Redis connection unsuited to Lambda's execution model — see the AWS
 * deployment audit, section 7).
 *
 * Producer side: src/workers/queue-provider.ts's enqueueAiTask() publishes
 * `{name, data}` JSON messages to AI_TASKS_QUEUE_URL when QUEUE_PROVIDER=sqs.
 * This handler is the consumer of exactly those messages — same envelope,
 * same job-processing functions (processAiTaskJob / processNutritionPlanJob)
 * as the BullMQ path, unchanged. Only `.name`, `.data`, `.id`, and
 * `.attemptsMade` are read from the job-shaped object those functions
 * receive (verified before extracting processAiTaskJob out of ai.worker.ts),
 * so the plain shim object built per SQS record below is a safe substitute
 * for a real BullMQ Job.
 *
 * Handler: dist/worker-lambda.handler
 * Trigger: SQS, recommended batch size 1 (plan generation is CPU/LLM-bound
 * and can run 45-120s per the timeout estimates in ai.worker.ts's
 * estimatePlanTimeoutMs — processing more than one per invocation risks
 * starving the batch's overall Lambda timeout). Enable
 * "Report batch item failures" (functionResponseTypes:
 * ReportBatchItemFailures) on the event source mapping so one bad message
 * doesn't force SQS to redeliver the whole batch — this handler already
 * returns `batchItemFailures` for exactly that reason.
 *
 * Lambda function timeout recommendation: >= 130s (planTimeoutMs's own
 * ceiling of 120000ms, plus headroom for the surrounding fetch/DB calls) —
 * see estimatePlanTimeoutMs / estimatePlanRetryTimeoutMs in ai.worker.ts and
 * nutrition.processor.ts's fixed 180000ms LLM timeout, whichever job type
 * this queue carries.
 */
import type { Job } from "bullmq";
import type { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from "aws-lambda";
import { logger } from "@gym-coach/shared";
import { ensureDatabaseUrlConfigured } from "./config/lambda-runtime";

interface QueueMessage {
  name: "generate-plan" | "generate-nutrition-plan";
  data: unknown;
}

function buildJobShim(
  messageId: string,
  approximateReceiveCount: string | undefined,
  message: QueueMessage,
): Job {
  const attemptsMade = Math.max(0, Number(approximateReceiveCount ?? "1") - 1);
  return {
    id: messageId,
    name: message.name,
    data: message.data,
    attemptsMade,
  } as unknown as Job;
}

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchItemFailure[] = [];

  // Resolved before the processor modules are imported — they pull in Prisma,
  // which needs DATABASE_URL present at construction time (see lambda.ts).
  await ensureDatabaseUrlConfigured();
  const { processAiTaskJob } = await import("./workers/ai.worker");

  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body) as QueueMessage;
      const job = buildJobShim(
        record.messageId,
        record.attributes?.ApproximateReceiveCount,
        message,
      );

      if (message.name === "generate-nutrition-plan") {
        const { processNutritionPlanJob } = await import(
          "./services/nutrition.processor"
        );
        await processNutritionPlanJob(job);
      } else {
        await processAiTaskJob(job);
      }
    } catch (err) {
      logger.error(
        { err, messageId: record.messageId },
        "ai-tasks SQS record failed — reporting as batch item failure for redelivery",
      );
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
