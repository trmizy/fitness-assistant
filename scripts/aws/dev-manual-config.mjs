#!/usr/bin/env node
/**
 * AWS DEV — configuration that is NOT in any CloudFormation stack or deploy workflow, written down as executable state.
 *
 * Why this exists: dev-deploy.yml deploys Lambda CODE only (never update-function-configuration), the API Gateway CORS and the
 * uploads-bucket CORS are not in a stack, and the Lambda roles' inline policies are not managed either. During the partner retest of
 * 2026-11-17/18 these were set by hand (aws cli). A hand-set value that is not recorded gets lost the day someone rebuilds the
 * environment, so this file is the record AND the tool to re-apply it:
 *
 *   node scripts/aws/dev-manual-config.mjs            # CHECK (read-only): prints OK / DRIFT per item, exit 1 on drift
 *   node scripts/aws/dev-manual-config.mjs --apply    # applies ONLY the drifted items (merge, never removes anything)
 *   node scripts/aws/dev-manual-config.mjs --only lambda,iam [--apply]
 *
 * Safety: refuses to run against any account other than the DEV account; every write is a MERGE of what is already there (CORS lists are
 * unioned, Lambda env is read, the wanted keys are set, the whole map is written back — update-function-configuration replaces the map);
 * secrets are never printed (only the keys listed below, none of which is a secret, are ever shown).
 * Credentials come from the usual AWS environment (AWS_PROFILE ...). Needs the `aws` CLI v2.
 *
 * Moving any of this into IaC is welcome; until then, change a value HERE in the same commit that changes it on AWS.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const REGION = "ap-southeast-1";
export const ACCOUNT = "191798898985";
const UPLOADS_BUCKET = `fitness-assistant-uploads-dev-${ACCOUNT}`;
const BUCKET_ARN = `arn:aws:s3:::${UPLOADS_BUCKET}`;
const fn = (name) => `fitness-assistant-dev-${name}`;
const fnArn = (name) => `arn:aws:lambda:${REGION}:${ACCOUNT}:function:${fn(name)}`;

export const DESIRED = {
  /** Browser origins of the production web app. Added to the uploads bucket CORS and to the API Gateway CORS. */
  origins: ["https://gymini.vn", "https://www.gymini.vn"],
  uploadsBucket: UPLOADS_BUCKET,
  api: {
    id: "id1iz7upbl", // fitness-assistant-dev-api (HTTP API). Its CORS is not part of any stack.
    // Custom request headers the web app sends. A header missing here fails the browser preflight.
    allowHeaders: ["authorization", "content-type", "x-gymini-client", "x-gymini-listing-flow", "x-gymini-venue-consent"],
  },
  /**
   * Lambda environment. Non-secret values only. TZ: the local stack runs every service with TZ=Asia/Ho_Chi_Minh; code that reads
   * getHours()/getDay() (PT availability, reschedule) is wrong on a UTC Lambda. REQUIRE_CONTRACT_ESIGN=false: e-sign is a settled
   * "off" decision; an unset value means ON (contract.service.ts), which strands every PT contract at PENDING_SIGNATURE.
   * *_LAMBDA_NAME: user-service reaches gym/payment by direct invoke (there is no internal HTTP on Lambda).
   * NOT listed on purpose: CHAT_SERVICE_URL on `user`. The chat ALB is re-created by every `dev-start -Chat` (new DNS name), so that value is
   * written by dev-start.ps1 (step 6c) and blanked by dev-stop.ps1 (step 2b-iii) via lib/set-lambda-env.cjs - pinning it here would go stale.
   */
  lambdaEnv: {
    user: {
      TZ: "Asia/Ho_Chi_Minh",
      REQUIRE_CONTRACT_ESIGN: "false",
      PT_MEDIA_S3_BUCKET: UPLOADS_BUCKET,
      GYM_LAMBDA_NAME: fn("gym"),
      PAYMENT_LAMBDA_NAME: fn("payment"),
    },
    gym: { TZ: "Asia/Ho_Chi_Minh" },
    payment: { TZ: "Asia/Ho_Chi_Minh" },
    fitness: { TZ: "Asia/Ho_Chi_Minh" },
    auth: { TZ: "Asia/Ho_Chi_Minh" },
    "user-jobs": { TZ: "Asia/Ho_Chi_Minh" },
    "gym-jobs": { TZ: "Asia/Ho_Chi_Minh" },
    "payment-jobs": { TZ: "Asia/Ho_Chi_Minh" },
    "fitness-jobs": { TZ: "Asia/Ho_Chi_Minh" },
  },
  /** Inline policies added to the Lambda roles. Least privilege: object actions on named prefixes only (no s3:ListBucket on purpose). */
  iam: [
    {
      role: fn("user-lambda-role"),
      policy: fn("user-pt-media-and-service-invoke"),
      document: {
        Version: "2012-10-17",
        Statement: [
          { Sid: "PTPhysiquePhotos", Effect: "Allow", Action: ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"], Resource: `${BUCKET_ARN}/pt-physique/*` },
          { Sid: "InvokeGymAndPayment", Effect: "Allow", Action: "lambda:InvokeFunction", Resource: [fnArn("gym"), fnArn("payment")] },
        ],
      },
    },
    {
      role: fn("gym-lambda-role"),
      policy: fn("gym-listing-photos"),
      document: {
        Version: "2012-10-17",
        Statement: [{ Sid: "GymListingPhotos", Effect: "Allow", Action: ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"], Resource: `${BUCKET_ARN}/listing-photos/*` }],
      },
    },
    {
      role: fn("gym-lambda-role"),
      policy: fn("gym-private-evidence"),
      document: {
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "PrivateEvidenceFiles",
            Effect: "Allow",
            Action: ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
            Resource: [`${BUCKET_ARN}/complaint-photos/*`, `${BUCKET_ARN}/branch-documents/*`],
          },
        ],
      },
    },
  ],
};

// ── pure merge / compare helpers (unit-tested) ───────────────────────────────────────────────────────────────────────────────────────

const union = (have = [], want = []) => [...have, ...want.filter((w) => !have.includes(w))];

/** Bucket CORS: every existing rule keeps everything it had and gains the missing origins. No rules at all -> one rule that matches the web app's uploads. */
export function mergeBucketCors(current, origins) {
  const rules = current?.CORSRules ?? [];
  if (rules.length === 0) {
    const next = {
      CORSRules: [{ AllowedHeaders: ["content-type", "x-amz-*"], AllowedMethods: ["GET", "PUT", "POST", "HEAD"], AllowedOrigins: [...origins], ExposeHeaders: ["ETag"], MaxAgeSeconds: 300 }],
    };
    return { next, changed: true };
  }
  const next = { ...current, CORSRules: rules.map((r) => ({ ...r, AllowedOrigins: union(r.AllowedOrigins, origins) })) };
  return { next, changed: JSON.stringify(next) !== JSON.stringify(current) };
}

/** API Gateway CORS: union of origins and allowed headers; methods, max-age and credentials are left as they are. */
export function mergeApiCors(current, origins, headers) {
  const cur = current ?? {};
  const next = { ...cur, AllowOrigins: union(cur.AllowOrigins, origins), AllowHeaders: union(cur.AllowHeaders, headers) };
  return { next, changed: JSON.stringify(next) !== JSON.stringify(cur) };
}

/** Lambda env: sets the wanted keys on top of the whole current map (which must be written back in full). */
export function mergeEnv(current, wanted) {
  const cur = current ?? {};
  const changedKeys = Object.keys(wanted).filter((k) => cur[k] !== wanted[k]);
  return { next: { ...cur, ...wanted }, changedKeys };
}

/**
 * ZaloPay guard (payment Lambda runs NODE_ENV=production). gateway-policy.ts refuses ZaloPay in production unless ZALOPAY_PRODUCTION_VERIFIED=true,
 * the flag an operator sets after verifying the integration against ZaloPay's PRODUCTION system. On this DEV environment it is set to true ONLY so
 * the SANDBOX keys (fake money) can be exercised. Therefore: the flag must never be true together with a non-sandbox endpoint, and keys alone
 * (no flag) are fine. The keys themselves (ZALOPAY_APP_ID / KEY1 / KEY2) are secrets: not in this file, set by hand, never printed.
 * Returns the problem text, or null when consistent.
 */
export function zalopayGuardProblem(env) {
  const flag = String(env?.ZALOPAY_PRODUCTION_VERIFIED ?? "").toLowerCase() === "true";
  if (!flag) return null;
  const endpoint = String(env?.ZALOPAY_ENDPOINT ?? "");
  // No endpoint = the provider's built-in default, which is the sandbox host.
  if (endpoint && !/^https:\/\/sb-openapi\.zalopay\.vn(\/|$)/.test(endpoint)) {
    return "ZALOPAY_PRODUCTION_VERIFIED=true but ZALOPAY_ENDPOINT is not the sandbox host (sb-openapi.zalopay.vn): that flag is for SANDBOX keys only on DEV";
  }
  return null;
}

/** Same statements (order-insensitive) = no drift. A policy that does not exist yet is drift. */
export function policyDiffers(currentDoc, desiredDoc) {
  if (!currentDoc) return true;
  const norm = (d) => JSON.stringify([...(d.Statement ?? [])].map((s) => JSON.stringify(s, Object.keys(s).sort())).sort());
  return norm(currentDoc) !== norm(desiredDoc);
}

// ── aws cli plumbing ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function aws(args, { allowMissing = false } = {}) {
  try {
    const out = execFileSync("aws", [...args, "--region", REGION, "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
    return out.trim() ? JSON.parse(out) : null;
  } catch (e) {
    const stderr = String(e.stderr ?? "");
    if (allowMissing && /NoSuchCORSConfiguration|NoSuchEntity|ResourceNotFoundException/.test(stderr)) return null;
    throw new Error(`aws ${args.slice(0, 2).join(" ")} failed: ${stderr.split("\n").find(Boolean) ?? e.message}`);
  }
}

function withTempJson(obj, fnUse) {
  const dir = mkdtempSync(join(tmpdir(), "dev-manual-config-"));
  try {
    const file = join(dir, "doc.json");
    writeFileSync(file, JSON.stringify(obj), { mode: 0o600 });
    return fnUse(`file://${file.replace(/\\/g, "/")}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── items ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function s3Item(apply) {
  const cur = aws(["s3api", "get-bucket-cors", "--bucket", DESIRED.uploadsBucket], { allowMissing: true });
  const { next, changed } = mergeBucketCors(cur, DESIRED.origins);
  if (changed && apply) withTempJson(next, (f) => aws(["s3api", "put-bucket-cors", "--bucket", DESIRED.uploadsBucket, "--cors-configuration", f]));
  return [{ item: `s3 CORS ${DESIRED.uploadsBucket} (+${DESIRED.origins.join(", ")})`, drift: changed, applied: changed && apply }];
}

function apiItem(apply) {
  const cur = aws(["apigatewayv2", "get-api", "--api-id", DESIRED.api.id])?.CorsConfiguration;
  const { next, changed } = mergeApiCors(cur, DESIRED.origins, DESIRED.api.allowHeaders);
  if (changed && apply) withTempJson(next, (f) => aws(["apigatewayv2", "update-api", "--api-id", DESIRED.api.id, "--cors-configuration", f]));
  return [{ item: `api gateway CORS ${DESIRED.api.id} (headers: ${DESIRED.api.allowHeaders.filter((h) => h.startsWith("x-gymini")).join(", ")})`, drift: changed, applied: changed && apply }];
}

function lambdaItems(apply) {
  return Object.entries(DESIRED.lambdaEnv).map(([name, wanted]) => {
    const fnName = fn(name);
    const cur = aws(["lambda", "get-function-configuration", "--function-name", fnName, "--query", "Environment.Variables"]);
    const { next, changedKeys } = mergeEnv(cur, wanted);
    if (changedKeys.length && apply) {
      withTempJson({ Variables: next }, (f) => aws(["lambda", "update-function-configuration", "--function-name", fnName, "--environment", f]));
      execFileSync("aws", ["lambda", "wait", "function-updated", "--function-name", fnName, "--region", REGION], { stdio: "ignore" });
    }
    return { item: `lambda env ${fnName} [${Object.keys(wanted).join(", ")}]`, drift: changedKeys.length > 0, detail: changedKeys.join(", "), applied: changedKeys.length > 0 && apply };
  });
}

function iamItems(apply) {
  return DESIRED.iam.map(({ role, policy, document }) => {
    const cur = aws(["iam", "get-role-policy", "--role-name", role, "--policy-name", policy], { allowMissing: true })?.PolicyDocument ?? null;
    const drift = policyDiffers(cur, document);
    if (drift && apply) withTempJson(document, (f) => aws(["iam", "put-role-policy", "--role-name", role, "--policy-name", policy, "--policy-document", f]));
    return { item: `iam ${role} / ${policy}`, drift, applied: drift && apply };
  });
}

/** Read-only invariant, never auto-fixed: a violation is reported as DRIFT and needs a human. */
function zalopayItem() {
  const env = aws(["lambda", "get-function-configuration", "--function-name", fn("payment"), "--query", "Environment.Variables"]) ?? {};
  const problem = zalopayGuardProblem(env);
  return [{ item: `payment ZaloPay guard (flag ${String(env.ZALOPAY_PRODUCTION_VERIFIED ?? "unset")}, keys ${env.ZALOPAY_KEY1 ? "set" : "unset"})`, drift: Boolean(problem), detail: problem ?? "" }];
}

const SECTIONS = { s3: s3Item, apigw: apiItem, lambda: lambdaItems, iam: iamItems, zalopay: zalopayItem };

export function main(argv = process.argv.slice(2)) {
  const apply = argv.includes("--apply");
  const onlyIdx = argv.indexOf("--only");
  const only = onlyIdx >= 0 ? String(argv[onlyIdx + 1] ?? "").split(",").filter(Boolean) : Object.keys(SECTIONS);
  const unknown = only.filter((s) => !(s in SECTIONS));
  if (unknown.length) throw new Error(`unknown section(s): ${unknown.join(", ")} (use ${Object.keys(SECTIONS).join(",")})`);

  const account = aws(["sts", "get-caller-identity"]).Account;
  if (account !== ACCOUNT) throw new Error(`refusing to run: account ${account} is not the DEV account ${ACCOUNT}`);

  const results = only.flatMap((s) => SECTIONS[s](apply));
  for (const r of results) {
    const state = r.applied ? "APPLIED" : r.drift ? "DRIFT  " : "OK     ";
    console.log(`${state} ${r.item}${r.detail ? `  <- ${r.detail}` : ""}`);
  }
  const drift = results.filter((r) => r.drift && !r.applied).length;
  console.log(drift ? `\n${drift} item(s) drifted. Re-run with --apply to fix them.` : apply ? "\nDone." : "\nNo drift.");
  return drift ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exitCode = 2;
  }
}
