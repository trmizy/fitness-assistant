import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { logger } from "@gym-coach/shared";

type DatabaseSecret = {
  username: string;
  password: string;
  host: string;
  port: number;
  database: string;
};

let cachedDatabaseUrl: string | null = null;
let cachedDatabaseSecret: DatabaseSecret | null = null;
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

function parseDatabaseSecret(secretString: string | undefined): DatabaseSecret {
  if (!secretString) throw new Error("Database secret has no SecretString");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(secretString) as Record<string, unknown>;
  } catch {
    throw new Error("Database secret JSON is invalid");
  }
  return {
    username: requiredString(raw.username, "username"),
    password: requiredString(raw.password, "password"),
    host: requiredString(raw.host, "host"),
    port: parsePort(raw.port),
    database: requiredString(raw.database, "database"),
  };
}

function buildDatabaseUrl(secret: DatabaseSecret): string {
  return `postgresql://${encodeURIComponent(secret.username)}:${encodeURIComponent(
    secret.password,
  )}@${secret.host}:${secret.port}/${secret.database}`;
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
  cachedDatabaseSecret = parseDatabaseSecret(response.SecretString);
  cachedDatabaseUrl = buildDatabaseUrl(cachedDatabaseSecret);
  process.env.DATABASE_URL = cachedDatabaseUrl;
  logger.info(
    {
      secretId,
      host: cachedDatabaseSecret.host,
      port: cachedDatabaseSecret.port,
      database: cachedDatabaseSecret.database,
    },
    "Fitness Lambda database configuration loaded from Secrets Manager",
  );
}

export function validateRequiredRuntimeConfig(): void {
  const problems: string[] = [];
  if (
    !process.env.INTERNAL_SERVICE_SECRET &&
    !process.env.INTERNAL_API_SECRET
  ) {
    problems.push("INTERNAL_SERVICE_SECRET (or INTERNAL_API_SECRET)");
  }
  if (problems.length > 0) {
    throw new Error(
      `${problems.join(", ")} must be configured before starting fitness-service`,
    );
  }
}
