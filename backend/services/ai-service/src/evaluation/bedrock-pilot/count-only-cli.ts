/**
 * COUNT-only probe CLI. `prepare` and `inspect` are file-only (no credentials, no network).
 * `execute` sends at most one CountTokens request and only after every owner gate passes:
 * evidence-backed account checks, clean pinned checkout, installed trust root, owner-signed
 * approval bound to the package digest, and an owner-preissued OWNER_SIGNED ledger. No inference path.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { PilotError } from "./config";
import { EvaluationDesignSchema } from "./design";
import { calculatePilotPins, implementationRoot } from "./pins";
import { atomicCreate } from "./storage";
import { digest } from "../evaluation-kit/identity";
import { MANTLE_MODEL } from "./mantle-transport";
import { ACCOUNT_CHECKS, assertCountOnlyAccountReady, parseCountOnlyProbe, prepareCountOnlyProbe, type CountAccount, type CountOnlyProbe } from "./count-only-probe";
import { assertImplementationCheckout, executeAuthorizedCountOnlyProbe } from "./mantle-count-client";

const fileHash = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const SourcesConfig = z.object({ design: EvaluationDesignSchema, sources: z.object({ workspaceRoot: z.string(), casesFile: z.string(),
  claimRegistryConfigFile: z.string().optional(), protocolDecisionsFile: z.string().optional(), intakeSidecarFile: z.string().optional() }).strict() }).passthrough();
const OwnerAmendments = z.object({ version: z.literal("controlled-warmup-owner-state-v1"), decisions: z.object({
  E13: z.object({ decision: z.literal("MANTLE_OHIO_CONDITIONAL"), status: z.literal("DECIDED") }).passthrough(),
  E19: z.object({ decision: z.literal("CONFIRM_RUBRIC"), status: z.literal("DECIDED") }).passthrough(),
  E20: z.object({ decision: z.literal("MANTLE_PAIRED_DESIGN"), status: z.literal("DECIDED") }).passthrough() }).passthrough() }).passthrough();
// Owner-written: each VERIFIED check names a saved evidence file; the CLI hashes it, the owner never types a hash.
const AccountEvidence = z.object({ principalArn: z.string(), projectArn: z.string(),
  checks: z.record(z.union([z.literal("NOT_VERIFIED"), z.object({ evidenceFile: z.string(), verifiedAt: z.string().datetime() }).strict()])) }).strict();

function flags(args: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith("--") || args[i + 1] === undefined || args[i + 1].startsWith("--") || args[i].slice(2) in out) throw new PilotError("COUNT_CLI_USAGE");
    out[args[i].slice(2)] = args[i + 1];
  }
  return out;
}
function only(f: Record<string, string>, allowed: string[], required: string[]) {
  if (Object.keys(f).some(k => !allowed.includes(k)) || required.some(k => !(k in f))) throw new PilotError("COUNT_CLI_USAGE");
}
function readAccount(file: string | undefined): CountAccount | undefined {
  if (!file) return undefined;
  const a = AccountEvidence.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  if (Object.keys(a.checks).sort().join() !== [...ACCOUNT_CHECKS].sort().join()) throw new PilotError("COUNT_ACCOUNT_CHECKS_INCOMPLETE");
  const base = path.dirname(path.resolve(file));
  const checks = Object.fromEntries(ACCOUNT_CHECKS.map(k => { const c = a.checks[k];
    return [k, c === "NOT_VERIFIED" ? c : { status: "VERIFIED", evidenceSha256: fileHash(path.resolve(base, c.evidenceFile)), verifiedAt: c.verifiedAt }]; })) as CountAccount["checks"];
  return { principalArn: a.principalArn, projectArn: a.projectArn, checks };
}
export function summary(p: CountOnlyProbe) {
  let readiness = "READY_FOR_OWNER_SIGNATURE";
  try { assertCountOnlyAccountReady(p); } catch { readiness = "ACCOUNT_NOT_VERIFIED"; }
  return { packageDigest: digest(p), requestSha256: p.request.sha256, requestBytes: Buffer.byteLength(p.request.body, "utf8"),
    endpoint: p.endpoint, model: p.model, region: p.region, service: p.service, awsProfile: p.awsProfile, selection: p.selection, sourcePins: p.sourcePins,
    preparedAt: p.preparedAt, expiresAt: p.expiresAt, timeoutMs: p.timeoutMs, maxCountRequests: p.maxCountRequests, retries: p.retries, maxInferenceCalls: p.maxInferenceCalls,
    privacy: p.privacy, account: p.account, readiness,
    unsignedApprovalTemplate: { approvalId: "<owner-generated UUID>", issuer: "<trust.json issuer>", approvedBy: "<owner>", scope: "BEDROCK_EVALUATION_PILOT",
      configHash: digest(p), expiresAt: "<= " + p.expiresAt, signature: "<owner Ed25519 signature over canonical body without signature>" } };
}
export async function prepare(f: Record<string, string>, now = new Date()) {
  only(f, ["config", "case", "arm", "repeat", "owner-amendments", "out", "hours", "timeout-ms", "account"], ["config", "case", "arm", "repeat", "owner-amendments", "out"]);
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: implementationRoot, encoding: "utf8", windowsHide: true }).trim();
  assertImplementationCheckout(head);
  const amendmentsFile = path.resolve(f["owner-amendments"]); OwnerAmendments.parse(JSON.parse(fs.readFileSync(amendmentsFile, "utf8")));
  const c = SourcesConfig.parse(JSON.parse(fs.readFileSync(f.config, "utf8")));
  const caseId = z.enum(["CAL01", "CAL06"]).parse(f.case), suffix = caseId === "CAL01" ? "01" : "06", caseKey = `case-warmup-cal${suffix}` as const;
  const arm = z.enum(["LAYERED_CONTEXT", "LAYERED_CONTEXT_RAG"]).parse(f.arm), repeatIndex = z.union([z.literal(0), z.literal(1)]).parse(Number(f.repeat));
  const hours = Number(f.hours ?? "24"); if (!(hours > 0 && hours <= 24)) throw new PilotError("COUNT_CLI_USAGE");
  const prepared = await calculatePilotPins(c.sources.workspaceRoot, c.sources.casesFile, c.design, c.sources, z.enum(["CLAIM_PROMPT_V1", "CLAIM_PROMPT_V2"]).optional().parse((c as { promptVersion?: unknown }).promptVersion));
  const row = prepared.preparation.rows.find(r => r.caseKey === caseKey && r.arm === arm && r.policy === "MINIMAL" && r.repeatIndex === repeatIndex);
  const bundle = (JSON.parse(fs.readFileSync(c.sources.casesFile, "utf8")).released as { freeze: { caseKey: string }; request: { caseId: string } }[]).find(b => b.freeze.caseKey === caseKey);
  if (!row || !bundle) throw new PilotError("COUNT_SELECTED_ROW_MISSING");
  const preparedAt = new Date(Math.floor(now.getTime() / 1000) * 1000);
  const probe = prepareCountOnlyProbe({ input: { modelId: MANTLE_MODEL, system: [{ text: row.prompt.system }], messages: [{ role: "user", content: [{ text: row.prompt.user }] }], inferenceConfig: { maxTokens: 2048 } },
    selection: { caseId, caseKey, requestCaseId: z.enum(["dev-cal-01", "dev-cal-06"]).parse(bundle.request.caseId), arm, policy: "MINIMAL", repeatIndex, requestHash: row.requestHash, promptHash: row.promptHash },
    sourcePins: { commit: prepared.pins.commit, implementationCommit: head, code: prepared.pins.code, corpus: prepared.pins.corpus, cases: prepared.pins.cases, ownerAmendments: fileHash(amendmentsFile) },
    preparedAt: preparedAt.toISOString(), expiresAt: new Date(preparedAt.getTime() + hours * 3600000).toISOString(),
    ...(f["timeout-ms"] ? { timeoutMs: Number(f["timeout-ms"]) } : {}), account: readAccount(f.account) });
  atomicCreate(path.resolve(f.out), probe);
  return { ...summary(probe), workspaceDirty: prepared.dirty, out: path.resolve(f.out) };
}
async function main() {
  const [command, ...rest] = process.argv.slice(2), f = flags(rest);
  let result: unknown;
  if (command === "prepare") result = await prepare(f);
  else if (command === "inspect") { only(f, ["package"], ["package"]); result = summary(parseCountOnlyProbe(JSON.parse(fs.readFileSync(f.package, "utf8")))); }
  else if (command === "execute") {
    only(f, ["package", "approval", "run-dir"], ["package", "approval", "run-dir"]);
    const runDirectory = path.resolve(f["run-dir"]); fs.mkdirSync(runDirectory);
    const probe = JSON.parse(fs.readFileSync(f.package, "utf8")), approval = JSON.parse(fs.readFileSync(f.approval, "utf8"));
    try { result = await executeAuthorizedCountOnlyProbe(probe, approval, { workspaceRoot: implementationRoot, runDirectory }); atomicCreate(path.join(runDirectory, "count-receipt.json"), result); }
    catch (e) { if (e instanceof PilotError) atomicCreate(path.join(runDirectory, "count-error.json"), { code: e.code, details: e.details }); throw e; }
  } else throw new PilotError("COUNT_CLI_USAGE");
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
if (require.main === module) main().catch(e => { process.stderr.write(JSON.stringify({ error: { code: e instanceof PilotError ? e.code : "COUNT_CLI_FAILED", details: e instanceof PilotError ? e.details : {} } }) + "\n"); process.exitCode = 1; });
