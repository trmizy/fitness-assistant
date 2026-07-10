import dotenv from "dotenv";
import { EMBEDDING_MODEL, LLM_MODEL, llmService } from "../services/llm.service";

dotenv.config();

async function main(): Promise<void> {
  const health = await llmService.getHealthStatus(
    Number(process.env.OLLAMA_CHECK_TIMEOUT_MS || "3000"),
  );

  const pullCommands = [
    `ollama pull ${LLM_MODEL}`,
    `ollama pull ${EMBEDDING_MODEL}`,
  ];

  console.log(
    JSON.stringify(
      {
        status: health.llmAvailable ? "PASS" : "FAIL",
        health,
        pullCommands: health.llmAvailable ? [] : pullCommands,
      },
      null,
      2,
    ),
  );

  if (!health.llmAvailable) process.exitCode = 1;
}

main().catch((err) => {
  console.error("FAIL ai:check:ollama");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
