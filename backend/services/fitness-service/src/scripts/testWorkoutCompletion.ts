import axios from "axios";

const API_BASE_URL =
  process.env.WORKOUT_TEST_API_BASE_URL || "http://localhost:3000";
const ACCESS_TOKEN = process.env.WORKOUT_TEST_ACCESS_TOKEN;
const EMAIL = process.env.WORKOUT_TEST_EMAIL;
const PASSWORD = process.env.WORKOUT_TEST_PASSWORD;

async function getToken(): Promise<string> {
  if (ACCESS_TOKEN) return ACCESS_TOKEN;
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      "Set WORKOUT_TEST_ACCESS_TOKEN or WORKOUT_TEST_EMAIL + WORKOUT_TEST_PASSWORD.",
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

function unwrap(payload: any) {
  return payload?.data ?? payload;
}

async function main() {
  const token = await getToken();
  const headers = { Authorization: `Bearer ${token}` };
  const schedulesRes = await axios.get(`${API_BASE_URL}/workouts/schedules`, {
    headers,
    params: { limit: 100 },
    timeout: 10000,
  });
  const schedules = Array.isArray(schedulesRes.data) ? schedulesRes.data : [];
  const target = schedules.find(
    (schedule: any) =>
      schedule?.status !== "COMPLETED" &&
      Array.isArray(schedule?.programDay?.exercises) &&
      schedule.programDay.exercises.length > 0,
  );
  if (!target)
    throw new Error(
      "No non-completed scheduled workout with exercises was found.",
    );

  const startRes = await axios.post(
    `${API_BASE_URL}/workouts/schedules/${target.id}/start`,
    {},
    { headers, timeout: 10000 },
  );
  const started = unwrap(startRes.data);
  if (started.sessionStatus !== "in_progress") {
    throw new Error(
      `Expected in_progress after start, got ${started.sessionStatus}`,
    );
  }
  if (started.progressPercent !== 0) {
    throw new Error(
      `Expected progressPercent=0 after start, got ${started.progressPercent}`,
    );
  }

  const exercises = target.programDay.exercises;
  let lastResult = started;
  for (const exercise of exercises) {
    const completeRes = await axios.post(
      `${API_BASE_URL}/workouts/schedules/${target.id}/exercises/${exercise.id}/complete`,
      {},
      { headers, timeout: 10000 },
    );
    lastResult = unwrap(completeRes.data);
    const expectedProgress = Math.round(
      (lastResult.completedExercises / lastResult.totalExercises) * 100,
    );
    if (lastResult.progressPercent !== expectedProgress) {
      throw new Error(
        `Expected progress ${expectedProgress}, got ${lastResult.progressPercent}`,
      );
    }
  }

  if (lastResult.progressPercent !== 100) {
    throw new Error(
      `Expected final progressPercent=100, got ${lastResult.progressPercent}`,
    );
  }
  if (
    lastResult.sessionStatus !== "completed" ||
    lastResult.dayStatus !== "completed"
  ) {
    throw new Error(
      `Expected completed statuses, got session=${lastResult.sessionStatus}, day=${lastResult.dayStatus}`,
    );
  }

  const refreshed = await axios.get(`${API_BASE_URL}/workouts/schedules`, {
    headers,
    params: { limit: 100 },
    timeout: 10000,
  });
  const completed = (Array.isArray(refreshed.data) ? refreshed.data : []).find(
    (schedule: any) => schedule.id === target.id,
  );
  if (completed?.progressPercent !== 100 || completed?.status !== "COMPLETED") {
    throw new Error(
      `Expected persisted 100/COMPLETED, got ${completed?.progressPercent}/${completed?.status}`,
    );
  }

  const duplicateRes = await axios.post(
    `${API_BASE_URL}/workouts/schedules/${target.id}/exercises/${exercises[0].id}/complete`,
    {},
    { headers, timeout: 10000 },
  );
  const duplicate = unwrap(duplicateRes.data);
  if (
    duplicate.progressPercent !== 100 ||
    duplicate.completedExercises !== duplicate.totalExercises
  ) {
    throw new Error(
      "Repeated quick complete should be idempotent and keep progress at 100.",
    );
  }

  console.log(
    JSON.stringify(
      {
        scheduleId: target.id,
        workoutId: lastResult.workoutId,
        totalExercises: lastResult.totalExercises,
        completedExercises: lastResult.completedExercises,
        progressPercent: lastResult.progressPercent,
        sessionStatus: lastResult.sessionStatus,
        persistedStatus: completed.status,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: workout quick completion progress is persisted and idempotent.",
  );
}

main().catch((err) => {
  console.error("FAIL workout:test:completion");
  console.error(err?.response?.data ?? err?.message ?? err);
  process.exit(1);
});
