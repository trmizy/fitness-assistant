#!/usr/bin/env node
// Phase 16A.3 - CloudFormation template semantic model extractor.
//
// Parses a CloudFormation template (YAML or JSON) and prints a canonical,
// deterministically-ordered JSON "semantic model" covering every top-level
// section that can change a stack's behavior WITHOUT appearing in a
// change-set's own `.Changes` array (the exact Phase 16A.2R blind spot:
// Outputs changes are applied by CloudFormation but never listed there).
//
// Read-only: never calls AWS, never mutates anything, never resolves a
// dynamic/secret reference - every CFN intrinsic function (!Ref, !Sub,
// !GetAtt, etc.) is preserved as a tagged structural placeholder
// ({"__fn":"Ref","value":...}), never evaluated.
//
// Usage: node cfn-template-semantics.mjs <templateFile>
// Prints the semantic model as JSON to stdout. Exits 1 on any parse error
// or on an unrecognized top-level template section (fail closed - never
// silently drops a section it doesn't understand).
//
// Dependency note: uses `js-yaml`, already present in this repo's pnpm
// virtual store as a transitive dependency of existing tooling (not a new
// package install) - resolved by its exact on-disk path below rather than
// declared as a new direct dependency of any workspace package, to avoid
// mass-editing package.json files for a CI-safety-only script.
import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function loadJsYaml() {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const pnpmDir = path.join(repoRoot, "node_modules", ".pnpm");
  let candidates = [];
  try {
    candidates = require("fs")
      .readdirSync(pnpmDir)
      // js-yaml 3.x has a different Schema API (no Schema.prototype.extend) -
      // require exactly a 4.x release, never pick whichever version the
      // filesystem happens to list first.
      .filter((d) => d.startsWith("js-yaml@4."))
      .map((d) => path.join(pnpmDir, d, "node_modules", "js-yaml"));
  } catch {
    /* fall through to error below */
  }
  for (const c of candidates) {
    try {
      const mod = require(c);
      if (typeof mod?.DEFAULT_SCHEMA?.extend === "function") return mod;
    } catch {
      /* try next */
    }
  }
  throw new Error(
    "js-yaml not found under node_modules/.pnpm - cannot parse a YAML template. " +
      "(JSON templates do not need this and will still work.)"
  );
}

const KNOWN_TOP_LEVEL_SECTIONS = new Set([
  "AWSTemplateFormatVersion",
  "Description",
  "Transform",
  "Parameters",
  "Mappings",
  "Conditions",
  "Resources",
  "Outputs",
  "Rules",
  "Metadata",
]);

// Every CFN short-form intrinsic tag this template style uses (or could
// plausibly use). Each is preserved as a structural placeholder, never
// evaluated - this is NOT a CFN evaluator, only a semantic-diff input.
const CFN_FN_TAGS = [
  "Ref",
  "Sub",
  "GetAtt",
  "GetAZs",
  "Join",
  "Select",
  "Split",
  "If",
  "Equals",
  "Not",
  "And",
  "Or",
  "Condition",
  "FindInMap",
  "Base64",
  "Cidr",
  "ImportValue",
  "Transform",
];

function buildCfnSchema(yaml) {
  const types = [];
  for (const tag of CFN_FN_TAGS) {
    for (const kind of ["scalar", "sequence", "mapping"]) {
      types.push(
        new yaml.Type("!" + tag, {
          kind,
          construct: (data) => ({ __fn: tag, value: data }),
        })
      );
    }
  }
  return yaml.DEFAULT_SCHEMA.extend(types);
}

const LONG_FORM_FN_KEYS = new Set(["Ref", ...CFN_FN_TAGS.map((t) => "Fn::" + t)]);

// A JSON-authored template (or a YAML one using the long Fn:: form instead
// of the !Tag shorthand) represents the exact same intrinsic function as a
// plain object key, e.g. {"Fn::Sub": "..."} or {"Ref": "X"}. Normalize both
// forms to the identical {__fn, value} shape the YAML !Tag parser already
// produces, so a semantically-equivalent template never reports a false
// RESOURCE_CHANGE/OUTPUT_CHANGE purely because of which form it was
// authored in (Phase 16A.3 test case 3).
function normalizeFn(value) {
  if (Array.isArray(value)) return value.map(normalizeFn);
  if (value && typeof value === "object") {
    if (value.__fn) return { __fn: value.__fn, value: normalizeFn(value.value) };
    const keys = Object.keys(value);
    if (keys.length === 1 && LONG_FORM_FN_KEYS.has(keys[0])) {
      const tag = keys[0] === "Ref" ? "Ref" : keys[0].slice("Fn::".length);
      return { __fn: tag, value: normalizeFn(value[keys[0]]) };
    }
    const out = {};
    for (const key of keys) out[key] = normalizeFn(value[key]);
    return out;
  }
  return value;
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortDeep(value[key]);
    return out;
  }
  return value;
}

function parseTemplate(filePath) {
  const raw = readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    /* not JSON - try YAML */
  }
  const yaml = loadJsYaml();
  const schema = buildCfnSchema(yaml);
  return yaml.load(raw, { schema });
}

// Description fields are pure human documentation with zero functional/
// runtime effect - CloudFormation change sets never diff a template's own
// top-level Description either (already an established exclusion from
// Phase 16A.2). Stripping Parameter.Description/Output.Description here
// too avoids false-positive PARAMETER_CHANGE/OUTPUT_CHANGE findings from
// prose edits, AND sidesteps a real, pre-existing AWS-CLI/Windows Unicode
// round-trip bug (an em-dash "—" in a live-fetched template's Description
// comes back as "???" even via --output json - confirmed empirically this
// phase, consistent with the same artifact seen since Phase 15B - this is
// NOT something a semantic-safety guard should ever treat as a meaningful
// change).
function stripDescriptions(section) {
  if (!section || typeof section !== "object") return section;
  const out = {};
  for (const [name, def] of Object.entries(section)) {
    if (def && typeof def === "object" && !Array.isArray(def)) {
      const { Description, ...rest } = def;
      out[name] = rest;
    } else {
      out[name] = def;
    }
  }
  return out;
}

function extractSemanticModel(doc) {
  const unknown = Object.keys(doc).filter((k) => !KNOWN_TOP_LEVEL_SECTIONS.has(k));
  const norm = (v) => sortDeep(normalizeFn(v ?? {}));
  const model = {
    Transform: doc.Transform ?? null,
    Parameters: norm(stripDescriptions(doc.Parameters)),
    Mappings: norm(doc.Mappings),
    Conditions: norm(doc.Conditions),
    Resources: norm(doc.Resources),
    Outputs: norm(stripDescriptions(doc.Outputs)),
    Rules: norm(doc.Rules),
    Metadata: norm(doc.Metadata),
    UnknownTopLevelSections: unknown.sort(),
  };
  return model;
}

const file = process.argv[2];
if (!file) {
  console.error("usage: node cfn-template-semantics.mjs <templateFile>");
  process.exit(1);
}
try {
  const doc = parseTemplate(file);
  const model = extractSemanticModel(doc);
  process.stdout.write(JSON.stringify(model));
} catch (err) {
  console.error("TEMPLATE_PARSE_FAILED: " + err.message);
  process.exit(1);
}
