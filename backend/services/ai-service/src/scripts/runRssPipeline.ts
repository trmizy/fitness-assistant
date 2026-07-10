import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../repositories/conversation.repository";
import { runRssPipeline } from "../knowledge-pipeline/service";

function readArgs() {
  const args = process.argv.slice(2);
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const sourceArg = args.find((arg) => arg.startsWith("--source="));
  const limit = limitArg
    ? Number.parseInt(limitArg.split("=")[1] ?? "", 10)
    : undefined;

  return {
    sourceId: sourceArg ? sourceArg.slice("--source=".length) : undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
    embed: !args.includes("--no-embed"),
    force: args.includes("--force"),
  };
}

async function main(): Promise<void> {
  const result = await runRssPipeline(readArgs());
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
