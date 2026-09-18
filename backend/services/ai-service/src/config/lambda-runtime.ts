/**
 * Lambda cold-start bootstrap for ai-service: resolves DATABASE_URL from
 * Secrets Manager (DATABASE_SECRET_ID) before anything imports Prisma, and
 * fails fast on missing must-have configuration.
 *
 * Mirrors payment-service's config/lambda-runtime.ts, with one extra rule
 * ai-service needs: the secret's `database` field must be exactly
 * `fitness_assistant_ai`. The HTTP/worker/jobs Lambdas share the same
 * connection path as the migration Lambda, so a mis-pointed secret must be
 * caught here too — not only in migrate-lambda.ts.
 *
 * DATABASE_URL, when already set (local dev, docker-compose), always wins and
 * no Secrets Manager call is made.
 *
 * Nothing here logs the password or the assembled URL — only the non-secret
 * host/port/database fields, which is what makes a misconfiguration
 * diagnosable from CloudWatch without leaking a credential.
 */
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { logger } from "@gym-coach/shared";

export const AI_DATABASE_NAME = "fitness_assistant_ai";

type DatabaseSecret = {
  username: string;
  password: string;
  host: string;
  port: number;
  database: string;
};

let cachedDatabaseUrl: string | null = null;
let secretsClient: SecretsManagerClient | null = null;

function getSecretsClient(): SecretsManagerClient {
  if (!secretsClient) {
    secretsClient = new SecretsManagerClient({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
    });
  }
  return secretsClient;
}

function requiredString(value: unknown, field: keyof DatabaseSecret): string {
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
  if (!secretString) throw new Error("Database secret has no SecretString");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(secretString) as Record<string, unknown>;
  } catch {
    throw new Error("Database secret JSON is invalid");
  }

  const database = requiredString(raw.database, "database");
  if (database !== AI_DATABASE_NAME) {
    throw new Error(
      `Database secret points at "${database}", but ai-service may only connect to "${AI_DATABASE_NAME}".`,
    );
  }

  return {
    username: requiredString(raw.username, "username"),
    password: requiredString(raw.password, "password"),
    host: requiredString(raw.host, "host"),
    port: parsePort(raw.port),
    database,
  };
}

export function buildDatabaseUrl(
  secret: DatabaseSecret,
  database = secret.database,
): string {
  const url = new URL(`postgresql://${secret.host}:${secret.port}/${database}`);
  url.username = secret.username;
  url.password = secret.password;
  url.searchParams.set("schema", "public");
  return url.toString();
}

export async function ensureDatabaseUrlConfigured(): Promise<void> {
  if (process.env.DATABASE_URL) return;
  if (cachedDatabaseUrl) {
    process.env.DATABASE_URL = cachedDatabaseUrl;
    return;
  }

  const secretId = process.env.DATABASE_SECRET_ID;
  if (!secretId) {
    throw new Error(
      "DATABASE_URL is not set and DATABASE_SECRET_ID is not configured",
    );
  }

  const response = await getSecretsClient().send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  const secret = parseDatabaseSecret(response.SecretString);
  cachedDatabaseUrl = buildDatabaseUrl(secret);
  process.env.DATABASE_URL = cachedDatabaseUrl;

  logger.info(
    {
      secretId,
      host: secret.host,
      port: secret.port,
      database: secret.database,
    },
    "AI Lambda database configuration loaded from Secrets Manager",
  );
}

export function validateRequiredRuntimeConfig(): void {
  if (!process.env.INTERNAL_SERVICE_SECRET) {
    throw new Error(
      "INTERNAL_SERVICE_SECRET must be configured before starting ai-service",
    );
  }
}
