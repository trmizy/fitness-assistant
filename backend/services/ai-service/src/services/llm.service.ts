import axios, { AxiosError } from 'axios';
import { logger } from '@gym-coach/shared';
import type { LLMResponse } from '../models/ai.models';
import { LlmError } from '../errors/api-error';

const LLM_PROVIDER = process.env.LLM_PROVIDER || 'ollama';
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'http://localhost:11434';
export const LLM_MODEL = process.env.LLM_MODEL || 'llama3.2:3b';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text';

function safeLlmUrl(): string {
  try {
    const url = new URL(LLM_BASE_URL);
    url.username = '';
    url.password = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return LLM_BASE_URL.replace(/\/\/[^/@]+@/, '//***@');
  }
}

function isAxiosTimeout(err: unknown): boolean {
  return err instanceof AxiosError && (err.code === 'ECONNABORTED' || /timeout/i.test(err.message));
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
      if (LLM_PROVIDER === 'ollama') {
        const response = await axios.get(`${LLM_BASE_URL}/api/tags`, { timeout: timeoutMs });
        const models = Array.isArray(response.data?.models) ? response.data.models : [];
        const hasChatModel = models.some((item: any) => item?.name === LLM_MODEL || item?.model === LLM_MODEL);
        const hasEmbeddingModel = models.some((item: any) => {
          const name = String(item?.name || item?.model || '');
          return name === EMBEDDING_MODEL || name === `${EMBEDDING_MODEL}:latest`;
        });

        return {
          llmAvailable: hasChatModel && hasEmbeddingModel,
          llmProvider: LLM_PROVIDER,
          llmUrl: base,
          model: LLM_MODEL,
          embeddingModel: EMBEDDING_MODEL,
          checkedAt,
          ...(!hasChatModel || !hasEmbeddingModel
            ? { error: `Missing model(s): ${[!hasChatModel ? LLM_MODEL : null, !hasEmbeddingModel ? EMBEDDING_MODEL : null].filter(Boolean).join(', ')}` }
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

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const model = EMBEDDING_MODEL;

      try {
        const response = await axios.post(`${LLM_BASE_URL}/api/embeddings`, {
          model,
          prompt: text,
        });
        return response.data.embedding as number[];
      } catch (err) {
        // Newer Ollama builds use /api/embed instead of /api/embeddings.
        const is404 = err instanceof AxiosError && err.response?.status === 404;
        if (!is404) throw err;

        const response = await axios.post(`${LLM_BASE_URL}/api/embed`, {
          model,
          input: text,
        });

        const embeddings = response.data?.embeddings as number[][] | undefined;
        const embedding = response.data?.embedding as number[] | undefined;
        const vector = embeddings?.[0] ?? embedding;

        if (!vector || !Array.isArray(vector)) {
          throw new Error('Invalid embedding response from LLM provider');
        }
        return vector;
      }
    } catch (err) {
      const msg = err instanceof AxiosError ? err.message : String(err);
      throw new LlmError(`Embedding generation failed: ${msg}`, err instanceof Error ? err : undefined);
    }
  },

  /**
   * Calls the configured LLM provider.
   * @throws {LlmError} when the provider is unreachable or returns an error.
   *   Callers must NOT expose or store LlmError.message as user-facing conversation content.
   */
  async callLLM(
    prompt: string,
    opts?: { responseFormat?: 'json' | 'text'; timeoutMs?: number; temperature?: number; numPredict?: number },
  ): Promise<LLMResponse> {
    try {
      if (LLM_PROVIDER === 'ollama') {
        // Use /api/chat (chat format) for better instruction following.
        // The prompt is split into a system message (rules) and a user message (question + context).
        const systemEnd = prompt.indexOf('Câu hỏi của user:');
        const hasSystemSplit = systemEnd > 0;

        const messages = hasSystemSplit
          ? [
              { role: 'system', content: prompt.slice(0, systemEnd).trim() },
              { role: 'user', content: prompt.slice(systemEnd).trim() },
            ]
          : [{ role: 'user', content: prompt }];

        const payload: any = {
          model: LLM_MODEL,
          messages,
          stream: false,
          options: {
            num_ctx: 4096,
            num_predict: opts?.numPredict ?? (opts?.responseFormat === 'json' ? 2048 : 1024),
          },
        };

        // Include temperature option if provided (low temperature recommended for structured JSON)
        if (typeof opts?.temperature === 'number') {
          // Keep it in options; provider uses this for sampling.
          payload.options.temperature = opts.temperature;
        }

        // If caller explicitly requests JSON-mode/format for Ollama, set top-level `format`.
        if (opts?.responseFormat === 'json') {
          // Use top-level `format` as Ollama expects structured output there.
          payload.format = 'json';
        }

        const response = await axios.post(`${LLM_BASE_URL}/api/chat`, payload, {
          timeout: opts?.timeoutMs ?? 120000,
        });
        return {
          answer: (response.data.message?.content as string) || '',
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
        { model: LLM_MODEL, messages: [{ role: 'user', content: prompt }] },
        { headers: { 'Content-Type': 'application/json' }, timeout: opts?.timeoutMs ?? 300000 },
      );
      const usage = (response.data.usage || {}) as Record<string, number>;
      return {
        answer: (response.data.choices[0]?.message?.content as string) || '',
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
      };
    } catch (err) {
      const cause = err instanceof Error ? err : undefined;
      const isConnection = err instanceof AxiosError && !err.response && !isAxiosTimeout(err);
      const isTimeout = isAxiosTimeout(err);
      const detail = err instanceof AxiosError ? err.message : String(err);

      logger.error({ err, llmProvider: LLM_PROVIDER, llmBaseUrl: LLM_BASE_URL }, 'LLM call failed');

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
};

