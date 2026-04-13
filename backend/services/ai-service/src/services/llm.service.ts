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
      const response = await axios.post(`${LLM_BASE_URL}/api/embeddings`, {
        model: process.env.EMBEDDING_MODEL || 'nomic-embed-text',
        prompt: text,
      });
      return response.data.embedding as number[];
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
        const response = await axios.post(
          `${LLM_BASE_URL}/api/generate`,
          { model: LLM_MODEL, prompt, stream: false },
          { timeout: 120000 },
        );
        return {
          answer: (response.data.response as string) || '',
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
        { headers: { 'Content-Type': 'application/json' }, timeout: 120000 },
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
