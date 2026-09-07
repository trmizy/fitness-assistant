import { execFileSync } from 'node:child_process';
import pg from 'pg';

const services = [
  {
    name: '@gym-coach/auth-service',
    cwd: 'backend/services/auth-service',
    envName: 'AUTH_DATABASE_URL',
    fallbackDb: 'gymcoach_auth_test',
  },
  {
    name: '@gym-coach/user-service',
    cwd: 'backend/services/user-service',
    envName: 'USER_DATABASE_URL',
    fallbackDb: 'gymcoach_user_test',
  },
  {
    name: '@gym-coach/fitness-service',
    cwd: 'backend/services/fitness-service',
    envName: 'FITNESS_DATABASE_URL',
    fallbackDb: 'gymcoach_fitness_test',
    // Phase 2 hardening (2026-09-06): this used to be 'db-push', which
    // silently omitted two safety-critical raw-SQL partial unique indexes
    // (training_cycles_one_active_per_user, nutrition_goals_user_id_
    // active_unique) — Prisma's schema DSL cannot express a WHERE-
    // conditioned unique index, so those only exist as hand-written SQL
    // inside two migration files, which `db push` never runs. Any test
    // provisioned that way was missing both "at most one ACTIVE cycle/
    // goal per user" database guarantees without any error or warning.
    // Verified safe to switch: `prisma migrate deploy` replays all 49
    // fitness-service migrations cleanly against a fresh database (no
    // drift), and produces both indexes — see requiredIndexes below,
    // checked automatically after provisioning so a future drift fails
    // loudly instead of silently.
    requiredIndexes: [
      { table: 'training_cycles', index: 'training_cycles_one_active_per_user' },
      { table: 'nutrition_goals', index: 'nutrition_goals_user_id_active_unique' },
    ],
  },
  {
    name: '@gym-coach/ai-service',
    cwd: 'backend/services/ai-service',
    envName: 'AI_DATABASE_URL',
    fallbackDb: 'gymcoach_ai_test',
  },
  {
    name: '@gym-coach/chat-service',
    cwd: 'backend/services/chat-service',
    envName: 'CHAT_DATABASE_URL',
    fallbackDb: 'gymcoach_chat_test',
    prismaEnvName: 'CHAT_DATABASE_URL',
  },
];

function defaultUrl(dbName) {
  const user = process.env.POSTGRES_USER || 'gymcoach_test';
  const pass = process.env.POSTGRES_PASSWORD || 'gymcoach_test_password';
  const host = process.env.POSTGRES_HOST || 'postgres-test';
  const port = process.env.POSTGRES_PORT || '5432';
  return `postgresql://${user}:${pass}@${host}:${port}/${dbName}`;
}

function assertTestUrl(url, serviceName) {
  if (!url.includes('_test') && !url.includes('postgres-test') && !url.includes('localhost')) {
    throw new Error(`${serviceName}: refusing to migrate non-test database URL`);
  }
  if (/gymcoach_(auth|user|fitness|ai|chat)(\?|$)/.test(url) && !url.includes('_test')) {
    throw new Error(`${serviceName}: refusing to migrate development/production database: ${url.replace(/:[^:@/]+@/, ':***@')}`);
  }
}

const resolvedUrls = [];

for (const service of services) {
  const url = process.env[service.envName] || defaultUrl(service.fallbackDb);
  assertTestUrl(url, service.name);
  resolvedUrls.push({ service, url });
  const env = {
    ...process.env,
    DATABASE_URL: url,
    CHAT_DATABASE_URL: service.prismaEnvName === 'CHAT_DATABASE_URL' ? url : process.env.CHAT_DATABASE_URL,
  };

  const strategy = service.strategy === 'db-push' ? 'db push' : 'migrate deploy';
  const args = service.strategy === 'db-push'
    ? ['exec', 'prisma', 'db', 'push', '--skip-generate']
    : ['exec', 'prisma', 'migrate', 'deploy'];

  console.log(`[prisma:test] ${strategy} ${service.name}`);
  execFileSync('pnpm', args, {
    cwd: service.cwd,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

// Post-provisioning verification — spec: "TEST DATABASE REPRESENTS
// PRODUCTION CONSTRAINTS", never let a test run silently against a
// database missing a constraint the application logic actually relies on.
// Any service can list `requiredIndexes` (table + raw-SQL index name); a
// missing one fails this script (and therefore the whole test run) loudly
// instead of a concurrency test just quietly passing for the wrong reason.
const servicesWithRequiredIndexes = resolvedUrls.filter(({ service }) => service.requiredIndexes?.length);
if (servicesWithRequiredIndexes.length > 0) {
  console.log('[prisma:test] verifying production-critical indexes exist post-provisioning');
  let allOk = true;
  for (const { service, url } of servicesWithRequiredIndexes) {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const { rows } = await client.query(
        `SELECT indexname, tablename FROM pg_indexes WHERE tablename = ANY($1::text[])`,
        [service.requiredIndexes.map((r) => r.table)],
      );
      const found = new Set(rows.map((r) => r.indexname));
      for (const { table, index } of service.requiredIndexes) {
        if (!found.has(index)) {
          allOk = false;
          console.error(
            `[prisma:test] MISSING CRITICAL INDEX: "${index}" on "${table}" (${service.name}). ` +
              `This index is not expressible in schema.prisma (Prisma DSL has no WHERE-conditioned ` +
              `unique index) and only exists as hand-written SQL inside a migration file — a ` +
              `"db push"-provisioned database, or a migration history that has drifted, will not ` +
              `have it. Refusing to let tests run against a database missing a constraint the ` +
              `application relies on for correctness.`,
          );
        }
      }
    } finally {
      await client.end();
    }
  }
  if (!allOk) {
    process.exit(1);
  }
  console.log('[prisma:test] all required indexes present');
}
