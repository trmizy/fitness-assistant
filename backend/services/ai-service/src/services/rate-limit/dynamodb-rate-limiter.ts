/**
 * Distributed fixed-window counter for Lambda, where concurrent execution
 * environments share nothing in memory. One atomic DynamoDB `UpdateItem` per
 * request does the increment-and-read in a single round trip — there is no
 * separate "read count, add one, write count" sequence anywhere in this file,
 * which is exactly the race a naive counter would have across concurrent
 * invocations (`isolated Lambda instance A` and `B` both reading `count=19`
 * and both writing `count=20`, silently admitting a 21st and 22nd request).
 *
 * Item shape (table: AI_RATE_LIMIT_TABLE, partition key `key`, no sort key,
 * PAY_PER_REQUEST):
 *   key       — "<bucketName>:<userId>:<windowStart>", see buildRateLimitKey()
 *   count     — Number, this window's request count
 *   expiresAt — Number, Unix epoch seconds, DynamoDB TTL attribute
 *
 * Only the minimum needed to count requests is stored: no JWT, no prompt or
 * response text, no email/name, no fitness data — `key` embeds a userId, not
 * any of that.
 *
 * TTL and correctness: expiresAt gets a buffer well past the window's own
 * end (see TTL_BUFFER_SECONDS) purely for storage hygiene. Correctness NEVER
 * depends on DynamoDB deleting an item at any particular time — a new window
 * always computes a brand-new `windowStart` and therefore a brand-new item
 * key, so even if the previous window's item is still sitting in the table
 * (TTL sweep can lag by minutes), it is never read or incremented again.
 */
import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  type UpdateCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type { RateLimiter, RateLimitParams, RateLimitResult } from "./types";
import { RateLimitInfrastructureError } from "./types";

/** Extra seconds past the window's own end before the item may be reclaimed
 * by DynamoDB's TTL sweep, which is a best-effort background process (AWS
 * documents it as typically within 48 hours, occasionally slower) — not
 * something the rate limit's correctness leans on either way. */
const TTL_BUFFER_SECONDS = 300;

export function resolveRateLimitTableName(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.AI_RATE_LIMIT_TABLE || "fitness-assistant-dev-ai-rate-limit";
}

function resolveRegion(env: NodeJS.ProcessEnv = process.env): string {
  return env.AWS_REGION || env.AWS_DEFAULT_REGION || "ap-southeast-1";
}

let documentClient: DynamoDBDocumentClient | undefined;
function getDocumentClient(): DynamoDBDocumentClient {
  if (!documentClient) {
    // Credentials: SDK default provider chain only (Lambda execution role in
    // production) — never a static access key.
    const config: DynamoDBClientConfig = { region: resolveRegion() };
    documentClient = DynamoDBDocumentClient.from(new DynamoDBClient(config));
  }
  return documentClient;
}

/** Transport seam — tests replace `send` to run fully offline. */
export const dynamoRateLimiterDeps = {
  send(command: UpdateCommand): Promise<{ Attributes?: Record<string, unknown> }> {
    return getDocumentClient().send(command) as never;
  },
};

export function buildRateLimitKey(
  key: string,
  windowStart: number,
): string {
  return `${key}:${windowStart}`;
}

export class DynamoDbRateLimiter implements RateLimiter {
  constructor(private readonly tableName: string = resolveRateLimitTableName()) {}

  async consume({ key, max, windowSeconds }: RateLimitParams): Promise<RateLimitResult> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
    const itemKey = buildRateLimitKey(key, windowStart);
    const expiresAt = windowStart + windowSeconds + TTL_BUFFER_SECONDS;

    const input: UpdateCommandInput = {
      TableName: this.tableName,
      Key: { key: itemKey },
      // Single atomic round trip: create-if-absent AND increment AND
      // create-if-absent the TTL, all in one UpdateItem — never a separate
      // GetItem beforehand.
      UpdateExpression:
        "SET #count = if_not_exists(#count, :zero) + :one, expiresAt = if_not_exists(expiresAt, :expiresAt)",
      ExpressionAttributeNames: { "#count": "count" },
      ExpressionAttributeValues: { ":zero": 0, ":one": 1, ":expiresAt": expiresAt },
      ReturnValues: "UPDATED_NEW",
    };

    let result: { Attributes?: Record<string, unknown> };
    try {
      result = await dynamoRateLimiterDeps.send(new UpdateCommand(input));
    } catch (err) {
      throw new RateLimitInfrastructureError(
        `DynamoDB rate limit UpdateItem failed for table "${this.tableName}": ${
          err instanceof Error ? err.message : String(err)
        }`,
        err,
      );
    }

    const count = Number(result.Attributes?.count);
    if (!Number.isFinite(count) || count < 1) {
      throw new RateLimitInfrastructureError(
        `DynamoDB rate limit UpdateItem for table "${this.tableName}" returned no usable count`,
      );
    }

    return {
      allowed: count <= max,
      count,
      max,
      retryAfterSeconds: windowStart + windowSeconds - nowSeconds,
    };
  }
}
