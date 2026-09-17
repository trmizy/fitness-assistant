/**
 * Phase 6 — service/API tests for the nutrition domain.
 *
 * These are not unit tests of arithmetic (nutritionMath has its own); they check the part that can
 * only break against the server: the URL each call builds, the body it sends, and how it reads the
 * answer back. Every contract asserted here was first observed against the running gateway, and
 * each one has already cost a real bug somewhere in the product:
 *
 *  - a log row comes back with `fats`, not `fat` — web sums `log.fat` and therefore shows 0 g of
 *    fat for every day (MOBILE_BACKEND_GAPS.md records it as a web bug, web being frozen);
 *  - `POST /nutrition` validates macros with `z.number().positive()`, so a food with 0 g of fat
 *    must omit the field instead of sending a zero, or the whole save 400s;
 *  - `PUT /nutrition/goals` re-checks the macros against Atwater 4/4/9 with a ±50 kcal tolerance
 *    and rejects the goal otherwise;
 *  - the program endpoints answer `{ data: ... }` while the log and goal endpoints answer the
 *    object directly, so unwrapping is per-endpoint, not a rule.
 */
import { nutritionService } from "../../api";
import {
  buildLogPayload,
  macroConsistency,
  normalizeLogs,
  sumTotals,
} from "../../../features/nutrition/nutritionMath";
import { stubHttp, type HttpStub } from "./httpStub";

let http: HttpStub;

afterEach(() => http?.restore());

describe("GET /nutrition", () => {
  it("sends only the date filters it was given", async () => {
    http = stubHttp(() => ({ data: [] }));
    await nutritionService.getLogs("2026-09-17", "2026-09-17");

    expect(http.last().method).toBe("GET");
    expect(http.last().path).toBe("/nutrition");
    expect(http.last().query).toEqual({ startDate: "2026-09-17", endDate: "2026-09-17" });
  });

  it("adds mealType only when asked, and sends no query at all when asked for nothing", async () => {
    http = stubHttp(() => ({ data: [] }));

    await nutritionService.getLogs("2026-09-17", "2026-09-17", "breakfast");
    expect(http.last().query).toEqual({
      startDate: "2026-09-17",
      endDate: "2026-09-17",
      mealType: "breakfast",
    });

    await nutritionService.getLogs();
    expect(http.last().url).toBe("/nutrition?");
    expect(http.last().query).toEqual({});
  });

  it("hands back the rows untouched, and `fats` survives into the day's fat total", async () => {
    // The exact row shape the gateway returns. `fats` is the field name; a reader that looks for
    // `fat` silently totals zero — which is what web does today.
    http = stubHttp(() => ({
      data: [
        { id: "1", mealType: "breakfast", foodName: "Trứng", calories: 155, protein: 13, carbs: 1, fats: 11 },
        { id: "2", mealType: "lunch", foodName: "Cơm", calories: 200, protein: 4, carbs: 44, fats: 0.4 },
      ],
    }));

    const rows = await nutritionService.getLogs("2026-09-17", "2026-09-17");
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(2);

    const totals = sumTotals(normalizeLogs(rows));
    expect(totals.calories).toBe(355);
    expect(totals.fat).toBeCloseTo(11.4, 5);
    // The bug this guards: reading `fat` off the raw rows.
    expect(rows.reduce((sum: number, row: any) => sum + (row.fat ?? 0), 0)).toBe(0);
  });
});

describe("POST /nutrition", () => {
  it("posts the payload as built, with zero macros left out", async () => {
    http = stubHttp(() => ({ status: 201, data: { id: "new" } }));

    const payload = buildLogPayload({
      mealType: "snack",
      foodName: "  Táo  ",
      calories: 52,
      protein: 0,
      carbs: 14,
      fats: 0,
    });
    await nutritionService.createLog(payload);

    const sent = http.last();
    expect(sent.method).toBe("POST");
    expect(sent.path).toBe("/nutrition");
    expect(sent.body).toEqual({ mealType: "snack", foodName: "Táo", calories: 52, carbs: 14 });
    // `z.number().positive()` on the server: these must be absent, not zero.
    expect("protein" in sent.body).toBe(false);
    expect("fats" in sent.body).toBe(false);
  });

  it("surfaces the server's 400 instead of reporting a save that never happened", async () => {
    http = stubHttp(() => ({
      status: 400,
      data: { message: "protein: Number must be greater than 0" },
    }));

    await expect(
      nutritionService.createLog({ mealType: "snack", foodName: "Táo", calories: 52, protein: 0 }),
    ).rejects.toMatchObject({
      response: { status: 400, data: { message: "protein: Number must be greater than 0" } },
    });
  });

  it("keeps a valid macro set intact — nothing is dropped on the way out", async () => {
    http = stubHttp(() => ({ status: 201, data: {} }));

    await nutritionService.createLog(
      buildLogPayload({
        mealType: "dinner",
        foodName: "Ức gà",
        calories: 165,
        protein: 31,
        carbs: 0,
        fats: 3.6,
        notes: "150 g",
        date: "2026-09-17",
      }),
    );

    expect(http.last().body).toEqual({
      mealType: "dinner",
      foodName: "Ức gà",
      calories: 165,
      protein: 31,
      fats: 3.6,
      notes: "150 g",
      date: "2026-09-17",
    });
  });
});

describe("PUT and DELETE /nutrition/:id", () => {
  it("edits and deletes by id", async () => {
    http = stubHttp(() => ({ data: { ok: true } }));

    await nutritionService.updateLog("log-7", { calories: 300 });
    expect(http.last().method).toBe("PUT");
    expect(http.last().path).toBe("/nutrition/log-7");
    expect(http.last().body).toEqual({ calories: 300 });

    await nutritionService.deleteLog("log-7");
    expect(http.last().method).toBe("DELETE");
    expect(http.last().path).toBe("/nutrition/log-7");
  });
});

describe("/nutrition/goals", () => {
  it("reads the goal as the endpoint returns it, water target included", async () => {
    http = stubHttp(() => ({
      data: { id: "g1", calories: 2400, protein: 150, carbs: 250, fat: 80, waterMl: 3000, goalMode: "CUSTOM" },
    }));

    const goal = await nutritionService.getGoal();
    expect(http.last().path).toBe("/nutrition/goals");
    expect(goal.calories).toBe(2400);
    // `waterMl` is a TARGET and nothing in the product logs intake against it — the reason the
    // dashboard and the monthly summary show no water figure.
    expect(goal.waterMl).toBe(3000);
  });

  it("writes the goal and returns the server's plan-consistency verdict with it", async () => {
    http = stubHttp(() => ({
      data: { goal: { calories: 2400 }, planConsistency: { consistent: false, reason: "PLAN_MISMATCH" } },
    }));

    const result = await nutritionService.upsertGoal({
      calories: 2400,
      protein: 150,
      carbs: 250,
      fat: 80,
    });

    expect(http.last().method).toBe("PUT");
    expect(http.last().path).toBe("/nutrition/goals");
    expect(http.last().body).toEqual({ calories: 2400, protein: 150, carbs: 250, fat: 80 });
    expect(result.planConsistency).toEqual({ consistent: false, reason: "PLAN_MISMATCH" });
  });

  it("agrees with the server's Atwater check, so the UI can refuse before the request", async () => {
    // 150*4 + 250*4 + 80*9 = 2320 kcal against a stated 2400 → 80 kcal out, past the ±50 tolerance.
    const check = macroConsistency(2400, 150, 250, 80);
    expect(check.computedCalories).toBe(2320);
    expect(check.discrepancyKcal).toBe(-80);
    expect(check.consistent).toBe(false);

    http = stubHttp(() => ({
      status: 400,
      data: { message: "Macros do not match calories (2320 kcal vs 2400 kcal)" },
    }));

    await expect(
      nutritionService.upsertGoal({ calories: 2400, protein: 150, carbs: 250, fat: 80 }),
    ).rejects.toMatchObject({ response: { status: 400 } });

    // ...and a goal inside the tolerance is accepted by both sides.
    expect(macroConsistency(2340, 150, 250, 80).consistent).toBe(true);
  });
});

describe("the program endpoints and their envelope", () => {
  it("unwraps the daily task and asks for a specific day only when given one", async () => {
    http = stubHttp(() => ({
      data: {
        data: {
          hasProgram: true,
          date: "2026-09-17",
          program: { id: "p1", name: "Giảm mỡ" },
          day: { name: "Ngày 3" },
          meals: [{ id: "m1" }],
          actualProgress: { calories: 1840, protein: 120, carbs: 180, fat: 60 },
        },
      },
    }));

    const task = await nutritionService.getDailyTask("2026-09-17");
    expect(http.last().path).toBe("/nutrition/daily-task");
    expect(http.last().query).toEqual({ date: "2026-09-17" });
    // The dashboard tile reads exactly this field.
    expect(task.actualProgress?.calories).toBe(1840);

    await nutritionService.getDailyTask();
    expect(http.last().url).toBe("/nutrition/daily-task");
  });

  it("falls back to a no-program day rather than undefined when the envelope is empty", async () => {
    http = stubHttp(() => ({ data: {} }));

    const task = await nutritionService.getDailyTask("2026-09-17");
    expect(task).toEqual({
      hasProgram: false,
      date: "2026-09-17",
      program: null,
      day: null,
      meals: [],
      actualProgress: null,
    });
  });

  it("reads the monthly summary out of its envelope, empty list when there is none", async () => {
    http = stubHttp(() => ({
      data: { data: [{ date: "2026-09-01", status: "completed", completedMeals: 4, partialMeals: 0, totalMeals: 4, calories: 2100 }] },
    }));

    const days = await nutritionService.getMonthlySummary("2026-09-01", "2026-09-30");
    expect(http.last().path).toBe("/nutrition/monthly-summary");
    expect(http.last().query).toEqual({ startDate: "2026-09-01", endDate: "2026-09-30" });
    expect(days).toHaveLength(1);

    http.restore();
    http = stubHttp(() => ({ data: {} }));
    expect(await nutritionService.getMonthlySummary("2026-09-01", "2026-09-30")).toEqual([]);
  });

  it("returns null, not an error, when there is no current program", async () => {
    http = stubHttp(() => ({ data: {} }));
    expect(await nutritionService.getCurrentProgram()).toBeNull();
    expect(http.last().path).toBe("/nutrition/plans/current");
  });

  it("marks and unmarks a planned meal through the completion endpoint", async () => {
    http = stubHttp(() => ({ data: { data: { status: "COMPLETED" } } }));

    await nutritionService.upsertMealCompletion("meal-1", "2026-09-17", "PARTIAL", {
      percentConsumed: 50,
    });
    expect(http.last().method).toBe("POST");
    expect(http.last().path).toBe("/nutrition/meal-completions");
    expect(http.last().body).toEqual({
      mealId: "meal-1",
      date: "2026-09-17",
      status: "PARTIAL",
      percentConsumed: 50,
    });

    await nutritionService.deleteMealCompletion("meal-1", "2026-09-17");
    expect(http.last().method).toBe("DELETE");
    expect(http.last().path).toBe("/nutrition/meal-completions");
    expect(http.last().query).toEqual({ mealId: "meal-1", date: "2026-09-17" });
  });
});
