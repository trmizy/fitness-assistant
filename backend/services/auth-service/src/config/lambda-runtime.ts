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

let cachedDatabaseSecret: DatabaseSecret | null = null;
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

function parseDatabaseSecret(secretString: string | undefined): DatabaseSecret {
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

function buildDatabaseUrl(secret: DatabaseSecret): string {
  const username = encodeURIComponent(secret.username);
  const password = encodeURIComponent(secret.password);
  return `postgresql://${username}:${password}@${secret.host}:${secret.port}/${secret.database}`;
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

  try {
    if (!cachedDatabaseSecret) {
      const response = await getSecretsClient().send(
        new GetSecretValueCommand({ SecretId: secretId }),
      );
      cachedDatabaseSecret = parseDatabaseSecret(response.SecretString);
    }

    cachedDatabaseUrl = buildDatabaseUrl(cachedDatabaseSecret);
    process.env.DATABASE_URL = cachedDatabaseUrl;
    logger.info(
      {
        secretId,
        host: cachedDatabaseSecret.host,
        port: cachedDatabaseSecret.port,
        database: cachedDatabaseSecret.database,
      },
      "Auth Lambda database configuration loaded from Secrets Manager",
    );
  } catch (error) {
    logger.error(
      {
        secretId,
        message: (error as Error).message,
      },
      "Failed to load Auth Lambda database configuration",
    );
    throw error;
  }
}

export function validateRequiredRuntimeConfig(): void {
  const problems: string[] = [];

  if (!process.env.INTERNAL_SERVICE_SECRET) {
    problems.push("INTERNAL_SERVICE_SECRET");
  }

  if (process.env.NODE_ENV === "production") {
    const jwtSecret = process.env.JWT_SECRET;
    if (
      !jwtSecret ||
      jwtSecret === "dev_jwt_secret_change_in_production" ||
      jwtSecret.length < 32
    ) {
      problems.push("JWT_SECRET");
    }

    const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
    if (
      !jwtRefreshSecret ||
      jwtRefreshSecret === "refresh-secret-key-change-in-production" ||
      jwtRefreshSecret.length < 32
    ) {
      problems.push("JWT_REFRESH_SECRET");
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `${problems.join(
        ", ",
      )} must be configured before starting auth-service`,
    );
  }
}
