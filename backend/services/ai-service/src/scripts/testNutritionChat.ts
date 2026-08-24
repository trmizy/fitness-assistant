import axios from "axios";

const API_BASE_URL =
  process.env.AI_TEST_API_BASE_URL || "http://localhost:3000";
const ACCESS_TOKEN = process.env.AI_TEST_ACCESS_TOKEN;
const EMAIL = process.env.AI_TEST_EMAIL;
const PASSWORD = process.env.AI_TEST_PASSWORD;

function localDateAfter(days: number): string {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

async function getToken(): Promise<string> {
  if (ACCESS_TOKEN) return ACCESS_TOKEN;
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      "Set AI_TEST_ACCESS_TOKEN or AI_TEST_EMAIL + AI_TEST_PASSWORD.",
    );
  }
  const res = await axios.post(
    `${API_BASE_URL}/auth/login`,
    { email: EMAIL, password: PASSWORD },
    { timeout: 8000 },
  );
  const token = res.data?.accessToken ?? res.data?.data?.accessToken;
  if (!token)
    throw new Error("Login succeeded but no accessToken was returned.");
  return token;
}

function unwrap(payload: any): any {
  return payload?.data?.data ?? payload?.data ?? payload;
}

function assertNoWorkoutLeak(answer: string, question: string): void {
  const forbidden = [
    /scheduled_session/i,
    /Nhật ký tập luyện/i,
    /Bài tập/i,
    /Sets/i,
    /Reps/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(answer)) {
      throw new Error(
        `Workout content leaked into nutrition answer for "${question}": ${pattern}`,
      );
    }
  }
}

function assertNoNutritionLeak(answer: string, question: string): void {
  const forbidden = [
    /thực đơn/i,
    /bữa sáng/i,
    /bữa trưa/i,
    /bữa tối/i,
    /nutrition_log/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(answer)) {
      throw new Error(
        `Nutrition content leaked into workout answer for "${question}": ${pattern}`,
      );
    }
  }
}

async function ask(question: string, headers: Record<string, string>) {
  const started = Date.now();
  const res = await axios.post(
    `${API_BASE_URL}/ai/ask`,
    { question },
    { headers, timeout: 20000 },
  );
  const payload = unwrap(res);
  const answer = String(payload.answer ?? "");
  if (!answer.trim()) throw new Error(`Empty answer for question: ${question}`);
  return { question, latencyMs: Date.now() - started, answer, payload };
}

async function main() {
  const token = await getToken();
  const headers = { Authorization: `Bearer ${token}` };
  const tomorrow = localDateAfter(1);

  const breakfast = await ask("cho tôi thấy thực đơn sáng mai", headers);
  if (!breakfast.payload.nutritionSchedule)
    throw new Error("Missing nutritionSchedule metadata for breakfast lookup.");
  if (breakfast.payload.workoutSchedule)
    throw new Error("Breakfast lookup must not call workout schedule.");
  if (breakfast.payload.nutritionSchedule.targetDate !== tomorrow)
    throw new Error(
      `Expected ${tomorrow}, got ${breakfast.payload.nutritionSchedule.targetDate}`,
    );
  if (breakfast.payload.nutritionSchedule.mealType !== "breakfast")
    throw new Error(
      `Expected breakfast, got ${breakfast.payload.nutritionSchedule.mealType}`,
    );
  assertNoWorkoutLeak(breakfast.answer, breakfast.question);

  const tomorrowFood = await ask("ngày mai tôi sẽ ăn gì", headers);
  if (!tomorrowFood.payload.nutritionSchedule)
    throw new Error(
      "Missing nutritionSchedule metadata for tomorrow meal lookup.",
    );
  if (tomorrowFood.payload.workoutSchedule)
    throw new Error("Tomorrow meal lookup must not call workout schedule.");
  if (tomorrowFood.payload.nutritionSchedule.targetDate !== tomorrow)
    throw new Error(
      `Expected ${tomorrow}, got ${tomorrowFood.payload.nutritionSchedule.targetDate}`,
    );
  assertNoWorkoutLeak(tomorrowFood.answer, tomorrowFood.question);

  const tomorrowWorkout = await ask("ngày mai tôi tập gì", headers);
  if (!tomorrowWorkout.payload.workoutSchedule)
    throw new Error("Missing workoutSchedule metadata for workout lookup.");
  if (tomorrowWorkout.payload.nutritionSchedule)
    throw new Error("Workout lookup must not call nutrition lookup.");
  if (tomorrowWorkout.payload.workoutSchedule.targetDate !== tomorrow)
    throw new Error(
      `Expected ${tomorrow}, got ${tomorrowWorkout.payload.workoutSchedule.targetDate}`,
    );
  assertNoNutritionLeak(tomorrowWorkout.answer, tomorrowWorkout.question);

  const cases = [breakfast, tomorrowFood, tomorrowWorkout];
  for (const result of cases) {
    console.log(
      JSON.stringify(
        {
          question: result.question,
          latencyMs: result.latencyMs,
          nutritionSchedule: result.payload.nutritionSchedule,
          workoutSchedule: result.payload.workoutSchedule,
          answerPreview: result.answer.slice(0, 360),
        },
        null,
        2,
      ),
    );
  }

  console.log(
    "PASS: nutrition chat lookup and workout schedule lookup are routed to separate deterministic sources.",
  );
}

main().catch((err) => {
  const detail = err?.response?.data ?? err?.message ?? err;
  console.error("FAIL ai:test:nutrition-chat");
  console.error(detail);
  process.exit(1);
});
