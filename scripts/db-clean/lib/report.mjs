/**
 * db-clean - Markdown report for `audit --report` (plan section 16 template of Ngai: target database, environment, identifiers, tables
 * affected, row estimates, accounts to preserve with dependencies, data to delete / preserve, backup + recovery plan).
 */
import { SERVICES, CLEAN_ORDER } from './config.mjs';

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const n = (v) => (v === null || v === undefined ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const tbl = (head, rows) => `| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n${rows.map((r) => `| ${r.map((c) => esc(n(c))).join(' | ')} |`).join('\n')}\n`;

export function renderReport({ ctx, manifest, token, metadata, plan, files, partnerDbs }) {
  const p = ctx.profile;
  const L = [];
  const per = metadata.perDb;
  L.push(`# Phase G - db-clean AUDIT report (${p.name})`);
  L.push('');
  L.push('Evidence label: **REAL HTTP/API is NOT claimed**. This is a **CODE AUDIT + READ-ONLY DATABASE AUDIT** of the dev databases (every connection ran with `default_transaction_read_only = on`; no row, role, ACL or `pg_hba.conf` was written).');
  L.push('');
  L.push('## 1. Target and environment');
  L.push(tbl(['Item', 'Value'], [
    ['Environment', `${manifest.environment.envName} (${manifest.environment.host}:${manifest.environment.port}, container \`${p.container}\`)`],
    ['PostgreSQL', manifest.environment.serverVersion],
    ['Audited at', metadata.auditedAt],
    ['Operator', metadata.operator],
    ['Script version', `git ${manifest.scriptVersion.gitSha}, files sha256 \`${manifest.scriptVersion.filesSha256}\``],
    ['Partner-owned databases', partnerDbs === 'include' ? 'INCLUDED in the cleanup' : 'REPORT ONLY (ai, fitness are not in the manifest; no row of them would be deleted)'],
    ['Allowlist source', metadata.allowlistSource],
  ]));
  L.push('### Identifiers');
  L.push(tbl(['Database', 'oid', 'Service', 'In manifest'], manifest.environment.dbs.map((d) => [d.datname, d.oid, d.svc, manifest.parameters.cleanDbs.includes(d.svc) ? 'yes' : 'no (report only)'])));
  L.push(`**confirmToken** \`${token}\``);
  L.push('');
  L.push(`Manifest: \`${files.manifest}\`  \nToken file: \`${files.token}\`  \nMetadata (not in the token): \`${files.metadata}\``);
  L.push('');
  L.push(`pg_hba.conf: \`${manifest.hbaSnapshot.path}\` sha256 \`${manifest.hbaSnapshot.sha256}\`  `);
  L.push(tbl(['line', 'type', 'database', 'user', 'address', 'method'], manifest.hbaSnapshot.rules.map((r) => [r.line, r.type, r.database, r.user, r.address, r.method])));
  L.push('Roles at audit time:');
  L.push(tbl(['role', 'super', 'login', 'bypassrls', 'member of'], manifest.aclSnapshot.roles.map((r) => [r.rolname, r.rolsuper, r.rolcanlogin, r.rolbypassrls, (r.memberOf || []).join(',')])));
  if (metadata.preflightWarnings.length) L.push(`**Preflight warnings:** ${metadata.preflightWarnings.join('; ')}\n`);
  L.push(`Blockers in the manifest: ${Object.keys(manifest.blockers).length ? '```json\n' + JSON.stringify(manifest.blockers, null, 2) + '\n```' : '**none**'}`);
  L.push('');

  L.push('## 2. Row estimates per database');
  L.push(tbl(['Database', 'Rows now', 'To delete', 'Kept (policy tables)', 'Reference tables kept untouched', 'Mode'],
    SERVICES.map((s) => [per[s].datname, per[s].totals.rows, per[s].totals.delete, per[s].totals.keep, per[s].totals.preservedTablesRows, per[s].inManifest ? 'IN MANIFEST' : 'report only (partner-owned)'])));
  L.push('Order of execution (12.13 item 7): ' + CLEAN_ORDER.filter((s) => manifest.parameters.cleanDbs.includes(s)).join(' -> '));
  L.push('');
  L.push('## 3. Tables affected (row estimates, exact)');
  for (const s of CLEAN_ORDER) {
    const d = per[s];
    L.push(`### ${d.datname}${d.inManifest ? '' : ' (report only - NOT in the manifest)'}`);
    const rows = d.tables.filter((t) => t.delete > 0 || t.keep > 0 || t.total > 0).map((t) => [t.table, t.pk.join(','), t.total, t.delete, t.keep, t.note || '']);
    L.push(tbl(['table', 'primary key (read from pg_index)', 'rows', 'delete', 'keep', 'note'], rows));
    const pres = Object.entries(d.preserveTables);
    if (pres.length) L.push(`Reference / evidence tables, never touched: ${pres.map(([t, c]) => `${t} (${c})`).join(', ')}\n`);
    if (d.droppedDespitePreservedParty.length) L.push(`Rows that name a preserved account but are still deleted (the other party / a parent is deleted): ${d.droppedDespitePreservedParty.map((x) => `${x.table} ${x.rows}`).join(', ')}\n`);
    if (d.unclassified.length || d.noPk.length || d.badPk.length || d.conflicts.length || d.cycle) L.push(`**BLOCKERS:** ${JSON.stringify({ unclassified: d.unclassified, noPk: d.noPk, badPk: d.badPk, conflicts: d.conflicts, cycle: d.cycle })}\n`);
  }

  L.push('## 4. Accounts to preserve - CANDIDATES (nobody is kept by default; Ngai decides)');
  L.push('Sources: the always-list from the plan plus every e-mail found in the real E2E fixtures (D:\\fitnessassistant-playwright-e2e\\fixtures\\auth.ts, frontend/mobile/e2e/*.e2e.ts, scripts/partner-application-e2e/*, D:\\fitnessassistant-teacher-demo-kit). The Capacitor harness D:\\fitnessassistant-mobile-e2e is NOT inventoried.');
  L.push('');
  L.push(tbl(['E-mail', 'Exists', 'Role (auth)', 'Active', 'is_pt', 'Last login', 'Verdict', 'Fixture use'],
    metadata.accounts.map((a) => [a.email, a.exists ? 'yes' : 'NO', a.role, a.isActive, a.profile?.isPT, a.lastLogin, a.verdict, (a.fixtureHits || []).slice(0, 2).map((h) => `${String(h.file).split(/[\\/]/).slice(-2).join('/')}:${h.line}`).join(' ')])));
  L.push('### Dependencies of each existing candidate');
  L.push(tbl(['E-mail', 'Brands', 'Branches', 'Partner acct', 'Contracts (client/pt)', 'Sessions', 'PT pkgs', 'Wallets (type available)', 'Gym memberships', 'Chats', 'Workouts', 'Roadmaps', 'AI convs', 'InBody', 'Login count'],
    metadata.accounts.filter((a) => a.exists).map((a) => [a.email, a.brands, a.branches, (a.partnerAccounts || []).map((x) => `${x.role}/${x.status}/${x.partnerStatus}`).join(' '), `${a.contractsAsClient}/${a.contractsAsPt}`, a.sessions, a.ptPackages, (a.wallets || []).map((w) => `${w.type} ${w.available}`).join('; '), a.membershipContracts, a.chatConversations, a.workouts, a.roadmaps, a.aiConversations, a.inbody, a.loginCount])));
  L.push('');
  L.push(`Accounts in this manifest's allowlist (${manifest.allowlist.users.length} found): ${manifest.allowlist.users.map((u) => u.email).join(', ')}`);
  L.push(`E-mails in the allowlist that do not exist in the dev database: ${manifest.allowlist.missingEmails.join(', ') || 'none'}`);
  L.push(`Surviving gyms (branches) after the cleanup: ${manifest.allowlist.keptGymIds.length}`);
  L.push('');
  L.push('Kept rows protected by `rowHash` (stored in the manifest, compared at H0, H2 and H3):');
  L.push(tbl(['database', 'table', 'rows kept', 'columns excluded from the hash (volatile)'],
    manifest.allowlist.preservedRows.map((r) => [r.db, r.table, r.entries.length, (manifest.allowlist.excludedVolatileColumns[`${r.db}.${r.schema}.${r.table}`] || []).join(', ')])));

  const ex = metadata.extras;
  L.push('## 5. user-service: the 60 duplicate live PT-client pairs and the failed migration');
  L.push('```json\n' + JSON.stringify(ex.contractPairs, null, 2) + '\n```');
  L.push('Failed / rolled-back migration rows (per database):');
  L.push('```json\n' + JSON.stringify(Object.fromEntries(Object.entries(ex.failedMigrations).filter(([, v]) => Array.isArray(v) ? v.length : true)), null, 2) + '\n```');
  L.push('The cleanup never touches `_prisma_migrations`. The failed row stays; after the cleanup the operator would still have to run `prisma migrate resolve --rolled-back 20261021140000_contract_one_live_per_pair_enforce` and `migrate deploy` (not done here).');
  L.push('');
  L.push('## 6. Other databases on the server');
  L.push(tbl(['database', 'MB', 'tables', 'non-empty tables', 'error'], ex.otherDatabases.map((d) => [d.datname, d.mb, d.tables, d.nonEmptyTables && JSON.stringify(d.nonEmptyTables), d.error])));
  L.push('');
  L.push('## 7. What is deleted / what is preserved (policy summary)');
  L.push('- **Preserved untouched:** `_prisma_migrations`, geography (`vietnam_*`), the amenity catalogue + its audit log, platform commission rates, the compat-evidence tables (`legacy_compat_events`, `client_compat_events`, `compat_writer_heartbeats`), fitness/AI catalogues and the knowledge base, PLATFORM wallets.');
  L.push('- **Kept:** every row of a preserved account, and the rows below it that stay consistent (a child of a kept parent). A row involving a preserved account AND a deleted account (e.g. a contract between them) is deleted (counted in section 3).');
  L.push('- **Deleted:** everything else in the four in-scope databases (chat, payment, gym, user, auth).');
  L.push('');
  L.push('## 8. Backup and recovery plan');
  L.push('H0 `freeze` (pg_hba fence + temporary superuser `gymini_maintenance`) -> `audit --recheck` -> H1 `backup` (`pg_dump -Fc` of all 7 databases inside the one frozen window, `pg_restore --list`, trial restore into `*_restorecheck`) -> H2 `clean --apply` (one transaction per database, order above, stops at the first failure) -> H3 `verify` -> H4 `unfreeze`. Backups go to `D:\\FitnessAssistant-backups\\<timestamp>\\` (outside git). `restore --backup` restores all seven databases from ONE set. `recover` / the manual runbook (README-db-clean.md) restores `pg_hba.conf` through the OS user `postgres` and drops the maintenance role.');
  L.push('');
  L.push('NOTHING was frozen, backed up, cleaned or restored on dev. This audit stops here for Ngai.');
  return L.join('\n') + '\n';
}
