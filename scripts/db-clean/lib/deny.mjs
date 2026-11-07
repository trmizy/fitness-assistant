/**
 * db-clean - row-level deny list (`audit --deny-file F`) and the guards that go with it.
 *
 * The cleanup is an allowlist of ACCOUNTS: everything owned by a preserved account survives. E2E test data that sits under a preserved
 * owner (jane.smith's E2E gyms, the E2E catalogue amenities, E2E packages) can therefore not be expressed by the allowlist. The deny file
 * names such rows by NAME PATTERN:
 *
 *   { "gymNameLike": ["E2E%"], "amenityNameLike": ["E2E\\_%"], "proposalNameLike": ["E2E\\_%"], "packageNameLike": ["E2E%"] }
 *
 *   - every pattern is a SQL LIKE pattern and MUST start with the literal text "E2E" (case-sensitive) - anything else is refused;
 *   - the audit EXPANDS the patterns into explicit id lists and writes patterns + ids into the manifest (`deny`), so they are covered by
 *     the confirmToken; recheck / freeze / clean re-derive the ids from the patterns and must find exactly the same ones;
 *   - the policy (lib/policy.mjs) reads the id lists as $4 (gyms) $5 (amenities) $6 (amenity proposals) $7 (packages);
 *   - guards (below) turn dangerous situations into BLOCKERS (the manifest cannot be applied): a denied gym with a live contract / active
 *     membership / money in its wallet, and any dispute row that depends on something that would be deleted.
 *     A denied package that a contract still points at is NOT denied: it is kept and listed (`deny.keptDespiteDeny`).
 */
import fs from 'node:fs';
import { Refused, readJson } from './util.mjs';
import { makeKeep } from './policy.mjs';
import { rulesFor, paramList, GUARD } from './engine.mjs';
import { computeTriggerPreflight } from './triggers.mjs';

export const DENY_KEYS = ['gymNameLike', 'amenityNameLike', 'proposalNameLike', 'packageNameLike'];
// Name patterns must start with E2E. The explicit id lists and the wallet acknowledgements are separate keys: they name exact rows.
export const REQUIRED_PREFIX = 'E2E';

export const EXPLICIT_KEYS = ['explicitProposals', 'explicitAmenities'];
export const ACK_KEY = 'acknowledgedWalletsWithMoney';
export const emptyPatterns = () => ({ gymNameLike: [], amenityNameLike: [], proposalNameLike: [], packageNameLike: [], explicitProposals: [], explicitAmenities: [], [ACK_KEY]: [] });

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const normExplicit = (k, v) => {
  if (!Array.isArray(v)) throw new Refused(`deny file: "${k}" must be an array of {id, expectedName}`, 'DENY_EXPLICIT');
  const out = v.map((e) => {
    if (!isObj(e) || typeof e.id !== 'string' || !e.id || typeof e.expectedName !== 'string' || !e.expectedName || Object.keys(e).some((x) => !['id', 'expectedName'].includes(x))) {
      throw new Refused(`deny file: every "${k}" entry must be exactly {id, expectedName} (non-empty strings)`, 'DENY_EXPLICIT');
    }
    return { id: e.id, expectedName: e.expectedName };
  });
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
};
const normAck = (v) => {
  if (!Array.isArray(v)) throw new Refused(`deny file: "${ACK_KEY}" must be an array of {walletId, gymId, availableVnd}`, 'DENY_ACK');
  const out = v.map((e) => {
    if (!isObj(e) || typeof e.walletId !== 'string' || !e.walletId || typeof e.gymId !== 'string' || !e.gymId || !Number.isFinite(e.availableVnd) || e.availableVnd <= 0 || Object.keys(e).some((x) => !['walletId', 'gymId', 'availableVnd'].includes(x))) {
      throw new Refused(`deny file: every "${ACK_KEY}" entry must be exactly {walletId, gymId, availableVnd > 0} (full ids)`, 'DENY_ACK');
    }
    return { walletId: e.walletId, gymId: e.gymId, availableVnd: e.availableVnd };
  });
  return out.sort((a, b) => (a.walletId < b.walletId ? -1 : a.walletId > b.walletId ? 1 : 0));
};

/** Validate + normalise (sorted, unique). Throws Refused('DENY_PATTERN') on any problem. */
export function validatePatterns(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new Refused('the deny file must be a JSON object', 'DENY_PATTERN');
  const out = emptyPatterns();
  for (const k of Object.keys(obj)) {
    if (EXPLICIT_KEYS.includes(k)) {
      out[k] = normExplicit(k, obj[k]);
      continue;
    }
    if (k === ACK_KEY) {
      out[k] = normAck(obj[k]);
      continue;
    }
    if (!DENY_KEYS.includes(k)) throw new Refused(`deny file: unknown key "${k}" (allowed: ${[...DENY_KEYS, ...EXPLICIT_KEYS, ACK_KEY].join(', ')})`, 'DENY_PATTERN');
    const v = typeof obj[k] === 'string' ? [obj[k]] : obj[k];
    if (!Array.isArray(v)) throw new Refused(`deny file: "${k}" must be a string or an array of strings`, 'DENY_PATTERN');
    for (const p of v) {
      if (typeof p !== 'string' || !p.startsWith(REQUIRED_PREFIX)) {
        throw new Refused(`deny file: pattern ${JSON.stringify(p)} in "${k}" does not start with "${REQUIRED_PREFIX}" (case-sensitive). Only E2E-prefixed patterns are allowed.`, 'DENY_PATTERN');
      }
    }
    out[k] = [...new Set(v)].sort();
  }
  return out;
}

export function loadDenyFile(file) {
  if (!fs.existsSync(file)) throw new Refused(`deny file not found: ${file}`, 'BAD_ARGS');
  let raw;
  try {
    raw = readJson(file);
  } catch (e) {
    throw new Refused(`deny file is not valid JSON: ${e.message}`, 'DENY_PATTERN');
  }
  return validatePatterns(raw);
}

export const emptyDeny = () => ({ patterns: emptyPatterns(), gymIds: [], amenityIds: [], proposalIds: [], packageIds: [], keptDespiteDeny: [] });

const ids = (db, table, patterns) =>
  patterns.length === 0
    ? Promise.resolve([])
    : db.json(`SELECT COALESCE(json_agg(id ORDER BY id), '[]'::json) FROM "${table}" WHERE name LIKE ANY($1::text[])`, [patterns]);

/** patterns -> explicit id lists (read only). dbs: { gym, user }. */
export async function expandDeny(dbs, patternsIn) {
  const patterns = validatePatterns(patternsIn);
  const out = emptyDeny();
  out.patterns = patterns;
  out.gymIds = await ids(dbs.gym, 'gyms', patterns.gymNameLike);
  out.amenityIds = await ids(dbs.gym, 'amenities', patterns.amenityNameLike);
  out.proposalIds = await ids(dbs.gym, 'amenity_proposals', patterns.proposalNameLike);
  // explicit ids: must exist AND carry the expected name, else the whole audit/recheck is refused
  for (const [list, table, target] of [[patterns.explicitAmenities, 'amenities', 'amenityIds'], [patterns.explicitProposals, 'amenity_proposals', 'proposalIds']]) {
    for (const e of list) {
      const rows = await dbs.gym.json(`SELECT COALESCE(json_agg(name), '[]'::json) FROM "${table}" WHERE id = $1`, [e.id]);
      if (rows.length !== 1) throw new Refused(`deny file: explicit ${table} id ${e.id} does not exist`, 'DENY_EXPLICIT');
      if (rows[0] !== e.expectedName) throw new Refused(`deny file: explicit ${table} id ${e.id} is named ${JSON.stringify(rows[0])}, expected ${JSON.stringify(e.expectedName)}`, 'DENY_EXPLICIT');
      out[target] = [...new Set([...out[target], e.id])].sort();
    }
  }
  if (patterns.packageNameLike.length) {
    const r = await dbs.user.json(
      `SELECT json_build_object(
         'ids', COALESCE((SELECT json_agg(p.id ORDER BY p.id) FROM pt_service_packages p WHERE p.name LIKE ANY($1::text[]) AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.package_id = p.id)), '[]'::json),
         'kept', COALESCE((SELECT json_agg(json_build_object('table', 'pt_service_packages', 'id', p.id, 'name', p.name, 'contracts', (SELECT count(*)::int FROM contracts c WHERE c.package_id = p.id)) ORDER BY p.id)
                            FROM pt_service_packages p WHERE p.name LIKE ANY($1::text[]) AND EXISTS (SELECT 1 FROM contracts c WHERE c.package_id = p.id)), '[]'::json))`,
      [patterns.packageNameLike],
    );
    out.packageIds = r.ids;
    out.keptDespiteDeny = r.kept;
  }
  return out;
}

/** The fields of a deny object that the policy sees. */
export const denyParams = (deny) => ({ gymIds: deny.gymIds, amenityIds: deny.amenityIds, proposalIds: deny.proposalIds, packageIds: deny.packageIds });

/** Compare the deny section of a manifest with the one re-derived from its patterns now. Problems carry a "[datname]" prefix (see progressTouched in clean.mjs). */
export function denyProblems(ctx, stored, fresh) {
  if (!stored) return ['the manifest has no "deny" section (it was made by an older tool version)'];
  const problems = [];
  const where = { gymIds: 'gym', amenityIds: 'gym', proposalIds: 'gym', packageIds: 'user' };
  for (const k of ['gymIds', 'amenityIds', 'proposalIds', 'packageIds']) {
    if (JSON.stringify(fresh[k]) !== JSON.stringify(stored[k])) {
      const dat = ctx.profile.dbName(where[k]);
      const extra = fresh[k].filter((x) => !stored[k].includes(x));
      const missing = stored[k].filter((x) => !fresh[k].includes(x));
      problems.push(`[${dat}] deny ${k} differ from the patterns re-derived now: ${extra.length} new match(es) ${JSON.stringify(extra.slice(0, 20))}, ${missing.length} approved but no longer matching ${JSON.stringify(missing.slice(0, 20))}`);
    }
  }
  if (JSON.stringify(fresh.keptDespiteDeny) !== JSON.stringify(stored.keptDespiteDeny)) problems.push(`[${ctx.profile.dbName('user')}] deny.keptDespiteDeny differs from the data now`);
  return problems;
}

/** Pure check (no database) of the deny section of a manifest: patterns valid, every list an array of strings. */
export function denyStaticProblems(deny) {
  if (!deny) return ['the manifest has no "deny" section (it was made by an older tool version)'];
  try {
    validatePatterns(deny.patterns);
  } catch (e) {
    return [`manifest deny patterns are invalid: ${e.message}`];
  }
  const bad = ['gymIds', 'amenityIds', 'proposalIds', 'packageIds'].filter((k) => !Array.isArray(deny[k]) || deny[k].some((x) => typeof x !== 'string'));
  return bad.map((k) => `manifest deny.${k} is not a list of ids`);
}

// ---------------------------------------------------------------------------------------------------- guards
const LIVE_USER_CONTRACT = `('PENDING_REVIEW', 'PENDING_SIGNATURE', 'PENDING_PAYMENT', 'ACTIVE')`;
const LIVE_MEMBERSHIP = `('PENDING_PAYMENT', 'ACTIVE', 'PENDING_ISSUE')`;
const DISPUTE_USER_COLS = [
  ['dispute_cases', ['client_user_id', 'pt_user_id', 'investigator_id']],
  ['dispute_case_access_logs', ['viewer_user_id']],
  ['dispute_case_approvals', ['approver_id']],
  ['dispute_case_assessments', ['assessor_id']],
  ['dispute_case_events', ['actor_user_id']],
  ['dispute_case_executions', ['actor_user_id']],
  ['dispute_case_proposals', ['proposer_id']],
  ['dispute_case_statements', ['author_user_id']],
];
const DISPUTE_CONTRACT_COLS = [['dispute_cases', 'contract_id'], ['dispute_case_evidence', 'scope_contract_id']];
const DISPUTE_SESSION_COLS = [['dispute_cases', 'session_id'], ['dispute_case_evidence', 'scope_session_id'], ['dispute_case_executions', 'session_id']];

const exists = async (db, table) => (await db.json(`SELECT to_json(to_regclass('public.' || $1::text) IS NOT NULL)`, [table])) === true;

/**
 * Blockers + report info. Read only. `plan.params` carries the deny lists. Returns { blockers, info } where blockers is
 * { disputeDependencies?: [...], deniedGymLiveRefs?: [...] } (empty object when everything is fine).
 */
export async function computeGuards(ctx, plan, cleanDbs) {
  const P = paramList(plan.params);
  const blockers = {};
  const info = {};
  const dbs = ctx.dbs;
  const userDat = ctx.profile.dbName('user');
  const gymDat = ctx.profile.dbName('gym');
  const payDat = ctx.profile.dbName('payment');

  // ---- dispute rows (PRESERVE tables): nothing they point at may be deleted
  const K = makeKeep(rulesFor('user', ctx.policy));
  const dispute = [];
  for (const [table, cols] of DISPUTE_USER_COLS) {
    if (!(await exists(dbs.user, table))) continue;
    for (const c of cols) {
      const rows = await dbs.user.json(`SELECT count(*)::int FROM "${table}" t WHERE t."${c}" IS NOT NULL AND NOT (t."${c}" = ANY($1::text[])) AND ${GUARD}`, P);
      if (rows > 0) dispute.push({ db: userDat, table, column: c, rows, reason: 'names an account that is not preserved and would be deleted' });
    }
  }
  for (const [table, col] of DISPUTE_CONTRACT_COLS) {
    if (!(await exists(dbs.user, table))) continue;
    const gone = await dbs.user.json(
      `SELECT count(*)::int FROM "${table}" t WHERE t."${col}" IS NOT NULL AND EXISTS (SELECT 1 FROM contracts c WHERE c.id = t."${col}" AND NOT COALESCE(${K('contracts', 'c')}, FALSE)) AND ${GUARD}`,
      P,
    );
    if (gone > 0) dispute.push({ db: userDat, table, column: col, rows: gone, reason: 'refers to a contract that would be deleted' });
    const gym = await dbs.user.json(`SELECT count(*)::int FROM "${table}" t WHERE t."${col}" IS NOT NULL AND EXISTS (SELECT 1 FROM contracts c WHERE c.id = t."${col}" AND c.gym_id = ANY($4::text[])) AND ${GUARD}`, P);
    if (gym > 0) dispute.push({ db: userDat, table, column: col, rows: gym, reason: 'refers to a contract of a DENIED gym' });
  }
  for (const [table, col] of DISPUTE_SESSION_COLS) {
    if (!(await exists(dbs.user, table))) continue;
    const gone = await dbs.user.json(
      `SELECT count(*)::int FROM "${table}" t WHERE t."${col}" IS NOT NULL AND EXISTS (SELECT 1 FROM sessions s WHERE s.id = t."${col}" AND NOT COALESCE(${K('sessions', 's')}, FALSE)) AND ${GUARD}`,
      P,
    );
    if (gone > 0) dispute.push({ db: userDat, table, column: col, rows: gone, reason: 'refers to a session that would be deleted' });
  }
  if (dispute.length) blockers.disputeDependencies = dispute;

  // ---- denied gyms: nothing live may hang on them
  const live = [];
  const denied = plan.params.deny?.gymIds ?? [];
  if (denied.length) {
    const mc = await dbs.gym.json(
      `SELECT COALESCE(json_agg(json_build_object('gymId', gym_id, 'rows', n)), '[]'::json) FROM (SELECT gym_id, count(*)::int n FROM gym_membership_contracts WHERE gym_id = ANY($1::text[]) AND status::text IN ${LIVE_MEMBERSHIP} GROUP BY 1) x`,
      [denied],
    );
    if (mc.length) live.push({ db: gymDat, table: 'gym_membership_contracts', reason: 'live membership (PENDING_PAYMENT / ACTIVE / PENDING_ISSUE) on a denied gym', gyms: mc });
    const uc = await dbs.user.json(
      `SELECT COALESCE(json_agg(json_build_object('gymId', gym_id, 'rows', n)), '[]'::json) FROM (SELECT gym_id, count(*)::int n FROM contracts WHERE gym_id = ANY($1::text[]) AND status::text IN ${LIVE_USER_CONTRACT} GROUP BY 1) x`,
      [denied],
    );
    if (uc.length) live.push({ db: userDat, table: 'contracts', reason: 'live PT contract on a denied gym', gyms: uc });
    const w = await dbs.payment.json(
      `SELECT COALESCE(json_agg(json_build_object('walletId', id, 'gymId', owner_id, 'available', available_balance::text, 'pending', pending_balance::text, 'locked', locked_balance::text, 'holdback', holdback_balance::text)), '[]'::json)
         FROM wallets WHERE owner_type::text = 'GYM' AND owner_id = ANY($1::text[]) AND (available_balance <> 0 OR pending_balance <> 0 OR locked_balance <> 0 OR holdback_balance <> 0)`,
      [denied],
    );
    const acks = ctx.denyPatterns?.[ACK_KEY] ?? plan.deny?.patterns?.[ACK_KEY] ?? [];
    const waived = [];
    const stillBlocking = w.filter((x) => {
      const ok = acks.find((a) => a.walletId === x.walletId && a.gymId === x.gymId && Number(x.available) === a.availableVnd && Number(x.pending) === 0 && Number(x.locked) === 0 && Number(x.holdback) === 0);
      if (ok) waived.push({ ...x, acknowledgedVnd: ok.availableVnd });
      return !ok;
    });
    info.waivedWalletsWithMoney = waived;
    if (stillBlocking.length) live.push({ db: payDat, table: 'wallets', reason: 'a denied gym wallet still holds money (not acknowledged with exactly this wallet id, gym id and amount)', wallets: stillBlocking });
    info.deniedGymContractsNotLive = await dbs.user.json(`SELECT count(*)::int FROM contracts WHERE gym_id = ANY($1::text[]) AND status::text NOT IN ${LIVE_USER_CONTRACT}`, [denied]);
  }
  if (live.length) blockers.deniedGymLiveRefs = live;

  // ---- explicit amenities must not be used by anything that survives
  const expl = plan.params.deny?.amenityIds ?? [];
  const explicitIds = (plan.deny?.patterns?.explicitAmenities ?? []).map((e) => e.id);
  if (explicitIds.length) {
    const inUse = await dbs.gym.json(
      `SELECT COALESCE(json_agg(json_build_object('amenityId', ga.amenity_id, 'gymId', ga.gym_id, 'gymName', g.name, 'via', 'gym_amenities')), '[]'::json)
         FROM gym_amenities ga JOIN gyms g ON g.id = ga.gym_id WHERE ga.amenity_id = ANY($1::text[]) AND NOT (ga.gym_id = ANY($2::text[]))`,
      [explicitIds, plan.params.deny?.gymIds ?? []],
    );
    const rev = await dbs.gym.json(
      `SELECT COALESCE(json_agg(json_build_object('amenityId', a, 'gymId', r.gym_id, 'revisionId', r.id, 'status', r.status::text, 'via', 'revision payload')), '[]'::json)
         FROM gym_listing_revisions r CROSS JOIN unnest($1::text[]) a
        WHERE r.payload::text LIKE '%' || a || '%' AND NOT (r.gym_id = ANY($2::text[])) AND r.status::text IN ('DRAFT', 'PENDING')`,
      [explicitIds, plan.params.deny?.gymIds ?? []],
    );
    const used = [...inUse, ...rev].map((x) => ({ db: gymDat, ...x }));
    if (used.length) blockers.explicitAmenityInUse = used;
  }
  void expl;

  // ---- information only
  if ((plan.params.deny?.amenityIds ?? []).length) {
    info.listingRevisionsMentioningDeniedAmenities = await dbs.gym.json(
      `SELECT count(*)::int FROM gym_listing_revisions r WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) a WHERE r.payload::text LIKE '%' || a || '%')`,
      [plan.params.deny.amenityIds],
    );
  }
  // ---- immutability guards / triggers that the delete would fire (lib/triggers.mjs): anything not allowlisted is a blocker
  let triggers = null;
  if (cleanDbs) {
    triggers = await computeTriggerPreflight(ctx, plan, cleanDbs);
    if (triggers.blockers.length) blockers.triggerGuards = triggers.blockers;
  }
  return { blockers, info, triggers };
}

/**
 * Wallet proof for the payment transactions that are deleted together with a deleted party: every KEPT wallet that is involved
 * (owner pays / is paid in / is the gym of a deleted transaction, or holds a ledger entry of one) with its balances, and how many of its
 * ledger entries the cleanup would delete (must be 0: ledger entries follow their wallet, and a kept ledger entry pins its transaction).
 * "after" is the same row: kept wallets are rowHash-verified (balances included, only updated_at excluded) before COMMIT.
 */
export async function walletImpact(ctx, plan) {
  const rules = rulesFor('payment', ctx.policy);
  const K = makeKeep(rules);
  const P = paramList(plan.params);
  try {
    return await ctx.dbs.payment.json(
      `WITH dt AS (SELECT t.id, t.payer_id, t.pt_id, t.gym_id FROM payment_transactions t WHERE NOT COALESCE(${K('payment_transactions', 't')}, FALSE) AND ${GUARD}),
            inv AS (SELECT w.* FROM wallets w WHERE COALESCE(${K('wallets', 'w')}, FALSE) AND ${GUARD}
                      AND (w.owner_id IN (SELECT payer_id FROM dt) OR w.owner_id IN (SELECT pt_id FROM dt WHERE pt_id IS NOT NULL) OR w.owner_id IN (SELECT gym_id FROM dt WHERE gym_id IS NOT NULL)
                           OR EXISTS (SELECT 1 FROM wallet_ledger_entries l JOIN dt ON dt.id = l.transaction_id WHERE l.wallet_id = w.id)))
       SELECT json_build_object(
         'deletedTransactions', (SELECT count(*)::int FROM dt),
         'involvedKeptWallets', COALESCE((SELECT json_agg(json_build_object('walletId', w.id, 'ownerType', w.owner_type::text, 'ownerId', w.owner_id,
              'before', json_build_object('available', w.available_balance::text, 'pending', w.pending_balance::text, 'locked', w.locked_balance::text, 'holdback', w.holdback_balance::text),
              'after', json_build_object('available', w.available_balance::text, 'pending', w.pending_balance::text, 'locked', w.locked_balance::text, 'holdback', w.holdback_balance::text),
              'ledgerEntriesKept', (SELECT count(*)::int FROM wallet_ledger_entries l WHERE l.wallet_id = w.id),
              'ledgerEntriesDeleted', (SELECT count(*)::int FROM wallet_ledger_entries l WHERE l.wallet_id = w.id AND NOT COALESCE(${K('wallet_ledger_entries', 'l')}, FALSE))) ORDER BY w.id) FROM inv w), '[]'::json),
         'deletedWalletsWithBalance', COALESCE((SELECT json_agg(json_build_object('walletId', w.id, 'ownerType', w.owner_type::text, 'available', w.available_balance::text, 'pending', w.pending_balance::text, 'locked', w.locked_balance::text, 'holdback', w.holdback_balance::text) ORDER BY w.id)
              FROM wallets w WHERE NOT COALESCE(${K('wallets', 'w')}, FALSE) AND ${GUARD} AND (w.available_balance <> 0 OR w.pending_balance <> 0 OR w.locked_balance <> 0 OR w.holdback_balance <> 0)), '[]'::json))`,
      P,
    );
  } catch (e) {
    return { error: e.message };
  }
}
