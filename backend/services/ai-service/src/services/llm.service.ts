import axios, { AxiosError } from 'axios';
import { logger } from '@gym-coach/shared';
import type { LLMResponse } from '../models/ai.models';
import { LlmError } from '../errors/api-error';

const LLM_PROVIDER = process.env.LLM_PROVIDER || 'ollama';
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'http://localhost:11434';
export const LLM_MODEL = process.env.LLM_MODEL || 'llama3.2:3b';

export const llmService = {
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const model = process.env.EMBEDDING_MODEL || 'nomic-embed-text';

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
  async callLLM(prompt: string): Promise<LLMResponse> {
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

        const response = await axios.post(
          `${LLM_BASE_URL}/api/chat`,
          {
            model: LLM_MODEL,
            messages,
            stream: false,
            options: {
              // Increased from 1536 to accommodate chat history, expanded RAG results,
              // and workout/nutrition history in the prompt (~2000-3000 tokens typical).
              num_ctx: 4096,
              // Increased from 500 to prevent truncated workout tables (5-6 day plans
              // with exercises need ~600-800 tokens).
              num_predict: 1024,
            },
          },
          { timeout: 60000 },
        );
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
        { headers: { 'Content-Type': 'application/json' }, timeout: 300000 },
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
      const isConnection = err instanceof AxiosError && !err.response;
      const detail = err instanceof AxiosError ? err.message : String(err);

      logger.error({ err, llmProvider: LLM_PROVIDER, llmBaseUrl: LLM_BASE_URL }, 'LLM call failed');

      throw new LlmError(
        isConnection
          ? `LLM provider unreachable at ${LLM_BASE_URL}. Is ${LLM_PROVIDER} running?`
          : `LLM call failed: ${detail}`,
        cause,
      );
    }
  },
};

