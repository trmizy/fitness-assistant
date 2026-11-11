import { readFileSync, writeFileSync } from "fs";
const resolved = JSON.parse(readFileSync("scripts/ci/__fixtures__/ci-cd-oidc-resolved-policies.json", "utf8"));
const outDir = process.argv[2] || "scripts/ci/__fixtures__/16b1b-policies";
import { mkdirSync } from "fs";
mkdirSync(outDir, { recursive: true });
for (const [name, role] of Object.entries(resolved.roles)) {
  writeFileSync(`${outDir}/${name}.trust.json`, JSON.stringify(role.trustPolicy, null, 2));
  writeFileSync(`${outDir}/${name}.perm.json`, JSON.stringify(role.permissionPolicies[0].document, null, 2));
}
console.log("written to", outDir);
