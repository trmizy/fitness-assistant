/** Read-only bytes/history checks. Integrity is not scientific validation. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { scenarios } from "./scenarios";
import { AnswerSchema, EvidencePackSchema, type AdvisoryInput } from "./experiment";
import { reviewLegacyV2 } from "./content-aware-v3";

const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const FrozenV2PinSchema = z.object({
  version: z.literal("guarded-v2-integrity-pin-v1"), capturedAt: z.string(), authority: z.string(), baselineCommit: z.string().regex(/^[a-f0-9]{40}$/),
  artifactRelativeDirectory: z.literal("artifacts/ai-advisory-progress/bedrock-guarded-v2"),
  files: z.array(z.object({ name: z.enum(["manifest.json", "requests.json", "results.jsonl", "summary.json"]), bytes: z.number().int().nonnegative(), sha256: Hash }).strict()).length(4),
  sourcePack: z.object({ path: z.literal("data/eval/advisory-progress-dev/evidence-pack.json"), sha256: Hash }).strict(),
  codeHashes: z.object({ "experiment.ts": Hash, "scenarios.ts": Hash, "run.ts": Hash, "guarded.ts": Hash }).strict(),
  requestsSha256: Hash, scenariosSha256: Hash,
  rows: z.array(z.object({ id: z.string(), variant: z.enum(["A", "B", "C", "D"]), candidateSha256: Hash, contractPass: z.boolean(),
    contractScore: z.object({ assessmentMatch: z.boolean(), requiredFactsAddressed: z.boolean(), requiredQuestionsPresent: z.boolean() }).strict() }).strict()).length(24),
}).strict();
export type FrozenV2Buffers = { files: Record<string, Buffer>; pack: Buffer; code: Record<string, Buffer> };
type Integrity = { status: "INTEGRITY_CONFIRMED" | "ARTIFACT_UNAVAILABLE" | "INTEGRITY_MISMATCH"; findings: string[]; modelCalls: 0 };
const Row = z.object({ id: z.string(), variant: z.enum(["A", "B", "C", "D"]), finalCandidate: AnswerSchema, contractPass: z.boolean(),
  contractScore: z.object({ assessmentMatch: z.boolean(), requiredFactsAddressed: z.boolean(), requiredQuestionsPresent: z.boolean() }).strict() }).passthrough();
const Requests = z.array(z.object({ id: z.string(), variant: z.enum(["A", "B", "C", "D"]), prompt: z.object({ system: z.string(), user: z.string() }).strict() }).strict()).length(24);

export function verifyFrozenV2Buffers(pinValue: unknown, data: FrozenV2Buffers): Integrity {
  const parsed = FrozenV2PinSchema.safeParse(pinValue);
  if (!parsed.success) return { status: "INTEGRITY_MISMATCH", findings: ["INVALID_PIN"], modelCalls: 0 };
  const pin = parsed.data, findings: string[] = [];
  const missing = [...pin.files.filter((f) => !data.files[f.name]).map((f) => f.name), ...Object.keys(pin.codeHashes).filter((n) => !data.code[n])];
  if (!data.pack) missing.push("evidence-pack.json");
  if (missing.length) return { status: "ARTIFACT_UNAVAILABLE", findings: missing, modelCalls: 0 };
  if (new Set(pin.files.map((f) => f.name)).size !== 4 || new Set(pin.rows.map((r) => `${r.id}:${r.variant}`)).size !== 24) findings.push("DUPLICATE_PIN_IDENTITY");
  for (const f of pin.files) if (data.files[f.name].length !== f.bytes || sha(data.files[f.name]) !== f.sha256) findings.push(`ARTIFACT_BYTES_CHANGED:${f.name}`);
  if (sha(data.pack) !== pin.sourcePack.sha256) findings.push("SOURCE_PACK_CHANGED");
  for (const [n, h] of Object.entries(pin.codeHashes)) if (sha(data.code[n]) !== h) findings.push(`FROZEN_CODE_CHANGED:${n}`);
  if (!findings.length) try {
    const manifest = JSON.parse(data.files["manifest.json"].toString("utf8"));
    const requests = Requests.parse(JSON.parse(data.files["requests.json"].toString("utf8")));
    if (sha(JSON.stringify(requests)) !== pin.requestsSha256 || manifest.requestsSha256 !== pin.requestsSha256) findings.push("REQUEST_HASH_CHANGED");
    const pack = EvidencePackSchema.parse(JSON.parse(data.pack.toString("utf8")));
    if (sha(JSON.stringify(scenarios(pack.sources))) !== pin.scenariosSha256 || manifest.scenariosSha256 !== pin.scenariosSha256) findings.push("SCENARIO_HASH_CHANGED");
    if (manifest.corpusSha256 !== pin.sourcePack.sha256 || JSON.stringify(manifest.codeHashes) !== JSON.stringify(pin.codeHashes)) findings.push("MANIFEST_HASH_LINK_CHANGED");
    const rows = data.files["results.jsonl"].toString("utf8").trim().split(/\r?\n/).map((l) => Row.parse(JSON.parse(l)));
    if (rows.length !== 24 || new Set(rows.map((r) => `${r.id}:${r.variant}`)).size !== 24 || new Set(requests.map((r) => `${r.id}:${r.variant}`)).size !== 24) findings.push("INCOMPLETE_FROZEN_RUN");
    for (const row of rows) {
      const pinned = pin.rows.find((r) => r.id === row.id && r.variant === row.variant);
      if (!pinned || sha(JSON.stringify(row.finalCandidate)) !== pinned.candidateSha256 || row.contractPass !== pinned.contractPass || JSON.stringify(row.contractScore) !== JSON.stringify(pinned.contractScore)) findings.push(`CANDIDATE_OR_HISTORY_CHANGED:${row.id}:${row.variant}`);
    }
  } catch { findings.push("INVALID_FROZEN_DATA"); }
  return { status: findings.length ? "INTEGRITY_MISMATCH" : "INTEGRITY_CONFIRMED", findings, modelCalls: 0 };
}

export function loadFrozenV2(root: string, artifactDir?: string) {
  const pinPath = path.join(root, "data/eval/advisory-progress-dev/reviews/frozen-v2-integrity.json");
  if (!fs.existsSync(pinPath)) return { integrity: { status: "ARTIFACT_UNAVAILABLE", findings: ["INTEGRITY_PIN_UNAVAILABLE"], modelCalls: 0 } as Integrity, data: null };
  let pinValue: unknown;
  try { pinValue = JSON.parse(fs.readFileSync(pinPath, "utf8")); }
  catch { return { integrity: { status: "INTEGRITY_MISMATCH", findings: ["INVALID_PIN_JSON"], modelCalls: 0 } as Integrity, data: null }; }
  const parsed = FrozenV2PinSchema.safeParse(pinValue);
  if (!parsed.success) return { integrity: { status: "INTEGRITY_MISMATCH", findings: ["INVALID_PIN"], modelCalls: 0 } as Integrity, data: null };
  const pin = parsed.data, dir = artifactDir ?? path.join(root, pin.artifactRelativeDirectory);
  const names = pin.files.map((f) => [f.name, path.join(dir, f.name)] as const);
  const codeNames = Object.keys(pin.codeHashes).map((n) => [n, path.join(root, "backend/services/ai-service/src/evaluation/advisory-progress", n)] as const);
  const packFile = path.join(root, pin.sourcePack.path);
  const missing = [...names, ...codeNames, ["evidence-pack.json", packFile]].filter(([, p]) => !fs.existsSync(p)).map(([n]) => n);
  if (missing.length) return { integrity: { status: "ARTIFACT_UNAVAILABLE", findings: missing, modelCalls: 0 } as Integrity, data: null };
  const data: FrozenV2Buffers = { files: Object.fromEntries(names.map(([n, p]) => [n, fs.readFileSync(p)])), pack: fs.readFileSync(packFile), code: Object.fromEntries(codeNames.map(([n, p]) => [n, fs.readFileSync(p)])) };
  return { integrity: verifyFrozenV2Buffers(pin, data), data };
}

export function reviewFrozenV2Content(root: string, artifactDir?: string) {
  const loaded = loadFrozenV2(root, artifactDir);
  if (loaded.integrity.status !== "INTEGRITY_CONFIRMED" || !loaded.data) return { integrity: loaded.integrity, rows: [], modelCalls: 0 };
  const requests = Requests.parse(JSON.parse(loaded.data.files["requests.json"].toString("utf8")));
  const inputs = new Map<string, AdvisoryInput>(requests.map((r) => {
    const m = /^<advisory_input trust="untrusted-data">\n([\s\S]*)\n<\/advisory_input>$/.exec(r.prompt.user);
    if (!m) throw new Error("UnexpectedFrozenRequestEnvelope");
    return [`${r.id}:${r.variant}`, JSON.parse(m[1]) as AdvisoryInput];
  }));
  const rows = loaded.data.files["results.jsonl"].toString("utf8").trim().split(/\r?\n/).map((l) => Row.parse(JSON.parse(l)));
  return { integrity: loaded.integrity, modelCalls: 0, rows: rows.map((r) => ({ id: r.id, variant: r.variant,
    ...reviewLegacyV2(inputs.get(`${r.id}:${r.variant}`)!, r) })) };
}
