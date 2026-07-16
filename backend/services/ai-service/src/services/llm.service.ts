import axios, { AxiosError } from "axios";
import { logger } from "@gym-coach/shared";
import type { LLMResponse } from "../models/ai.models";
import { LlmError } from "../errors/api-error";

const LLM_PROVIDER = process.env.LLM_PROVIDER || "ollama";
const LLM_BASE_URL = process.env.LLM_BASE_URL || "http://localhost:11434";
export const LLM_MODEL = process.env.LLM_MODEL || "llama3.2:3b";
export const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL || "nomic-embed-text";
const MOCK_EMBEDDING_DIM = 768;
const DEFAULT_EMBEDDING_TIMEOUT_MS = readPositiveIntEnv(
  "EMBEDDING_TIMEOUT_MS",
  8000,
);
const DEFAULT_LLM_TIMEOUT_MS = readPositiveIntEnv("LLM_TIMEOUT_MS", 60000);

function readPositiveIntEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function sanitizeLlmError(err: unknown): Record<string, unknown> {
  if (err instanceof AxiosError) {
    const data = err.response?.data;
    const responseBody =
      typeof data === "string"
        ? data.slice(0, 500)
        : data
          ? JSON.stringify(data).slice(0, 500)
          : undefined;
    return {
      name: err.name,
      message: err.message,
      code: err.code,
      status: err.response?.status,
      method: err.config?.method,
      url: err.config?.url,
      timeout: err.config?.timeout,
      responseBody,
    };
  }

  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }

  return { message: String(err) };
}

function safeLlmUrl(): string {
  try {
    const url = new URL(LLM_BASE_URL);
    url.username = "";
    url.password = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return LLM_BASE_URL.replace(/\/\/[^/@]+@/, "//***@");
  }
}

function isAxiosTimeout(err: unknown): boolean {
  return (
    err instanceof AxiosError &&
    (err.code === "ECONNABORTED" || /timeout/i.test(err.message))
  );
}

function normalizeModelName(value: unknown): string {
  return String(value || "").trim();
}

function modelNameMatches(actual: unknown, expected: string): boolean {
  const actualName = normalizeModelName(actual);
  const expectedName = normalizeModelName(expected);
  if (!actualName || !expectedName) return false;
  return (
    actualName === expectedName ||
    actualName === `${expectedName}:latest` ||
    `${actualName}:latest` === expectedName
  );
}

function buildOllamaMessages(
  prompt: string,
): Array<{ role: string; content: string }> {
  const systemEnd = prompt.indexOf("Câu hỏi của user:");
  const hasSystemSplit = systemEnd > 0;

  return hasSystemSplit
    ? [
        { role: "system", content: prompt.slice(0, systemEnd).trim() },
        { role: "user", content: prompt.slice(systemEnd).trim() },
      ]
    : [{ role: "user", content: prompt }];
}

async function emitTextInChunks(
  text: string,
  onToken: (token: string) => void | Promise<void>,
  chunkSize = 6,
) {
  for (let i = 0; i < text.length; i += chunkSize) {
    await onToken(text.slice(i, i + chunkSize));
  }
}

function mockEmbedding(text: string): number[] {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return Array.from({ length: MOCK_EMBEDDING_DIM }, (_, index) => {
    hash ^= index + 0x9e3779b9;
    hash = Math.imul(hash, 16777619);
    return ((hash >>> 0) % 2000) / 1000 - 1;
  });
}

function mockCompletion(
  prompt: string,
  responseFormat?: "json" | "text",
): string {
  if (responseFormat === "json") {
    return JSON.stringify({
      goal: "test plan",
      durationWeeks: 4,
      daysPerWeek: 3,
      weeklySchedule: [],
      progressionNotes: ["Use conservative progression in test mode."],
      recoveryNotes: ["Prioritize sleep and recovery."],
      nutritionSummary: "Use adequate protein and hydration.",
    });
  }

  if (/workout|exercise|tap|lich/i.test(prompt)) {
    return "Mock AI response: use a conservative training plan with clear sets, reps, rest, and recovery notes.";
  }

  return "Mock AI response: use retrieved context when relevant and keep the answer concise.";
}

export type LlmHealthStatus = {
  llmAvailable: boolean;
  llmProvider: string;
  llmUrl: string;
  model: string;
  embeddingModel: string;
  checkedAt: string;
  error?: string;
};

export const llmService = {
  async getHealthStatus(timeoutMs = 3000): Promise<LlmHealthStatus> {
    const base = safeLlmUrl();
    const checkedAt = new Date().toISOString();

    try {
      if (LLM_PROVIDER === "mock") {
        return {
          llmAvailable: true,
          llmProvider: LLM_PROVIDER,
          llmUrl: "mock://local",
          model: LLM_MODEL,
          embeddingModel: EMBEDDING_MODEL,
          checkedAt,
        };
      }

      if (LLM_PROVIDER === "ollama") {
        const response = await axios.get(`${LLM_BASE_URL}/api/tags`, {
          timeout: timeoutMs,
        });
        const models = Array.isArray(response.data?.models)
          ? response.data.models
          : [];
        const hasChatModel = models.some((item: any) =>
          [item?.name, item?.model].some((name) =>
            modelNameMatches(name, LLM_MODEL),
          ),
        );
        const hasEmbeddingModel = models.some((item: any) =>
          [item?.name, item?.model].some((name) =>
            modelNameMatches(name, EMBEDDING_MODEL),
          ),
        );

        return {
          llmAvailable: hasChatModel && hasEmbeddingModel,
          llmProvider: LLM_PROVIDER,
          llmUrl: base,
          model: LLM_MODEL,
          embeddingModel: EMBEDDING_MODEL,
          checkedAt,
          ...(!hasChatModel || !hasEmbeddingModel
            ? {
                error: `Missing model(s): ${[!hasChatModel ? LLM_MODEL : null, !hasEmbeddingModel ? EMBEDDING_MODEL : null].filter(Boolean).join(", ")}`,
              }
            : {}),
        };
      }

      await axios.get(`${LLM_BASE_URL}/v1/models`, { timeout: timeoutMs });
      return {
        llmAvailable: true,
        llmProvider: LLM_PROVIDER,
        llmUrl: base,
        model: LLM_MODEL,
        embeddingModel: EMBEDDING_MODEL,
        checkedAt,
      };
    } catch (err) {
      const detail = err instanceof AxiosError ? err.message : String(err);
      return {
        llmAvailable: false,
        llmProvider: LLM_PROVIDER,
        llmUrl: base,
        model: LLM_MODEL,
        embeddingModel: EMBEDDING_MODEL,
        checkedAt,
        error: detail,
      };
    }
  },

  async generateEmbedding(
    text: string,
    opts?: { timeoutMs?: number },
  ): Promise<number[]> {
    if (LLM_PROVIDER === "mock") {
      return mockEmbedding(text);
    }

    try {
      const model = EMBEDDING_MODEL;

      try {
        const response = await axios.post(
          `${LLM_BASE_URL}/api/embeddings`,
          {
            model,
            prompt: text,
          },
          { timeout: opts?.timeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS },
        );
        return response.data.embedding as number[];
      } catch (err) {
        // Newer Ollama builds use /api/embed instead of /api/embeddings.
        const is404 = err instanceof AxiosError && err.response?.status === 404;
        if (!is404) throw err;

        const response = await axios.post(
          `${LLM_BASE_URL}/api/embed`,
          {
            model,
            input: text,
          },
          { timeout: opts?.timeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS },
        );

        const embeddings = response.data?.embeddings as number[][] | undefined;
        const embedding = response.data?.embedding as number[] | undefined;
        const vector = embeddings?.[0] ?? embedding;

        if (!vector || !Array.isArray(vector)) {
          throw new Error("Invalid embedding response from LLM provider");
        }
        return vector;
      }
    } catch (err) {
      const msg = err instanceof AxiosError ? err.message : String(err);
      throw new LlmError(
        `Embedding generation failed: ${msg}`,
        err instanceof Error ? err : undefined,
      );
    }
  },

  /**
   * Calls the configured LLM provider.
   * @throws {LlmError} when the provider is unreachable or returns an error.
   *   Callers must NOT expose or store LlmError.message as user-facing conversation content.
   */
  async callLLM(
    prompt: string,
    opts?: {
      responseFormat?: "json" | "text";
      timeoutMs?: number;
      temperature?: number;
      numPredict?: number;
    },
  ): Promise<LLMResponse> {
    try {
      if (LLM_PROVIDER === "mock") {
        const answer = mockCompletion(prompt, opts?.responseFormat);
        const promptTokens = Math.ceil(prompt.length / 4);
        const completionTokens = Math.ceil(answer.length / 4);
        return {
          answer,
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        };
      }

      if (LLM_PROVIDER === "ollama") {
        // Use /api/chat (chat format) for better instruction following.
        // The prompt is split into a system message (rules) and a user message (question + context).
        const payload: any = {
          model: LLM_MODEL,
          messages: buildOllamaMessages(prompt),
          stream: false,
          options: {
            num_ctx:
              opts?.responseFormat === "json"
                ? readPositiveIntEnv("LLM_JSON_NUM_CTX", 8192)
                : readPositiveIntEnv("LLM_NUM_CTX", 8192),
            num_predict:
              opts?.numPredict ??
              (opts?.responseFormat === "json" ? 2048 : 1024),
          },
        };

        // Include temperature option if provided (low temperature recommended for structured JSON)
        if (typeof opts?.temperature === "number") {
          // Keep it in options; provider uses this for sampling.
          payload.options.temperature = opts.temperature;
        }

        // If caller explicitly requests JSON-mode/format for Ollama, set top-level `format`.
        if (opts?.responseFormat === "json") {
          // Use top-level `format` as Ollama expects structured output there.
          payload.format = "json";
        }

        const response = await axios.post(`${LLM_BASE_URL}/api/chat`, payload, {
          timeout: opts?.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
        });
        return {
          answer: (response.data.message?.content as string) || "",
          promptTokens: (response.data.prompt_eval_count as number) || 0,
          completionTokens: (response.data.eval_count as number) || 0,
          totalTokens:
            ((response.data.prompt_eval_count as number) || 0) +
            ((response.data.eval_count as number) || 0),
        };
      }

      // OpenAI-compatible APIs (LM Studio, vllm, OpenAI, etc.)
      const response = await axios.post(
        `${LLM_BASE_URL}/v1/chat/completions`,
        { model: LLM_MODEL, messages: [{ role: "user", content: prompt }] },
        {
          headers: { "Content-Type": "application/json" },
          timeout: opts?.timeoutMs ?? 300000,
        },
      );
      const usage = (response.data.usage || {}) as Record<string, number>;
      return {
        answer: (response.data.choices[0]?.message?.content as string) || "",
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
      };
    } catch (err) {
      const cause = err instanceof Error ? err : undefined;
      const isConnection =
        err instanceof AxiosError && !err.response && !isAxiosTimeout(err);
      const isTimeout = isAxiosTimeout(err);
      const detail = err instanceof AxiosError ? err.message : String(err);

      logger.error(
        {
          err: sanitizeLlmError(err),
          llmProvider: LLM_PROVIDER,
          llmBaseUrl: safeLlmUrl(),
        },
        "LLM call failed",
      );

      throw new LlmError(
        isConnection
          ? `LLM provider unreachable at ${LLM_BASE_URL}. Is ${LLM_PROVIDER} running?`
          : isTimeout
            ? `LLM provider timed out at ${LLM_BASE_URL}. The model may be overloaded or the prompt is too large.`
            : `LLM call failed: ${detail}`,
        cause,
      );
    }
  },

  async callLLMStream(
    prompt: string,
    opts: {
      responseFormat?: "json" | "text";
      timeoutMs?: number;
      temperature?: number;
      numPredict?: number;
      onToken: (token: string) => void | Promise<void>;
    },
  ): Promise<LLMResponse> {
    if (LLM_PROVIDER !== "ollama") {
      const response = await this.callLLM(prompt, opts);
      await emitTextInChunks(response.answer, opts.onToken);
      return response;
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      opts.timeoutMs ?? 120000,
    );
    let answer = "";
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      const payload: any = {
        model: LLM_MODEL,
        messages: buildOllamaMessages(prompt),
        stream: true,
        options: {
          num_ctx:
            opts.responseFormat === "json"
              ? readPositiveIntEnv("LLM_JSON_NUM_CTX", 8192)
              : readPositiveIntEnv("LLM_NUM_CTX", 8192),
          num_predict:
            opts.numPredict ?? (opts.responseFormat === "json" ? 2048 : 1024),
        },
      };
      if (typeof opts.temperature === "number") {
        payload.options.temperature = opts.temperature;
      }
      if (opts.responseFormat === "json") {
        payload.format = "json";
      }

      const response = await fetch(`${LLM_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`LLM stream failed with status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let event: any;
          try {
            event = JSON.parse(trimmed);
          } catch {
            continue;
          }

          const token =
            typeof event?.message?.content === "string"
              ? event.message.content
              : typeof event?.response === "string"
                ? event.response
                : "";
          if (token) {
            answer += token;
            await opts.onToken(token);
          }

          if (typeof event?.prompt_eval_count === "number")
            promptTokens = event.prompt_eval_count;
          if (typeof event?.eval_count === "number")
            completionTokens = event.eval_count;
        }
      }

      const trailing = buffer.trim();
      if (trailing) {
        try {
          const event = JSON.parse(trailing);
          const token =
            typeof event?.message?.content === "string"
              ? event.message.content
              : typeof event?.response === "string"
                ? event.response
                : "";
          if (token) {
            answer += token;
            await opts.onToken(token);
          }
          if (typeof event?.prompt_eval_count === "number")
            promptTokens = event.prompt_eval_count;
          if (typeof event?.eval_count === "number")
            completionTokens = event.eval_count;
        } catch {
          // Ignore malformed trailing chunks.
        }
      }

      return {
        answer,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      };
    } catch (err) {
      const cause = err instanceof Error ? err : undefined;
      const isAbort = cause?.name === "AbortError";
      const detail = err instanceof Error ? err.message : String(err);

      logger.error(
        { err, llmProvider: LLM_PROVIDER, llmBaseUrl: LLM_BASE_URL },
        "LLM stream failed",
      );

      throw new LlmError(
        isAbort
          ? `LLM provider timed out at ${LLM_BASE_URL}. The model may be overloaded or the prompt is too large.`
          : `LLM stream failed: ${detail}`,
        cause,
      );
    } finally {
      clearTimeout(timeout);
    }
  },
};
