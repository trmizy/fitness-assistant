// `--target official` (thesis-defense databases gymcoach_<svc>_official): guard, emptiness preflight, media env, ward-geo loader.
// Pure / fake-pool tests: no database, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { assertSeedAllowed, resolveTarget, SeedGuardError } from "../lib/guard.mjs";
import { assertOfficialKnownAccountsOnly, assertOfficialTargetEmpty } from "../lib/preflight.mjs";
import { assertTargetReadyForScale } from "../lib/scale/checkpoint.mjs";
import { createScaleS3Clients, isScaleMinioEndpoint, probeS3Buckets } from "../lib/scale/media.mjs";
import { assertLoadWardGeoAllowed } from "../load-ward-geo.mjs";

const OK_ENV = { SEED_MARKETPLACE_CONFIRM: "official" };
const names = (suffix) => ({ auth: `gymcoach_auth_${suffix}`, user: `gymcoach_user_${suffix}`, gym: `gymcoach_gym_${suffix}`, payment: `gymcoach_payment_${suffix}` });
const official = (over = {}) => ({ kind: "official", host: "localhost", port: 5433, dbs: names("official"), ...over });
const refuses = (fn, code) => assert.throws(fn, (e) => e instanceof SeedGuardError && e.code === code, `expected ${code}`);

test("official: resolveTarget defaults to localhost:5433 and the four gymcoach_<svc>_official DBs", () => {
  const t = resolveTarget({ kind: "official", env: {} });
  assert.equal(t.kind, "official");
  assert.equal(t.host, "localhost");
  assert.equal(t.port, 5433);
  assert.deepEqual(t.dbs, names("official"));
  const custom = resolveTarget({ kind: "official", env: { SEED_PG_HOST: "127.0.0.1", SEED_PG_PORT: "55460" } });
  assert.equal(custom.port, 55460);
  assert.deepEqual(Object.keys(custom.dbs), ["auth", "user", "gym", "payment"]);
});

test("official: accepted with _official names + SEED_MARKETPLACE_CONFIRM=official on loopback", () => {
  assert.deepEqual(assertSeedAllowed(official(), { env: OK_ENV }), { kind: "official", requiresEmptyCheck: true });
  for (const host of ["localhost", "127.0.0.1", "::1"]) assert.equal(assertSeedAllowed(official({ host }), { env: OK_ENV }).kind, "official");
});

test("official: refuses a missing or wrong confirm, and NODE_ENV=production", () => {
  refuses(() => assertSeedAllowed(official(), { env: {} }), "CONFIRM_MISSING");
  for (const wrong of ["scale", "partner", "dev", "OFFICIAL", "true", ""]) {
    refuses(() => assertSeedAllowed(official(), { env: { SEED_MARKETPLACE_CONFIRM: wrong } }), "CONFIRM_MISSING");
  }
  refuses(() => assertSeedAllowed(official(), { env: { ...OK_ENV, NODE_ENV: "production" } }), "PRODUCTION_REFUSED");
});

test("official: refuses dev, test, seedrun, scale and other-suffix database names", () => {
  for (const suffix of ["", "seed_test", "test", "scale", "seedrun", "demo", "official2", "official_x"]) {
    const dbs = names(suffix).auth === "gymcoach_auth_" ? { auth: "gymcoach_auth", user: "gymcoach_user", gym: "gymcoach_gym", payment: "gymcoach_payment" } : names(suffix);
    refuses(() => assertSeedAllowed(official({ dbs }), { env: OK_ENV }), "DB_NOT_ALLOWLISTED");
  }
  // one bad name among four official ones is enough
  refuses(() => assertSeedAllowed(official({ dbs: { ...names("official"), gym: "gymcoach_gym" } }), { env: OK_ENV }), "DB_NOT_ALLOWLISTED");
  refuses(() => assertSeedAllowed(official({ dbs: { ...names("official"), payment: "gymcoach_payment_scale" } }), { env: OK_ENV }), "DB_NOT_ALLOWLISTED");
});

test("official: refuses names containing prod/staging/live and a service/name mismatch", () => {
  for (const bad of ["gymcoach_user_official_prod", "gymcoach_user_staging_official", "gymcoach_user_live_official", "gymcoach_user_PRODUCTION"]) {
    refuses(() => assertSeedAllowed(official({ dbs: { ...names("official"), user: bad } }), { env: OK_ENV }), "FORBIDDEN_DB_NAME");
  }
  refuses(() => assertSeedAllowed(official({ dbs: { ...names("official"), user: "gymcoach_auth_official" } }), { env: OK_ENV }), "DB_SERVICE_MISMATCH");
  refuses(() => assertSeedAllowed(official({ dbs: { ...names("official"), user: "gymcoach_fitness_official" } }), { env: OK_ENV }), "DB_SERVICE_MISMATCH");
});

test("official: seeds exactly auth/user/gym/payment - an extra or missing service database is refused", () => {
  refuses(() => assertSeedAllowed(official({ dbs: { ...names("official"), fitness: "gymcoach_fitness_official" } }), { env: OK_ENV }), "DB_NOT_ALLOWLISTED");
  const { payment, ...three } = names("official");
  assert.ok(payment);
  refuses(() => assertSeedAllowed(official({ dbs: three }), { env: OK_ENV }), "NO_TARGET");
});

test("official: non-loopback host needs the explicit allowRemoteHost option; prod-like hosts and the scale endpoint never pass", () => {
  refuses(() => assertSeedAllowed(official({ host: "db.example.org" }), { env: OK_ENV }), "HOST_NOT_ALLOWED");
  refuses(() => assertSeedAllowed(official({ host: "gymcoach-postgres" }), { env: OK_ENV }), "HOST_NOT_ALLOWED");
  refuses(() => assertSeedAllowed(official({ host: "db.example.org" }), { env: OK_ENV, allowRemoteHost: false }), "HOST_NOT_ALLOWED");
  assert.equal(assertSeedAllowed(official({ host: "db.example.org" }), { env: OK_ENV, allowRemoteHost: true }).kind, "official");
  // the flag never widens anything else
  refuses(() => assertSeedAllowed(official({ host: "prod-db.example.org" }), { env: OK_ENV, allowRemoteHost: true }), "FORBIDDEN_DB_NAME");
  refuses(() => assertSeedAllowed(official({ host: "pg.staging.example.org" }), { env: OK_ENV, allowRemoteHost: true }), "FORBIDDEN_DB_NAME");
  refuses(() => assertSeedAllowed(official({ host: "live.example.org" }), { env: OK_ENV, allowRemoteHost: true }), "FORBIDDEN_DB_NAME");
  refuses(() => assertSeedAllowed(official({ port: 55440 }), { env: OK_ENV, allowRemoteHost: true }), "HOST_NOT_ALLOWED");
  refuses(() => assertSeedAllowed(official({ host: "gymcoach-postgres-scale", port: 5432 }), { env: OK_ENV, allowRemoteHost: true }), "HOST_NOT_ALLOWED");
  refuses(() => assertSeedAllowed(official({ dbs: names("seed_test") }), { env: OK_ENV, allowRemoteHost: true }), "DB_NOT_ALLOWLISTED");
});

test("other targets can never touch *_official databases", () => {
  const dbs = names("official");
  const allSeven = { ...dbs, fitness: "gymcoach_fitness_official", ai: "gymcoach_ai_official", chat: "gymcoach_chat_official" };
  refuses(() => assertSeedAllowed({ kind: "partner", host: "localhost", port: 5433, dbs: allSeven }, { env: { SEED_MARKETPLACE_CONFIRM: "partner" } }), "DB_NOT_ALLOWLISTED");
  refuses(() => assertSeedAllowed({ kind: "fresh", host: "localhost", port: 5433, dbs: allSeven }, { env: {} }), "DB_NOT_ALLOWLISTED");
  refuses(() => assertSeedAllowed({ kind: "test", host: "localhost", port: 55433, dbs }, { env: {} }), "DB_NOT_ALLOWLISTED");
  refuses(() => assertSeedAllowed({ kind: "dev", host: "localhost", port: 5433, dbs }, { env: { SEED_MARKETPLACE_CONFIRM: "dev" }, markerPath: null }), "DB_NOT_ALLOWLISTED");
  // scale kind keeps its own allowlist
  refuses(() => assertSeedAllowed({ kind: "scale", host: "localhost", port: 55440, dbs: allSeven }, { env: { SEED_MARKETPLACE_CONFIRM: "scale" } }), "DB_NOT_ALLOWLISTED");
  // and the official guard does not weaken "dev DBs with the official confirm": confirm=official does not unlock dev
  refuses(() => assertSeedAllowed({ kind: "dev", host: "localhost", port: 5433, dbs: { auth: "gymcoach_auth", user: "gymcoach_user", gym: "gymcoach_gym", payment: "gymcoach_payment" } }, { env: OK_ENV, markerPath: null }), "MARKER_MISSING");
});

// ---- emptiness / foreign-account preflight (fake pools) --------------------------------------------------------------------------
function fakePool(tables, extra = {}) {
  return {
    query: async (sql) => {
      if (sql.includes("FROM pg_tables")) return { rows: Object.keys(tables).map((tablename) => ({ tablename })) };
      const count = sql.match(/FROM public\."([^"]+)"/);
      if (count) return { rows: [{ n: tables[count[1]] }] };
      if (sql.includes("FROM wallets")) return { rows: [{ n: extra.walletsDirty ?? 0 }] };
      if (sql.includes("NOT (email ILIKE") || sql.includes("NOT (")) return { rows: [{ n: extra.foreign ?? 0 }] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}
const emptyPools = (over = {}) => ({
  auth: fakePool({ _prisma_migrations: 12, users: 0 }),
  user: fakePool({ _prisma_migrations: 90, vietnam_provinces: 34, vietnam_wards: 3321, vietnam_ward_geo: 3321, user_profiles: 0 }),
  gym: fakePool({ _prisma_migrations: 40, amenities: 18, platform_commission_rates: 1, gyms: 0 }),
  payment: fakePool({ _prisma_migrations: 30, wallets: 1, payment_transactions: 0 }),
  ...over,
});

test("official emptiness: migration rows, reference tables (provinces, wards, ward geo, amenities) and the empty platform wallet are tolerated", async () => {
  const counts = await assertOfficialTargetEmpty(emptyPools());
  assert.equal(counts["payment.wallets"], 0);
});

test("official emptiness: any business row (even one) refuses, naming the table", async () => {
  await assert.rejects(assertOfficialTargetEmpty(emptyPools({ auth: fakePool({ users: 1 }) })), (e) => e.code === "OFFICIAL_NOT_EMPTY" && /auth\.users=1/.test(e.message));
  await assert.rejects(assertOfficialTargetEmpty(emptyPools({ gym: fakePool({ gyms: 2500 }) })), (e) => e.code === "OFFICIAL_NOT_EMPTY");
  await assert.rejects(assertOfficialTargetEmpty(emptyPools({ payment: fakePool({ wallets: 5 }, { walletsDirty: 5 }) })), (e) => e.code === "OFFICIAL_NOT_EMPTY");
  await assert.rejects(assertOfficialTargetEmpty({ auth: emptyPools().auth }), (e) => e.code === "NO_TARGET");
});

test("scale tier preflight on official: non-empty refuses (SCALE_ALREADY_SEEDED) unless --resume with a checkpoint", async () => {
  const target = official();
  await assertTargetReadyForScale({ target, pools: emptyPools(), resume: false });
  await assert.rejects(assertTargetReadyForScale({ target, pools: emptyPools({ user: fakePool({ user_profiles: 3 }) }), resume: false }), (e) => e.code === "SCALE_ALREADY_SEEDED");
  await assert.rejects(assertTargetReadyForScale({ target, pools: emptyPools(), resume: true, checkpoint: null }), (e) => e.code === "RESUME_CHECKPOINT_MISSING");
  await assertTargetReadyForScale({ target, pools: emptyPools({ user: fakePool({ user_profiles: 3 }) }), resume: true, checkpoint: { ok: true } });
});

test("official business seed: only scale/seed-domain accounts may already exist", async () => {
  await assertOfficialKnownAccountsOnly({ auth: fakePool({}, { foreign: 0 }), user: fakePool({}, { foreign: 0 }) });
  await assert.rejects(assertOfficialKnownAccountsOnly({ auth: fakePool({}, { foreign: 2 }), user: fakePool({}, { foreign: 0 }) }), (e) => e.code === "OFFICIAL_FOREIGN_DATA");
  await assert.rejects(assertOfficialKnownAccountsOnly({ auth: fakePool({}, { foreign: 0 }), user: fakePool({}, { foreign: 1 }) }), (e) => e.code === "OFFICIAL_FOREIGN_DATA");
});

// ---- media env: never falls back to the isolated scale MinIO ---------------------------------------------------------------------
const goodMedia = {
  SEED_MINIO_ENDPOINT: "http://127.0.0.1:9000",
  SEED_MINIO_ACCESS_KEY: "k",
  SEED_MINIO_SECRET_KEY: "s",
  PT_MEDIA_S3_BUCKET: "user-media",
  PARTNER_S3_PRIVATE_BUCKET: "partner-private",
};

test("official media (strict): every S3 setting is explicit, no scale defaults", () => {
  assert.throws(() => createScaleS3Clients({}, { strict: true }), (e) => e.code === "MEDIA_ENV_MISSING" && /SEED_MINIO_ENDPOINT/.test(e.message));
  for (const key of Object.keys(goodMedia)) {
    const env = { ...goodMedia };
    delete env[key];
    // the services' own variables are accepted as aliases for the endpoint/keys, so only the truly missing ones throw
    const aliased = { ...env, PT_MEDIA_S3_ENDPOINT: "http://127.0.0.1:9000", PT_MEDIA_S3_ACCESS_KEY_ID: "k", PT_MEDIA_S3_SECRET_ACCESS_KEY: "s" };
    if (key.startsWith("SEED_")) assert.doesNotThrow(() => createScaleS3Clients(aliased, { strict: true }));
    else assert.throws(() => createScaleS3Clients(env, { strict: true }), (e) => e.code === "MEDIA_ENV_MISSING");
  }
  const clients = createScaleS3Clients(goodMedia, { strict: true });
  assert.equal(clients.ptBucket, "user-media");
  assert.equal(clients.gymBucket, "partner-private");
});

test("official media (strict): the isolated scale MinIO endpoint is refused", () => {
  for (const ep of ["http://127.0.0.1:59000", "http://localhost:59000", "http://gymcoach-minio-scale:9000"]) {
    assert.equal(isScaleMinioEndpoint(ep), true, ep);
    assert.throws(() => createScaleS3Clients({ ...goodMedia, SEED_MINIO_ENDPOINT: ep }, { strict: true }), (e) => e.code === "MEDIA_ENDPOINT_REFUSED");
  }
  for (const ep of ["http://127.0.0.1:9000", "http://minio:9000", "https://s3.example.org", "not a url"]) assert.equal(isScaleMinioEndpoint(ep), false, ep);
});

test("non-strict (scale/test) keeps its documented isolated-scale defaults", () => {
  const c = createScaleS3Clients({});
  assert.equal(c.ptBucket, "gymini-user-media");
  assert.equal(c.gymBucket, "gymini-partner-private");
});

test("probeS3Buckets reports an unreachable bucket before any write", async () => {
  class List { constructor(i) { this.input = i; } }
  const ok = { send: async () => ({}) };
  await probeS3Buckets({ ptClient: ok, gymClient: ok, ptBucket: "a", gymBucket: "b" }, { ListObjectsV2Command: List });
  const bad = { send: async (cmd) => { if (cmd.input.Bucket === "b") { const e = new Error("x"); e.name = "NoSuchBucket"; throw e; } return {}; } };
  await assert.rejects(probeS3Buckets({ ptClient: bad, gymClient: bad, ptBucket: "a", gymBucket: "b" }, { ListObjectsV2Command: List }), (e) => e.code === "MEDIA_UNREACHABLE" && /"b"/.test(e.message));
});

// ---- ward geo loader ---------------------------------------------------------------------------------------------------------------
test("load-ward-geo guard: official needs its confirm, the loopback rule and the _official user DB", () => {
  const r = assertLoadWardGeoAllowed("official", { env: OK_ENV });
  assert.equal(r.guard.kind, "official");
  assert.equal(r.target.dbs.user, "gymcoach_user_official");
  refuses(() => assertLoadWardGeoAllowed("official", { env: {} }), "CONFIRM_MISSING");
  refuses(() => assertLoadWardGeoAllowed("official", { env: { ...OK_ENV, SEED_PG_HOST: "db.example.org" } }), "HOST_NOT_ALLOWED");
  assert.equal(assertLoadWardGeoAllowed("official", { env: { ...OK_ENV, SEED_PG_HOST: "db.example.org" }, allowRemoteHost: true }).guard.kind, "official");
  refuses(() => assertLoadWardGeoAllowed("official", { env: { ...OK_ENV, NODE_ENV: "production" } }), "PRODUCTION_REFUSED");
  // the previous restrictions are unchanged
  refuses(() => assertLoadWardGeoAllowed("dev", { env: { SEED_MARKETPLACE_CONFIRM: "dev" } }), "TARGET_REFUSED");
  refuses(() => assertLoadWardGeoAllowed("partner", { env: { SEED_MARKETPLACE_CONFIRM: "partner" } }), "TARGET_REFUSED");
});
