import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { Client } from "pg";

const FITNESS_DATABASE_NAME = "fitness_assistant_fitness";
const REFUSAL_MESSAGE = "Refusing to run Fitness Service migrations against non-fitness database.";

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

function assertFitnessDatabase(database: string): void {
  if (database !== FITNESS_DATABASE_NAME) {
    throw new Error(REFUSAL_MESSAGE);
  }
}
function assertRequiredString(value: unknown, field: keyof DatabaseSecret): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`DATABASE_SECRET_ID secret is missing required field: ${field}`);
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

async function loadDatabaseSecret(): Promise<DatabaseSecret> {
  const secretId = process.env.DATABASE_SECRET_ID;
  if (!secretId) {
    throw new Error("DATABASE_SECRET_ID is required for Fitness Service migration Lambda.");
  }

  const client = new SecretsManagerClient({ region: process.env.AWS_REGION || "ap-southeast-1" });
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!result.SecretString) {
    throw new Error("DATABASE_SECRET_ID must contain a JSON SecretString.");
  }

  const parsed = JSON.parse(result.SecretString) as Partial<DatabaseSecret>;
  const database = assertRequiredString(parsed.database, "database");
  assertFitnessDatabase(database);

  return {
    username: assertRequiredString(parsed.username, "username"),
    password: assertRequiredString(parsed.password, "password"),
    host: assertRequiredString(parsed.host, "host"),
    port: parsePort(parsed.port),
    database,
  };
}

function buildDatabaseUrl(secret: DatabaseSecret, database = secret.database): string {
  const url = new URL(`postgresql://${secret.host}:${secret.port}/${database}`);
  url.username = secret.username;
  url.password = secret.password;
  url.searchParams.set("schema", "public");
  return url.toString();
}

async function ensureFitnessDatabaseExists(secret: DatabaseSecret): Promise<boolean> {
  assertFitnessDatabase(secret.database);

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
    const existing = await maintenanceClient.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      FITNESS_DATABASE_NAME,
    ]);
    if ((existing.rowCount || 0) > 0) {
      return false;
    }

    await maintenanceClient.query(`CREATE DATABASE ${quotePostgresIdentifier(FITNESS_DATABASE_NAME)}`);
    return true;
  } finally {
    await maintenanceClient.end();
  }
}

function quotePostgresIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function truncateOutput(output: string): string {
  const maxLength = 12_000;
  if (output.length <= maxLength) return output;
  return `${output.slice(0, maxLength)}\n[output truncated]`;
}

async function runPrismaMigrateDeploy(databaseUrl: string): Promise<{ exitCode: number; output: string }> {
  const prismaCli = resolve(process.cwd(), "node_modules", "prisma", "build", "index.js");
  const schemaPath = resolve(process.cwd(), "prisma", "schema.prisma");

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schemaPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        PRISMA_HIDE_UPDATE_MESSAGE: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

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

export async function handler(): Promise<MigrationResult> {
  const secret = await loadDatabaseSecret();
  assertFitnessDatabase(secret.database);

  const databaseCreated = await ensureFitnessDatabaseExists(secret);
  const databaseUrl = buildDatabaseUrl(secret);
  const migration = await runPrismaMigrateDeploy(databaseUrl);

  if (migration.exitCode !== 0) {
    throw new Error(`prisma migrate deploy failed with exit code ${migration.exitCode}\n${migration.output}`);
  }

  return {
    status: "ok",
    database: FITNESS_DATABASE_NAME,
    databaseCreated,
    migrateExitCode: migration.exitCode,
    output: migration.output,
  };
}
