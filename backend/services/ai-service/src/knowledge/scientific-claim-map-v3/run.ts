import fs from "node:fs";
import { buildClaimMap } from "./builder";
import { loadConfiguredClaimRegistry, readConfiguredClaimInputs } from "./load";
const args = process.argv.slice(2);
if (args.length !== 3 || !["--build", "--validate"].includes(args[0]) || args[1] !== "--registry-config") throw new Error("DEV_OFFLINE_ONLY: --build|--validate --registry-config ABSOLUTE_LOCAL_CONFIG required");
if (args[0] === "--build") {
  const { config, bundle } = readConfiguredClaimInputs(args[2]);
  fs.writeFileSync(config.claimMapFile, JSON.stringify(buildClaimMap(bundle), null, 2) + "\n", { flag: "wx" });
}
const loaded = loadConfiguredClaimRegistry(args[2]);
console.log(JSON.stringify({ evidence: "CODE AUDIT / TEST FIXTURE", boundary: loaded.registry.useBoundary,
  contextClaims: loaded.registry.listForContext().length, ragClaims: loaded.registry.listForRag().length,
  mapHash: loaded.mapHash, modelCalls: 0, embeddingCalls: 0, vectorDbCalls: 0 }, null, 2));
