import dotenv from "dotenv";
import { llmOrchestrator } from "../llm/orchestrator.service";

dotenv.config();

async function main(): Promise<void> {
  const question =
    process.argv.slice(2).join(" ").trim() ||
    "Phan tich InBody moi nhat cua toi";

  const result = await llmOrchestrator.run(
    question,
    undefined,
    undefined,
    undefined,
    (m) => console.error(`[status] ${m}`),
  );

  console.log(
    JSON.stringify(
      {
        traceId: result.traceId,
        routeIntent: result.routeIntent,
        usedFallback: result.usedFallback,
        fallbackReason: result.fallbackReason,
        timing: result.timing,
        answer: result.answer,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("FAIL ai:debug:chat");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
