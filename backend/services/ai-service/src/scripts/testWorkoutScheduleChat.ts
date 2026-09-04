import axios from "axios";

const API_BASE_URL =
  process.env.AI_TEST_API_BASE_URL || "http://localhost:3000";
const ACCESS_TOKEN = process.env.AI_TEST_ACCESS_TOKEN;
const EMAIL = process.env.AI_TEST_EMAIL;
const PASSWORD = process.env.AI_TEST_PASSWORD;

function localDateForCurrentWeek(targetDay: number): string {
  const value = new Date();
  const mondayOffset = (value.getDay() + 6) % 7;
  value.setDate(value.getDate() - mondayOffset + (targetDay - 1));
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

function assertNoGeneralPlanFallback(answer: string, question: string): void {
  const forbidden = [
    /full body\s*3/i,
    /sample/i,
    /mau\s*3/i,
    /macro/i,
    /protein/i,
    /calo/i,
    /assumed training frequency/i,
    /ban co the tap may buoi/i,
    /bạn có thể tập mấy buổi/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(answer)) {
      throw new Error(
        `General-plan fallback leaked for "${question}": matched ${pattern}`,
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
  const schedule = payload.workoutSchedule;
  if (!answer.trim()) throw new Error(`Empty answer for question: ${question}`);
  if (!schedule || schedule.source === undefined) {
    throw new Error(
      `Missing workoutSchedule metadata for question: ${question}`,
    );
  }
  assertNoGeneralPlanFallback(answer, question);
  return { question, latencyMs: Date.now() - started, answer, schedule };
}

async function main() {
  const token = await getToken();
  const headers = { Authorization: `Bearer ${token}` };
  const tuesday = localDateForCurrentWeek(2);
  const thursday = localDateForCurrentWeek(4);
  const friday = localDateForCurrentWeek(5);

  const cases = [
    {
      label: "A",
      question: "thứ 3 tuần này tập gì",
      expectedTargetDate: tuesday,
    },
    {
      label: "B",
      question: "thứ 5 tuần này thì sao",
      expectedTargetDate: thursday,
    },
    {
      label: "C",
      question: "thú 5 tuần này tập gì",
      expectedTargetDate: thursday,
    },
    {
      label: "D",
      question: "thứ 5 ngày 18 tháng 6 tập gì",
      expectedTargetDate: "2026-06-18",
      mustSayNoSpecificScheduleIfNotScheduled: true,
    },
    {
      label: "E",
      question: "18/6 tập gì",
      expectedTargetDate: "2026-06-18",
      mustSayNoSpecificScheduleIfNotScheduled: true,
    },
    {
      label: "F",
      question: "còn thứ 6 thì sao",
      expectedTargetDate: friday,
    },
  ];

  for (const testCase of cases) {
    const result = await ask(testCase.question, headers);
    const { schedule, answer } = result;
    if (schedule.targetDate !== testCase.expectedTargetDate) {
      throw new Error(
        `${testCase.label}: expected targetDate=${testCase.expectedTargetDate}, got ${schedule.targetDate}`,
      );
    }
    if (
      testCase.mustSayNoSpecificScheduleIfNotScheduled &&
      schedule.source !== "scheduled_session" &&
      !/chưa thấy lịch tập cụ thể/i.test(answer)
    ) {
      throw new Error(
        `${testCase.label}: explicit date without scheduled_session must say no specific schedule.`,
      );
    }

    console.log(
      JSON.stringify(
        {
          label: testCase.label,
          question: testCase.question,
          latencyMs: result.latencyMs,
          targetDate: schedule.targetDate,
          source: schedule.source,
          scheduledWorkoutFound: schedule.scheduledWorkoutFound,
          answerPreview: answer.slice(0, 360),
        },
        null,
        2,
      ),
    );
  }

  console.log(
    "PASS: workout schedule chat lookup handled weekday/date/follow-up cases without general-plan fallback.",
  );
}

main().catch((err) => {
  const detail = err?.response?.data ?? err?.message ?? err;
  console.error("FAIL ai:test:workout-schedule-chat");
  console.error(detail);
  process.exit(1);
});
