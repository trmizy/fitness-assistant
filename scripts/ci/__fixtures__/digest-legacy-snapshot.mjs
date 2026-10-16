import { readFileSync } from "fs";
import crypto from "crypto";

const dir = process.argv[2];
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) o[k] = sortDeep(v[k]); return o; }
  return v;
}
const sha = (o) => crypto.createHash("sha256").update(JSON.stringify(sortDeep(o))).digest("hex");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));

const role = readJson(`${dir}/legacy-role-before.json`);
const p1 = readJson(`${dir}/legacy-role-policy-plan-read-only-before.json`);
const p2 = readJson(`${dir}/legacy-role-policy-state-backend-read-before.json`);
const oidc = readJson(`${dir}/oidc-provider-before.json`);

console.log("legacyRole.trustDigest =", sha(role.Role.AssumeRolePolicyDocument));
console.log("legacyRole.planReadOnly.digest =", sha(p1.PolicyDocument));
console.log("legacyRole.stateBackendRead.digest =", sha(p2.PolicyDocument));
console.log("legacyRole.permissionsBoundary =", JSON.stringify(role.Role.PermissionsBoundary ?? null));
console.log("oidc.digest =", sha({ Url: oidc.Url, ClientIDList: oidc.ClientIDList, ThumbprintList: oidc.ThumbprintList }));
