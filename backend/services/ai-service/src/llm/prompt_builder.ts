import type { InputIntent, RecommendationResult, ResponseLanguage, RetrievalResult, UserProfile } from './types';
import type { PersonalizationContext } from './profile_extractor';

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

export function extractSessionContext(chatHistory: any[]): string {
  if (!chatHistory || chatHistory.length === 0) return '';

  const concerns: string[] = [];
  let goalMentioned: string | undefined;
  let planFrequency: string | undefined;
  let planSplit: string | undefined;

  for (const c of chatHistory.slice(0, 10)) {
    const q = ((c.question || '') as string).toLowerCase();
    const a = ((c.answer || '') as string).toLowerCase();

    // Scan question for concerns and goals
    if (/ch[aâ]n\s*th[uươ][ươ]ng|injury|[dđ]au\b|pain/.test(q)) concerns.push('chấn thương');
    if (/protein|[dđ][aạ]m\b/.test(q)) concerns.push('protein');
    if (/gi[aả]m\s*m[oỡ]|fat\s*loss|giam\s*mo/.test(q)) goalMentioned = 'giảm mỡ';
    if (/t[aă]ng\s*c[oơ]|muscle\s*gain|tang\s*co/.test(q)) goalMentioned = 'tăng cơ';
    if (/ngh[iỉ]\s*ng[oơ]i|recover|recovery/.test(q)) concerns.push('hồi phục');
    // Equipment / time constraints from questions
    if (/ch[iỉ]\s*c[oó]\s*dumbbell|only\s*dumbbell|t[aạ]\s*đ[oơ]n/i.test(q)) concerns.push('chỉ có dumbbell');
    if (/[oở]\s*nh[aà]\b|at\s*home|home\s*gym/i.test(q)) concerns.push('tập ở nhà');
    if (/30\s*ph[uú]t|45\s*ph[uú]t|b[aậ]n\s*h[oọ]c|b[aậ]n\s*vi[eệ]c/i.test(q)) concerns.push('thời gian hạn chế');

    // Scan answer for injury mentions
    if (/ch[aâ]n\s*th[uươ][ươ]ng|injury|[dđ]au\b|pain/.test(a)) concerns.push('chấn thương');
    if (/tr[aá]nh.*overhead|tr[aá]nh.*vai\s*tr[uư][oớ]c|overhead.*c[aẩ]n\s*th[aậ]n/i.test(a)) {
      concerns.push('cẩn thận overhead press');
    }

    // Scan answer for previously given plan frequency
    if (!planFrequency) {
      const freqMatch = a.match(
        /(\d)\s*ng[aà]y\s*\/?\s*tu[aầ]n|(\d)\s*bu[oổ]i\s*\/?\s*tu[aầ]n|(\d)-day\s+plan|(\d)\s+days?\s+per\s+week/i,
      );
      if (freqMatch) {
        const days = freqMatch[1] || freqMatch[2] || freqMatch[3] || freqMatch[4];
        if (days) planFrequency = `${days} ngày/tuần`;
      }
    }

    // Scan answer for split type
    if (!planSplit) {
      if (/push.{0,5}pull.{0,5}legs|ppl/i.test(a)) planSplit = 'Push/Pull/Legs';
      else if (/upper.{0,5}lower/i.test(a)) planSplit = 'Upper/Lower';
      else if (/full.{0,5}body/i.test(a)) planSplit = 'Full Body';
    }
  }

  const parts: string[] = [];
  if (goalMentioned) parts.push(`Mục tiêu đã nhắc: ${goalMentioned}`);
  if (planFrequency) {
    const splitInfo = planSplit ? ` [${planSplit}]` : '';
    parts.push(`Đã đề xuất plan: ${planFrequency}${splitInfo} — giữ nhất quán trừ khi user yêu cầu đổi`);
  }
  if (concerns.length > 0) {
    const unique = [...new Set(concerns)];
    parts.push(`Mối quan tâm trong phiên: ${unique.join(', ')}`);
  }

  return parts.length > 0 ? `[Ngữ cảnh phiên: ${parts.join('; ')}]` : '';
}

function formatHistorySections(context: PersonalizationContext, chatHistory: any[]): string[] {
  const sections: string[] = [];

  if (context.workoutHistory && context.workoutHistory.length > 0) {
    const totalWorkouts = context.workoutHistory.length;
    const recentWorkouts = context.workoutHistory.slice(0, 5).map(w =>
      `- ${w.date?.split('T')[0] || 'Unknown'}: ${w.duration ? w.duration + ' min' : 'Unknown duration'}, ${Array.isArray(w.exercises) ? w.exercises.length : 0} exercises`,
    ).join('\n');
    sections.push(`Lịch sử tập luyện (${totalWorkouts} buổi gần nhất):\n` + recentWorkouts);
  }

  if (context.nutritionHistory && context.nutritionHistory.length > 0) {
    const avgCal = Math.round(
      context.nutritionHistory.slice(0, 7).reduce((s, n) => s + (n.calories || 0), 0) /
        Math.min(context.nutritionHistory.length, 7),
    );
    const avgProtein = Math.round(
      context.nutritionHistory.slice(0, 7).reduce((s, n) => s + (n.protein || 0), 0) /
        Math.min(context.nutritionHistory.length, 7),
    );
    const recentNutrition = context.nutritionHistory.slice(0, 5).map(n =>
      `- ${n.date?.split('T')[0] || 'Unknown'}: ${n.calories || 0} kcal, ${n.protein || 0}g protein`,
    ).join('\n');
    sections.push(
      `Lịch sử dinh dưỡng (TB 7 ngày: ${avgCal} kcal, ${avgProtein}g protein):\n` + recentNutrition,
    );
  }

  const sessionCtx = extractSessionContext(chatHistory);
  if (sessionCtx) sections.push(sessionCtx);

  if (chatHistory && chatHistory.length > 0) {
    const chat = chatHistory
      .slice(0, 5)
      .reverse()
      .map((c) => {
        const q = c.question || '';
        const a = c.answer || '';
        return `User: ${q.length > 120 ? q.slice(0, 120) + '...' : q}\nCoach: ${a.length > 180 ? a.slice(0, 180) + '...' : a}`;
      })
      .join('\n\n');
    sections.push('Lịch sử hội thoại:\n' + chat);
  }

  return sections;
}

function compactRetrieval(result: RetrievalResult): string {
  if (result.isEmpty || result.documents.length === 0) {
    return '- No relevant context retrieved. Use conservative recommendations.';
  }

  // Limit to 3 docs — more context doesn't improve small-model accuracy but increases latency
  return result.documents
    .slice(0, 3)
    .map((doc, idx) => `${idx + 1}. ${doc.pageContent}`)
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
    context: PersonalizationContext,
    retrieval: RetrievalResult,
    recommendation: RecommendationResult,
    responseLanguage: ResponseLanguage,
    chatHistory: any[],
  ): string {
    const profile = context.profile;
    const viRules = [
      'Bạn là AI fitness coach cho người dùng Việt Nam.',
      '',
      'QUY TẮC NGÔN NGỮ:',
      '- Câu trả lời chính bằng tiếng Việt.',
      '- Tên bài tập PHẢI là tên canonical tiếng Anh theo DB Workout Log: ví dụ Bench Press, Cable Triceps Pushdown, One-Arm Dumbbell Overhead Triceps Extension.',
      '- Không dịch tên bài tập sang tiếng Việt, kể cả khi nguồn RAG đang dùng tên tiếng Việt hoặc alias.',
      '- Nếu thấy tên bài tập tiếng Việt trong context, tự map sang tên tiếng Anh chuẩn trước khi trả lời.',
      '- KHÔNG lộ nhãn nội bộ: recomposition, confidence, omnivorous, moderate_volume, strength_retention.',
      '',
      'QUY TẮC COACHING VÀ CẢM XÚC:',
      '- Bắt đầu bằng một câu nhận xét tích cực/cảm thông dựa trên dữ liệu user (ví dụ: "Với 65 kg và mục tiêu giảm mỡ, bạn đang ở điểm khởi đầu rất tốt!").',
      '- Sử dụng ngôn ngữ động viên. Thay "bạn đang làm sai" → "cách hiệu quả hơn là...".',
      '- Nếu user đã đề cập tiến trình trước đó trong hội thoại, ghi nhận sự cố gắng của họ.',
      '- Kết thúc bằng một câu ngắn khích lệ phù hợp mục tiêu (ví dụ: "Kiên trì 4–6 tuần — bạn sẽ thấy kết quả rõ rệt!").',
      '- Nếu user đang gặp khó khăn (chấn thương, thiếu thời gian, thiếu thiết bị), đồng cảm trước khi đưa giải pháp.',
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
      '- Lead with a brief empathetic acknowledgement of the user\'s situation, then deliver the answer immediately.',
      '- Be precise with numbers: always state exact calories, macros, sets, reps.',
      '- Use encouraging language. Instead of "you\'re doing it wrong", say "a more effective approach is...".',
      '- If the user mentions prior progress in this conversation, acknowledge and celebrate their effort.',
      '- End each response with one short motivating sentence aligned to their goal.',
      '- Use **bold** for critical numbers and key terms.',
      '- Add fitness emojis sparingly: 💪 🥗 ⚡ 📊 🎯',
      '- Exercise names must stay in English and should match the Workout Log DB naming exactly.',
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
      ...(() => {
        const sections = formatHistorySections(context, chatHistory);
        return sections.length > 0 ? [...sections, ''] : [];
      })(),
      'Câu hỏi của user:',
      inputQuestion,
      '',
      // Inject extracted constraints so LLM cannot ignore them
      ...(() => {
        const isGeneralKnowledge = intent.routeIntent === 'general_fitness_knowledge';
        if (isGeneralKnowledge) return [];

        const constraints: string[] = [];
        if (recommendation.workout.sessionsPerWeek) {
          constraints.push(`⚠️ CONSTRAINT: Số ngày/tuần = ${recommendation.workout.sessionsPerWeek}. Phải trả đúng ${recommendation.workout.sessionsPerWeek} ngày.`);
        }
        if (intent.minimumExercisesPerDay) {
          constraints.push(`⚠️ CONSTRAINT: Mỗi buổi phải có ÍT NHẤT ${intent.minimumExercisesPerDay} bài tập.`);
        }
        const equipmentList = profile.training.availableEquipment;
        if (equipmentList.length > 0) {
          const eq = equipmentList.map((e) => e.toLowerCase());
          const hasGymAccess = eq.some((e) => /barbell|rack|gym/.test(e));
          if (!hasGymAccess) {
            const hasDumbbell = eq.some((e) => /dumbbell/.test(e));
            const equipmentMsg = hasDumbbell
              ? `Chỉ có thiết bị: ${equipmentList.join(', ')}. TUYỆT ĐỐI không đề xuất bài cần barbell, rack, máy cable, máy gym.`
              : `Tập không thiết bị (${equipmentList.join(', ')}). TUYỆT ĐỐI không đề xuất bài cần barbell, dumbbell, rack, máy cable, máy gym.`;
            constraints.push(`⚠️ CONSTRAINT: ${equipmentMsg}`);
          }
        }
        return constraints.length > 0 ? ['Ràng buộc bắt buộc từ câu hỏi:', ...constraints, ''] : [];
      })(),
      'Hồ sơ user:',
      compactProfile(profile),
      '',
      ...(() => {
        const isGeneralKnowledge = intent.routeIntent === 'general_fitness_knowledge';
        if (isGeneralKnowledge) return [];
        return [
          `Chỉ số tính toán (nguồn sự thật — không được lệch khỏi các con số này):`,
          compactRecommendations(recommendation),
          ''
        ];
      })(),
      '',
      'Tri thức bài tập liên quan:',
      compactRetrieval(retrieval),
      '',
      ...(() => {
        const isMeal = intent.routeIntent === 'meal_plan_request';
        const isInjury = intent.mentionsInjury;
        const isGeneralKnowledge = intent.routeIntent === 'general_fitness_knowledge';

        if (responseLanguage === 'vi') {
          if (isGeneralKnowledge) {
            return [
              'ĐỊNH DẠNG ĐẦU RA BẮT BUỘC (viết bằng tiếng Việt):',
              '⛔ NẾU CÂU HỎI KHÔNG LIÊN QUAN ĐẾN THỂ HÌNH, SỨC KHỎE, DINH DƯỠNG (ví dụ: hỏi về lập trình, toán học, chính trị, v.v.): Hãy từ chối trả lời một cách lịch sự ("Xin lỗi, tôi là trợ lý thể hình nên chỉ hỗ trợ các vấn đề về sức khỏe/tập luyện..."). KHÔNG trả về bất kỳ kế hoạch nào.',
              '',
              'Nếu câu hỏi liên quan đến fitness:',
              '- Trả lời trực tiếp, dựa trên kiến thức thể hình của bạn. CHỈ dùng thông tin RAG nếu nó THỰC SỰ liên quan đến câu hỏi. Bỏ qua RAG nếu không liên quan.',
              '- Chỉ đưa ra lời khuyên cá nhân hóa nếu phù hợp với câu hỏi.',
              '- KHÔNG ép buộc xuất ra bảng lịch tập hay bảng dinh dưỡng nếu câu hỏi chỉ hỏi kiến thức chung.',
              '- Viết theo đoạn văn dễ đọc, dùng markdown cơ bản, không dài dòng.',
            ];
          }

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
          if (isGeneralKnowledge) {
            return [
              'MANDATORY OUTPUT FORMAT (write in English):',
              '⛔ IF THE QUESTION IS NOT RELATED TO FITNESS, HEALTH, OR NUTRITION (e.g., programming, math, politics): Politely decline to answer ("I am a fitness assistant and can only help with health and training matters..."). DO NOT generate any plan.',
              '',
              'If the question is related to fitness:',
              '- Answer directly and clearly, based on sports science and the provided RAG information.',
              '- Provide personalized advice only if it makes sense for the question.',
              '- DO NOT force a workout table or nutrition table unless the user explicitly asks for a full plan.',
              '- Write in easy-to-read paragraphs using basic markdown.',
            ];
          }

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
