/**
 * AWS Lambda scheduled-jobs entrypoint — one Lambda function, invoked by
 * separate Amazon EventBridge Scheduler / EventBridge Rule cron schedules,
 * each passing a different fixed JSON input (`{"job": "<name>"}`) to select
 * which job runs. This replaces two mechanisms that don't work on Lambda's
 * execution model (no long-lived process):
 *
 *   1. server.ts's `setInterval(...)` personalized-service auto-accept sweep
 *      (personalized-service-autoaccept-sweep.service.ts) — runAutoAcceptSweep()
 *      is already a plain, standalone async function with no setInterval
 *      dependency of its own, so it is called here unchanged.
 *   2. knowledge-pipeline/queue.ts's BullMQ *repeatable* jobs
 *      (scheduleKnowledgeRefreshes()) — those still require a running BullMQ
 *      Worker (knowledge-pipeline/worker.ts, started by
 *      scripts/startKnowledgePipelineWorker.ts) to ever execute, which is a
 *      long-lived Redis consumer, same problem as ai.worker.ts. The
 *      individual pipeline runners themselves
 *      (runLocalEvidencePipeline/runPubMedPipeline/runRssPipeline/
 *      runWebPipeline, from knowledge-pipeline/service.ts) are plain
 *      functions with no BullMQ dependency — already proven by
 *      internal.routes.ts's synchronous (non-"/async") admin endpoints,
 *      which call them directly — so they are called here directly too,
 *      bypassing BullMQ/Redis entirely for the AWS-scheduled path.
 *
 * Handler: dist/jobs-lambda.handler
 *
 * Recommended EventBridge schedules (cadences taken from this repo's own
 * defaults in knowledge-pipeline/queue.ts's scheduleKnowledgeRefreshes(),
 * NOT invented — see the AWS deployment audit, section 16):
 *   {"job":"local-evidence-refresh"}  cron(0 2 * * ? *)   — KNOWLEDGE_LOCAL_CRON default "0 2 * * *"
 *   {"job":"pubmed-refresh"}          cron(30 2 * * ? *)  — KNOWLEDGE_PUBMED_CRON default "30 2 * * *"
 *   {"job":"rss-refresh"}             cron(0 3 * * ? *)   — KNOWLEDGE_RSS_CRON default "0 3 * * *"
 *   {"job":"web-refresh"}             cron(30 3 * * ? *)  — KNOWLEDGE_WEB_CRON default "30 3 * * *"
 *   {"job":"personalized-service-autoaccept-sweep"} rate(15 minutes) —
 *     PERSONALIZED_SERVICE_AUTOACCEPT_INTERVAL_MS default 900000ms (15 min)
 *
 * Each of these can run well past API Gateway's 30s ceiling (RSS/web/PubMed
 * crawling and embedding are I/O- and LLM-heavy) — that is fine here because
 * this Lambda is invoked directly by EventBridge, never through API Gateway;
 * size its own Lambda timeout generously (recommend 5-10 minutes) instead.
 */
import { logger } from "@gym-coach/shared";
import { ensureDatabaseUrlConfigured } from "./config/lambda-runtime";

export type JobsLambdaEvent = {
  job:
    | "local-evidence-refresh"
    | "pubmed-refresh"
    | "rss-refresh"
    | "web-refresh"
    | "personalized-service-autoaccept-sweep";
  // Passed straight through to the pipeline function for local-evidence/rss —
  // lets one EventBridge rule override defaults without a code change.
  limit?: number;
  sourceId?: string;
  force?: boolean;
};

export const handler = async (event: JobsLambdaEvent): Promise<unknown> => {
  logger.info({ job: event.job }, "jobs-lambda invocation started");

  // Same lazy-import ordering as lambda.ts / worker-lambda.ts: both the
  // knowledge pipeline and the auto-accept sweep reach Prisma, so
  // DATABASE_URL must be resolved before those modules load.
  await ensureDatabaseUrlConfigured();
  const {
    runLocalEvidencePipeline,
    runPubMedPipeline,
    runRssPipeline,
    runWebPipeline,
  } = await import("./knowledge-pipeline/service");
  const { runAutoAcceptSweep } = await import(
    "./services/personalized-service-autoaccept-sweep.service"
  );

  switch (event.job) {
    case "local-evidence-refresh":
      return runLocalEvidencePipeline({
        limit: event.limit,
        force: event.force ?? false,
        embed: true,
      });
    case "pubmed-refresh":
      return runPubMedPipeline({
        limit: event.limit ?? Number.parseInt(process.env.KNOWLEDGE_PUBMED_LIMIT || "10", 10),
        force: event.force ?? false,
        embed: true,
      });
    case "rss-refresh":
      return runRssPipeline({
        sourceId: event.sourceId ?? process.env.KNOWLEDGE_RSS_SOURCE_ID,
        limit: event.limit ?? Number.parseInt(process.env.KNOWLEDGE_RSS_LIMIT || "10", 10),
        force: event.force ?? false,
        embed: true,
      });
    case "web-refresh":
      return runWebPipeline({
        sourceId: event.sourceId ?? process.env.KNOWLEDGE_WEB_SOURCE_ID,
        force: event.force ?? false,
        embed: true,
      });
    case "personalized-service-autoaccept-sweep":
      return runAutoAcceptSweep();
    default:
      throw new Error(`jobs-lambda: unknown job "${(event as { job?: string }).job}"`);
  }
};
