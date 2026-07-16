import { logger } from "@gym-coach/shared";
import { llmService, buildOllamaMessages } from "../services/llm.service";
import type { ChatToolDefinition, ChatMessage } from "../services/llm.service";
import { retriever } from "./retriever";
import type { PersonalizationContext } from "./profile_extractor";

const MAX_TOOL_CALLS_PER_TURN = 2;

// Feasibility spike (2026-07-16, scratchpad/tool_calling_spike.mjs) confirmed
// qwen3:30b-a3b-instruct-2507-q4_K_M reliably emits well-formed Ollama
// tool_calls for these two schemas: 20/20 schema-valid, 19/20 correct
// tool-choice, 0 hallucinated names, 3/3 round-trip continuations coherent.
export const AVAILABLE_TOOLS: ChatToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_exercise_library",
      description:
        "Search the exercise knowledge base for exercises matching a muscle group or movement pattern, optionally filtered by available equipment. Use this when the user asks for specific exercise suggestions you are not already certain about.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query, e.g. muscle group or exercise type",
          },
          equipment: {
            type: "string",
            enum: ["none", "dumbbell", "barbell", "machine", "any"],
            description: "Equipment the user has available",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_user_fitness_data",
      description:
        "Fetch the current user's own fitness data on demand: workout history, InBody body-composition history, or nutrition logs. Use this when the user asks about their own past data specifically.",
      parameters: {
        type: "object",
        properties: {
          dataType: {
            type: "string",
            enum: ["workout_history", "inbody", "nutrition_logs"],
            description: "Which category of the user's own data to fetch",
          },
        },
        required: ["dataType"],
      },
    },
  },
];

const VALID_TOOL_NAMES = new Set(AVAILABLE_TOOLS.map((t) => t.function.name));
const VALID_EQUIPMENT = new Set(["none", "dumbbell", "barbell", "machine", "any"]);
const VALID_DATA_TYPES = new Set(["workout_history", "inbody", "nutrition_logs"]);

export type ToolExecutionContext = {
  personalization: PersonalizationContext;
};

function validateArgs(name: string, args: unknown): string | null {
  if (!VALID_TOOL_NAMES.has(name)) return `unknown tool name: ${name}`;
  if (!args || typeof args !== "object") return "arguments must be an object";
  const a = args as Record<string, unknown>;

  if (name === "search_exercise_library") {
    if (typeof a.query !== "string" || !a.query.trim())
      return "missing/invalid 'query'";
    if (a.equipment !== undefined && !VALID_EQUIPMENT.has(a.equipment as string))
      return `invalid enum 'equipment': ${a.equipment}`;
    return null;
  }

  if (name === "get_user_fitness_data") {
    if (!VALID_DATA_TYPES.has(a.dataType as string))
      return `invalid/missing enum 'dataType': ${a.dataType}`;
    return null;
  }

  return `unknown tool name: ${name}`;
}

function summarizeWorkoutHistory(ctx: PersonalizationContext): unknown {
  return (ctx.workoutHistory || []).slice(0, 10).map((w) => ({
    date: w.date,
    name: w.name,
    exercises: (w.exercises || []).slice(0, 12).map((e) => ({
      name: e.exercise?.exerciseName,
      sets: e.sets,
      reps: e.reps,
      weight: e.weight,
    })),
  }));
}

function summarizeInBodyHistory(ctx: PersonalizationContext): unknown {
  return (ctx.inBodyHistory || []).slice(0, 6).map((entry) => ({
    date: entry.date ?? entry.dateOnly,
    weightKg: entry.weight,
    bodyFatPct: entry.bodyFatPct,
    muscleMassKg: entry.muscleMass,
    bmi: entry.bmi,
  }));
}

function summarizeNutritionLogs(ctx: PersonalizationContext): unknown {
  return (ctx.nutritionHistory || []).slice(0, 10).map((n) => ({
    date: n.date,
    mealType: n.mealType,
    foodName: n.foodName,
    calories: n.calories,
    protein: n.protein,
  }));
}

/**
 * Executes a validated tool call. Never throws — tool failures degrade to a
 * `{ error }` string result so one bad call doesn't abort the whole chat turn.
 */
export async function executeTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolExecutionContext,
): Promise<string> {
  const validationError = validateArgs(name, rawArgs);
  if (validationError) {
    logger.warn({ name, rawArgs, validationError }, "Tool call failed validation");
    return JSON.stringify({ error: validationError });
  }
  const args = rawArgs as Record<string, unknown>;

  try {
    if (name === "search_exercise_library") {
      const docs = await retriever.searchExercises(
        args.query as string,
        args.equipment as string | undefined,
      );
      if (docs.length === 0) {
        return JSON.stringify({ results: [], note: "No matching exercises found." });
      }
      return JSON.stringify({
        results: docs.map((d) => ({ content: d.pageContent, relevance: d.score })),
      });
    }

    if (name === "get_user_fitness_data") {
      const dataType = args.dataType as string;
      if (dataType === "workout_history") {
        return JSON.stringify({ workoutHistory: summarizeWorkoutHistory(ctx.personalization) });
      }
      if (dataType === "inbody") {
        return JSON.stringify({ inBodyHistory: summarizeInBodyHistory(ctx.personalization) });
      }
      return JSON.stringify({ nutritionLogs: summarizeNutritionLogs(ctx.personalization) });
    }

    return JSON.stringify({ error: `unknown tool name: ${name}` });
  } catch (err) {
    logger.warn({ name, args, err }, "Tool execution failed");
    return JSON.stringify({ error: "Tool execution failed" });
  }
}

/**
 * Runs one LLM-bound turn with real Ollama tool-calling: the model may call
 * `search_exercise_library` / `get_user_fitness_data` before producing its
 * final answer. Bounded to one tool round-trip (MAX_TOOL_CALLS_PER_TURN
 * calls, then one follow-up completion) so a turn can't loop indefinitely or
 * blow the latency budget.
 */
export async function runToolCallingTurn(
  prompt: string,
  personalization: PersonalizationContext,
  opts: { timeoutMs: number; temperature?: number; numPredict?: number },
): Promise<{
  answer: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}> {
  const messages = buildOllamaMessages(prompt) as ChatMessage[];

  const first = await llmService.callLLMChat(messages, {
    tools: AVAILABLE_TOOLS,
    timeoutMs: opts.timeoutMs,
    temperature: opts.temperature,
    numPredict: opts.numPredict,
  });

  const toolCalls = first.message.tool_calls;
  if (!toolCalls || toolCalls.length === 0) {
    return {
      answer: first.message.content,
      promptTokens: first.promptTokens,
      completionTokens: first.completionTokens,
      totalTokens: first.totalTokens,
    };
  }

  const boundedCalls = toolCalls.slice(0, MAX_TOOL_CALLS_PER_TURN);
  logger.info(
    { tools: boundedCalls.map((c) => c.function.name) },
    "Tool-calling turn: model requested tool(s)",
  );
  const followUpMessages: ChatMessage[] = [
    ...messages,
    { role: "assistant", content: "", tool_calls: boundedCalls },
  ];
  for (const call of boundedCalls) {
    const result = await executeTool(call.function.name, call.function.arguments, {
      personalization,
    });
    followUpMessages.push({ role: "tool", content: result });
  }

  const second = await llmService.callLLMChat(followUpMessages, {
    timeoutMs: opts.timeoutMs,
    temperature: opts.temperature,
    numPredict: opts.numPredict,
  });

  return {
    answer: second.message.content,
    promptTokens: first.promptTokens + second.promptTokens,
    completionTokens: first.completionTokens + second.completionTokens,
    totalTokens: first.totalTokens + second.totalTokens,
  };
}
