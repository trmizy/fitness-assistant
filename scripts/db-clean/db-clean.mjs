#!/usr/bin/env node
/**
 * db-clean - the database cleanup tool for the Listing Management plan (Phase G / H). See README-db-clean.md next to this file
 * and plan sections 9, 12.9, 12.13-12.16.
 *
 *   audit    --env dev|test [--out DIR] [--report FILE] [--allowlist FILE] [--fixtures "a;b"] [--partner-dbs report|include] [--db-suffix S]
 *            READ ONLY. Writes the candidate manifest + confirmToken (+ metadata) into --out. No write to any database.
 *   audit    --recheck --manifest F --confirm-token T [--run-dir DIR]
 *   approve  --manifest F --confirm-token T --out DIR        copy the (manifest, token) pair into DIR/approved/ (read only)
 *   freeze   --env E --manifest approved/... --confirm-token T [--run-dir DIR]     H0  (needs DBCLEAN_MAINT_PASSWORD; dev: DBCLEAN_CONFIRM=dev)
 *   backup   --env E --manifest ... --confirm-token T --run-dir DIR                H1
 *   clean    --env E --apply --manifest ... --confirm-token T --run-dir DIR [--resume]   H2
 *   verify   --env E --manifest ... --confirm-token T --run-dir DIR                H3
 *   unfreeze --env E --run-dir DIR [--no-start-containers]                          H4
 *   restore  --env E --run-dir DIR [--backup DIR]                                   all seven databases from ONE backup set
 *   recover  --env E --run-dir DIR                                                  the manual runbook as a command
 *   status   --env E [--run-dir DIR]                                                read only
 *
 * Exit codes: 0 ok, 1 refused (a guard / check said no, nothing was done or the failure was recorded), 2 unexpected error.
 */
import { Refused, parseArgs } from './lib/util.mjs';
import * as C from './lib/commands.mjs';

const COMMON = { env: 'val', 'db-suffix': 'val', 'run-dir': 'val' };
const SPEC = {
  audit: { ...COMMON, out: 'val', report: 'val', allowlist: 'val', fixtures: 'val', 'partner-dbs': 'val', recheck: 'bool', manifest: 'val', 'confirm-token': 'val' },
  approve: { ...COMMON, manifest: 'val', 'confirm-token': 'val', out: 'val' },
  freeze: { ...COMMON, manifest: 'val', 'confirm-token': 'val' },
  backup: { ...COMMON, manifest: 'val', 'confirm-token': 'val' },
  clean: { ...COMMON, manifest: 'val', 'confirm-token': 'val', apply: 'bool', resume: 'bool' },
  verify: { ...COMMON, manifest: 'val', 'confirm-token': 'val' },
  unfreeze: { ...COMMON, 'no-start-containers': 'bool', 'login-url': 'val' },
  restore: { ...COMMON, backup: 'val' },
  recover: { ...COMMON },
  status: { ...COMMON },
};
const RUN = { audit: C.cmdAudit, approve: C.cmdApprove, freeze: C.cmdFreeze, backup: C.cmdBackup, clean: C.cmdClean, verify: C.cmdVerify, unfreeze: C.cmdUnfreeze, restore: C.cmdRestore, recover: C.cmdRecover, status: C.cmdStatus };

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || !SPEC[cmd]) throw new Refused(`usage: db-clean <${Object.keys(SPEC).join('|')}> --env dev|test ...  (see the header of db-clean.mjs)`, 'USAGE');
  const args = parseArgs(rest, SPEC[cmd]);
  await RUN[cmd](args);
}

main().then(
  () => process.exit(0),
  (e) => {
    if (e instanceof Refused) {
      console.error(`REFUSED [${e.code}]: ${e.message}`);
      process.exit(1);
    }
    console.error(`ERROR: ${e && e.stack ? e.stack : e}`);
    process.exit(2);
  },
);
