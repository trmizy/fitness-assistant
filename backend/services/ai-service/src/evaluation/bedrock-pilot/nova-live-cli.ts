/**
 * The only LIVE entry point: the Nova Pro measured warmup. The owner-signed configuration is the sole authority —
 * there is no unlock flag or environment variable. Every gate (signed config + Nova scope, clean pinned checkout,
 * installed trust root + Ed25519 approval, scoped OWNER_SIGNED ledger) runs before credentials or any request.
 * Usage: nova-live-cli <signed-config.json> <new-run-directory> [--resume]
 */
import fs from "node:fs";
import { runControlledPilot } from "./runner";
import { parseConfiguration, PilotError } from "./config";
async function main() {
  const args = process.argv.slice(2), resume = args.includes("--resume"), positional = args.filter((a) => a !== "--resume");
  if (positional.length !== 2 || positional.some((a) => a.startsWith("--"))) throw new PilotError("USAGE_NOVA_LIVE_SIGNED_CONFIG_JSON_RUN_DIRECTORY");
  const value = JSON.parse(fs.readFileSync(positional[0], "utf8")), config = parseConfiguration(value);
  if (config.mode !== "LIVE" || config.transportProtocol !== "NOVA_CONVERSE_MEASURED") throw new PilotError("NOVA_LIVE_CLI_SCOPE");
  const summary = await runControlledPilot({ config: value, directory: positional[1], resume, onPreview: (preview) => process.stdout.write(JSON.stringify({ preview }) + "\n") });
  process.stdout.write(JSON.stringify({ summary }) + "\n");
}
if (require.main === module) main().catch((e) => { process.stderr.write(JSON.stringify({ error: { code: e instanceof PilotError ? e.code : "PILOT_FAILED", details: e instanceof PilotError ? e.details : {} } }) + "\n"); process.exitCode = 1; });
