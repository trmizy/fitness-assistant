/** No env flag can unlock LIVE. Fake is the only executable mode of this CLI. */
import fs from "node:fs";
import { runControlledPilot } from "./runner";
import { PilotError } from "./config";
async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--live")) throw new PilotError("CLI_LIVE_LOCKED");
  const resume = args.includes("--resume"), positional = args.filter((a) => a !== "--fake" && a !== "--resume");
  if (positional.length !== 2 || positional.some((a) => a.startsWith("--"))) throw new PilotError("USAGE_FAKE_CONFIG_JSON_RUN_DIRECTORY");
  const config = JSON.parse(fs.readFileSync(positional[0], "utf8"));
  const summary = await runControlledPilot({ config, directory: positional[1], resume, onPreview: (preview) => process.stdout.write(JSON.stringify({ preview }) + "\n") });
  process.stdout.write(JSON.stringify({ summary }) + "\n");
}
if (require.main === module) main().catch((e) => { process.stderr.write(JSON.stringify({ error: { code: e instanceof PilotError ? e.code : "PILOT_FAILED", details: e instanceof PilotError ? e.details : {} } }) + "\n"); process.exitCode = 1; });
