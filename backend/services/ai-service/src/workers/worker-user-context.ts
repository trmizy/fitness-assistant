/**
 * Fetches personal user data for use in plan generation workers.
 * Workers run without user auth tokens, so they use the internal service secret.
 */
import axios from 'axios';
import { logger } from '@gym-coach/shared';

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL ||
  (process.env.NODE_ENV === 'production' ? 'http://user-service:3004' : 'http://localhost:3004');

const FITNESS_SERVICE_URL =
  process.env.FITNESS_SERVICE_URL ||
  (process.env.NODE_ENV === 'production' ? 'http://fitness-service:3002' : 'http://localhost:3002');

function internalHeaders(userId: string) {
  return {
    'x-internal-token': process.env.INTERNAL_SERVICE_SECRET || '',
    'x-user-id': userId,
  };
}

export interface WorkerUserContext {
  /** Latest InBody measurement — most accurate physical data */
  latestInBody: {
    weightKg?: number;
    bodyFatPct?: number;
    bodyFatKg?: number;
    muscleMassKg?: number;
    bmi?: number;
    bmr?: number;
    measuredAt?: string;
    segmentalMuscle?: { rightArm?: number; leftArm?: number; trunk?: number; rightLeg?: number; leftLeg?: number };
  } | null;
  /** All InBody entries for trend display */
  inBodyHistory: Array<{
    weightKg?: number; bodyFatPct?: number; muscleMassKg?: number; measuredAt?: string;
  }>;
  /** Basic profile fields */
  profile: {
    age?: number;
    gender?: string;
    heightCm?: number;
    goal?: string;
    activityLevel?: string;
    experienceLevel?: string;
    currentWeight?: number;
    targetWeight?: number;
    injuries?: string[];
  } | null;
  /** Recent workout logs (last 10, with exercise details) */
  recentWorkouts: Array<{
    date?: string;
    duration?: number;
    exerciseNames?: string[];
    muscleGroups?: string[];
  }>;
  /** Recent nutrition daily totals (last 7 days) */
  recentNutritionDays: Array<{
    date?: string;
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
  }>;
}

/**
 * Fetch all personal context for plan generation.
 * Non-critical failures are swallowed — missing data means AI generates a slightly less personalised plan
 * but won't fail the job.
 */
export async function fetchWorkerUserContext(userId: string): Promise<WorkerUserContext> {
  const headers = internalHeaders(userId);
  const timeout = 5000;

  const [profileRes, inBodyRes, workoutsRes, nutritionRes] = await Promise.allSettled([
    axios.get(`${USER_SERVICE_URL}/profile/me`, { headers, timeout }),
    axios.get(`${USER_SERVICE_URL}/inbody`, { headers, timeout }),
    axios.get(`${FITNESS_SERVICE_URL}/workouts?limit=10`, { headers, timeout }),
    axios.get(`${FITNESS_SERVICE_URL}/nutrition`, { headers, timeout }),
  ]);

  // ── Profile ──────────────────────────────────────────────────────────────
  const profileData = profileRes.status === 'fulfilled'
    ? (profileRes.value.data?.profile ?? profileRes.value.data ?? null)
    : null;
  if (profileRes.status === 'rejected') {
    logger.debug({ err: (profileRes as any).reason?.message, userId }, '[worker-context] profile fetch failed');
  }

  // ── InBody ────────────────────────────────────────────────────────────────
  const rawInBody: any[] = inBodyRes.status === 'fulfilled' ? (inBodyRes.value.data ?? []) : [];
  if (inBodyRes.status === 'rejected') {
    logger.debug({ err: (inBodyRes as any).reason?.message, userId }, '[worker-context] inbody fetch failed');
  }
  const latest = rawInBody[0] ?? null;
  const latestInBody = latest ? {
    weightKg: latest.weight,
    bodyFatPct: latest.bodyFatPct,
    bodyFatKg: latest.bodyFat,
    muscleMassKg: latest.muscleMass,
    bmi: latest.bmi,
    bmr: latest.bmr,
    measuredAt: (latest.date ?? latest.dateOnly ?? '').split('T')[0] || undefined,
    segmentalMuscle: (latest.trunkMuscle || latest.rightLegMuscle) ? {
      rightArm: latest.rightArmMuscle,
      leftArm: latest.leftArmMuscle,
      trunk: latest.trunkMuscle,
      rightLeg: latest.rightLegMuscle,
      leftLeg: latest.leftLegMuscle,
    } : undefined,
  } : null;
  const inBodyHistory = rawInBody.slice(0, 5).map((e: any) => ({
    weightKg: e.weight,
    bodyFatPct: e.bodyFatPct,
    muscleMassKg: e.muscleMass,
    measuredAt: (e.date ?? e.dateOnly ?? '').split('T')[0] || undefined,
  }));

  // ── Workouts ──────────────────────────────────────────────────────────────
  const rawWorkouts: any[] = workoutsRes.status === 'fulfilled' ? (workoutsRes.value.data ?? []) : [];
  if (workoutsRes.status === 'rejected') {
    logger.debug({ err: (workoutsRes as any).reason?.message, userId }, '[worker-context] workouts fetch failed');
  }
  const recentWorkouts = rawWorkouts.slice(0, 7).map((w: any) => {
    const exs: any[] = Array.isArray(w.exercises) ? w.exercises : [];
    return {
      date: (w.date ?? '').split('T')[0],
      duration: w.duration,
      exerciseNames: exs.slice(0, 6).map((ex: any) => ex.exercise?.exerciseName ?? ex.name).filter(Boolean),
      muscleGroups: Array.from(new Set(
        exs.flatMap((ex: any) =>
          Array.isArray(ex.exercise?.muscleGroupsActivated)
            ? ex.exercise.muscleGroupsActivated.slice(0, 2)
            : ex.exercise?.bodyPart ? [ex.exercise.bodyPart] : [],
        ),
      )).slice(0, 5) as string[],
    };
  });

  // ── Nutrition ─────────────────────────────────────────────────────────────
  const rawNutrition: any[] = nutritionRes.status === 'fulfilled' ? (nutritionRes.value.data ?? []) : [];
  if (nutritionRes.status === 'rejected') {
    logger.debug({ err: (nutritionRes as any).reason?.message, userId }, '[worker-context] nutrition fetch failed');
  }
  // Group by date
  const byDate: Record<string, { cal: number; pro: number; carbs: number; fat: number }> = {};
  for (const n of rawNutrition) {
    const d = (n.date ?? '').split('T')[0];
    if (!d) continue;
    if (!byDate[d]) byDate[d] = { cal: 0, pro: 0, carbs: 0, fat: 0 };
    byDate[d].cal   += Number(n.calories ?? 0);
    byDate[d].pro   += Number(n.protein ?? 0);
    byDate[d].carbs += Number(n.carbs ?? 0);
    byDate[d].fat   += Number(n.fats ?? n.fat ?? 0);
  }
  const recentNutritionDays = Object.entries(byDate)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 7)
    .map(([date, v]) => ({ date, calories: Math.round(v.cal), protein: Math.round(v.pro), carbs: Math.round(v.carbs), fat: Math.round(v.fat) }));

  return {
    latestInBody,
    inBodyHistory,
    profile: profileData,
    recentWorkouts,
    recentNutritionDays,
  };
}

/** Build a compact text summary of the user context to inject into plan prompts */
export function formatWorkerContextForPrompt(ctx: WorkerUserContext): string {
  const lines: string[] = [];

  // InBody
  if (ctx.latestInBody) {
    const ib = ctx.latestInBody;
    const d = ib.measuredAt ? ` (đo ${ib.measuredAt})` : '';
    lines.push(`[Dữ liệu InBody mới nhất${d}]`);
    if (ib.weightKg != null)    lines.push(`  Cân nặng: ${ib.weightKg} kg`);
    if (ib.bodyFatPct != null)  lines.push(`  Mỡ cơ thể: ${ib.bodyFatPct}% (${ib.bodyFatKg ?? '?'} kg)`);
    if (ib.muscleMassKg != null) lines.push(`  Cơ xương: ${ib.muscleMassKg} kg`);
    if (ib.bmi != null)          lines.push(`  BMI: ${ib.bmi}`);
    if (ib.bmr != null)          lines.push(`  BMR: ${ib.bmr} kcal/ngày`);
    const sm = ib.segmentalMuscle;
    if (sm?.trunk)               lines.push(`  Cơ theo vùng (kg): tay-P ${sm.rightArm ?? '?'} tay-T ${sm.leftArm ?? '?'} thân ${sm.trunk ?? '?'} chân-P ${sm.rightLeg ?? '?'} chân-T ${sm.leftLeg ?? '?'}`);
    // Trend
    if (ctx.inBodyHistory.length > 1) {
      const trend = ctx.inBodyHistory.slice(0, 4).map(e => `${e.measuredAt}: ${e.weightKg ?? '?'}kg cơ ${e.muscleMassKg ?? '?'}kg mỡ ${e.bodyFatPct ?? '?'}%`).join(' | ');
      lines.push(`  Xu hướng: ${trend}`);
    }
  } else if (ctx.profile?.currentWeight) {
    lines.push(`[Thông tin thể chất từ profile (chưa có InBody)]`);
    lines.push(`  Cân nặng: ${ctx.profile.currentWeight} kg`);
  }

  // Profile extras (injuries)
  if (ctx.profile?.injuries?.length) {
    lines.push(`[Chấn thương / hạn chế: ${ctx.profile.injuries.join(', ')}]`);
  }

  // Recent workout summary
  if (ctx.recentWorkouts.length > 0) {
    lines.push(`[Lịch sử tập gần nhất (${ctx.recentWorkouts.length} buổi)]`);
    ctx.recentWorkouts.slice(0, 5).forEach(w => {
      const muscles = w.muscleGroups?.length ? ` | nhóm cơ: ${w.muscleGroups.slice(0, 3).join(', ')}` : '';
      const exNames = w.exerciseNames?.length ? ` | bài: ${w.exerciseNames.slice(0, 4).join(', ')}` : '';
      lines.push(`  ${w.date} (${w.duration ?? '?'} phút)${muscles}${exNames}`);
    });
  }

  // Recent nutrition summary
  if (ctx.recentNutritionDays.length > 0) {
    const avg = {
      cal:  Math.round(ctx.recentNutritionDays.reduce((s, d) => s + (d.calories ?? 0), 0) / ctx.recentNutritionDays.length),
      pro:  Math.round(ctx.recentNutritionDays.reduce((s, d) => s + (d.protein ?? 0), 0) / ctx.recentNutritionDays.length),
      carbs: Math.round(ctx.recentNutritionDays.reduce((s, d) => s + (d.carbs ?? 0), 0) / ctx.recentNutritionDays.length),
      fat:  Math.round(ctx.recentNutritionDays.reduce((s, d) => s + (d.fat ?? 0), 0) / ctx.recentNutritionDays.length),
    };
    lines.push(`[Dinh dưỡng gần nhất (TB ${ctx.recentNutritionDays.length} ngày): ${avg.cal} kcal P${avg.pro}g C${avg.carbs}g F${avg.fat}g]`);
    ctx.recentNutritionDays.slice(0, 3).forEach(d => {
      lines.push(`  ${d.date}: ${d.calories} kcal P${d.protein}g C${d.carbs}g F${d.fat}g`);
    });
  }

  return lines.join('\n');
}
