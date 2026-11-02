import fs from "node:fs";
import path from "node:path";
import { buildClaimMap, digest, sha256, validateClaimMap, verifyInputBundle } from "./builder";
import { createClaimRegistry } from "./registry";

const args = process.argv.slice(2);
if (args.length !== 1 || !["--build", "--validate"].includes(args[0])) throw new Error("DEV_OFFLINE_ONLY: use --build or --validate; no live/provider mode");
const root = path.resolve(__dirname, "../../../../../.."), dir = path.join(root, "data/knowledge/scientific-claim-map-v3");
const bundle = verifyInputBundle(JSON.parse(fs.readFileSync(path.join(dir, "input-bundle.json"), "utf8")));
// Verify originals when available. Missing originals are explicit, never reported as current live state.
const unavailable: string[] = [];
for (const [id, file] of Object.entries(bundle.files)) {
  if (!fs.existsSync(file.origin)) { unavailable.push(id); continue; }
  if (sha256(fs.readFileSync(file.origin, "utf8")) !== file.sha256) throw new Error(`CurrentSourceHashMismatch:${id}`);
}
const generated = buildClaimMap(bundle), destination = path.join(dir, "claim-map.json");
if (args[0] === "--build") fs.writeFileSync(destination, JSON.stringify(generated, null, 2) + "\n", { flag: "wx" });
const map = validateClaimMap(bundle, JSON.parse(fs.readFileSync(destination, "utf8")));
const registry = createClaimRegistry(bundle, map, { inputBundleSha256: digest(bundle), ownerDecisionsSha256: bundle.files.owner.sha256 });
console.log(JSON.stringify({ evidence: "TEST FIXTURE / CODE AUDIT", boundary: map.useBoundary, counts: map.counts,
  contextClaims: registry.listForContext().length, ragClaims: registry.listForRag().length,
  inputBundleSha256: digest(bundle), ownerUpdatedAt: map.ownerUpdatedAt, unavailableOriginals: unavailable,
  originalVerification: unavailable.length ? "PINNED_OFFLINE_SNAPSHOT_SOME_ORIGINALS_UNAVAILABLE" : "ALL_ORIGINAL_BYTES_MATCH_CAPTURE",
  modelCalls: 0, embeddingCalls: 0, vectorDbCalls: 0 }, null, 2));
