import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { executeTool, runToolCallingTurn, AVAILABLE_TOOLS } from "../llm/tools";
import { retriever } from "../llm/retriever";
import { llmService } from "../services/llm.service";
import { conversationRepository } from "../repositories/conversation.repository";
import type { PersonalizationContext } from "../llm/profile_extractor";

const originalSearchExercises = retriever.searchExercises;
const originalCallLLMChat = llmService.callLLMChat;
const originalCreateUserMemory = conversationRepository.createUserMemory;
const originalPruneOldestMemories = conversationRepository.pruneOldestMemories;

afterEach(() => {
  retriever.searchExercises = originalSearchExercises;
  llmService.callLLMChat = originalCallLLMChat;
  conversationRepository.createUserMemory = originalCreateUserMemory;
  conversationRepository.pruneOldestMemories = originalPruneOldestMemories;
});

function emptyPersonalization(
  overrides?: Partial<PersonalizationContext>,
): PersonalizationContext {
  return {
    profile: { userId: "u1", training: { availableEquipment: [], injuries: [], preferredTrainingDays: [] } },
    inBodyHistory: [],
    workoutHistory: [],
    nutritionHistory: [],
    ...overrides,
  } as PersonalizationContext;
}

describe("executeTool — search_exercise_library", () => {
  it("returns results from retriever.searchExercises for valid args", async () => {
    retriever.searchExercises = async (query, equipment) => {
      assert.equal(query, "rear delts");
      assert.equal(equipment, "none");
      return [
        { id: "exercises_1", pageContent: "Exercise: Face Pull", score: 0.7, source: "qdrant:exercises", category: "exercise_knowledge", metadata: { source_file: "test", chunk_id: "1" } },
      ];
    };

    const result = JSON.parse(
      await executeTool(
        "search_exercise_library",
        { query: "rear delts", equipment: "none" },
        { personalization: emptyPersonalization() },
      ),
    );
    assert.equal(result.results.length, 1);
    assert.match(result.results[0].content, /Face Pull/);
  });

  it("rejects missing 'query'", async () => {
    const result = JSON.parse(
      await executeTool("search_exercise_library", {}, { personalization: emptyPersonalization() }),
    );
    assert.ok(result.error);
  });

  it("rejects invalid 'equipment' enum", async () => {
    const result = JSON.parse(
      await executeTool(
        "search_exercise_library",
        { query: "chest", equipment: "spaceship" },
        { personalization: emptyPersonalization() },
      ),
    );
    assert.ok(result.error);
  });

  it("degrades to an error result instead of throwing when retriever fails", async () => {
    retriever.searchExercises = async () => {
      throw new Error("qdrant unavailable");
    };
    const result = JSON.parse(
      await executeTool(
        "search_exercise_library",
        { query: "chest" },
        { personalization: emptyPersonalization() },
      ),
    );
    assert.ok(result.error);
  });
});

describe("executeTool — get_user_fitness_data", () => {
  it("returns workout_history from already-fetched personalization context", async () => {
    const ctx = emptyPersonalization({
      workoutHistory: [
        { date: "2026-07-10", name: "Push Day", exercises: [{ exercise: { exerciseName: "Bench Press" }, sets: 4, reps: 8, weight: 60 }] },
      ],
    });
    const result = JSON.parse(
      await executeTool("get_user_fitness_data", { dataType: "workout_history" }, { personalization: ctx }),
    );
    assert.equal(result.workoutHistory.length, 1);
    assert.equal(result.workoutHistory[0].exercises[0].name, "Bench Press");
  });

  it("returns inbody history", async () => {
    const ctx = emptyPersonalization({
      inBodyHistory: [{ date: "2026-07-01", weight: 70, bodyFatPct: 18, muscleMass: 32, bmi: 22 }],
    });
    const result = JSON.parse(
      await executeTool("get_user_fitness_data", { dataType: "inbody" }, { personalization: ctx }),
    );
    assert.equal(result.inBodyHistory[0].weightKg, 70);
  });

  it("returns nutrition logs", async () => {
    const ctx = emptyPersonalization({
      nutritionHistory: [{ date: "2026-07-15", mealType: "lunch", foodName: "Chicken rice", calories: 600, protein: 40 }],
    });
    const result = JSON.parse(
      await executeTool("get_user_fitness_data", { dataType: "nutrition_logs" }, { personalization: ctx }),
    );
    assert.equal(result.nutritionLogs[0].foodName, "Chicken rice");
  });

  it("rejects an invalid dataType", async () => {
    const result = JSON.parse(
      await executeTool("get_user_fitness_data", { dataType: "secrets" }, { personalization: emptyPersonalization() }),
    );
    assert.ok(result.error);
  });
});

describe("executeTool — remember_user_fact", () => {
  it("saves a memory and prunes when a userId is present", async () => {
    let created: any;
    let pruned: [string, number] | undefined;
    conversationRepository.createUserMemory = (async (data: any) => {
      created = data;
      return { id: "m1", ...data, createdAt: new Date() };
    }) as any;
    conversationRepository.pruneOldestMemories = (async (userId: string, keep: number) => {
      pruned = [userId, keep];
    }) as any;

    const result = JSON.parse(
      await executeTool(
        "remember_user_fact",
        { fact: "Prefers training in the morning", category: "schedule" },
        { personalization: emptyPersonalization({ profile: { userId: "u42", training: { availableEquipment: [], injuries: [], preferredTrainingDays: [] } } }) },
      ),
    );

    assert.equal(result.saved, true);
    assert.equal(created.userId, "u42");
    assert.equal(created.content, "Prefers training in the morning");
    assert.equal(created.category, "schedule");
    assert.deepEqual(pruned, ["u42", 20]);
  });

  it("rejects a missing 'fact'", async () => {
    const result = JSON.parse(
      await executeTool("remember_user_fact", {}, { personalization: emptyPersonalization() }),
    );
    assert.ok(result.error);
  });

  it("rejects an invalid 'category' enum", async () => {
    const result = JSON.parse(
      await executeTool(
        "remember_user_fact",
        { fact: "Vegetarian", category: "spaceship" },
        { personalization: emptyPersonalization() },
      ),
    );
    assert.ok(result.error);
  });

  it("rejects a fact over the length cap", async () => {
    const result = JSON.parse(
      await executeTool(
        "remember_user_fact",
        { fact: "x".repeat(301) },
        { personalization: emptyPersonalization() },
      ),
    );
    assert.ok(result.error);
  });

  it("returns an error instead of writing when there is no authenticated user", async () => {
    let wasCalled = false;
    conversationRepository.createUserMemory = (async () => {
      wasCalled = true;
      return {} as any;
    }) as any;

    const result = JSON.parse(
      await executeTool(
        "remember_user_fact",
        { fact: "Vegetarian" },
        { personalization: emptyPersonalization({ profile: { training: { availableEquipment: [], injuries: [], preferredTrainingDays: [] } } }) },
      ),
    );

    assert.ok(result.error);
    assert.equal(wasCalled, false);
  });
});

describe("executeTool — unknown tool", () => {
  it("returns an error instead of throwing", async () => {
    const result = JSON.parse(
      await executeTool("delete_everything", {}, { personalization: emptyPersonalization() }),
    );
    assert.ok(result.error);
  });
});

describe("AVAILABLE_TOOLS schema", () => {
  it("declares the spike-verified tools plus remember_user_fact", () => {
    const names = AVAILABLE_TOOLS.map((t) => t.function.name).sort();
    assert.deepEqual(names, [
      "get_user_fitness_data",
      "remember_user_fact",
      "search_exercise_library",
    ]);
  });
});

describe("runToolCallingTurn", () => {
  it("returns the first-hop answer directly when the model calls no tool", async () => {
    let calls = 0;
    llmService.callLLMChat = async () => {
      calls++;
      return {
        message: { role: "assistant", content: "Protein giup phuc hoi co bap." },
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      };
    };

    const result = await runToolCallingTurn(
      "System rules\nCâu hỏi của user: Protein la gi?",
      emptyPersonalization(),
      { timeoutMs: 5000 },
    );

    assert.equal(calls, 1, "no tool call means only one LLM round trip");
    assert.equal(result.answer, "Protein giup phuc hoi co bap.");
    assert.equal(result.totalTokens, 15);
  });

  it("executes the tool call and does a second round trip for the final answer", async () => {
    let call = 0;
    llmService.callLLMChat = async (messages, opts) => {
      call++;
      if (call === 1) {
        assert.ok(opts?.tools?.length, "first hop must advertise tools");
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              { function: { name: "search_exercise_library", arguments: { query: "rear delts", equipment: "none" } } },
            ],
          },
          promptTokens: 20,
          completionTokens: 8,
          totalTokens: 28,
        };
      }
      // Second hop: tool result should be present in the messages array, and
      // tools should NOT be re-offered (forces a final text answer).
      assert.equal(opts?.tools, undefined, "second hop must not re-offer tools");
      const toolMsg = messages.find((m) => m.role === "tool");
      assert.ok(toolMsg, "tool result message must be appended");
      return {
        message: { role: "assistant", content: "Thu Face Pull cho vai sau." },
        promptTokens: 40,
        completionTokens: 12,
        totalTokens: 52,
      };
    };
    retriever.searchExercises = async () => [
      { id: "exercises_1", pageContent: "Exercise: Face Pull", score: 0.7, source: "qdrant:exercises", category: "exercise_knowledge", metadata: { source_file: "test", chunk_id: "1" } },
    ];

    const result = await runToolCallingTurn(
      "System rules\nCâu hỏi của user: Bai tap nao cho vai sau tai nha?",
      emptyPersonalization(),
      { timeoutMs: 5000 },
    );

    assert.equal(call, 2, "one tool call means exactly two LLM round trips");
    assert.equal(result.answer, "Thu Face Pull cho vai sau.");
    assert.equal(result.promptTokens, 60);
    assert.equal(result.completionTokens, 20);
    assert.equal(result.totalTokens, 80);
  });

  it("bounds tool execution to MAX_TOOL_CALLS_PER_TURN even if the model requests more", async () => {
    let executedCalls = 0;
    const manyToolCalls = Array.from({ length: 5 }, (_, i) => ({
      function: { name: "get_user_fitness_data", arguments: { dataType: "workout_history" } },
      id: String(i),
    }));

    llmService.callLLMChat = async (messages, opts) => {
      if (opts?.tools?.length) {
        return {
          message: { role: "assistant", content: "", tool_calls: manyToolCalls },
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
        };
      }
      executedCalls = messages.filter((m) => m.role === "tool").length;
      return {
        message: { role: "assistant", content: "done" },
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
      };
    };

    await runToolCallingTurn("Q", emptyPersonalization(), { timeoutMs: 5000 });
    assert.equal(executedCalls, 2, "must cap at MAX_TOOL_CALLS_PER_TURN=2");
  });
});
