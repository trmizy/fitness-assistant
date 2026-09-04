import { execFileSync } from 'node:child_process';

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
    strategy: 'db-push',
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

for (const service of services) {
  const url = process.env[service.envName] || defaultUrl(service.fallbackDb);
  assertTestUrl(url, service.name);
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
