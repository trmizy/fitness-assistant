import { spawnSync } from "child_process";
import path from "path";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { logger } from "@gym-coach/shared";

const USER_DATABASE_NAME = "fitness_assistant_user";
const AUTH_DATABASE_NAME = "fitness_assistant";
export const NON_USER_DATABASE_ERROR =
  "Refusing to run User Service migrations against non-user database.";

type DatabaseSecret = {
  username: string;
  password: string;
  host: string;
  port: number;
  database: string;
};

type RuntimePaths = {
  artifactRoot: string;
  schemaPath: string;
  prismaCliEntry: string;
  schemaEngineBinary: string;
};

type MigrateResult = {
  status: number | null;
  error?: { message: string };
  stdout?: string;
  stderr?: string;
};

type MigrationHandlerOptions = {
  fetchSecretString?: (secretId: string) => Promise<string | undefined>;
  runMigrate?: (paths: RuntimePaths) => MigrateResult;
  paths?: RuntimePaths;
};

const OUTPUT_TAIL_CHARS = 4000;
const tail = (s: string) =>
  s.length > OUTPUT_TAIL_CHARS ? s.slice(-OUTPUT_TAIL_CHARS) : s;

let secretsClient: SecretsManagerClient | null = null;

function getSecretsClient(): SecretsManagerClient {
  if (!secretsClient) {
    secretsClient = new SecretsManagerClient({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
    });
  }
  return secretsClient;
}

function assertNonEmptyString(
  value: unknown,
  field: keyof DatabaseSecret,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Database secret is missing required field: ${field}`);
  }
  return value.trim();
}

function parsePort(value: unknown): number {
  const port =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("Database secret has invalid port");
  }

  return port;
}

export function parseDatabaseSecret(
  secretString: string | undefined,
): DatabaseSecret {
  if (!secretString) {
    throw new Error("Database secret has no SecretString");
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(secretString) as Record<string, unknown>;
  } catch {
    throw new Error("Database secret JSON is invalid");
  }

  return {
    username: assertNonEmptyString(raw.username, "username"),
    password: assertNonEmptyString(raw.password, "password"),
    host: assertNonEmptyString(raw.host, "host"),
    port: parsePort(raw.port),
    database: assertNonEmptyString(raw.database, "database"),
  };
}

export function assertUserServiceDatabase(database: string): void {
  if (database === AUTH_DATABASE_NAME || database !== USER_DATABASE_NAME) {
    throw new Error(NON_USER_DATABASE_ERROR);
  }
}

export function buildDatabaseUrl(secret: DatabaseSecret): string {
  assertUserServiceDatabase(secret.database);
  const username = encodeURIComponent(secret.username);
  const password = encodeURIComponent(secret.password);
  return `postgresql://${username}:${password}@${secret.host}:${secret.port}/${secret.database}`;
}

export function getRuntimePaths(distDir = __dirname): RuntimePaths {
  const artifactRoot = path.join(distDir, "..");
  return {
    artifactRoot,
    schemaPath: path.join(artifactRoot, "prisma", "schema.prisma"),
    prismaCliEntry: path.join(
      artifactRoot,
      "node_modules",
      "prisma",
      "build",
      "index.js",
    ),
    schemaEngineBinary: path.join(
      artifactRoot,
      "prisma-engines",
      process.platform === "win32"
        ? "schema-engine-windows.exe"
        : "schema-engine-rhel-openssl-3.0.x",
    ),
  };
}

async function fetchSecretString(secretId: string): Promise<string | undefined> {
  const response = await getSecretsClient().send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  return response.SecretString;
}

function runPrismaMigrateDeploy(paths: RuntimePaths): MigrateResult {
  return spawnSync(
    process.execPath,
    [paths.prismaCliEntry, "migrate", "deploy", "--schema", paths.schemaPath],
    {
      cwd: paths.artifactRoot,
      env: {
        ...process.env,
        PRISMA_SCHEMA_ENGINE_BINARY: paths.schemaEngineBinary,
      },
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      timeout: 4 * 60 * 1000,
    },
  );
}

export function createMigrationHandler(options: MigrationHandlerOptions = {}) {
  return async function handler(_event: unknown, _context: unknown) {
    const secretId = process.env.DATABASE_SECRET_ID;
    if (!secretId) {
      logger.error(
        { message: "DATABASE_SECRET_ID is not configured" },
        "user-migrate-lambda: failed to configure DATABASE_URL",
      );
      return {
        statusCode: 500,
        body: JSON.stringify({
          status: "error",
          operation: "prisma migrate deploy",
          stage: "configure-database-url",
          error: "DATABASE_SECRET_ID is not configured",
        }),
      };
    }

    try {
      const secretString = await (options.fetchSecretString ?? fetchSecretString)(
        secretId,
      );
      const secret = parseDatabaseSecret(secretString);
      const databaseUrl = buildDatabaseUrl(secret);
      process.env.DATABASE_URL = databaseUrl;

      logger.info(
        {
          secretId,
          host: secret.host,
          port: secret.port,
          database: secret.database,
        },
        "user-migrate-lambda: database configuration loaded from Secrets Manager",
      );
    } catch (err) {
      const message = (err as Error).message;
      logger.error(
        { secretId, message },
        "user-migrate-lambda: failed to configure DATABASE_URL",
      );
      return {
        statusCode: 500,
        body: JSON.stringify({
          status: "error",
          operation: "prisma migrate deploy",
          stage: "configure-database-url",
          error: message,
        }),
      };
    }

    const paths = options.paths ?? getRuntimePaths();
    logger.info(
      {
        schema: paths.schemaPath,
        cliEntry: paths.prismaCliEntry,
        schemaEngineBinary: paths.schemaEngineBinary,
      },
      "user-migrate-lambda: running prisma migrate deploy",
    );

    const result = (options.runMigrate ?? runPrismaMigrateDeploy)(paths);
    const stdout = tail(result.stdout ?? "");
    const stderr = tail(result.stderr ?? "");
    const success = result.status === 0 && !result.error;

    logger[success ? "info" : "error"](
      {
        exitCode: result.status,
        spawnError: result.error?.message,
        stdoutTail: stdout,
        stderrTail: stderr,
      },
      "user-migrate-lambda: prisma migrate deploy finished",
    );

    return {
      statusCode: success ? 200 : 500,
      body: JSON.stringify({
        status: success ? "ok" : "error",
        operation: "prisma migrate deploy",
        exitCode: result.status,
        spawnError: result.error?.message,
        stdout,
        stderr,
      }),
    };
  };
}

export const handler = createMigrationHandler();
