import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { logger } from "@gym-coach/shared";

// Structural port of auth-service/src/config/lambda-runtime.ts (that
// service's own Lambda is already deployed and passing — see
// docs/aws-deployment/04-backend-migration-plan.md). Same DB secret shape
// (fitness-assistant/dev/database), same "build DATABASE_URL once per
// execution environment, reuse on every warm invocation" caching strategy.

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
  // URL-encode username/password — Secrets Manager values can contain
  // characters (@, :, /, %) that are otherwise mis-parsed as URL
  // delimiters. Never logged in full (see ensureDatabaseUrlConfigured
  // below, which logs only host/port/database, matching auth-service's
  // own established convention).
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
      "User Lambda database configuration loaded from Secrets Manager",
    );
  } catch (error) {
    logger.error(
      {
        secretId,
        message: (error as Error).message,
      },
      "Failed to load User Lambda database configuration",
    );
    throw error;
  }
}

// User Service, unlike auth-service, never verifies a JWT locally — every
// authenticated request is verified by calling out to AUTH_SERVICE_URL
// (see middleware/auth.middleware.ts). So there is no JWT_SECRET/
// JWT_REFRESH_SECRET requirement here (that check is auth-service's own).
// What User Service DOES require to boot safely is the same
// INTERNAL_SERVICE_SECRET serviceSecret.middleware.ts already hard-checks
// at module-load time (see that file's own top-level `process.exit(1)` in
// production) — that check runs regardless of Lambda vs container, so it
// is NOT duplicated here. This function exists as the one place a Lambda
// cold start can fail loudly, with a clear message, before serverless-http
// ever tries to route a request — for anything not already covered by
// that existing check.
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
      `${problems.join(", ")} must be configured before starting user-service`,
    );
  }
}
