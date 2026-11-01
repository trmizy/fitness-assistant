/**
 * db-clean - preserved-account candidates (plan 8.1 / 12.13 item 8): where each e-mail is used (E2E fixtures) and what the dev
 * databases really say about it (role, status, last login, dependants). Read only. Nothing here decides: Ngai decides.
 *
 * Fixture sources are exactly the ones the plan names. The Capacitor harness (D:\fitnessassistant-mobile-e2e) is NOT inventoried
 * (the project is Expo-only).
 */
import fs from 'node:fs';
import path from 'node:path';

export const ALWAYS_CANDIDATES = [
  'admin@example.com',
  'john.doe@example.com',
  'pt@example.com',
  'jane.smith@example.com',
  'huytronh2@gmail.com',
  'huytronh4@gmail.com',
  'huytronh5@gmail.com',
];

export const DEFAULT_FIXTURE_SOURCES = [
  'D:\\fitnessassistant-playwright-e2e\\fixtures\\auth.ts',
  'frontend/mobile/e2e/*.e2e.ts',
  'scripts/partner-application-e2e/*',
  'D:\\fitnessassistant-teacher-demo-kit',
];

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.cjs', '.mjs', '.json', '.md', '.bat', '.ps1', '.sh', '.txt', '.yml', '.yaml', '.env']);
const SKIP_DIRS = new Set(['node_modules', 'screenshots', '.git', 'dist', 'build', 'test-results', 'playwright-report', '.auth']);
const SKIP_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml']);

function listFiles(target, repoRoot) {
  const out = [];
  const abs = path.isAbsolute(target) ? target : path.join(repoRoot, target);
  if (target.includes('*')) {
    const dir = path.dirname(abs);
    const pat = new RegExp(`^${path.basename(abs).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    if (fs.existsSync(dir)) for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isFile() && pat.test(e.name)) out.push(path.join(dir, e.name));
    return out;
  }
  if (!fs.existsSync(abs)) return out;
  const st = fs.statSync(abs);
  if (st.isFile()) return [abs];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p);
      } else if (!SKIP_FILES.has(e.name) && TEXT_EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
    }
  };
  walk(abs);
  return out;
}

/** @returns {{emails: Map<string, {file:string, line:number}[]>, sources: {source:string, files:number, missing:boolean}[]}} */
export function scanFixtures(sources, repoRoot) {
  const emails = new Map();
  const report = [];
  for (const s of sources) {
    const files = listFiles(s, repoRoot);
    const abs = path.isAbsolute(s) ? s : path.join(repoRoot, s);
    report.push({ source: s, files: files.length, missing: !s.includes('*') && !fs.existsSync(abs) });
    for (const f of files) {
      let text;
      try {
        text = fs.readFileSync(f, 'utf8');
      } catch {
        continue;
      }
      if (text.length > 4_000_000) continue;
      const lines = text.split(/\r?\n/);
      lines.forEach((ln, i) => {
        for (const m of ln.matchAll(EMAIL_RE)) {
          const e = m[0].toLowerCase();
          if (!emails.has(e)) emails.set(e, []);
          const hits = emails.get(e);
          if (hits.length < 6) hits.push({ file: f, line: i + 1 });
        }
      });
    }
  }
  return { emails, sources: report };
}

async function tryJson(db, sql, params) {
  if (!db) return null;
  try {
    return await db.json(sql, params);
  } catch {
    return null;
  }
}

/** What the databases say about each account. `dbs` = { auth, user, payment, gym, chat, fitness, ai } open (read only) connections. */
export async function accountFacts(dbs, emails) {
  const lower = emails.map((e) => e.toLowerCase());
  const users =
    (await tryJson(
      dbs.auth,
      `SELECT COALESCE(json_agg(json_build_object('id', u.id, 'email', u.email, 'role', u.role::text, 'isActive', u."isActive", 'createdAt', u."createdAt",
          'mustChangePassword', u.must_change_password,
          'lastLogin', (SELECT max(a."createdAt") FROM audit_logs a WHERE a."userId" = u.id AND a.action = 'LOGIN'),
          'loginCount', (SELECT count(*)::int FROM audit_logs a WHERE a."userId" = u.id AND a.action = 'LOGIN'),
          'refreshTokens', (SELECT count(*)::int FROM refresh_tokens r WHERE r."userId" = u.id))), '[]'::json)
         FROM users u WHERE lower(u.email) = ANY($1::text[])`,
      [lower],
    )) || [];
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const out = [];
  for (const email of lower) {
    const u = byEmail.get(email);
    if (!u) {
      out.push({ email, exists: false });
      continue;
    }
    const id = u.id;
    const one = (db, sql) => tryJson(db, sql, [id]);
    const profile = await one(dbs.user, `SELECT COALESCE((SELECT json_build_object('profileId', p.id, 'isPT', p."isPT", 'ptSuspended', p.pt_suspended) FROM user_profiles p WHERE p."userId" = $1 LIMIT 1), 'null'::json)`);
    const facts = {
      email,
      exists: true,
      userId: id,
      role: u.role,
      isActive: u.isActive,
      createdAt: u.createdAt,
      lastLogin: u.lastLogin,
      loginCount: u.loginCount,
      refreshTokens: u.refreshTokens,
      profile,
      ptApplications: await one(dbs.user, `SELECT COALESCE(json_agg(json_build_object('status', a.status::text)), '[]'::json) FROM pt_applications a JOIN user_profiles p ON p.id = a.user_profile_id WHERE p."userId" = $1`),
      contractsAsClient: await one(dbs.user, `SELECT count(*)::int FROM contracts WHERE client_user_id = $1`),
      contractsAsPt: await one(dbs.user, `SELECT count(*)::int FROM contracts WHERE pt_user_id = $1`),
      sessions: await one(dbs.user, `SELECT count(*)::int FROM sessions WHERE client_user_id = $1 OR pt_user_id = $1`),
      ptPackages: await one(dbs.user, `SELECT count(*)::int FROM pt_service_packages WHERE pt_user_id = $1`),
      inbody: await one(dbs.user, `SELECT count(*)::int FROM inbody_entries WHERE user_id = $1`),
      wallets: await one(dbs.payment, `SELECT COALESCE(json_agg(json_build_object('type', w.owner_type::text, 'available', w.available_balance::text, 'pending', w.pending_balance::text, 'locked', w.locked_balance::text)), '[]'::json) FROM wallets w WHERE w.owner_id = $1`),
      partnerAccounts: await one(dbs.gym, `SELECT COALESCE(json_agg(json_build_object('partnerId', a.partner_id, 'role', a.role::text, 'status', a.status::text, 'partnerStatus', gp.status::text)), '[]'::json) FROM gym_partner_accounts a LEFT JOIN gym_partners gp ON gp.id = a.partner_id WHERE a.user_id = $1`),
      brands: await one(dbs.gym, `SELECT count(*)::int FROM gym_brands WHERE owner_id = $1`),
      branches: await one(dbs.gym, `SELECT count(*)::int FROM gyms WHERE owner_id = $1`),
      membershipContracts: await one(dbs.gym, `SELECT count(*)::int FROM gym_membership_contracts WHERE client_id = $1`),
      gymReviews: await one(dbs.gym, `SELECT count(*)::int FROM gym_reviews WHERE client_id = $1`),
      chatConversations: await one(dbs.chat, `SELECT count(*)::int FROM conversation_participants WHERE "userId" = $1`),
      workouts: await one(dbs.fitness, `SELECT count(*)::int FROM workouts WHERE user_id = $1`),
      roadmaps: await one(dbs.fitness, `SELECT count(*)::int FROM fitness_roadmaps WHERE user_id = $1`),
      aiConversations: await one(dbs.ai, `SELECT count(*)::int FROM conversations WHERE user_id = $1`),
      aiServices: await one(dbs.ai, `SELECT count(*)::int FROM personalized_services WHERE seller_id = $1`),
    };
    out.push(facts);
  }
  return out;
}

/** Plan 12.13 item 8 verdicts. */
export function verdict(exists, fixtureHits) {
  if (!exists) return 'KHONG TON TAI (not in the dev database)';
  if (fixtureHits && fixtureHits.length) return 'CO BANG CHUNG CAN GIU (a real E2E fixture uses it)';
  return 'KHONG THAY DUNG (no fixture uses it)';
}
