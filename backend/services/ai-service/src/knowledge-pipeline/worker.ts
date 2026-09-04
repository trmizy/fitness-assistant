import { Worker } from "bullmq";
import { logger } from "@gym-coach/shared";
import { redisConnection } from "../workers/ai.queue";
import { KNOWLEDGE_PIPELINE } from "./config";
import {
  runLocalEvidencePipeline,
  runPubMedPipeline,
  runRssPipeline,
  runWebPipeline,
} from "./service";
import type {
  LocalEvidencePipelineOptions,
  PubMedPipelineOptions,
  RssPipelineOptions,
  WebPipelineOptions,
} from "./types";

export function createKnowledgePipelineWorker() {
  const worker = new Worker<
    | LocalEvidencePipelineOptions
    | PubMedPipelineOptions
    | RssPipelineOptions
    | WebPipelineOptions
  >(
    KNOWLEDGE_PIPELINE.queueName,
    async (job) => {
      if (job.name === "local-evidence-refresh") {
        return runLocalEvidencePipeline(
          job.data as LocalEvidencePipelineOptions,
        );
      }
      if (job.name === "pubmed-refresh") {
        return runPubMedPipeline(job.data as PubMedPipelineOptions);
      }
      if (job.name === "rss-refresh") {
        return runRssPipeline(job.data as RssPipelineOptions);
      }
      if (job.name === "web-refresh") {
        return runWebPipeline(job.data as WebPipelineOptions);
      }
      throw new Error(`Unsupported knowledge pipeline job: ${job.name}`);
    },
    { connection: redisConnection, concurrency: 1 },
  );

  worker.on("completed", (job, result) => {
    logger.info({ jobId: job.id, result }, "Knowledge pipeline job completed");
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "Knowledge pipeline job failed");
  });

  return worker;
}
