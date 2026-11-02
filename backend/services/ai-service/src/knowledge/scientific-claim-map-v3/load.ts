import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { digest, sha256, verifyInputBundle } from "./builder";
import { createClaimRegistry } from "./registry";
import { sha256Schema } from "./schema";

const absoluteFile = z.string().refine(path.isAbsolute, "AbsoluteExternalFileRequired");
const configSchema = z.object({ version: z.literal("claim-registry-local-config-v1"), inputBundleFile: absoluteFile,
  claimMapFile: absoluteFile, currentOwnerDecisionsFile: absoluteFile,
  trustedPins: z.object({ inputBundleSha256: sha256Schema, ownerDecisionsSha256: sha256Schema }).strict(),
}).strict();
/** Local config is a caller-owned trust input, not an owner approval or a self-signed release. */
export function readConfiguredClaimInputs(configFile: string) {
  if (!path.isAbsolute(configFile)) throw new Error("AbsoluteRegistryConfigRequired");
  const config = configSchema.parse(JSON.parse(fs.readFileSync(configFile, "utf8")));
  const bundle = verifyInputBundle(JSON.parse(fs.readFileSync(config.inputBundleFile, "utf8")));
  if (digest(bundle) !== config.trustedPins.inputBundleSha256) throw new Error("UntrustedInputBundlePin");
  if (bundle.files.owner.sha256 !== config.trustedPins.ownerDecisionsSha256
    || sha256(fs.readFileSync(config.currentOwnerDecisionsFile, "utf8")) !== config.trustedPins.ownerDecisionsSha256) throw new Error("StaleOwnerDecisionsPin");
  return { config, bundle };
}
export function loadConfiguredClaimRegistry(configFile: string) {
  const { config, bundle } = readConfiguredClaimInputs(configFile);
  const text = fs.readFileSync(config.claimMapFile, "utf8"), map = JSON.parse(text);
  return { registry: createClaimRegistry(bundle, map, config.trustedPins), mapHash: sha256(text), pins: config.trustedPins };
}
