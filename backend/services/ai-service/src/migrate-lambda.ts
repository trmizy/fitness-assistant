/**
 * AWS Lambda migration entrypoint — creates `fitness_assistant_ai` if it does
 * not exist yet, then runs `prisma migrate deploy` against it and nothing
 * else.
 *
 * Manually invoked (AWS Console "Test" button / owner-triggered), never wired
 * to an HTTP route or a schedule. Mirrors payment-service's migrate-lambda.ts
 * (same secret loading, same maintenance-DB create, same spawn of the bundled
 * prisma CLI), so all migration Lambdas in this system behave identically.
 *
 * Safety guard — three independent checks, all must name the same database:
 *   1. the secret's `database` field                      === fitness_assistant_ai
 *   2. the `database` field of the invocation event, when given (or
 *      AI_DATABASE_NAME)                                   === fitness_assistant_ai
 *   3. the database re-asserted immediately before CREATE DATABASE and again
 *      before migrate deploy
 * Anything else — fitness_assistant, fitness_assistant_user,
 * fitness_assistant_fitness, fitness_assistant_gym,
 * fitness_assistant_payment, postgres, or any other name — is refused outright
 * and nothing touches the cluster.
 *
 * Never drops a database. The only DDL it can issue on its own is
 * `CREATE DATABASE "fitness_assistant_ai"`; everything else comes from the
 * repo's own migration files, applied by `prisma migrate deploy` only —
 * never `db push`, `migrate reset`, or `--accept-data-loss`.
 *
 * Handler: dist/migrate-lambda.handler
 * Env: DATABASE_SECRET_ID (e.g. fitness-assistant/dev/ai-database), or
 *      DATABASE_URL for a local run.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { Client } from "pg";

const AI_DATABASE_NAME = "fitness_assistant_ai";
const REFUSAL_MESSAGE =
  "Refusing to run AI Service migrations against non-ai database.";

type DatabaseSecret = {
  username: string;
  password: string;
  host: string;
  port: number | string;
  database: string;
};

type MigrationResult = {
  status: "ok";
  database: string;
  databaseCreated: boolean;
  migrateExitCode: number;
  output: string;
};

export interface MigrateLambdaEvent {
  /** Optional confirmation; when present it must equal AI_DATABASE_NAME. */
  database?: string;
  /** Read-only inventory before an owner-authorized migration deployment. */
  operation?: "status" | "deploy" | "resolve-workflow-baseline";
}

function assertAiDatabase(database: string): void {
  if (database !== AI_DATABASE_NAME) {
    throw new Error(`${REFUSAL_MESSAGE} Got "${database}".`);
  }
}

function assertRequiredString(
  value: unknown,
  field: keyof DatabaseSecret,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `DATABASE_SECRET_ID secret is missing required field: ${field}`,
    );
  }
  return value;
}

function parsePort(value: unknown): number {
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("DATABASE_SECRET_ID secret has invalid port");
  }
  return port;
}

/**
 * Local/dev path only: lets a developer run this handler against a plain
 * DATABASE_URL instead of Secrets Manager. The database name embedded in the
 * URL still has to be fitness_assistant_ai.
 */
function secretFromDatabaseUrl(databaseUrl: string): DatabaseSecret {
  const url = new URL(databaseUrl);
  const database = url.pathname.replace(/^\//, "").split("?")[0];
  assertAiDatabase(database);
  return {
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    host: url.hostname,
    port: Number(url.port || 5432),
    database,
  };
}

async function loadDatabaseSecret(): Promise<DatabaseSecret> {
  const secretId = process.env.DATABASE_SECRET_ID;
  if (!secretId) {
    if (process.env.DATABASE_URL) {
      return secretFromDatabaseUrl(process.env.DATABASE_URL);
    }
    throw new Error(
      "DATABASE_SECRET_ID is required for AI Service migration Lambda.",
    );
  }

  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION || "ap-southeast-1",
  });
  const result = await client.send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  if (!result.SecretString) {
    throw new Error("DATABASE_SECRET_ID must contain a JSON SecretString.");
  }

  const parsed = JSON.parse(result.SecretString) as Partial<DatabaseSecret>;
  const database = assertRequiredString(parsed.database, "database");
  assertAiDatabase(database);

  return {
    username: assertRequiredString(parsed.username, "username"),
    password: assertRequiredString(parsed.password, "password"),
    host: assertRequiredString(parsed.host, "host"),
    port: parsePort(parsed.port),
    database,
  };
}

function buildDatabaseUrl(
  secret: DatabaseSecret,
  database = secret.database,
): string {
  const url = new URL(`postgresql://${secret.host}:${secret.port}/${database}`);
  url.username = secret.username;
  url.password = secret.password;
  url.searchParams.set("schema", "public");
  return url.toString();
}

function quotePostgresIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function ensureAiDatabaseExists(
  secret: DatabaseSecret,
): Promise<boolean> {
  assertAiDatabase(secret.database);

  const maintenanceClient = new Client({
    user: secret.username,
    password: secret.password,
    host: secret.host,
    port: Number(secret.port),
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });

  await maintenanceClient.connect();
  try {
    const existing = await maintenanceClient.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [AI_DATABASE_NAME],
    );
    if ((existing.rowCount || 0) > 0) {
      return false;
    }

    await maintenanceClient.query(
      `CREATE DATABASE ${quotePostgresIdentifier(AI_DATABASE_NAME)}`,
    );
    return true;
  } finally {
    await maintenanceClient.end();
  }
}

function truncateOutput(output: string): string {
  const maxLength = 12_000;
  if (output.length <= maxLength) return output;
  return `${output.slice(0, maxLength)}\n[output truncated]`;
}

async function runPrismaMigrateDeploy(
  databaseUrl: string,
  resolveWorkflowBaseline = false,
): Promise<{ exitCode: number; output: string }> {
  const prismaCli = resolve(
    process.cwd(),
    "node_modules",
    "prisma",
    "build",
    "index.js",
  );
  const schemaPath = resolve(process.cwd(), "prisma", "schema.prisma");

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [
        prismaCli,
        "migrate",
        ...(resolveWorkflowBaseline
          ? ["resolve", "--applied", "20260915120000_agent_workflow_session"]
          : ["deploy"]),
        "--schema",
        schemaPath,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          PRISMA_HIDE_UPDATE_MESSAGE: "true",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({ exitCode: code ?? 1, output: truncateOutput(output) });
    });
  });
}

export async function handler(
  event: MigrateLambdaEvent = {},
): Promise<
  | MigrationResult
  | {
      status: "inspection";
      database: string;
      migrations: unknown[];
      actionColumns: unknown[];
      workflowColumns: unknown[];
      workflowIndexes: unknown[];
      duplicateActiveGroups: number;
    }
> {
  if (
    event.operation !== undefined &&
    !["status", "deploy", "resolve-workflow-baseline"].includes(event.operation)
  ) {
    throw new Error("Unsupported migration operation");
  }
  // An explicit `database` in the event (or AI_DATABASE_NAME) is optional, but
  // if either is supplied it must agree with the secret — a mismatch means the
  // caller and the configuration disagree about what is being migrated, which
  // is exactly when to stop.
  const requestedDatabase = event.database ?? process.env.AI_DATABASE_NAME;
  if (requestedDatabase !== undefined) {
    assertAiDatabase(requestedDatabase);
  }

  const secret = await loadDatabaseSecret();
  assertAiDatabase(secret.database);

  if (event.operation === "status") {
    const client = new Client({
      user: secret.username,
      password: secret.password,
      host: secret.host,
      port: Number(secret.port),
      database: AI_DATABASE_NAME,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    try {
      await client.query("BEGIN READ ONLY");
      const migrations = await client.query(
        'SELECT migration_name, checksum, finished_at IS NOT NULL AS applied, rolled_back_at IS NOT NULL AS rolled_back FROM "_prisma_migrations" ORDER BY migration_name',
      );
      const columns = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'fitness_agent_actions' ORDER BY ordinal_position",
      );
      const workflowColumns = await client.query(
        "SELECT column_name, data_type, is_nullable, column_default, datetime_precision FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_workflow_sessions' ORDER BY ordinal_position",
      );
      const workflowIndexes = await client.query(
        "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'agent_workflow_sessions'",
      );
      const duplicates = await client.query(
        "SELECT count(*)::int AS count FROM (SELECT user_id, session_id FROM agent_workflow_sessions WHERE status NOT IN ('COMPLETED', 'CANCELLED', 'EXPIRED') GROUP BY user_id, session_id HAVING count(*) > 1) d",
      );
      await client.query("COMMIT");
      return {
        status: "inspection",
        database: AI_DATABASE_NAME,
        migrations: migrations.rows,
        actionColumns: columns.rows,
        workflowColumns: workflowColumns.rows,
        workflowIndexes: workflowIndexes.rows,
        duplicateActiveGroups: duplicates.rows[0].count,
      };
    } finally {
      await client.end();
    }
  }

  // Resolve is an explicit maintenance operation, never creates a database.
  // Use only after comparing the existing table's columns/defaults/indexes to
  // the named migration via the read-only status operation.
  const databaseCreated =
    event.operation === "resolve-workflow-baseline"
      ? false
      : await ensureAiDatabaseExists(secret);
  const databaseUrl = buildDatabaseUrl(secret);
  const migration = await runPrismaMigrateDeploy(
    databaseUrl,
    event.operation === "resolve-workflow-baseline",
  );

  if (migration.exitCode !== 0) {
    throw new Error(
      `prisma migrate deploy failed with exit code ${migration.exitCode}\n${migration.output}`,
    );
  }

  return {
    status: "ok",
    database: AI_DATABASE_NAME,
    databaseCreated,
    migrateExitCode: migration.exitCode,
    output: migration.output,
  };
}
