import dotenv from "dotenv";
import { llmService } from "../services/llm.service";

dotenv.config();

async function main(): Promise<void> {
  if (process.env.DISABLE_OLLAMA_WARMUP === "true") {
    console.log(JSON.stringify({ status: "SKIP", reason: "disabled" }));
    return;
  }

  const timeoutMs = Number(process.env.OLLAMA_WARMUP_TIMEOUT_MS || "15000");
  const health = await llmService.getHealthStatus(3000);
  if (!health.llmAvailable) {
    console.log(
      JSON.stringify(
        {
          status: "FAIL",
          reason: "ollama_unavailable",
          health,
          pullCommands: [
            `ollama pull ${health.model}`,
            `ollama pull ${health.embeddingModel}`,
          ],
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const startedAt = Date.now();
  const [llm, embedding] = await Promise.all([
    llmService.callLLM("Reply with OK.", {
      timeoutMs,
      temperature: 0,
      numPredict: 16,
    }),
    llmService.generateEmbedding("warmup", { timeoutMs }),
  ]);

  console.log(
    JSON.stringify(
      {
        status: "PASS",
        elapsedMs: Date.now() - startedAt,
        answerPreview: llm.answer.slice(0, 80),
        embeddingDimensions: embedding.length,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("FAIL ai:warmup");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
