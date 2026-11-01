/** Child-process crash/concurrency probe. Always FAKE; never imports a live runner. */
import fs from "node:fs";
import path from "node:path";
import { openBudgetLedger } from "../../evaluation/bedrock-pilot/ledger";
import { openEvaluationSession } from "../../evaluation/bedrock-pilot/session";
import { pilotPrompt, pilotTransport } from "./pilot";
async function main() {
  const [mode, argsFile] = process.argv.slice(2), a = JSON.parse(fs.readFileSync(argsFile, "utf8"));
  if (mode === "concurrent") {
    try { const l = openBudgetLedger(a.ledger); process.stdout.write("ACQUIRED\n"); await new Promise((r) => setTimeout(r, 400)); l.close(); }
    catch { process.exitCode = 23; } return;
  }
  const fake = pilotTransport();
  if (mode === "crash-before-response") fake.invoke = async () => { process.exit(73); };
  if (mode === "crash-before-raw" || mode === "crash-after-raw") {
    const original = fs.writeFileSync;
    fs.writeFileSync = ((...args: Parameters<typeof fs.writeFileSync>) => {
      if (typeof args[1] === "string" && args[1].includes('"event":"RAW_RESPONSE"')) {
        if (mode === "crash-after-raw") { original(...args); fs.fsyncSync(args[0] as number); }
        process.exit(74);
      }
      return original(...args);
    }) as typeof fs.writeFileSync;
  }
  const session = openEvaluationSession(a.config, path.join(a.root, "run"), fake, { fixtureLedgerDirectory: path.join(a.root, "ledger"), fixtureApprovalId: "fixture-shared" });
  await session.evaluate(pilotPrompt, "row-0"); await session.close();
}
main().catch(() => { process.exitCode = 24; });
