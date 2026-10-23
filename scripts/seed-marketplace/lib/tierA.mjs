// Tier A - direct DB fixtures, only for what has no API:
//   auth-service.users          : clients (CUSTOMER) and PT candidates (CUSTOMER until the real approval flow promotes them)
//   user-service.user_profiles  : one per client / PT candidate (saveDraft needs the profile to exist before Tier B runs)
//   user-service.inbody_entries : 2-4 scans for ~40 % of the clients
// NOT created here: gym owners (their accounts come from the partner-application start/verify/set-password flow, Tier B),
// PT/gym listings, contracts, memberships, wallets. Historical sessions + session reviews are SKIPPED on purpose (see SEED.md):
// they would need payment-service ledger rows that only a real, paid contract can produce consistently.
//
// Idempotent: every insert is ON CONFLICT (id) DO NOTHING with a deterministic id, so run N+1 changes nothing.
// Safe: before writing, every seed e-mail is checked; a row that already uses a seed e-mail under a DIFFERENT id (or a
// non-seed account that happens to collide) stops the whole run with SeedCollisionError. Real/preserved accounts are never
// read for writing, updated or deleted - this module has no UPDATE or DELETE statement at all.
import pg from "pg";
import bcrypt from "bcryptjs";
import { SERVICES } from "./guard.mjs";
import { chunk, isSeedEmail, seedEmail } from "./util.mjs";

export class SeedCollisionError extends Error {
  constructor(message, rows) {
    super(message);
    this.name = "SeedCollisionError";
    this.rows = rows;
  }
}

const ts = (d) => (d instanceof Date ? d.toISOString().replace("Z", "") : d);
const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);

export function makePools(target) {
  const pools = {};
  for (const s of SERVICES) {
    pools[s] = new pg.Pool({ host: target.host, port: target.port, user: target.user, password: target.password, database: target.dbs[s], max: 4 });
  }
  return pools;
}
export async function closePools(pools) {
  await Promise.all(Object.values(pools).map((p) => p.end()));
}

export function devPassword() {
  return process.env.SEED_MARKETPLACE_PASSWORD || "Seed@Gymini2026";
}

/** Every account this seed intends to own, with its deterministic id. Owners are listed for the collision check only. */
export function plannedAccounts(world) {
  const rows = [];
  for (const c of world.clients) rows.push({ id: c.profile.userId, email: c.profile.email, kind: "CLIENT" });
  for (const p of world.pts) rows.push({ id: p.userId, email: p.email, kind: "PT" });
  for (const o of world.owners) rows.push({ id: null, email: o.email, kind: "OWNER" }); // id is assigned by auth-service
  return rows;
}

/** Throws SeedCollisionError if any planned e-mail is already used by an account the seed does not own. */
export async function assertNoCollisions(pools, world) {
  const planned = plannedAccounts(world);
  for (const group of chunk(planned, 500)) {
    const emails = group.map((g) => g.email);
    const { rows } = await pools.auth.query('SELECT id, email FROM users WHERE lower(email) = ANY($1)', [emails.map((e) => e.toLowerCase())]);
    const byEmail = new Map(group.map((g) => [g.email.toLowerCase(), g]));
    const bad = [];
    for (const r of rows) {
      const want = byEmail.get(r.email.toLowerCase());
      if (!want) continue;
      // an id-less (owner) row: fine when it is a seed e-mail (previous run created it); a non-seed e-mail can never be in the plan
      const ours = isSeedEmail(r.email) && (want.id === null || want.id === r.id);
      if (!ours) bad.push({ email: r.email, existingId: r.id, expectedId: want.id });
    }
    if (bad.length) throw new SeedCollisionError(`${bad.length} planned e-mail(s) already belong to other accounts - refusing to continue (first: ${bad[0].email})`, bad);
  }
  // sanity: the plan itself must not contain a non-seed address
  const stray = planned.find((p) => !isSeedEmail(p.email));
  if (stray) throw new SeedCollisionError(`planned e-mail ${stray.email} is not on the seed domain`, [stray]);
}

async function insertMany(client, table, cols, rows, conflict = "(id)") {
  let inserted = 0;
  for (const part of chunk(rows, 200)) {
    const params = [];
    const values = part.map((row) => `(${cols.map((c) => (params.push(row[c] ?? null), `$${params.length}`)).join(",")})`);
    const quoted = cols.map((c) => `"${c}"`).join(",");
    const res = await client.query(`INSERT INTO ${table} (${quoted}) VALUES ${values.join(",")} ON CONFLICT ${conflict} DO NOTHING`, params);
    inserted += res.rowCount ?? 0;
  }
  return inserted;
}

async function inTx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export function authUserRows(world, passwordHash) {
  const mk = (id, person, email, createdAt) => ({ id, email, password: passwordHash, firstName: person.firstName, lastName: person.lastName, role: "CUSTOMER", isActive: true, must_change_password: false, createdAt: ts(createdAt), updatedAt: ts(createdAt) });
  const rows = [];
  for (const c of world.clients) rows.push(mk(c.profile.userId, c.person, c.profile.email, c.profile.createdAt));
  for (const p of world.pts) rows.push(mk(p.userId, p.person, p.email, new Date(Date.UTC(2026, 7, 1))));
  return rows;
}

export function profileRows(world) {
  const rows = [];
  for (const c of world.clients) {
    const p = c.profile;
    rows.push({
      id: p.profileId, userId: p.userId, firstName: p.firstName, lastName: p.lastName, email: p.email, isPT: false,
      date_of_birth: day(p.dateOfBirth), age: p.age, gender: p.gender, heightCm: p.heightCm, goal: p.goal, activityLevel: p.activityLevel,
      experienceLevel: p.experienceLevel, competes_in_sport: p.competesInSport, safety_screening_status: p.safetyScreeningStatus,
      safety_screening_flags: p.safetyScreeningFlags, preferredTrainingDays: p.preferredTrainingDays, availableEquipment: p.availableEquipment,
      injuries: p.injuries, preferred_split: p.preferredSplit, has_completed_onboarding: p.hasCompletedOnboarding, currentWeight: p.currentWeight,
      targetWeight: p.targetWeight, startingWeight: p.startingWeight, startingWeightSource: p.startingWeightSource, dietary_preference: p.dietaryPreference,
      nutrition_budget_level: p.nutritionBudgetLevel, region: p.region, session_duration_minutes: p.sessionDurationMinutes, pt_budget_vnd: p.ptBudgetVnd,
      first_name_normalized: p.firstNameNormalized, last_name_normalized: p.lastNameNormalized, specialties: [], createdAt: ts(p.createdAt), updatedAt: ts(p.createdAt),
    });
  }
  for (const t of world.pts) {
    const p = t.profile;
    rows.push({
      id: p.profileId, userId: p.userId, firstName: p.firstName, lastName: p.lastName, email: p.email, isPT: false, gender: p.gender, heightCm: p.heightCm,
      first_name_normalized: p.firstNameNormalized, last_name_normalized: p.lastNameNormalized, specialties: [], preferredTrainingDays: [], availableEquipment: [], injuries: [],
      createdAt: ts(new Date(Date.UTC(2026, 7, 1))), updatedAt: ts(new Date(Date.UTC(2026, 7, 1))),
    });
  }
  return rows;
}

export function inbodyRows(world) {
  const out = [];
  for (const c of world.clients)
    for (const i of c.inbody)
      out.push({
        id: i.id, user_id: i.userId, date: ts(i.date), date_only: day(i.dateOnly), weight: i.weight, height: i.height, bmi: i.bmi, body_fat: i.bodyFat, body_fat_pct: i.bodyFatPct,
        muscle_mass: i.muscleMass, visceral_fat: i.visceralFat, bmr: i.bmr, right_arm_muscle: i.rightArmMuscle, left_arm_muscle: i.leftArmMuscle, trunk_muscle: i.trunkMuscle,
        right_leg_muscle: i.rightLegMuscle, left_leg_muscle: i.leftLegMuscle, right_arm_fat: i.rightArmFat, left_arm_fat: i.leftArmFat, trunk_fat: i.trunkFat,
        right_leg_fat: i.rightLegFat, left_leg_fat: i.leftLegFat, status: i.status, created_at: ts(i.date), updated_at: ts(i.date),
      });
  return out;
}

const AUTH_COLS = ["id", "email", "password", "firstName", "lastName", "role", "isActive", "must_change_password", "createdAt", "updatedAt"];
const PROFILE_COLS = [
  "id", "userId", "firstName", "lastName", "email", "isPT", "date_of_birth", "age", "gender", "heightCm", "goal", "activityLevel", "experienceLevel", "competes_in_sport",
  "safety_screening_status", "safety_screening_flags", "preferredTrainingDays", "availableEquipment", "injuries", "preferred_split", "has_completed_onboarding", "currentWeight",
  "targetWeight", "startingWeight", "startingWeightSource", "dietary_preference", "nutrition_budget_level", "region", "session_duration_minutes", "pt_budget_vnd",
  "first_name_normalized", "last_name_normalized", "specialties", "createdAt", "updatedAt",
];
const INBODY_COLS = [
  "id", "user_id", "date", "date_only", "weight", "height", "bmi", "body_fat", "body_fat_pct", "muscle_mass", "visceral_fat", "bmr", "right_arm_muscle", "left_arm_muscle", "trunk_muscle",
  "right_leg_muscle", "left_leg_muscle", "right_arm_fat", "left_arm_fat", "trunk_fat", "right_leg_fat", "left_leg_fat", "status", "created_at", "updated_at",
];

/** Which columns a row has (rows differ: PT candidates carry fewer). Missing keys become NULL -> column default is lost, so fill defaults here. */
function normalizeProfile(r) {
  return {
    competes_in_sport: false, safety_screening_status: "UNKNOWN", safety_screening_flags: [], has_completed_onboarding: false, session_duration_minutes: 60,
    ...r,
  };
}

export async function runTierA(pools, world, { log = () => {} } = {}) {
  await assertNoCollisions(pools, world);
  const hash = await bcrypt.hash(devPassword(), 10); // hashed once, reused: the password itself is never logged
  const result = {};
  result.authUsers = await inTx(pools.auth, (c) => insertMany(c, "users", AUTH_COLS, authUserRows(world, hash)));
  log(`auth.users +${result.authUsers}`);
  result.profiles = await inTx(pools.user, (c) => insertMany(c, "user_profiles", PROFILE_COLS, profileRows(world).map(normalizeProfile)));
  log(`user_profiles +${result.profiles}`);
  result.inbody = await inTx(pools.user, (c) => insertMany(c, "inbody_entries", INBODY_COLS, inbodyRows(world)));
  log(`inbody_entries +${result.inbody}`);
  return result;
}

/** Does any seed data exist yet? (guards --reseed on dev) */
export async function seedDataPresent(pools) {
  const { rows } = await pools.auth.query(`SELECT count(*)::int AS n FROM users WHERE email LIKE '%@seed.gymini.test'`);
  return rows[0].n > 0;
}

/** Row counts of everything the seed owns, for the "three runs -> identical counts" proof. */
export async function seedCounts(pools) {
  const one = async (pool, sql) => (await pool.query(sql)).rows[0].n;
  const emailLike = `'%@seed.gymini.test'`;
  return {
    "auth.users": await one(pools.auth, `SELECT count(*)::int n FROM users WHERE email LIKE ${emailLike}`),
    "auth.users[CUSTOMER]": await one(pools.auth, `SELECT count(*)::int n FROM users WHERE email LIKE ${emailLike} AND role='CUSTOMER'`),
    "auth.users[PT]": await one(pools.auth, `SELECT count(*)::int n FROM users WHERE email LIKE ${emailLike} AND role='PT'`),
    "auth.users[GYM_OWNER]": await one(pools.auth, `SELECT count(*)::int n FROM users WHERE email LIKE ${emailLike} AND role='GYM_OWNER'`),
    "user.user_profiles": await one(pools.user, `SELECT count(*)::int n FROM user_profiles WHERE email LIKE ${emailLike}`),
    "user.inbody_entries": await one(pools.user, `SELECT count(*)::int n FROM inbody_entries WHERE user_id IN (SELECT "userId" FROM user_profiles WHERE email LIKE ${emailLike})`),
    "user.pt_applications": await one(pools.user, `SELECT count(*)::int n FROM pt_applications WHERE user_profile_id IN (SELECT id FROM user_profiles WHERE email LIKE ${emailLike})`),
    "gym.gym_partners[seed owners]": await one(pools.gym, `SELECT count(*)::int n FROM gym_partners WHERE contact_email LIKE ${emailLike}`),
    "gym.gyms": await one(pools.gym, `SELECT count(*)::int n FROM gyms WHERE email LIKE ${emailLike}`),
    "payment.wallets": await one(pools.payment, `SELECT count(*)::int n FROM wallets`),
  };
}

export { seedEmail };
