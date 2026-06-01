import axios from 'axios';

const API_BASE_URL = process.env.WORKOUT_TEST_API_BASE_URL || 'http://localhost:3000';
const ACCESS_TOKEN = process.env.WORKOUT_TEST_ACCESS_TOKEN;
const EMAIL = process.env.WORKOUT_TEST_EMAIL;
const PASSWORD = process.env.WORKOUT_TEST_PASSWORD;

async function getToken(): Promise<string> {
  if (ACCESS_TOKEN) return ACCESS_TOKEN;
  if (!EMAIL || !PASSWORD) {
    throw new Error('Set WORKOUT_TEST_ACCESS_TOKEN or WORKOUT_TEST_EMAIL + WORKOUT_TEST_PASSWORD.');
  }
  const res = await axios.post(`${API_BASE_URL}/auth/login`, { email: EMAIL, password: PASSWORD }, { timeout: 8000 });
  const token = res.data?.accessToken ?? res.data?.data?.accessToken;
  if (!token) throw new Error('Login succeeded but no accessToken was returned.');
  return token;
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
  const target = schedules.find((schedule: any) =>
    schedule?.status !== 'COMPLETED' &&
    Array.isArray(schedule?.programDay?.exercises) &&
    schedule.programDay.exercises.length > 0,
  );
  if (!target) throw new Error('No non-completed scheduled workout with exercises was found.');

  const startRes = await axios.post(`${API_BASE_URL}/workouts/schedules/${target.id}/start`, {}, { headers, timeout: 10000 });
  const started = startRes.data?.data?.schedule;
  if (started?.status !== 'IN_PROGRESS') {
    throw new Error(`Expected IN_PROGRESS after start, got ${started?.status}`);
  }

  const exercises = target.programDay.exercises.map((item: any) => ({
    exerciseId: item.exercise?.id,
    sets: item.sets || 1,
    reps: item.reps || 10,
    weight: 1,
  })).filter((item: any) => item.exerciseId);

  const workoutRes = await axios.post(`${API_BASE_URL}/workouts`, {
    scheduleId: target.id,
    name: `Completion test ${target.id.slice(0, 6)}`,
    date: String(target.date),
    duration: 1,
    exercises,
  }, { headers, timeout: 10000 });

  const refreshed = await axios.get(`${API_BASE_URL}/workouts/schedules`, {
    headers,
    params: { limit: 100 },
    timeout: 10000,
  });
  const completed = (Array.isArray(refreshed.data) ? refreshed.data : []).find((schedule: any) => schedule.id === target.id);
  if (completed?.status !== 'COMPLETED') {
    throw new Error(`Expected COMPLETED after workout save, got ${completed?.status}`);
  }
  if (completed?.progressPercent !== 100) {
    throw new Error(`Expected progressPercent=100, got ${completed?.progressPercent}`);
  }
  if (!completed?.workoutLogId && !completed?.workoutId) {
    throw new Error('Expected workoutLogId/workoutId on completed schedule.');
  }

  let duplicateBlocked = false;
  try {
    await axios.post(`${API_BASE_URL}/workouts/schedules/${target.id}/start`, {}, { headers, timeout: 10000 });
  } catch (err: any) {
    duplicateBlocked = err?.response?.status === 409;
  }
  if (!duplicateBlocked) throw new Error('Starting completed schedule should return 409.');

  console.log(JSON.stringify({
    scheduleId: target.id,
    startStatus: started.status,
    completedStatus: completed.status,
    progressPercent: completed.progressPercent,
    workoutLogId: completed.workoutLogId || workoutRes.data?.id,
    duplicateStartBlocked: duplicateBlocked,
  }, null, 2));
  console.log('PASS: workout completion status is persisted and duplicate start is blocked.');
}

main().catch((err) => {
  console.error('FAIL workout:test:completion');
  console.error(err?.response?.data ?? err?.message ?? err);
  process.exit(1);
});
