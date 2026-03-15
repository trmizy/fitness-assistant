import axios from 'axios';
import { logger } from '@gym-coach/shared';
import type { LLMResponse } from '../models/ai.models';

const LLM_PROVIDER = process.env.LLM_PROVIDER || 'ollama';
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'http://localhost:11434';
export const LLM_MODEL = process.env.LLM_MODEL || 'llama3.2:3b';

export const llmService = {
  async generateEmbedding(text: string): Promise<number[]> {
    const response = await axios.post(`${LLM_BASE_URL}/api/embeddings`, {
      model: process.env.EMBEDDING_MODEL || 'nomic-embed-text',
      prompt: text,
    });
    return response.data.embedding;
  },

  async callLLM(prompt: string): Promise<LLMResponse> {
    try {
      if (LLM_PROVIDER === 'ollama') {
        const response = await axios.post(
          `${LLM_BASE_URL}/api/generate`,
          { model: LLM_MODEL, prompt, stream: false },
          { timeout: 120000 },
        );
        return {
          answer: response.data.response || '',
          promptTokens: response.data.prompt_eval_count || 0,
          completionTokens: response.data.eval_count || 0,
          totalTokens:
            (response.data.prompt_eval_count || 0) +
            (response.data.eval_count || 0),
        };
      }

      // Fallback for OpenAI-compatible APIs
      const response = await axios.post(
        `${LLM_BASE_URL}/v1/chat/completions`,
        { model: LLM_MODEL, messages: [{ role: 'user', content: prompt }] },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 120000,
        },
      );
      const usage = response.data.usage || {};
      return {
        answer: response.data.choices[0]?.message?.content || '',
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
      };
    } catch (error: any) {
      logger.error('LLM call failed:', error.message);
      return {
        answer: `Error calling LLM: ${error.message}. Make sure Ollama is running with 'ollama serve'.`,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };
    }
  },
};
