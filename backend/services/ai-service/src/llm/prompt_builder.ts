import type {
  InputIntent,
  RecommendationResult,
  ResponseLanguage,
  RetrievalResult,
  UserProfile,
} from "./types";
import type { PersonalizationContext } from "./profile_extractor";

function compactProfile(profile: UserProfile): string {
  // Weight: InBody is always the priority source; profile weight is a fallback
  const inBodyDate = profile.inBody?.measuredAt
    ? `InBody đo ngày ${String(profile.inBody.measuredAt).slice(0, 10)}`
    : null;
  const weightSource = inBodyDate ?? "profile (tự khai báo)";
  const weightDisplay = profile.currentWeightKg ?? "unknown";

  const lines: string[] = [
    `- Age: ${profile.age ?? "unknown"}`,
    `- Gender: ${profile.gender ?? "unknown"}`,
    `- Height(cm): ${profile.heightCm ?? "unknown"}`,
    `- Weight(kg): ${weightDisplay} [nguồn: ${weightSource}]`,
    `- Goal: ${profile.goal ?? "unknown"}`,
    `- Activity level: ${profile.activityLevel ?? "unknown"}`,
    `- Experience level: ${profile.experienceLevel ?? "BEGINNER"}`,
  ];

  if (profile.inBody) {
    const lbl = inBodyDate ? ` (${inBodyDate})` : "";
    lines.push(`- Body fat%${lbl}: ${profile.inBody.bodyFatPct ?? "unknown"}`);
    lines.push(
      `- Skeletal muscle(kg)${lbl}: ${profile.inBody.skeletalMuscleKg ?? "unknown"}`,
    );
    if (profile.inBody.bodyFatKg != null)
      lines.push(`- Fat mass(kg)${lbl}: ${profile.inBody.bodyFatKg}`);
    if (profile.inBody.bmi != null)
      lines.push(`- BMI${lbl}: ${profile.inBody.bmi}`);
    if (profile.inBody.bmr != null)
      lines.push(`- BMR(kcal/day)${lbl}: ${profile.inBody.bmr}`);
    // Segmental muscle analysis
    const sm = profile.inBody.segmentalMuscle;
    if (sm) {
      lines.push(
        `- Segmental muscle(kg)${lbl}: tay-P ${sm.rightArm ?? "?"} tay-T ${sm.leftArm ?? "?"} thân ${sm.trunk ?? "?"} chân-P ${sm.rightLeg ?? "?"} chân-T ${sm.leftLeg ?? "?"}`,
      );
    }
    // Segmental fat analysis
    const sf = profile.inBody.segmentalFat;
    if (sf) {
      lines.push(
        `- Segmental fat(kg)${lbl}: tay-P ${sf.rightArm ?? "?"} tay-T ${sf.leftArm ?? "?"} thân ${sf.trunk ?? "?"} chân-P ${sf.rightLeg ?? "?"} chân-T ${sf.leftLeg ?? "?"}`,
      );
    }
  }

  if (profile.training.injuries.length > 0) {
    lines.push(
      `- Injuries/limitations: ${profile.training.injuries.join(", ")}`,
    );
  }

  if (profile.training.availableEquipment.length > 0) {
    lines.push(
      `- Equipment access: ${profile.training.availableEquipment.join(", ")}`,
    );
  }

  if (profile.training.trainingDaysPerWeek) {
    lines.push(`- Training days/week: ${profile.training.trainingDaysPerWeek}`);
  }

  if (profile.foodPreference) {
    lines.push(`- Food preference: ${profile.foodPreference}`);
  }

  return lines.join("\n");
}

function compactMemories(context: PersonalizationContext): string {
  const memories = context.memories || [];
  if (memories.length === 0) return "";
  return memories.map((m) => `- ${m.content}`).join("\n");
}

function compactCurrentPrograms(context: PersonalizationContext): string {
  const parts: string[] = [];

  if (context.currentWorkoutProgram) {
    const wp = context.currentWorkoutProgram as any;
    const days =
      Array.isArray(wp.daySummaries) && wp.daySummaries.length > 0
        ? wp.daySummaries
            .map(
              (d: any) =>
                `Ngày ${d.dayNumber}: ${d.title ?? "(no title)"} (${d.exerciseCount ?? 0} bài)`,
            )
            .join("; ")
        : "";
    parts.push(
      `Chương trình tập hiện tại: ${wp.name ?? "N/A"} | Mục tiêu: ${wp.goal ?? "N/A"} | ${wp.daysPerWeek ?? "?"} buổi/tuần | ${wp.durationWeeks ?? "?"} tuần${days ? ` | ${days}` : ""}`,
    );
  }

  if (context.currentNutritionProgram) {
    const np = context.currentNutritionProgram as any;
    parts.push(
      `Chương trình dinh dưỡng hiện tại: ${np.name ?? "N/A"} | Mục tiêu: ${np.goal ?? "N/A"} | Calories/ngày: ${np.dailyCaloriesTarget ?? "N/A"} kcal | Protein: ${np.proteinTargetGrams ?? "?"}g | Carbs: ${np.carbTargetGrams ?? "?"}g | Fat: ${np.fatTargetGrams ?? "?"}g`,
    );
  }

  return parts.length > 0 ? parts.join("\n") : "";
}

export function extractSessionContext(chatHistory: any[]): string {
  if (!chatHistory || chatHistory.length === 0) return "";

  const concerns: string[] = [];
  let goalMentioned: string | undefined;
  let planFrequency: string | undefined;
  let planSplit: string | undefined;

  for (const c of chatHistory.slice(0, 10)) {
    const q = ((c.question || "") as string).toLowerCase();
    const a = ((c.answer || "") as string).toLowerCase();

    // Scan question for concerns and goals
    if (/ch[aâ]n\s*th[uươ][ươ]ng|injury|[dđ]au\b|pain/.test(q))
      concerns.push("chấn thương");
    if (/protein|[dđ][aạ]m\b/.test(q)) concerns.push("protein");
    if (/gi[aả]m\s*m[oỡ]|fat\s*loss|giam\s*mo/.test(q))
      goalMentioned = "giảm mỡ";
    if (/t[aă]ng\s*c[oơ]|muscle\s*gain|tang\s*co/.test(q))
      goalMentioned = "tăng cơ";
    if (/ngh[iỉ]\s*ng[oơ]i|recover|recovery/.test(q)) concerns.push("hồi phục");
    // Equipment / time constraints from questions
    if (/ch[iỉ]\s*c[oó]\s*dumbbell|only\s*dumbbell|t[aạ]\s*đ[oơ]n/i.test(q))
      concerns.push("chỉ có dumbbell");
    if (/[oở]\s*nh[aà]\b|at\s*home|home\s*gym/i.test(q))
      concerns.push("tập ở nhà");
    if (/30\s*ph[uú]t|45\s*ph[uú]t|b[aậ]n\s*h[oọ]c|b[aậ]n\s*vi[eệ]c/i.test(q))
      concerns.push("thời gian hạn chế");

    // Scan answer for injury mentions
    if (/ch[aâ]n\s*th[uươ][ươ]ng|injury|[dđ]au\b|pain/.test(a))
      concerns.push("chấn thương");
    if (
      /tr[aá]nh.*overhead|tr[aá]nh.*vai\s*tr[uư][oớ]c|overhead.*c[aẩ]n\s*th[aậ]n/i.test(
        a,
      )
    ) {
      concerns.push("cẩn thận overhead press");
    }

    // Scan answer for previously given plan frequency
    if (!planFrequency) {
      const freqMatch = a.match(
        /(\d)\s*ng[aà]y\s*\/?\s*tu[aầ]n|(\d)\s*bu[oổ]i\s*\/?\s*tu[aầ]n|(\d)-day\s+plan|(\d)\s+days?\s+per\s+week/i,
      );
      if (freqMatch) {
        const days =
          freqMatch[1] || freqMatch[2] || freqMatch[3] || freqMatch[4];
        if (days) planFrequency = `${days} ngày/tuần`;
      }
    }

    // Scan answer for split type
    if (!planSplit) {
      if (/push.{0,5}pull.{0,5}legs|ppl/i.test(a)) planSplit = "Push/Pull/Legs";
      else if (/upper.{0,5}lower/i.test(a)) planSplit = "Upper/Lower";
      else if (/full.{0,5}body/i.test(a)) planSplit = "Full Body";
    }
  }

  const parts: string[] = [];
  if (goalMentioned) parts.push(`Mục tiêu đã nhắc: ${goalMentioned}`);
  if (planFrequency) {
    const splitInfo = planSplit ? ` [${planSplit}]` : "";
    parts.push(
      `Đã đề xuất plan: ${planFrequency}${splitInfo} — giữ nhất quán trừ khi user yêu cầu đổi`,
    );
  }
  if (concerns.length > 0) {
    const unique = [...new Set(concerns)];
    parts.push(`Mối quan tâm trong phiên: ${unique.join(", ")}`);
  }

  return parts.length > 0 ? `[Ngữ cảnh phiên: ${parts.join("; ")}]` : "";
}

function formatHistorySections(
  context: PersonalizationContext,
  chatHistory: any[],
): string[] {
  const sections: string[] = [];
  // Note: current workout/nutrition programs are injected via compactCurrentPrograms()
  // in the main prompt build rather than here to keep them near the profile block.

  // ── InBody history trend (up to 5 most recent measurements) ─────────────
  if (context.inBodyHistory && context.inBodyHistory.length > 1) {
    const historyLines = context.inBodyHistory.slice(0, 5).map((e: any) => {
      const d = (e.date || e.dateOnly || "").split("T")[0];
      const seg =
        e.rightArmMuscle || e.trunkMuscle || e.rightLegMuscle
          ? ` | Cơ: tay-P ${e.rightArmMuscle ?? "?"}kg tay-T ${e.leftArmMuscle ?? "?"}kg thân ${e.trunkMuscle ?? "?"}kg chân-P ${e.rightLegMuscle ?? "?"}kg chân-T ${e.leftLegMuscle ?? "?"}kg`
          : "";
      return `- ${d}: ${e.weight ?? "?"}kg | mỡ ${e.bodyFatPct ?? "?"}% (${e.bodyFat ?? "?"}kg) | cơ ${e.muscleMass ?? "?"}kg${seg}`;
    });
    sections.push(
      `Lịch sử InBody (${Math.min(context.inBodyHistory.length, 5)} lần đo gần nhất, mới nhất trước):\n${historyLines.join("\n")}`,
    );
  }

  // ── Workout history: show exercise names + muscle groups ─────────────────
  if (context.workoutHistory && context.workoutHistory.length > 0) {
    const totalWorkouts = context.workoutHistory.length;
    // Group by date, then show exercises with muscle groups
    const recentWorkouts = (context.workoutHistory as any[])
      .slice(0, 7)
      .map((w) => {
        const d = (w.date || "").split("T")[0] || "Unknown";
        const dur = w.duration ? `${w.duration} phút` : "?";
        const exList =
          Array.isArray(w.exercises) && w.exercises.length > 0
            ? w.exercises
                .slice(0, 8)
                .map((ex: any) => {
                  const name =
                    ex.exercise?.exerciseName ?? ex.name ?? "Unknown";
                  const muscles =
                    Array.isArray(ex.exercise?.muscleGroupsActivated) &&
                    ex.exercise.muscleGroupsActivated.length > 0
                      ? `[${ex.exercise.muscleGroupsActivated.slice(0, 3).join(", ")}]`
                      : ex.exercise?.bodyPart
                        ? `[${ex.exercise.bodyPart}]`
                        : "";
                  const volume =
                    ex.sets && ex.reps
                      ? `${ex.sets}×${ex.reps}${ex.weight ? `@${ex.weight}kg` : ""}`
                      : "";
                  return `    • ${name}${muscles ? " " + muscles : ""}${volume ? " " + volume : ""}`;
                })
                .join("\n")
            : "    (không có chi tiết bài tập)";
        return `- ${d} (${dur}, ${Array.isArray(w.exercises) ? w.exercises.length : 0} bài):\n${exList}`;
      })
      .join("\n");
    sections.push(
      `Lịch sử tập luyện (${totalWorkouts} buổi, hiển thị 7 gần nhất):\n${recentWorkouts}`,
    );
  }

  // ── Nutrition: group by date, show all macros ────────────────────────────
  if (context.nutritionHistory && context.nutritionHistory.length > 0) {
    const logs = context.nutritionHistory as any[];
    // Group by date
    const byDate: Record<
      string,
      { cal: number; pro: number; carbs: number; fat: number; items: string[] }
    > = {};
    for (const n of logs) {
      const d = (n.date || "").split("T")[0] || "Unknown";
      if (!byDate[d])
        byDate[d] = { cal: 0, pro: 0, carbs: 0, fat: 0, items: [] };
      byDate[d].cal += n.calories || 0;
      byDate[d].pro += n.protein || 0;
      byDate[d].carbs += n.carbs || 0;
      byDate[d].fat += n.fats || 0;
      if (n.foodName)
        byDate[d].items.push(
          `${n.foodName}${n.quantity ? ` ${n.quantity}${n.unit || "g"}` : ""}`,
        );
    }
    const dates = Object.keys(byDate).sort().reverse().slice(0, 7);
    const totalDays = dates.length;
    const avgCal = Math.round(
      dates.reduce((s, d) => s + byDate[d].cal, 0) / totalDays,
    );
    const avgPro = Math.round(
      dates.reduce((s, d) => s + byDate[d].pro, 0) / totalDays,
    );
    const avgCarbs = Math.round(
      dates.reduce((s, d) => s + byDate[d].carbs, 0) / totalDays,
    );
    const avgFat = Math.round(
      dates.reduce((s, d) => s + byDate[d].fat, 0) / totalDays,
    );
    const dailyLines = dates
      .map((d) => {
        const v = byDate[d];
        const items =
          v.items.length > 0
            ? ` (${v.items.slice(0, 4).join(", ")}${v.items.length > 4 ? "..." : ""})`
            : "";
        return `- ${d}: ${v.cal} kcal | P ${v.pro}g | C ${v.carbs}g | F ${v.fat}g${items}`;
      })
      .join("\n");
    sections.push(
      `Lịch sử dinh dưỡng (${totalDays} ngày gần nhất, TB: ${avgCal} kcal P${avgPro}g C${avgCarbs}g F${avgFat}g):\n${dailyLines}`,
    );
  }

  const sessionCtx = extractSessionContext(chatHistory);
  if (sessionCtx) sections.push(sessionCtx);

  if (chatHistory && chatHistory.length > 0) {
    const chat = chatHistory
      .slice(0, 5)
      .reverse()
      .map((c) => {
        const q = c.question || "";
        const a = c.answer || "";
        return `User: ${q.length > 120 ? q.slice(0, 120) + "..." : q}\nCoach: ${a.length > 180 ? a.slice(0, 180) + "..." : a}`;
      })
      .join("\n\n");
    sections.push("Lịch sử hội thoại:\n" + chat);
  }

  return sections;
}

function compactRetrieval(result: RetrievalResult): string {
  if (result.isEmpty || result.documents.length === 0) {
    return "- No relevant context retrieved. Use conservative recommendations.";
  }

  // Separate evidence docs from exercise/knowledge docs
  const evidenceDocs = result.documents.filter(
    (d) => d.source === "qdrant:fitness_evidence",
  );
  const regularDocs = result.documents.filter(
    (d) => d.source !== "qdrant:fitness_evidence",
  );

  const parts: string[] = [];

  // Limit to 3 regular docs — more context doesn't improve small-model accuracy
  if (regularDocs.length > 0) {
    parts.push(
      regularDocs
        .slice(0, 3)
        .map((doc, idx) => `${idx + 1}. ${doc.pageContent}`)
        .join("\n\n"),
    );
  }

  // Evidence docs shown separately with citation markers
  if (evidenceDocs.length > 0) {
    const evidenceBlock = evidenceDocs
      .slice(0, 3)
      .map((doc, idx) => {
        const m = doc.metadata as any;
        const cite = m.source_url ? ` [nguồn: ${m.source_url}]` : "";
        return `E${idx + 1}. ${doc.pageContent}${cite}`;
      })
      .join("\n\n");
    parts.push(`[Bằng chứng khoa học từ nghiên cứu:]\n${evidenceBlock}`);
  }

  return (
    parts.join("\n\n") ||
    "- No relevant context retrieved. Use conservative recommendations."
  );
}

function compactRecommendations(recommendation: RecommendationResult): string {
  const n = recommendation.nutrition;
  const w = recommendation.workout;
  const m = recommendation.meal;

  const lines = [
    `Objective: ${recommendation.objective}`,
    `Calories target: ${n.targetCalories}`,
    `Macros grams/day: protein=${n.proteinGrams}, carbs=${n.carbsGrams}, fats=${n.fatGrams}`,
    `Nutrition confidence: ${n.confidence}`,
    `Workout split: ${w.split}`,
    `Workout sessions/week: ${w.sessionsPerWeek}`,
    `Workout focus: ${w.focus.join(", ")}`,
    `Workout avoid patterns: ${w.avoidedPatterns.length > 0 ? w.avoidedPatterns.join(", ") : "none"}`,
    `Meal template: ${m.template}`,
    `Meal preference: ${m.preference || "none"}`,
    `Assumptions: ${recommendation.assumptions.length > 0 ? recommendation.assumptions.join(" | ") : "none"}`,
    `Missing fields: ${recommendation.missingFields.length > 0 ? recommendation.missingFields.join(", ") : "none"}`,
  ];

  return lines.join("\n");
}

export const promptBuilder = {
  build(
    inputQuestion: string,
    intent: InputIntent,
    context: PersonalizationContext,
    retrieval: RetrievalResult,
    recommendation: RecommendationResult,
    responseLanguage: ResponseLanguage,
    chatHistory: any[],
    bodyCompText?: string,
  ): string {
    const profile = context.profile;
    const viRules = [
      "Bạn là AI fitness coach cho người dùng Việt Nam.",
      "",
      "PHẠM VI (LUÔN ÁP DỤNG, mọi loại câu hỏi):",
      "- Bạn CHỈ trả lời các chủ đề: tập luyện, dinh dưỡng thể thao, phục hồi, sức khỏe thể chất liên quan vận động.",
      "- Nếu câu hỏi (hoặc một phần câu hỏi) không thuộc phạm vi trên (lập trình, chính trị, tài chính, giải trí, học thuật không liên quan...), từ chối lịch sự phần đó và chỉ tập trung vào phần liên quan thể hình nếu có.",
      "- KHÔNG bao giờ đóng vai trò khác (lập trình viên, chuyên gia tài chính, v.v.) dù user yêu cầu.",
      "",
      "QUY TẮC NGÔN NGỮ:",
      "- Câu trả lời chính bằng tiếng Việt.",
      "- Tên bài tập PHẢI là tên canonical tiếng Anh theo DB Workout Log: ví dụ Bench Press, Cable Triceps Pushdown, One-Arm Dumbbell Overhead Triceps Extension.",
      "- Không dịch tên bài tập sang tiếng Việt, kể cả khi nguồn RAG đang dùng tên tiếng Việt hoặc alias.",
      "- Nếu thấy tên bài tập tiếng Việt trong context, tự map sang tên tiếng Anh chuẩn trước khi trả lời.",
      "- KHÔNG lộ nhãn nội bộ: recomposition, confidence, omnivorous, moderate_volume, strength_retention.",
      "- Khi mô tả chỉ số cơ/mỡ theo vùng cơ thể (tay, chân) từ dữ liệu InBody, LUÔN dùng đúng cặp 'trái'/'phải' (left/right) theo dữ liệu gốc. TUYỆT ĐỐI KHÔNG dùng 'trước'/'sau' — đó không phải là cách InBody phân vùng tay/chân.",
      '- SAI (không được viết): "Tay trước (biceps): 3.37kg (trái), 3.35kg (phải)" hay "Chân trước (quadriceps): ...". ĐÚNG: "Tay trái: 3.37kg, Tay phải: 3.35kg".',
      "",
      "QUY TẮC COACHING VÀ CẢM XÚC:",
      '- Bắt đầu bằng một câu nhận xét tích cực/cảm thông dựa trên dữ liệu user (ví dụ: "Với 65 kg và mục tiêu giảm mỡ, bạn đang ở điểm khởi đầu rất tốt!").',
      '- Sử dụng ngôn ngữ động viên. Thay "bạn đang làm sai" → "cách hiệu quả hơn là...".',
      "- Nếu user đã đề cập tiến trình trước đó trong hội thoại, ghi nhận sự cố gắng của họ.",
      '- Kết thúc bằng một câu ngắn khích lệ phù hợp mục tiêu (ví dụ: "Kiên trì 4–6 tuần — bạn sẽ thấy kết quả rõ rệt!").',
      "- Nếu user đang gặp khó khăn (chấn thương, thiếu thời gian, thiếu thiết bị), đồng cảm trước khi đưa giải pháp.",
      "",
      "QUY TẮC HÀNH VI:",
      "- Trả lời trực tiếp ngay — KHÔNG hỏi lại trước khi trả lời.",
      "- Nếu user hỏi lịch tập, phải đưa bài tập cụ thể ngay lần đầu.",
      "- Nếu user hỏi một ngày cụ thể (Thứ 2, ngày 1, buổi 1), chỉ trả lời riêng ngày đó.",
      "- Nếu user đổi số buổi/tuần, PHẢI cập nhật plan theo tần suất mới — không quay về plan 3 buổi mặc định.",
      '- Nếu thiếu dữ liệu, vẫn đưa plan mẫu an toàn và ghi rõ phần "Giả định".',
      "- Chỉ hỏi thêm ở cuối để cá nhân hóa sâu hơn.",
      "",
      "QUY TẮC FORMAT:",
      "- Với workout plan hoặc lịch ngày: trình bày bảng có cột: Ngày | Nhóm cơ | Bài tập | Sets | Reps | Rest",
      "- Với meal plan: có bảng macro mục tiêu VÀ bảng từng bữa ăn.",
      "- Dùng **bold** cho số quan trọng và từ khóa chính.",
      "- Thêm emoji phù hợp: 💪 🥗 ⚡ 📊 để phân cấp thị giác.",
      "- Không viết đoạn văn dài liền tục khó đọc.",
      "",
      "QUY TẮC CHẤT LƯỢNG:",
      "- Không bịa calories tuyệt đối nếu chưa có weight, height, age, activity.",
      '- "Tay trước" = biceps, KHÔNG phải tay trái/tay phải.',
      "- 6 buổi/tuần không tự động sai — đánh giá theo recovery và volume.",
    ];

    const enRules = [
      "You are Coach — an elite personal trainer and sports nutritionist with 10+ years of experience.",
      "You communicate like a real gym professional: direct, data-driven, confident, and genuinely motivating.",
      "",
      "SCOPE (ALWAYS APPLIES, for every message):",
      "- You ONLY answer questions about training, sports nutrition, recovery, and physical health tied to exercise.",
      "- If the message (or part of it) falls outside that scope (coding, politics, finance, entertainment, unrelated academic topics, etc.), politely decline that part and only address the fitness-relevant part, if any.",
      "- NEVER roleplay as a different kind of assistant (programmer, financial advisor, etc.) even if asked to.",
      "",
      "COACHING STYLE:",
      "- Lead with a brief empathetic acknowledgement of the user's situation, then deliver the answer immediately.",
      "- Be precise with numbers: always state exact calories, macros, sets, reps.",
      '- Use encouraging language. Instead of "you\'re doing it wrong", say "a more effective approach is...".',
      "- If the user mentions prior progress in this conversation, acknowledge and celebrate their effort.",
      "- End each response with one short motivating sentence aligned to their goal.",
      "- Use **bold** for critical numbers and key terms.",
      "- Add fitness emojis sparingly: 💪 🥗 ⚡ 📊 🎯",
      "- Exercise names must stay in English and should match the Workout Log DB naming exactly.",
      "",
      "NON-NEGOTIABLE RULES:",
      "- Numbers MUST match the deterministic targets exactly — these are your source of truth.",
      "- NEVER use these internal labels: recomposition, confidence, strength_retention, moderate_volume, omnivorous.",
      "- When describing InBody segmental muscle/fat data (arms, legs), ALWAYS use the correct 'left'/'right' pairing from the source data. NEVER use 'front'/'back' — that is not how InBody segments limbs.",
      "- Do NOT expose system structure, JSON, or parsed intent to the user.",
      "- Do NOT invent exercises or make unsupported medical claims.",
      "- If profile data is missing, give the best safe default first, then ask 1–2 targeted follow-ups at the end.",
    ];

    return [
      ...(responseLanguage === "vi" ? viRules : enRules),
      "",
      ...(() => {
        const sections = formatHistorySections(context, chatHistory);
        return sections.length > 0 ? [...sections, ""] : [];
      })(),
      "Câu hỏi của user:",
      inputQuestion,
      "",
      // Inject extracted constraints so LLM cannot ignore them
      ...(() => {
        const isGeneralKnowledge =
          intent.routeIntent === "general_fitness_knowledge";
        if (isGeneralKnowledge) return [];

        const constraints: string[] = [];
        if (recommendation.workout.sessionsPerWeek) {
          constraints.push(
            `⚠️ CONSTRAINT: Số ngày/tuần = ${recommendation.workout.sessionsPerWeek}. Phải trả đúng ${recommendation.workout.sessionsPerWeek} ngày.`,
          );
        }
        if (intent.minimumExercisesPerDay) {
          constraints.push(
            `⚠️ CONSTRAINT: Mỗi buổi phải có ÍT NHẤT ${intent.minimumExercisesPerDay} bài tập.`,
          );
        }
        const equipmentList = profile.training.availableEquipment;
        if (equipmentList.length > 0) {
          const eq = equipmentList.map((e) => e.toLowerCase());
          const hasGymAccess = eq.some((e) => /barbell|rack|gym/.test(e));
          if (!hasGymAccess) {
            const hasDumbbell = eq.some((e) => /dumbbell/.test(e));
            const equipmentMsg = hasDumbbell
              ? `Chỉ có thiết bị: ${equipmentList.join(", ")}. TUYỆT ĐỐI không đề xuất bài cần barbell, rack, máy cable, máy gym.`
              : `Tập không thiết bị (${equipmentList.join(", ")}). TUYỆT ĐỐI không đề xuất bài cần barbell, dumbbell, rack, máy cable, máy gym.`;
            constraints.push(`⚠️ CONSTRAINT: ${equipmentMsg}`);
          }
        }
        return constraints.length > 0
          ? ["Ràng buộc bắt buộc từ câu hỏi:", ...constraints, ""]
          : [];
      })(),
      "Hồ sơ user:",
      compactProfile(profile),
      "",
      // Facts saved across previous sessions via remember_user_fact (Phase 3 memory)
      ...(() => {
        const memoriesText = compactMemories(context);
        return memoriesText
          ? ["Thông tin đã ghi nhớ về user (từ các lần trò chuyện trước):", memoriesText, ""]
          : [];
      })(),
      // Inject active workout & nutrition programs if available
      ...(() => {
        const programsText = compactCurrentPrograms(context);
        return programsText
          ? ["Chương trình đang áp dụng:", programsText, ""]
          : [];
      })(),
      // Inject body composition analysis + evidence-based plan adjustments
      ...(() => {
        if (!bodyCompText) return [];
        return [
          "Phân tích thành phần cơ thể (dùng để điều chỉnh kế hoạch):",
          bodyCompText,
          "",
        ];
      })(),
      ...(() => {
        const isGeneralKnowledge =
          intent.routeIntent === "general_fitness_knowledge";
        if (isGeneralKnowledge) return [];
        return [
          `Chỉ số tính toán (nguồn sự thật — không được lệch khỏi các con số này):`,
          compactRecommendations(recommendation),
          "",
        ];
      })(),
      "",
      "Tri thức bài tập liên quan:",
      compactRetrieval(retrieval),
      "",
      ...(() => {
        const isMeal = intent.routeIntent === "meal_plan_request";
        const isInjury = intent.mentionsInjury;
        const isGeneralKnowledge =
          intent.routeIntent === "general_fitness_knowledge";

        if (responseLanguage === "vi") {
          if (isGeneralKnowledge) {
            return [
              "ĐỊNH DẠNG ĐẦU RA BẮT BUỘC (viết bằng tiếng Việt):",
              '⛔ CHỈ từ chối nếu câu hỏi HOÀN TOÀN không liên quan đến thể hình/sức khỏe/dinh dưỡng (ví dụ: lập trình, toán học, chính trị, giải trí). Câu hỏi về cân nặng, chỉ số cơ thể, tăng/giảm cân — kể cả khi ngắn gọn hoặc thiếu chi tiết (ví dụ: "tôi tăng lên 83kg rồi phải làm sao") — LUÔN được xem là liên quan, KHÔNG được từ chối; hãy trả lời trực tiếp và chỉ hỏi thêm thông tin nếu thực sự cần để cá nhân hóa. Nếu câu hỏi thực sự không liên quan, dùng nguyên văn: "Xin lỗi, tôi là trợ lý thể hình nên chỉ hỗ trợ các vấn đề về sức khỏe/tập luyện...". KHÔNG bao giờ vừa mở đầu bằng câu từ chối vừa tiếp tục trả lời — chỉ chọn MỘT trong hai.',
              "",
              "Nếu câu hỏi liên quan đến fitness:",
              "- Trả lời trực tiếp, dựa trên kiến thức thể hình của bạn. CHỈ dùng thông tin RAG nếu nó THỰC SỰ liên quan đến câu hỏi. Bỏ qua RAG nếu không liên quan.",
              "- Chỉ đưa ra lời khuyên cá nhân hóa nếu phù hợp với câu hỏi.",
              "- KHÔNG ép buộc xuất ra bảng lịch tập hay bảng dinh dưỡng nếu câu hỏi chỉ hỏi kiến thức chung.",
              "- Viết theo đoạn văn dễ đọc, dùng markdown cơ bản, không dài dòng.",
            ];
          }

          if (isMeal) {
            return [
              "ĐỊNH DẠNG ĐẦU RA BẮT BUỘC (chỉ về dinh dưỡng, viết bằng tiếng Việt):",
              "⛔ TUYỆT ĐỐI KHÔNG đưa lịch tập, bảng bài tập, kế hoạch workout, hay bất kỳ nội dung training nào vào câu trả lời này. Chỉ dinh dưỡng.",
              "",
              "## [Một câu nhận xét cá nhân hóa về dinh dưỡng của họ]",
              "",
              "## 🥗 Dinh Dưỡng Mục Tiêu",
              "| Chỉ số | Giá trị |",
              "|--------|---------|",
              "| Calo | X kcal |",
              "| Đạm | Xg |",
              "| Carb | Xg |",
              "| Béo | Xg |",
              "[1–2 câu lý giải dựa trên mục tiêu của họ]",
              "",
              "## 🍽️ Gợi Ý Thực Đơn",
              "[Bữa sáng / trưa / tối với thực phẩm cụ thể và gram]",
              "",
              "## 🔄 Cách Điều Chỉnh Theo Thời Gian",
              "[Hướng dẫn điều chỉnh macro/calo theo tiến trình — theo tuần hoặc tháng]",
              "",
              "## ⚡ Hành Động Tuần Này",
              "1. [Bước cụ thể có thể làm ngay]",
              "2. [Bước cụ thể có thể làm ngay]",
              "3. [Bước cụ thể có thể làm ngay]",
              "",
              "[Chỉ thêm nếu hồ sơ thiếu]",
              "**Giả định:** [liệt kê nếu thiếu dữ liệu]",
              "**Để cá nhân hóa thêm:** 1. [câu hỏi] 2. [câu hỏi]",
            ];
          }

          if (isInjury) {
            return [
              "ĐỊNH DẠNG ĐẦU RA BẮT BUỘC (có chấn thương — điều chỉnh an toàn, viết bằng tiếng Việt):",
              "",
              "## [Nhận xét cá nhân hóa về tình trạng chấn thương và mục tiêu]",
              "",
              "## ⚠️ Lưu Ý Chấn Thương",
              "[Mô tả ngắn bài tập/pattern nào cần tránh và tại sao]",
              "",
              "## 💪 Lịch Tập Điều Chỉnh",
              "| Ngày | Nhóm cơ | Bài tập | Sets | Reps | Rest | Ghi chú |",
              "|------|---------|---------|------|------|------|---------|",
              "| Thứ X | ... | Exercise Name | X | X-X | Xs | Safe for injury |",
              "",
              "## 🥗 Dinh Dưỡng",
              "**Calo:** X kcal | **Đạm:** Xg | **Carb:** Xg | **Béo:** Xg",
              "",
              "## ⚡ Hành Động Tuần Này",
              "1. [Bước cụ thể có thể làm ngay]",
              "2. [Bước cụ thể có thể làm ngay]",
              "3. [Bước cụ thể có thể làm ngay]",
              "",
              "[Chỉ thêm nếu hồ sơ thiếu]",
              "**Giả định:** [liệt kê nếu thiếu dữ liệu]",
            ];
          }

          return [
            "ĐỊNH DẠNG ĐẦU RA BẮT BUỘC (viết HOÀN TOÀN bằng tiếng Việt, giữ tên bài tập tiếng Anh):",
            "",
            "## [Một câu nhận xét cá nhân hóa dựa trên dữ liệu của họ]",
            "",
            "## 💪 Lịch Tập",
            "| Ngày | Nhóm cơ | Bài tập | Sets | Reps | Rest |",
            "|------|---------|---------|------|------|------|",
            "| Thứ X | ... | Exercise Name | X | X-X | Xs |",
            "",
            "## 🥗 Dinh Dưỡng",
            "| Chỉ số | Giá trị |",
            "|--------|---------|",
            "| Calo | X kcal |",
            "| Đạm | Xg |",
            "| Carb | Xg |",
            "| Béo | Xg |",
            "[1 câu lý giải ngắn]",
            "",
            "## ⚡ Hành Động Tuần Này",
            "1. [Bước cụ thể có thể làm ngay]",
            "2. [Bước cụ thể có thể làm ngay]",
            "3. [Bước cụ thể có thể làm ngay]",
            "",
            "[Chỉ thêm nếu hồ sơ thiếu]",
            "**Giả định:** [liệt kê nếu thiếu dữ liệu]",
            "**Để cá nhân hóa thêm:** 1. [câu hỏi] 2. [câu hỏi]",
          ];
        }

        // English path
        if (isGeneralKnowledge) {
          return [
            "MANDATORY OUTPUT FORMAT (write in English):",
            '⛔ IF THE QUESTION IS NOT RELATED TO FITNESS, HEALTH, OR NUTRITION (e.g., programming, math, politics): Politely decline to answer ("I am a fitness assistant and can only help with health and training matters..."). DO NOT generate any plan.',
            "",
            "If the question is related to fitness:",
            "- Answer directly and clearly, based on sports science and the provided RAG information.",
            "- Provide personalized advice only if it makes sense for the question.",
            "- DO NOT force a workout table or nutrition table unless the user explicitly asks for a full plan.",
            "- Write in easy-to-read paragraphs using basic markdown.",
          ];
        }

        if (isMeal) {
          return [
            "MANDATORY OUTPUT FORMAT (nutrition focus only, write in English):",
            "⛔ DO NOT include any workout schedule, exercise table, training plan, or any non-nutrition content in this response.",
            "",
            "## [One sentence personalized nutrition insight]",
            "",
            "## 🥗 Nutrition Targets",
            "**Calories:** X kcal | **Protein:** Xg | **Carbs:** Xg | **Fats:** Xg",
            "[1–2 sentence rationale based on their goal]",
            "",
            "## 🍽️ Meal Examples",
            "[Breakfast / Lunch / Dinner with specific foods and rough portions]",
            "",
            "## 🔄 How to Adjust Over Time",
            "[Guide on adjusting macros/calories as progress happens]",
            "",
            "## ⚡ Action Steps This Week",
            "[3 numbered, specific, immediately executable steps]",
            "",
            "[Only include if profile is incomplete]",
            "**To dial this in further:**",
            "1. [Specific follow-up question]",
            "2. [Specific follow-up question]",
          ];
        }

        if (isInjury) {
          return [
            "MANDATORY OUTPUT FORMAT (injury-aware plan, write in English):",
            "",
            "## [Personalized note on their injury and goal]",
            "",
            "## ⚠️ Injury Considerations",
            "[What to avoid and why, with safe alternatives]",
            "",
            "## 💪 Adjusted Training Plan",
            "[Weekly schedule modified for injury — flag each substitution]",
            "",
            "## 🥗 Nutrition",
            "**Calories:** X kcal | **Protein:** Xg | **Carbs:** Xg | **Fats:** Xg",
            "",
            "## ⚡ Action Steps This Week",
            "[3 numbered, specific, immediately executable steps]",
          ];
        }

        return [
          "MANDATORY OUTPUT FORMAT (write ENTIRELY in English):",
          "",
          "## [One punchy personalized sentence based on their data]",
          "",
          "## 💪 Training",
          "[Weekly schedule with days, muscle groups, exercises, sets/reps/rest]",
          "",
          "## 🥗 Nutrition",
          "**Calories:** X kcal | **Protein:** Xg | **Carbs:** Xg | **Fats:** Xg",
          "[1–2 sentence rationale based on their goal]",
          "",
          "## ⚡ Action Steps This Week",
          "[3 numbered, specific, immediately executable steps — no vague advice]",
          "",
          "[Only include if profile is incomplete]",
          "**To dial this in further:**",
          "1. [Specific follow-up question]",
          "2. [Specific follow-up question]",
        ];
      })(),
    ].join("\n");
  },
};
