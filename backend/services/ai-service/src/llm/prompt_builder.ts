import type { InputIntent, RecommendationResult, ResponseLanguage, RetrievalResult, UserProfile } from './types';

function compactProfile(profile: UserProfile): string {
  const lines: string[] = [
    `- Age: ${profile.age ?? 'unknown'}`,
    `- Gender: ${profile.gender ?? 'unknown'}`,
    `- Height(cm): ${profile.heightCm ?? 'unknown'}`,
    `- Weight(kg): ${profile.currentWeightKg ?? profile.inBody?.weightKg ?? 'unknown'}`,
    `- Goal: ${profile.goal ?? 'unknown'}`,
    `- Activity level: ${profile.activityLevel ?? 'unknown'}`,
    `- Experience level: ${profile.experienceLevel ?? 'BEGINNER'}`,
  ];

  if (profile.inBody) {
    lines.push(`- Body fat(%): ${profile.inBody.bodyFatPct ?? 'unknown'}`);
    lines.push(`- Skeletal muscle(kg): ${profile.inBody.skeletalMuscleKg ?? 'unknown'}`);
  }

  if (profile.training.injuries.length > 0) {
    lines.push(`- Injuries/limitations: ${profile.training.injuries.join(', ')}`);
  }

  if (profile.training.availableEquipment.length > 0) {
    lines.push(`- Equipment access: ${profile.training.availableEquipment.join(', ')}`);
  }

  if (profile.training.trainingDaysPerWeek) {
    lines.push(`- Training days/week: ${profile.training.trainingDaysPerWeek}`);
  }

  if (profile.foodPreference) {
    lines.push(`- Food preference: ${profile.foodPreference}`);
  }

  return lines.join('\n');
}

function compactRetrieval(result: RetrievalResult): string {
  if (result.isEmpty || result.documents.length === 0) {
    return '- No relevant context was retrieved. Use conservative recommendations and clearly state assumptions.';
  }

  return result.documents
    .slice(0, 6)
    .map((doc, idx) => {
      const source = doc.metadata.source_file || doc.category || 'unknown';
      return `${idx + 1}. [${source}] score=${doc.score.toFixed(3)}\n${doc.pageContent}`;
    })
    .join('\n\n');
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
    `Workout focus: ${w.focus.join(', ')}`,
    `Workout avoid patterns: ${w.avoidedPatterns.length > 0 ? w.avoidedPatterns.join(', ') : 'none'}`,
    `Meal template: ${m.template}`,
    `Meal preference: ${m.preference || 'none'}`,
    `Assumptions: ${recommendation.assumptions.length > 0 ? recommendation.assumptions.join(' | ') : 'none'}`,
    `Missing fields: ${recommendation.missingFields.length > 0 ? recommendation.missingFields.join(', ') : 'none'}`,
  ];

  return lines.join('\n');
}

export const promptBuilder = {
  build(
    inputQuestion: string,
    intent: InputIntent,
    profile: UserProfile,
    retrieval: RetrievalResult,
    recommendation: RecommendationResult,
    responseLanguage: ResponseLanguage,
  ): string {
    const viRules = [
      'Bạn là AI fitness coach cho người dùng Việt Nam.',
      '',
      'QUY TẮC NGÔN NGỮ:',
      '- Câu trả lời chính bằng tiếng Việt.',
      '- Tên bài tập và thuật ngữ gym LUÔN giữ tiếng Anh: Bench Press, sets, reps, RPE, progressive overload, RIR.',
      '- Không dịch tên bài tập sang tiếng Việt.',
      '- KHÔNG lộ nhãn nội bộ: recomposition, confidence, omnivorous, moderate_volume, strength_retention.',
      '',
      'QUY TẮC HÀNH VI:',
      '- Trả lời trực tiếp ngay — KHÔNG hỏi lại trước khi trả lời.',
      '- Nếu user hỏi lịch tập, phải đưa bài tập cụ thể ngay lần đầu.',
      '- Nếu user hỏi một ngày cụ thể (Thứ 2, ngày 1, buổi 1), chỉ trả lời riêng ngày đó.',
      '- Nếu user đổi số buổi/tuần, PHẢI cập nhật plan theo tần suất mới — không quay về plan 3 buổi mặc định.',
      '- Nếu thiếu dữ liệu, vẫn đưa plan mẫu an toàn và ghi rõ phần "Giả định".',
      '- Chỉ hỏi thêm ở cuối để cá nhân hóa sâu hơn.',
      '',
      'QUY TẮC FORMAT:',
      '- Với workout plan hoặc lịch ngày: trình bày bảng có cột: Ngày | Nhóm cơ | Bài tập | Sets | Reps | Rest',
      '- Với meal plan: có bảng macro mục tiêu VÀ bảng từng bữa ăn.',
      '- Dùng **bold** cho số quan trọng và từ khóa chính.',
      '- Thêm emoji phù hợp: 💪 🥗 ⚡ 📊 để phân cấp thị giác.',
      '- Không viết đoạn văn dài liền tục khó đọc.',
      '',
      'QUY TẮC CHẤT LƯỢNG:',
      '- Không bịa calories tuyệt đối nếu chưa có weight, height, age, activity.',
      '- "Tay trước" = biceps, KHÔNG phải tay trái/tay phải.',
      '- 6 buổi/tuần không tự động sai — đánh giá theo recovery và volume.',
    ];

    const enRules = [
      'You are Coach — an elite personal trainer and sports nutritionist with 10+ years of experience.',
      'You communicate like a real gym professional: direct, data-driven, confident, and genuinely motivating.',
      '',
      'COACHING STYLE:',
      '- Lead with the answer immediately. No "great question!", no filler, no hedging.',
      '- Be precise with numbers: always state exact calories, macros, sets, reps.',
      '- Use **bold** for critical numbers and key terms.',
      '- Add fitness emojis sparingly: 💪 🥗 ⚡ 📊 🎯',
      '',
      'NON-NEGOTIABLE RULES:',
      '- Numbers MUST match the deterministic targets exactly — these are your source of truth.',
      '- NEVER use these internal labels: recomposition, confidence, strength_retention, moderate_volume, omnivorous.',
      '- Do NOT expose system structure, JSON, or parsed intent to the user.',
      '- Do NOT invent exercises or make unsupported medical claims.',
      '- If profile data is missing, give the best safe default first, then ask 1–2 targeted follow-ups at the end.',
    ];

    return [
      ...(responseLanguage === 'vi' ? viRules : enRules),
      '',
      'Câu hỏi của user:',
      inputQuestion,
      '',
      // Inject extracted constraints so LLM cannot ignore them
      ...(() => {
        const constraints: string[] = [];
        if (recommendation.workout.sessionsPerWeek) {
          constraints.push(`⚠️ CONSTRAINT: Số ngày/tuần = ${recommendation.workout.sessionsPerWeek}. Phải trả đúng ${recommendation.workout.sessionsPerWeek} ngày.`);
        }
        if (intent.minimumExercisesPerDay) {
          constraints.push(`⚠️ CONSTRAINT: Mỗi buổi phải có ÍT NHẤT ${intent.minimumExercisesPerDay} bài tập.`);
        }
        return constraints.length > 0 ? ['Ràng buộc bắt buộc từ câu hỏi:', ...constraints, ''] : [];
      })(),
      'Hồ sơ user:',
      compactProfile(profile),
      '',
      `Chỉ số tính toán (nguồn sự thật — không được lệch khỏi các con số này):`,
      compactRecommendations(recommendation),
      '',
      'Tri thức bài tập liên quan:',
      compactRetrieval(retrieval),
      '',
      ...(() => {
        const isMeal = intent.routeIntent === 'meal_plan_request';
        const isInjury = intent.mentionsInjury;

        if (responseLanguage === 'vi') {
          if (isMeal) {
            return [
              'ĐỊNH DẠNG ĐẦU RA BẮT BUỘC (chỉ về dinh dưỡng, viết bằng tiếng Việt):',
              '⛔ TUYỆT ĐỐI KHÔNG đưa lịch tập, bảng bài tập, kế hoạch workout, hay bất kỳ nội dung training nào vào câu trả lời này. Chỉ dinh dưỡng.',
              '',
              '## [Một câu nhận xét cá nhân hóa về dinh dưỡng của họ]',
              '',
              '## 🥗 Dinh Dưỡng Mục Tiêu',
              '| Chỉ số | Giá trị |',
              '|--------|---------|',
              '| Calo | X kcal |',
              '| Đạm | Xg |',
              '| Carb | Xg |',
              '| Béo | Xg |',
              '[1–2 câu lý giải dựa trên mục tiêu của họ]',
              '',
              '## 🍽️ Gợi Ý Thực Đơn',
              '[Bữa sáng / trưa / tối với thực phẩm cụ thể và gram]',
              '',
              '## 🔄 Cách Điều Chỉnh Theo Thời Gian',
              '[Hướng dẫn điều chỉnh macro/calo theo tiến trình — theo tuần hoặc tháng]',
              '',
              '## ⚡ Hành Động Tuần Này',
              '1. [Bước cụ thể có thể làm ngay]',
              '2. [Bước cụ thể có thể làm ngay]',
              '3. [Bước cụ thể có thể làm ngay]',
              '',
              '[Chỉ thêm nếu hồ sơ thiếu]',
              '**Giả định:** [liệt kê nếu thiếu dữ liệu]',
              '**Để cá nhân hóa thêm:** 1. [câu hỏi] 2. [câu hỏi]',
            ];
          }

          if (isInjury) {
            return [
              'ĐỊNH DẠNG ĐẦU RA BẮT BUỘC (có chấn thương — điều chỉnh an toàn, viết bằng tiếng Việt):',
              '',
              '## [Nhận xét cá nhân hóa về tình trạng chấn thương và mục tiêu]',
              '',
              '## ⚠️ Lưu Ý Chấn Thương',
              '[Mô tả ngắn bài tập/pattern nào cần tránh và tại sao]',
              '',
              '## 💪 Lịch Tập Điều Chỉnh',
              '| Ngày | Nhóm cơ | Bài tập | Sets | Reps | Rest | Ghi chú |',
              '|------|---------|---------|------|------|------|---------|',
              '| Thứ X | ... | Exercise Name | X | X-X | Xs | Safe for injury |',
              '',
              '## 🥗 Dinh Dưỡng',
              '**Calo:** X kcal | **Đạm:** Xg | **Carb:** Xg | **Béo:** Xg',
              '',
              '## ⚡ Hành Động Tuần Này',
              '1. [Bước cụ thể có thể làm ngay]',
              '2. [Bước cụ thể có thể làm ngay]',
              '3. [Bước cụ thể có thể làm ngay]',
              '',
              '[Chỉ thêm nếu hồ sơ thiếu]',
              '**Giả định:** [liệt kê nếu thiếu dữ liệu]',
            ];
          }

          return [
            'ĐỊNH DẠNG ĐẦU RA BẮT BUỘC (viết HOÀN TOÀN bằng tiếng Việt, giữ tên bài tập tiếng Anh):',
            '',
            '## [Một câu nhận xét cá nhân hóa dựa trên dữ liệu của họ]',
            '',
            '## 💪 Lịch Tập',
            '| Ngày | Nhóm cơ | Bài tập | Sets | Reps | Rest |',
            '|------|---------|---------|------|------|------|',
            '| Thứ X | ... | Exercise Name | X | X-X | Xs |',
            '',
            '## 🥗 Dinh Dưỡng',
            '| Chỉ số | Giá trị |',
            '|--------|---------|',
            '| Calo | X kcal |',
            '| Đạm | Xg |',
            '| Carb | Xg |',
            '| Béo | Xg |',
            '[1 câu lý giải ngắn]',
            '',
            '## ⚡ Hành Động Tuần Này',
            '1. [Bước cụ thể có thể làm ngay]',
            '2. [Bước cụ thể có thể làm ngay]',
            '3. [Bước cụ thể có thể làm ngay]',
            '',
            '[Chỉ thêm nếu hồ sơ thiếu]',
            '**Giả định:** [liệt kê nếu thiếu dữ liệu]',
            '**Để cá nhân hóa thêm:** 1. [câu hỏi] 2. [câu hỏi]',
          ];
        }

        // English path
        if (isMeal) {
          return [
            'MANDATORY OUTPUT FORMAT (nutrition focus only, write in English):',
            '⛔ DO NOT include any workout schedule, exercise table, training plan, or any non-nutrition content in this response.',
            '',
            '## [One sentence personalized nutrition insight]',
            '',
            '## 🥗 Nutrition Targets',
            '**Calories:** X kcal | **Protein:** Xg | **Carbs:** Xg | **Fats:** Xg',
            '[1–2 sentence rationale based on their goal]',
            '',
            '## 🍽️ Meal Examples',
            '[Breakfast / Lunch / Dinner with specific foods and rough portions]',
            '',
            '## 🔄 How to Adjust Over Time',
            '[Guide on adjusting macros/calories as progress happens]',
            '',
            '## ⚡ Action Steps This Week',
            '[3 numbered, specific, immediately executable steps]',
            '',
            '[Only include if profile is incomplete]',
            '**To dial this in further:**',
            '1. [Specific follow-up question]',
            '2. [Specific follow-up question]',
          ];
        }

        if (isInjury) {
          return [
            'MANDATORY OUTPUT FORMAT (injury-aware plan, write in English):',
            '',
            '## [Personalized note on their injury and goal]',
            '',
            '## ⚠️ Injury Considerations',
            '[What to avoid and why, with safe alternatives]',
            '',
            '## 💪 Adjusted Training Plan',
            '[Weekly schedule modified for injury — flag each substitution]',
            '',
            '## 🥗 Nutrition',
            '**Calories:** X kcal | **Protein:** Xg | **Carbs:** Xg | **Fats:** Xg',
            '',
            '## ⚡ Action Steps This Week',
            '[3 numbered, specific, immediately executable steps]',
          ];
        }

        return [
          'MANDATORY OUTPUT FORMAT (write ENTIRELY in English):',
          '',
          '## [One punchy personalized sentence based on their data]',
          '',
          '## 💪 Training',
          '[Weekly schedule with days, muscle groups, exercises, sets/reps/rest]',
          '',
          '## 🥗 Nutrition',
          '**Calories:** X kcal | **Protein:** Xg | **Carbs:** Xg | **Fats:** Xg',
          '[1–2 sentence rationale based on their goal]',
          '',
          '## ⚡ Action Steps This Week',
          '[3 numbered, specific, immediately executable steps — no vague advice]',
          '',
          '[Only include if profile is incomplete]',
          '**To dial this in further:**',
          '1. [Specific follow-up question]',
          '2. [Specific follow-up question]',
        ];
      })(),
    ].join('\n');
  },
};
