/**
 * Amazon Bedrock Runtime access for ai-service: Nova chat (Converse), Nova
 * vision with a forced tool (Converse), and Cohere Embed (InvokeModel).
 *
 * Credentials: the AWS SDK default provider chain — on Lambda, the
 * function's execution role — UNLESS `BEDROCK_CROSS_ACCOUNT_ROLE_ARN` is
 * set, in which case every Bedrock call instead uses temporary credentials
 * obtained by assuming that role (see `getCrossAccountCredentials` below).
 * This exists because the primary DEV account's on-demand Bedrock quotas
 * for Nova Pro / Cohere Embed are account-level 0 and `Adjustable: false`
 * (confirmed via `service-quotas list-service-quotas`, 2026-10-18) — not an
 * IAM or authorization problem, a hard per-account throughput ceiling with
 * no self-service increase path. The role lives in a separate AWS account
 * that has real quota; nothing here reads a static access key anywhere.
 *
 * IAM: Converse and InvokeModel are both authorised by `bedrock:InvokeModel`.
 * No streaming API (ConverseStream / InvokeModelWithResponseStream) is called
 * anywhere, so `bedrock:InvokeModelWithResponseStream` is not needed.
 *
 * Request builders and response parsers are exported as pure functions, and
 * the network call goes through `bedrockRuntimeDeps.send`, so serialization,
 * parsing, and timeout behaviour are testable without an AWS account.
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
  type ConverseCommandInput,
  type ConverseCommandOutput,
  type InvokeModelCommandInput,
  type ToolInputSchema,
} from "@aws-sdk/client-bedrock-runtime";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  resolveBedrockEmbeddingModel,
  type EmbeddingInputType,
} from "./embedding-config";

export const BEDROCK_REGION =
  process.env.BEDROCK_REGION || process.env.AWS_REGION || "ap-southeast-1";
export const BEDROCK_CHAT_MODEL =
  process.env.BEDROCK_CHAT_MODEL || "amazon.nova-pro-v1:0";
export const BEDROCK_VISION_MODEL =
  process.env.BEDROCK_VISION_MODEL || BEDROCK_CHAT_MODEL;
export const BEDROCK_EMBEDDING_MODEL = resolveBedrockEmbeddingModel();

/** Cohere Embed v3 on Bedrock accepts at most 96 texts per request. */
export const COHERE_MAX_TEXTS_PER_CALL = 96;
/**
 * Per-text character cap applied before sending. Cohere Embed v3 on Bedrock
 * rejects longer inputs; ai-service chunks (≤1200 chars + title + tags) and
 * queries sit well under it, so this only bites on unusually long inputs,
 * where the model would truncate at ~512 tokens anyway (`truncate: "END"`).
 */
export const COHERE_MAX_TEXT_CHARS = 2048;

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** SDK attempts (1 = no retry) for chat and embeddings. Vision always uses 1,
 * matching the direct-Anthropic vision path's `maxRetries: 0`. */
const DEFAULT_MAX_ATTEMPTS = readPositiveInt(process.env.BEDROCK_MAX_ATTEMPTS, 3);

export class BedrockTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Bedrock request timed out after ${timeoutMs}ms`);
    this.name = "BedrockTimeoutError";
  }
}

export class BedrockRefusalError extends Error {
  constructor(readonly stopReason: string) {
    super(`Bedrock model stopped without an answer (stopReason: ${stopReason})`);
    this.name = "BedrockRefusalError";
  }
}

export type BedrockCommand = ConverseCommand | InvokeModelCommand;
export type BedrockSendOptions = { abortSignal: AbortSignal; maxAttempts: number };

/** Read at call time, not cached as a module-level const: on Lambda this is
 * set once per execution environment anyway, and reading it lazily avoids
 * any dependency on env vars being present before this module first loads
 * (relevant for tests, which set them per-case). */
function crossAccountRoleArn(): string | undefined {
  return process.env.BEDROCK_CROSS_ACCOUNT_ROLE_ARN || undefined;
}
function crossAccountExternalId(): string | undefined {
  return process.env.BEDROCK_CROSS_ACCOUNT_EXTERNAL_ID || undefined;
}
/** Re-assume this long before the session actually expires, never mid-request. */
const CREDENTIAL_REFRESH_SKEW_MS = 5 * 60 * 1000;

export interface CachedCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
}

let cachedCrossAccountCredentials: CachedCredentials | undefined;
const stsClient = new STSClient({ region: BEDROCK_REGION });

/** Transport seam, same pattern as `bedrockRuntimeDeps.send` — tests replace
 * `send` to exercise the caching/refresh logic without a real STS call. */
export const stsDeps = {
  send(command: AssumeRoleCommand) {
    return stsClient.send(command);
  },
};

/** Lets tests force the next call to re-assume instead of reusing a cached session. */
export function resetCrossAccountCredentialsCacheForTests(): void {
  cachedCrossAccountCredentials = undefined;
}

/**
 * Assumes `BEDROCK_CROSS_ACCOUNT_ROLE_ARN` and caches the result until
 * `CREDENTIAL_REFRESH_SKEW_MS` before it expires, so a steady stream of
 * Bedrock calls does not re-assume on every single request. Module-level
 * cache: correct for a Lambda execution environment, which is reused across
 * invocations until AWS recycles it (a cold start simply re-assumes once).
 */
export async function getCrossAccountCredentials(): Promise<CachedCredentials> {
  const now = Date.now();
  if (
    cachedCrossAccountCredentials &&
    cachedCrossAccountCredentials.expiration.getTime() - now > CREDENTIAL_REFRESH_SKEW_MS
  ) {
    return cachedCrossAccountCredentials;
  }

  const externalId = crossAccountExternalId();
  const { Credentials } = await stsDeps.send(
    new AssumeRoleCommand({
      RoleArn: crossAccountRoleArn(),
      RoleSessionName: "gymini-ai-service-bedrock",
      ...(externalId ? { ExternalId: externalId } : {}),
    }),
  );
  if (
    !Credentials?.AccessKeyId ||
    !Credentials.SecretAccessKey ||
    !Credentials.SessionToken ||
    !Credentials.Expiration
  ) {
    throw new Error("AssumeRole for BEDROCK_CROSS_ACCOUNT_ROLE_ARN returned incomplete credentials");
  }

  cachedCrossAccountCredentials = {
    accessKeyId: Credentials.AccessKeyId,
    secretAccessKey: Credentials.SecretAccessKey,
    sessionToken: Credentials.SessionToken,
    expiration: Credentials.Expiration,
  };
  return cachedCrossAccountCredentials;
}

const clients = new Map<number, BedrockRuntimeClient>();

function getClient(maxAttempts: number): BedrockRuntimeClient {
  let client = clients.get(maxAttempts);
  if (!client) {
    client = new BedrockRuntimeClient({
      region: BEDROCK_REGION,
      maxAttempts,
      ...(crossAccountRoleArn() ? { credentials: getCrossAccountCredentials } : {}),
    });
    clients.set(maxAttempts, client);
  }
  return client;
}

/** Transport seam. Tests replace `send` to capture requests offline. */
export const bedrockRuntimeDeps = {
  send(command: BedrockCommand, options: BedrockSendOptions): Promise<unknown> {
    return getClient(options.maxAttempts).send(
      command as never,
      { abortSignal: options.abortSignal } as never,
    );
  },
};

/**
 * Enforces `timeoutMs` as a hard deadline even if the underlying request does
 * not react to the abort signal, and always rejects with BedrockTimeoutError
 * so callers can classify it (ai.worker.ts falls back to its deterministic
 * plan on a "timed out" LlmError).
 */
async function sendWithDeadline<T>(
  command: BedrockCommand,
  timeoutMs: number,
  maxAttempts: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new BedrockTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  const request = bedrockRuntimeDeps.send(command, {
    abortSignal: controller.signal,
    maxAttempts,
  });
  // The losing side of the race must not become an unhandled rejection.
  request.catch(() => undefined);

  try {
    return (await Promise.race([request, deadline])) as T;
  } catch (err) {
    if (controller.signal.aborted && !(err instanceof BedrockTimeoutError)) {
      throw new BedrockTimeoutError(timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const NO_ANSWER_STOP_REASONS = new Set([
  "content_filtered",
  "guardrail_intervened",
  "refusal",
]);

function assertAnswered(output: ConverseCommandOutput): string {
  const stopReason = String(output.stopReason ?? "");
  if (NO_ANSWER_STOP_REASONS.has(stopReason)) {
    throw new BedrockRefusalError(stopReason);
  }
  return stopReason;
}

// ── Chat ───────────────────────────────────────────────────────────────────

export interface ConverseTextRequest {
  system?: string;
  userText: string;
  maxTokens: number;
  temperature?: number;
  timeoutMs: number;
  modelId?: string;
}

export interface ConverseTextResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
}

export function buildConverseTextInput(
  req: Omit<ConverseTextRequest, "timeoutMs">,
): ConverseCommandInput {
  const inferenceConfig: NonNullable<ConverseCommandInput["inferenceConfig"]> = {
    maxTokens: req.maxTokens,
  };
  if (typeof req.temperature === "number") {
    inferenceConfig.temperature = req.temperature;
  }

  return {
    modelId: req.modelId ?? BEDROCK_CHAT_MODEL,
    ...(req.system ? { system: [{ text: req.system }] } : {}),
    messages: [{ role: "user", content: [{ text: req.userText }] }],
    inferenceConfig,
  };
}

export function parseConverseText(output: ConverseCommandOutput): ConverseTextResult {
  const stopReason = assertAnswered(output);
  const text = (output.output?.message?.content ?? [])
    .map((block) => (block as { text?: unknown }).text)
    .filter((value): value is string => typeof value === "string")
    .join("");
  return {
    text,
    inputTokens: output.usage?.inputTokens ?? 0,
    outputTokens: output.usage?.outputTokens ?? 0,
    stopReason,
  };
}

export async function converseText(req: ConverseTextRequest): Promise<ConverseTextResult> {
  const output = await sendWithDeadline<ConverseCommandOutput>(
    new ConverseCommand(buildConverseTextInput(req)),
    req.timeoutMs,
    DEFAULT_MAX_ATTEMPTS,
  );
  return parseConverseText(output);
}

// ── Vision (forced tool use) ───────────────────────────────────────────────

export interface ConverseVisionToolRequest {
  image: { mediaType: "image/jpeg" | "image/png"; base64: string };
  text: string;
  toolName: string;
  toolDescription: string;
  inputSchema: Record<string, unknown>;
  maxTokens: number;
  timeoutMs: number;
  modelId?: string;
}

export function buildConverseVisionToolInput(
  req: Omit<ConverseVisionToolRequest, "timeoutMs">,
): ConverseCommandInput {
  return {
    modelId: req.modelId ?? BEDROCK_VISION_MODEL,
    messages: [
      {
        role: "user",
        content: [
          {
            image: {
              format: req.image.mediaType === "image/png" ? "png" : "jpeg",
              source: { bytes: Buffer.from(req.image.base64, "base64") },
            },
          },
          { text: req.text },
        ],
      },
    ],
    toolConfig: {
      tools: [
        {
          toolSpec: {
            name: req.toolName,
            description: req.toolDescription,
            inputSchema: { json: req.inputSchema } as unknown as ToolInputSchema,
          },
        },
      ],
      toolChoice: { tool: { name: req.toolName } },
    },
    inferenceConfig: { maxTokens: req.maxTokens },
  };
}

/** Returns the forced tool's input, or undefined when the model returned none. */
export function parseConverseToolUse(
  output: ConverseCommandOutput,
  toolName: string,
): unknown {
  assertAnswered(output);
  for (const block of output.output?.message?.content ?? []) {
    const toolUse = (block as { toolUse?: { name?: string; input?: unknown } }).toolUse;
    if (toolUse && toolUse.name === toolName) return toolUse.input;
  }
  return undefined;
}

export async function converseVisionTool(req: ConverseVisionToolRequest): Promise<unknown> {
  const output = await sendWithDeadline<ConverseCommandOutput>(
    new ConverseCommand(buildConverseVisionToolInput(req)),
    req.timeoutMs,
    1,
  );
  return parseConverseToolUse(output, req.toolName);
}

// ── Embeddings (Cohere Embed v3) ───────────────────────────────────────────

export function buildCohereEmbedBody(
  texts: readonly string[],
  inputType: EmbeddingInputType,
): { texts: string[]; input_type: EmbeddingInputType; truncate: "END" } {
  return {
    texts: texts.map((text) => text.slice(0, COHERE_MAX_TEXT_CHARS)),
    input_type: inputType,
    truncate: "END",
  };
}

/**
 * Accepts both documented response shapes: `embeddings: number[][]`
 * (`response_type: "embeddings_floats"`, the default) and
 * `embeddings: { float: number[][] }` (`"embeddings_by_type"`).
 */
export function parseCohereEmbedResponse(raw: unknown, expectedCount: number): number[][] {
  const embeddings = (raw as { embeddings?: unknown } | null)?.embeddings;
  const floats = Array.isArray(embeddings)
    ? embeddings
    : (embeddings as { float?: unknown } | undefined)?.float;

  if (!Array.isArray(floats) || floats.length !== expectedCount) {
    throw new Error(
      `Invalid Cohere embedding response: expected ${expectedCount} vector(s)`,
    );
  }

  return floats.map((vector, index) => {
    if (
      !Array.isArray(vector) ||
      vector.length === 0 ||
      !vector.every((n) => typeof n === "number" && Number.isFinite(n))
    ) {
      throw new Error(
        `Invalid Cohere embedding response: vector ${index} is not a numeric array`,
      );
    }
    return vector as number[];
  });
}

export function decodeInvokeModelBody(body: unknown): unknown {
  if (body instanceof Uint8Array) {
    return JSON.parse(new TextDecoder().decode(body));
  }
  if (typeof body === "string") return JSON.parse(body);
  throw new Error("Bedrock InvokeModel returned no body");
}

export async function embedTextsWithCohere(
  texts: readonly string[],
  inputType: EmbeddingInputType,
  opts: { timeoutMs: number; modelId?: string },
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length > COHERE_MAX_TEXTS_PER_CALL) {
    throw new Error(
      `Cohere Embed accepts at most ${COHERE_MAX_TEXTS_PER_CALL} texts per request, got ${texts.length}`,
    );
  }

  const input: InvokeModelCommandInput = {
    modelId: opts.modelId ?? BEDROCK_EMBEDDING_MODEL,
    contentType: "application/json",
    accept: "application/json",
    body: new TextEncoder().encode(JSON.stringify(buildCohereEmbedBody(texts, inputType))),
  };

  const output = await sendWithDeadline<{ body?: unknown }>(
    new InvokeModelCommand(input),
    opts.timeoutMs,
    DEFAULT_MAX_ATTEMPTS,
  );
  return parseCohereEmbedResponse(decodeInvokeModelBody(output.body), texts.length);
}
