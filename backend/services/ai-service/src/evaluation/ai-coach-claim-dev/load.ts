import fs from "node:fs";
import path from "node:path";
import { createClaimRegistry } from "../../knowledge/scientific-claim-map-v3/registry";
import { sha256, verifyInputBundle } from "../../knowledge/scientific-claim-map-v3/builder";

// E1 handoff pins, deliberately independent of a supplied packet's self-reported hashes.
export const E1_PINS = Object.freeze({ inputBundleSha256: "fb97e98a1177439c05be05615dd9febcad59266a88b9661b294627c2c1ac1c0d", ownerDecisionsSha256: "9cb81c776a1f9080b8c1d1dea46f882a6c942a6bbb272726641237c8e38811d2" });
export function loadClaimDev(root: string) {
  const dir = path.join(root, "data/knowledge/scientific-claim-map-v3");
  const bundle = verifyInputBundle(JSON.parse(fs.readFileSync(path.join(dir, "input-bundle.json"), "utf8")));
  const map = JSON.parse(fs.readFileSync(path.join(dir, "claim-map.json"), "utf8"));
  const registry = createClaimRegistry(bundle, map, E1_PINS);
  // Missing/currently changed originals are not silently treated as current owner approval.
  for (const [id, file] of Object.entries(bundle.files)) {
    if (!fs.existsSync(file.origin)) throw new Error(`CurrentOriginalUnavailable:${id}`);
    if (sha256(fs.readFileSync(file.origin, "utf8")) !== file.sha256) throw new Error(`CurrentSourceHashMismatch:${id}`);
  }
  return { registry, mapHash: sha256(fs.readFileSync(path.join(dir, "claim-map.json"), "utf8")) };
}
