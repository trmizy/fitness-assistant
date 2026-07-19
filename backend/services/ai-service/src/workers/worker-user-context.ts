/**
 * Fetches personal user data for use in plan generation workers.
 * Workers run without user auth tokens, so they use the internal service secret.
 */
import axios from "axios";
import { logger } from "@gym-coach/shared";
import { prisma } from "../repositories/conversation.repository";

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL ||
  (process.env.NODE_ENV === "production"
    ? "http://user-service:3004"
    : "http://localhost:3004");

const FITNESS_SERVICE_URL =
  process.env.FITNESS_SERVICE_URL ||
  (process.env.NODE_ENV === "production"
    ? "http://fitness-service:3002"
    : "http://localhost:3002");

function userServiceHeaders() {
  return {
    "x-service-secret": process.env.INTERNAL_SERVICE_SECRET || "",
  };
}

function internalHeaders(userId: string) {
  return {
    "x-internal-token": process.env.INTERNAL_SERVICE_SECRET || "",
    "x-user-id": userId,
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
    segmentalMuscle?: {
      rightArm?: number;
      leftArm?: number;
      trunk?: number;
      rightLeg?: number;
      leftLeg?: number;
    };
  } | null;
  /** All InBody entries for trend display */
  inBodyHistory: Array<{
    weightKg?: number;
    bodyFatPct?: number;
    muscleMassKg?: number;
    measuredAt?: string;
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
  /**
   * Outcome of the user's most recently finished monthly training cycle (v2
   * cycle model: decision KEEP/ADJUST/NEW_PLAN + deterministic progressSignals,
   * replaces the earlier ACHIEVED/PARTIAL/NOT_ACHIEVED outcome field), plus
   * how that cycle's underlying plan fared in the marketplace (Part B) and
   * with PT review — feeds the next plan's generation/adjustment (Part D).
   */
  lastCycleOutcome: {
    decision?: string | null;
    overallTrend?: string | null;
    adherencePercent?: number | null;
    startDate?: string;
    endDate?: string;
    sourcePlanId?: string | null;
    planRating?: { avgRating: number; ratingCount: number } | null;
    ptReview?: { status?: string | null; note?: string | null } | null;
  } | null;
}

/**
 * Fetch all personal context for plan generation.
 * Non-critical failures are swallowed — missing data means AI generates a slightly less personalised plan
 * but won't fail the job.
 */
export async function fetchWorkerUserContext(
  userId: string,
): Promise<WorkerUserContext> {
  const headers = internalHeaders(userId);
  const userHeaders = userServiceHeaders();
  const timeout = 5000;

  const [profileRes, inBodyRes, workoutsRes, nutritionRes, latestCycleRes] =
    await Promise.allSettled([
      axios.get(
        `${USER_SERVICE_URL}/internal/profile/${encodeURIComponent(userId)}`,
        { headers: userHeaders, timeout },
      ),
      axios.get(
        `${USER_SERVICE_URL}/internal/inbody/${encodeURIComponent(userId)}`,
        { headers: userHeaders, timeout },
      ),
      axios.get(`${FITNESS_SERVICE_URL}/workouts?limit=10`, {
        headers,
        timeout,
      }),
      axios.get(`${FITNESS_SERVICE_URL}/nutrition`, { headers, timeout }),
      axios.get(`${FITNESS_SERVICE_URL}/internal/training-cycles/latest-closed`, {
        headers,
        timeout,
      }),
    ]);

  // ── Profile ──────────────────────────────────────────────────────────────
  const profileData =
    profileRes.status === "fulfilled"
      ? (profileRes.value.data?.profile ?? profileRes.value.data ?? null)
      : null;
  if (profileRes.status === "rejected") {
    logger.debug(
      { err: (profileRes as any).reason?.message, userId },
      "[worker-context] profile fetch failed",
    );
  }

  // ── InBody ────────────────────────────────────────────────────────────────
  const rawInBody: any[] =
    inBodyRes.status === "fulfilled" ? (inBodyRes.value.data ?? []) : [];
  if (inBodyRes.status === "rejected") {
    logger.debug(
      { err: (inBodyRes as any).reason?.message, userId },
      "[worker-context] inbody fetch failed",
    );
  }
  const latest = rawInBody[0] ?? null;
  const latestInBody = latest
    ? {
        weightKg: latest.weight,
        bodyFatPct: latest.bodyFatPct,
        bodyFatKg: latest.bodyFat,
        muscleMassKg: latest.muscleMass,
        bmi: latest.bmi,
        bmr: latest.bmr,
        measuredAt:
          (latest.date ?? latest.dateOnly ?? "").split("T")[0] || undefined,
        segmentalMuscle:
          latest.trunkMuscle || latest.rightLegMuscle
            ? {
                rightArm: latest.rightArmMuscle,
                leftArm: latest.leftArmMuscle,
                trunk: latest.trunkMuscle,
                rightLeg: latest.rightLegMuscle,
                leftLeg: latest.leftLegMuscle,
              }
            : undefined,
      }
    : null;
  const inBodyHistory = rawInBody.slice(0, 5).map((e: any) => ({
    weightKg: e.weight,
    bodyFatPct: e.bodyFatPct,
    muscleMassKg: e.muscleMass,
    measuredAt: (e.date ?? e.dateOnly ?? "").split("T")[0] || undefined,
  }));

  // ── Workouts ──────────────────────────────────────────────────────────────
  const rawWorkouts: any[] =
    workoutsRes.status === "fulfilled" ? (workoutsRes.value.data ?? []) : [];
  if (workoutsRes.status === "rejected") {
    logger.debug(
      { err: (workoutsRes as any).reason?.message, userId },
      "[worker-context] workouts fetch failed",
    );
  }
  const recentWorkouts = rawWorkouts.slice(0, 7).map((w: any) => {
    const exs: any[] = Array.isArray(w.exercises) ? w.exercises : [];
    return {
      date: (w.date ?? "").split("T")[0],
      duration: w.duration,
      exerciseNames: exs
        .slice(0, 6)
        .map((ex: any) => ex.exercise?.exerciseName ?? ex.name)
        .filter(Boolean),
      muscleGroups: Array.from(
        new Set(
          exs.flatMap((ex: any) =>
            Array.isArray(ex.exercise?.muscleGroupsActivated)
              ? ex.exercise.muscleGroupsActivated.slice(0, 2)
              : ex.exercise?.bodyPart
                ? [ex.exercise.bodyPart]
                : [],
          ),
        ),
      ).slice(0, 5) as string[],
    };
  });

  // ── Nutrition ─────────────────────────────────────────────────────────────
  const rawNutrition: any[] =
    nutritionRes.status === "fulfilled" ? (nutritionRes.value.data ?? []) : [];
  if (nutritionRes.status === "rejected") {
    logger.debug(
      { err: (nutritionRes as any).reason?.message, userId },
      "[worker-context] nutrition fetch failed",
    );
  }
  // Group by date
  const byDate: Record<
    string,
    { cal: number; pro: number; carbs: number; fat: number }
  > = {};
  for (const n of rawNutrition) {
    const d = (n.date ?? "").split("T")[0];
    if (!d) continue;
    if (!byDate[d]) byDate[d] = { cal: 0, pro: 0, carbs: 0, fat: 0 };
    byDate[d].cal += Number(n.calories ?? 0);
    byDate[d].pro += Number(n.protein ?? 0);
    byDate[d].carbs += Number(n.carbs ?? 0);
    byDate[d].fat += Number(n.fats ?? n.fat ?? 0);
  }
  const recentNutritionDays = Object.entries(byDate)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 7)
    .map(([date, v]) => ({
      date,
      calories: Math.round(v.cal),
      protein: Math.round(v.pro),
      carbs: Math.round(v.carbs),
      fat: Math.round(v.fat),
    }));

  // ── Last cycle outcome + plan rating + PT review ────────────────────────────
  const rawCycle =
    latestCycleRes.status === "fulfilled"
      ? (latestCycleRes.value.data?.data?.cycle ?? null)
      : null;
  if (latestCycleRes.status === "rejected") {
    logger.debug(
      { err: (latestCycleRes as any).reason?.message, userId },
      "[worker-context] latest closed cycle fetch failed",
    );
  }

  let lastCycleOutcome: WorkerUserContext["lastCycleOutcome"] = null;
  if (rawCycle) {
    let planRating: { avgRating: number; ratingCount: number } | null = null;
    let ptReview: { status?: string | null; note?: string | null } | null =
      null;

    if (rawCycle.planId) {
      try {
        const [publishedPlan, workoutPlan] = await Promise.all([
          prisma.publishedPlan.findFirst({
            where: { sourcePlanId: rawCycle.planId },
            select: { avgRating: true, ratingCount: true },
          }),
          prisma.workoutPlan.findUnique({
            where: { id: rawCycle.planId },
            select: { ptReviewStatus: true, ptNote: true },
          }),
        ]);
        if (publishedPlan) {
          planRating = {
            avgRating: publishedPlan.avgRating,
            ratingCount: publishedPlan.ratingCount,
          };
        }
        if (workoutPlan && (workoutPlan.ptReviewStatus || workoutPlan.ptNote)) {
          ptReview = {
            status: workoutPlan.ptReviewStatus,
            note: workoutPlan.ptNote,
          };
        }
      } catch (err) {
        logger.debug(
          { err: (err as Error).message, userId },
          "[worker-context] local plan-rating/pt-review lookup failed",
        );
      }
    }

    const progressSignals = rawCycle.summary?.progressSignals ?? null;

    lastCycleOutcome = {
      decision: rawCycle.decision,
      overallTrend: progressSignals?.overallTrend ?? null,
      adherencePercent: progressSignals?.adherencePct ?? null,
      startDate: (rawCycle.startDate ?? "").split("T")[0] || undefined,
      endDate: (rawCycle.endDate ?? "").split("T")[0] || undefined,
      sourcePlanId: rawCycle.planId,
      planRating,
      ptReview,
    };
  }

  return {
    latestInBody,
    inBodyHistory,
    profile: profileData,
    recentWorkouts,
    recentNutritionDays,
    lastCycleOutcome,
  };
}

/** Build a compact text summary of the user context to inject into plan prompts */
export function formatWorkerContextForPrompt(ctx: WorkerUserContext): string {
  const lines: string[] = [];

  // Last cycle outcome — surfaced first so the model weighs it when deciding
  // whether to repeat or change approach for the new plan.
  if (ctx.lastCycleOutcome) {
    const c = ctx.lastCycleOutcome;
    const decisionLabel: Record<string, string> = {
      KEEP: "Giữ nguyên lịch tập, tăng tải",
      ADJUST: "Điều chỉnh lịch tập",
      NEW_PLAN: "Đổi sang kế hoạch mới",
    };
    const trendLabel: Record<string, string> = {
      PROGRESSING: "Đang tiến triển tốt",
      PLATEAU: "Chững lại",
      DECLINING: "Đang sụt giảm",
    };
    lines.push(
      `[Kết quả chu kỳ tập gần nhất${c.startDate ? ` (${c.startDate} - ${c.endDate ?? "?"})` : ""}]`,
    );
    if (c.overallTrend) {
      lines.push(`  Xu hướng: ${trendLabel[c.overallTrend] ?? c.overallTrend}`);
    }
    if (c.decision) {
      lines.push(`  Đề xuất chu kỳ trước: ${decisionLabel[c.decision] ?? c.decision}`);
    }
    if (c.adherencePercent != null) {
      lines.push(`  Tuân thủ lịch tập: ${c.adherencePercent}%`);
    }
    if (c.planRating) {
      lines.push(
        `  Đánh giá kế hoạch cũ trên chợ: ${c.planRating.avgRating.toFixed(1)}/5 (${c.planRating.ratingCount} lượt)`,
      );
    }
    if (c.ptReview?.note) {
      lines.push(`  Ghi chú của PT: ${c.ptReview.note}`);
    }
    lines.push(
      `  => Nếu xu hướng "Đang tiến triển tốt": có thể giữ hướng tiếp cận cũ, tăng nhẹ độ khó. Nếu "Chững lại" hoặc "Đang sụt giảm": cần điều chỉnh (đổi bài tập, giảm khối lượng, hoặc đổi cách tiếp cận) thay vì lặp lại y hệt kế hoạch cũ.`,
    );
  }

  // InBody
  if (ctx.latestInBody) {
    const ib = ctx.latestInBody;
    const d = ib.measuredAt ? ` (đo ${ib.measuredAt})` : "";
    lines.push(`[Dữ liệu InBody mới nhất${d}]`);
    if (ib.weightKg != null) lines.push(`  Cân nặng: ${ib.weightKg} kg`);
    if (ib.bodyFatPct != null)
      lines.push(`  Mỡ cơ thể: ${ib.bodyFatPct}% (${ib.bodyFatKg ?? "?"} kg)`);
    if (ib.muscleMassKg != null)
      lines.push(`  Cơ xương: ${ib.muscleMassKg} kg`);
    if (ib.bmi != null) lines.push(`  BMI: ${ib.bmi}`);
    if (ib.bmr != null) lines.push(`  BMR: ${ib.bmr} kcal/ngày`);
    const sm = ib.segmentalMuscle;
    if (sm?.trunk)
      lines.push(
        `  Cơ theo vùng (kg): tay-P ${sm.rightArm ?? "?"} tay-T ${sm.leftArm ?? "?"} thân ${sm.trunk ?? "?"} chân-P ${sm.rightLeg ?? "?"} chân-T ${sm.leftLeg ?? "?"}`,
      );
    // Trend
    if (ctx.inBodyHistory.length > 1) {
      const trend = ctx.inBodyHistory
        .slice(0, 4)
        .map(
          (e) =>
            `${e.measuredAt}: ${e.weightKg ?? "?"}kg cơ ${e.muscleMassKg ?? "?"}kg mỡ ${e.bodyFatPct ?? "?"}%`,
        )
        .join(" | ");
      lines.push(`  Xu hướng: ${trend}`);
    }
  } else if (ctx.profile?.currentWeight) {
    lines.push(`[Thông tin thể chất từ profile (chưa có InBody)]`);
    lines.push(`  Cân nặng: ${ctx.profile.currentWeight} kg`);
  }

  // Profile extras (injuries)
  if (ctx.profile?.injuries?.length) {
    lines.push(`[Chấn thương / hạn chế: ${ctx.profile.injuries.join(", ")}]`);
  }

  // Recent workout summary
  if (ctx.recentWorkouts.length > 0) {
    lines.push(`[Lịch sử tập gần nhất (${ctx.recentWorkouts.length} buổi)]`);
    ctx.recentWorkouts.slice(0, 5).forEach((w) => {
      const muscles = w.muscleGroups?.length
        ? ` | nhóm cơ: ${w.muscleGroups.slice(0, 3).join(", ")}`
        : "";
      const exNames = w.exerciseNames?.length
        ? ` | bài: ${w.exerciseNames.slice(0, 4).join(", ")}`
        : "";
      lines.push(`  ${w.date} (${w.duration ?? "?"} phút)${muscles}${exNames}`);
    });
  }

  // Recent nutrition summary
  if (ctx.recentNutritionDays.length > 0) {
    const avg = {
      cal: Math.round(
        ctx.recentNutritionDays.reduce((s, d) => s + (d.calories ?? 0), 0) /
          ctx.recentNutritionDays.length,
      ),
      pro: Math.round(
        ctx.recentNutritionDays.reduce((s, d) => s + (d.protein ?? 0), 0) /
          ctx.recentNutritionDays.length,
      ),
      carbs: Math.round(
        ctx.recentNutritionDays.reduce((s, d) => s + (d.carbs ?? 0), 0) /
          ctx.recentNutritionDays.length,
      ),
      fat: Math.round(
        ctx.recentNutritionDays.reduce((s, d) => s + (d.fat ?? 0), 0) /
          ctx.recentNutritionDays.length,
      ),
    };
    lines.push(
      `[Dinh dưỡng gần nhất (TB ${ctx.recentNutritionDays.length} ngày): ${avg.cal} kcal P${avg.pro}g C${avg.carbs}g F${avg.fat}g]`,
    );
    ctx.recentNutritionDays.slice(0, 3).forEach((d) => {
      lines.push(
        `  ${d.date}: ${d.calories} kcal P${d.protein}g C${d.carbs}g F${d.fat}g`,
      );
    });
  }

  return lines.join("\n");
}
