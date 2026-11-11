/**
 * Optional cross-account Bedrock credentials.
 *
 * V2.3A.9/V2.3A.9.2 confirmed, by direct live testing across 5 regions, 2
 * model sizes, both Bedrock Runtime APIs, and both direct-model and
 * inference-profile ID forms, that this Lambda's own AWS account
 * (191798898985) has an account-level Bedrock block: every real inference
 * call returns `ValidationException: Operation not allowed`, even under a
 * fully-privileged admin identity -- so the default execution-role
 * credentials bedrock.client.ts was built to use exclusively cannot ever
 * succeed on this account until that account-level restriction is lifted.
 *
 * A separate AWS account was confirmed (by direct live testing) to have
 * working Nova Pro access on the exact same inference profile. This module
 * is the deliberate, temporary stop-gap that lets bedrock.client.ts use
 * that account's credentials instead of the default provider chain, without
 * touching any other AWS call this Lambda makes (DB secret, SQS, internal
 * Lambda invokes all keep using the execution role exactly as before).
 *
 * Mirrors config/lambda-runtime.ts's ensureDatabaseUrlConfigured(): resolved
 * once per cold start, cached for the life of the frozen/thawed execution
 * environment, and never logs the key material itself -- only that
 * cross-account credentials were loaded and which secret they came from.
 *
 * When BEDROCK_CREDENTIALS_SECRET_ID is unset (the default), this module
 * does nothing and bedrock.client.ts falls back to the execution role
 * exactly as before -- this is strictly additive.
 */
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { logger } from "@gym-coach/shared";

type BedrockCredentialsSecret = {
  accessKeyId: string;
  secretAccessKey: string;
};

/** Structurally identical to AWS SDK v3's AwsCredentialIdentity, declared
 * locally instead of importing @aws-sdk/types (not a direct dependency of
 * this package, only a transitive one, which pnpm's strict linking would
 * not resolve). */
export type BedrockClientCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
};

let cachedCredentials: BedrockClientCredentials | null | undefined;
let secretsClient: SecretsManagerClient | null = null;

function getSecretsClient(): SecretsManagerClient {
  if (!secretsClient) {
    secretsClient = new SecretsManagerClient({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
    });
  }
  return secretsClient;
}

function requiredString(value: unknown, field: keyof BedrockCredentialsSecret): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Bedrock credentials secret is missing required field: ${field}`);
  }
  return value.trim();
}

export function parseBedrockCredentialsSecret(
  secretString: string | undefined,
): BedrockCredentialsSecret {
  if (!secretString) throw new Error("Bedrock credentials secret has no SecretString");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(secretString) as Record<string, unknown>;
  } catch {
    throw new Error("Bedrock credentials secret JSON is invalid");
  }
  return {
    accessKeyId: requiredString(raw.accessKeyId, "accessKeyId"),
    secretAccessKey: requiredString(raw.secretAccessKey, "secretAccessKey"),
  };
}

/**
 * Resolves and caches the cross-account Bedrock credentials. Returns
 * `undefined` (not an error) when BEDROCK_CREDENTIALS_SECRET_ID is unset,
 * so callers can pass the result straight through to
 * new BedrockRuntimeClient({ credentials }) and get the SDK's own default
 * provider chain whenever this feature isn't configured.
 */
export async function resolveBedrockCredentials(): Promise<BedrockClientCredentials | undefined> {
  if (cachedCredentials !== undefined) return cachedCredentials ?? undefined;

  const secretId = process.env.BEDROCK_CREDENTIALS_SECRET_ID;
  if (!secretId) {
    cachedCredentials = null;
    return undefined;
  }

  const response = await getSecretsClient().send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  const secret = parseBedrockCredentialsSecret(response.SecretString);
  cachedCredentials = {
    accessKeyId: secret.accessKeyId,
    secretAccessKey: secret.secretAccessKey,
  };

  logger.info(
    { secretId },
    "Bedrock cross-account credentials loaded from Secrets Manager (account-level Bedrock block stop-gap)",
  );

  return cachedCredentials;
}

/** Test-only: clears the module-level cache between test cases. */
export function __resetBedrockCredentialsCacheForTests(): void {
  cachedCredentials = undefined;
  secretsClient = null;
}
