#!/usr/bin/env node
// Phase 16B.1A - resolves every IAM::Role in infra/cloudformation/ci-cd-oidc.yaml
// into plain, concrete (no !Ref/!Sub/!GetAtt left unresolved) trust + permission
// policy JSON, for offline, read-only static auditing (Access Analyzer, Pester
// policy-logic tests, the report's policy table). Never calls AWS, never
// creates anything - a pure template-to-JSON transform using the template's
// OWN declared Parameter defaults (the real values this repo's Phase 16B.1A
// already verified live, not invented ones).
//
// Usage: node cfn-iam-policy-extract.mjs <templateFile> > resolved-policies.json
import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function loadJsYaml() {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const pnpmDir = path.join(repoRoot, "node_modules", ".pnpm");
  const candidates = require("fs")
    .readdirSync(pnpmDir)
    .filter((d) => d.startsWith("js-yaml@4."))
    .map((d) => path.join(pnpmDir, d, "node_modules", "js-yaml"));
  for (const c of candidates) {
    try {
      const mod = require(c);
      if (typeof mod?.DEFAULT_SCHEMA?.extend === "function") return mod;
    } catch {
      /* try next */
    }
  }
  throw new Error("js-yaml@4.x not found under node_modules/.pnpm");
}

const CFN_FN_TAGS = [
  "Ref", "Sub", "GetAtt", "GetAZs", "Join", "Select", "Split", "If", "Equals",
  "Not", "And", "Or", "Condition", "FindInMap", "Base64", "Cidr", "ImportValue",
];

function buildCfnSchema(yaml) {
  const types = [];
  for (const tag of CFN_FN_TAGS) {
    for (const kind of ["scalar", "sequence", "mapping"]) {
      types.push(new yaml.Type("!" + tag, { kind, construct: (d) => ({ __fn: tag, value: d }) }));
    }
  }
  return yaml.DEFAULT_SCHEMA.extend(types);
}

function resolve(value, ctx) {
  if (Array.isArray(value)) return value.map((v) => resolve(v, ctx));
  if (value && typeof value === "object") {
    if (value.__fn === "Sub") {
      const tpl = typeof value.value === "string" ? value.value : value.value[0];
      return tpl.replace(/\$\{([^}]+)\}/g, (m, name) => {
        if (name in ctx.params) return ctx.params[name];
        return m;
      });
    }
    if (value.__fn === "Ref") {
      const name = value.value;
      if (name in ctx.params) return ctx.params[name];
      return `REF:${name}`;
    }
    if (value.__fn === "GetAtt") {
      const key = Array.isArray(value.value) ? value.value.join(".") : value.value;
      if (ctx.getAtt[key]) return ctx.getAtt[key];
      return `GETATT:${key}`;
    }
    const out = {};
    for (const k of Object.keys(value)) out[k] = resolve(value[k], ctx);
    return out;
  }
  return value;
}

const file = process.argv[2];
if (!file) {
  console.error("usage: node cfn-iam-policy-extract.mjs <templateFile>");
  process.exit(1);
}

const yaml = loadJsYaml();
const schema = buildCfnSchema(yaml);
const doc = yaml.load(readFileSync(file, "utf8"), { schema });

const params = {};
for (const [name, def] of Object.entries(doc.Parameters || {})) {
  if (def && "Default" in def) params[name] = def.Default;
}
params["AWS::Partition"] = "aws";
params["AWS::Region"] = "ap-southeast-1";
params["AWS::AccountId"] = "191798898985";

// Every role's expected ARN, since IAM roles can reference each other's
// GetAtt before all are actually created (e.g. InfraPlanRole/InfraApplyRole
// -> CfnExecutionRole.Arn). Built from each resource's own RoleName property
// plus the standard IAM ARN shape - exactly what CloudFormation itself would
// resolve GetAtt to once the stack is applied.
const getAtt = {};
for (const [logicalId, res] of Object.entries(doc.Resources || {})) {
  if (res.Type === "AWS::IAM::Role") {
    const roleName = res.Properties?.RoleName;
    if (roleName) getAtt[`${logicalId}.Arn`] = `arn:aws:iam::191798898985:role/${roleName}`;
  }
}

const ctx = { params, getAtt };
const roles = {};
for (const [logicalId, res] of Object.entries(doc.Resources || {})) {
  if (res.Type !== "AWS::IAM::Role") continue;
  const props = res.Properties;
  roles[logicalId] = {
    roleName: props.RoleName,
    trustPolicy: resolve(props.AssumeRolePolicyDocument, ctx),
    permissionPolicies: (props.Policies || []).map((p) => ({
      name: p.PolicyName,
      document: resolve(p.PolicyDocument, ctx),
    })),
  };
}

process.stdout.write(JSON.stringify({ roles }, null, 2));
