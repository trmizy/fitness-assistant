/** Repeated-run OS crash fixture. No live provider or credentials. */
import fs from "node:fs";
import { runControlledPilot } from "../../evaluation/bedrock-pilot/runner";
import { pilotTransport } from "./pilot";
const args = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
runControlledPilot({ config: args.config, directory: args.directory, transport: pilotTransport(), onStage(stage) { if (stage === "EVALUATED") process.exit(76); } }).catch(() => { process.exitCode = 77; });
