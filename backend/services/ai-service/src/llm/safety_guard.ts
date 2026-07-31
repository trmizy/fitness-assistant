import type { UnsafeGuidance } from "./types";

// ── Rapid / extreme weight-loss ───────────────────────────────────────────────
function detectUnsafeWeightLoss(question: string): boolean {
  const q = question.toLowerCase();
  const numericRapidPattern =
    /(giam|lose).{0,20}(\d{1,2})\s*kg.{0,20}(1\s*(tuan|week)|[1-7]\s*(ngay|day))/i;
  const extremePattern =
    /(cuc doan|extreme|nhin an|fasting[^\n]{0,20}(day|ngay)|rapid weight loss)/i;
  return numericRapidPattern.test(q) || extremePattern.test(q);
}

// ── Medical emergency symptoms ────────────────────────────────────────────────
const MEDICAL_PATTERNS: RegExp[] = [
  /\bđau ngực\b|dau nguc\b|chest pain|chest tightness|tức ngực/i,
  /khó thở đột ngột|sudden.*short.*breath|can't breathe|không thở được/i,
  /ngất xỉu|ngat xiu|\bfaint(ing)?\b|passed? out|blackout|mất ý thức/i,
  /đau tim|dau tim|heart attack|cardiac arrest|trụy tim/i,
  /rối loạn ăn uống|roi loan an uong|anorexia|bulimia|binge.eat.*disorder/i,
  /\btự làm hại\b|tu lam hai|self.?harm|hurt\s+(my)?self|tự tổn thương/i,
];

// ── Performance-enhancing drugs (steroids/SARMs/growth hormone) ─────────────
// Narrow to actual PED substances + dosing/cycle language, so it doesn't
// collide with legitimate supplement questions (creatine/whey/BCAA are
// already treated as safe fitness anchors elsewhere in this file).
function detectPedRequest(question: string): boolean {
  const q = question.toLowerCase();
  // Deliberately no bare "tren" alias for trenbolone — that's also the common
  // Vietnamese word for "above/on" (e.g. "quy tắc ở trên") and would false-fire
  // on completely unrelated sentences. Require the full substance name instead.
  const substancePattern =
    /\b(steroid|anabolic|sarms?|trenbolone|dianabol|anadrol|winstrol|deca.?durabolin|clenbuterol|hgh|growth hormone|testosterone\s*(injection|cycle|enanthate|cypionate)|hormone\s*tang\s*truong|steroid\s*(dong hoa|tang co))\b/i;
  const requestPattern =
    /(lieu dung|liều dùng|dosage|dose|cycle|pct\b|post cycle|stack|mua o dau|where to buy|nen dung|should i (take|use)|cach su dung|how to (use|take))/i;
  return substancePattern.test(q) && (requestPattern.test(q) || substancePattern.test(q));
}

// ── Extreme/dangerously-low-calorie diet requests ────────────────────────────
// Deliberately narrow to REQUEST phrasing with a concrete very-low number, to
// avoid false-blocking legitimate discussion ("tại sao 800 calo nguy hiểm?").
function detectExtremeCalorieRequest(question: string): boolean {
  const q = question.toLowerCase();
  // \b before the digit group is required — without it, `\d{2,3}` can match a
  // trailing substring of a larger number (e.g. "500" out of "1500"),
  // wrongly flagging a normal 1500 kcal request as extreme.
  const lowCalorieNumber = /\b(\d{1,4})\s*(kcal|calo|calories?)\b/i.exec(q);
  if (!lowCalorieNumber) return false;
  const amount = Number(lowCalorieNumber[1]);
  if (!Number.isFinite(amount) || amount >= 800) return false;
  const requestPattern =
    /(thuc don|thực đơn|meal plan|an|ăn|eat|nhin an|nhịn ăn|diet|khau phan|khẩu phần|cho toi|give me|toi muon|i want|nen an|should i eat)/i;
  return requestPattern.test(q);
}

// ── Jailbreak / prompt-injection attempts ─────────────────────────────────────
function detectPromptInjection(question: string): boolean {
  const q = question.toLowerCase();
  const patterns: RegExp[] = [
    // `*` (not `?`) on the qualifier group — real jailbreak phrasing often
    // stacks multiple qualifiers ("ignore all previous instructions"), and a
    // single-optional-word group only matches one of them, missing the rest.
    /ignore\s+(?:all\s+|previous\s+|above\s+|prior\s+|these\s+)*instructions?/i,
    /bo qua\s+(?:moi\s+|tat ca\s+|cac\s+)*(quy tac|huong dan|rule|instruction)/i,
    /you are now\b|from now on you (are|will)/i,
    /act as\s+(dan\b|an? unrestricted|a different ai|jailbreak)/i,
    /reveal\s+your\s+(system\s+)?prompt/i,
    /(cho toi xem|show me|what is)\s+.{0,15}(system prompt|prompt goc|instructions? goc)/i,
    /pretend\s+(you have no|there are no)\s+(restrictions|rules|limits|guidelines)/i,
    /bypass\s+(your\s+|all\s+)?(safety|restrictions|rules|filters?)/i,
    /gia vo\s+(khong co|ban khong co)\s+(gioi han|quy tac|rule)/i,
  ];
  return patterns.some((p) => p.test(q));
}

// ── Off-topic detection ───────────────────────────────────────────────────────
const OFF_TOPIC_PATTERNS: RegExp[] = [
  /\b(javascript|typescript|python|react|nodejs|html|css|sql|docker|kubernetes|git\b|github|algorithm|frontend|backend|devops|api\s+key|deploy|server|database\s+(?!thể hình|fitness|exercise))\b/i,
  /\b(chinh tri|political|election|bau cu|president|government|war|chien tranh|tin tuc|stock market|crypto|bitcoin|invest|finance)\b/i,
  /\b(phim\b|movie|nhac|music\s+(?!therapy)|game(?!\s*thể|fitness)|nha hang|restaurant|travel|du lich|visa|hotel)\b/i,
  /\b(toan hoc|math(?!ematical exercise)|physics|vat li|chemistry|hoa hoc|history|lich su|literature|van hoc|luat phap|philosophy)\b/i,
  /\b(tinh yeu|love\s+(?!of training)|dating|romantic|quan he\s+(?!tinh)|marriage|cuoi|divorce|ly hon|girlfriend|boyfriend)\b/i,
];

// Fitness anchors specific enough that their presence reliably means the
// message is fitness-related even when it also contains
// an off-topic-sounding word (e.g. "lịch tập" vs. a bare "kg" or "BMI",
// which show up in plenty of non-fitness questions too, e.g.
// "BMI của thuật toán này là gì" is not actually a fitness question).
// Only STRONG anchors are allowed to override an off-topic match; weak/
// ambiguous tokens are not — this is what keeps the bot "purely gym": a
// message can't dodge the off-topic gate by sneaking in one vague word.
const STRONG_FITNESS_SIGNALS: RegExp[] = [
  /t[aậ]p\s*gym|\bgym\b|workout|exercise|train(ing)?\b|th[eể]\s*h[iì]nh|the\s*hinh/i,
  /dinh\s*d[uư][oơ]ng|nutrition|protein|th[uự]c\s*[dđ][oơ]n|b[uữ]a\s*[aă]n|an\s*u[oố]ng/i,
  /giam\s*can|tang\s*can|giam\s*mo|beo\s*phi|c[oơ]\s*b[aắ]p|muscle|body\s*fat/i,
  /bench|squat|deadlift|plank|push.?up|pull.?up|curl\b|press\b|lunge|burpee|dips?\b/i,
  /cardio|yoga|pilates|hiit/i,
  /supplement|whey|creatine|bcaa/i,
  /l[iị]ch\s*t[aậ]p|ch[uươ]ng\s*tr[iì]nh\s*t[aậ]p|buoi\s*tap|bai\s*tap/i,
  /ch[aâ]n\s*th[uươ][ươ]ng|injury\b|dau\s*lung|dau\s*goi|dau\s*vai/i,
];

function hasStrongFitnessSignal(question: string): boolean {
  return STRONG_FITNESS_SIGNALS.some((p) => p.test(question));
}

function isDefinitelyOffTopic(question: string): boolean {
  const matchesOffTopic = OFF_TOPIC_PATTERNS.some((p) => p.test(question));
  if (!matchesOffTopic) return false;
  // Mixed message (both an off-topic term and a fitness term). Only let it
  // through if a STRONG, unambiguous fitness anchor is present — a weak
  // signal alone (e.g. just "kg" or "BMI") must not be enough to bypass
  // the off-topic gate.
  return !hasStrongFitnessSignal(question);
}

function detectMedicalEmergency(question: string): boolean {
  return MEDICAL_PATTERNS.some((p) => p.test(question));
}

// ── Exported types ────────────────────────────────────────────────────────────
export type SafetyResult =
  | { type: "safe" }
  | { type: "unsafe_weight_loss"; guidance: UnsafeGuidance }
  | { type: "medical_emergency"; messageVi: string; messageEn: string }
  | { type: "off_topic"; messageVi: string; messageEn: string }
  | { type: "unsafe_ped_request"; messageVi: string; messageEn: string }
  | {
      type: "unsafe_extreme_calorie_request";
      messageVi: string;
      messageEn: string;
    }
  | { type: "prompt_injection_attempt"; messageVi: string; messageEn: string };

// ── Public API ────────────────────────────────────────────────────────────────
export const safetyGuard = {
  /** Backward-compatible single-purpose check for rapid weight loss. */
  evaluate(question: string): UnsafeGuidance | undefined {
    if (!detectUnsafeWeightLoss(question)) return undefined;
    return {
      blocked: true,
      reason:
        "Mục tiêu giảm cân quá nhanh có thể gây mất cơ, rối loạn điện giải và ảnh hưởng tim mạch.",
      safeAlternative:
        "Mục tiêu an toàn hơn là giảm khoảng 0.3-0.8 kg mỗi tuần, kết hợp tập sức mạnh và điều chỉnh calo vừa phải.",
      firstWeekSteps: [
        "Đặt mục tiêu giảm 0.5 kg trong tuần đầu.",
        "Giảm 300-500 kcal mỗi ngày từ tổng khẩu phần hiện tại.",
        "Tập tạ 3-4 buổi và đi bộ nhanh 20-30 phút, 4-5 buổi mỗi tuần.",
        "Ngủ 7-8 giờ mỗi đêm và theo dõi cân nặng 2-3 lần mỗi tuần.",
      ],
    };
  },

  /** Full safety gate — runs before any network I/O in the orchestrator. */
  check(question: string): SafetyResult {
    if (detectUnsafeWeightLoss(question)) {
      const guidance = this.evaluate(question)!;
      return { type: "unsafe_weight_loss", guidance };
    }

    if (detectMedicalEmergency(question)) {
      return {
        type: "medical_emergency",
        messageVi: [
          "## ⚠️ Cần Tham Khảo Ý Kiến Bác Sĩ",
          "",
          "Mình là **AI Fitness Coach** và không thể tư vấn về các triệu chứng y tế như đau ngực, khó thở đột ngột, ngất xỉu, hoặc chấn thương nghiêm trọng.",
          "",
          "🏥 **Hành động ngay:**",
          "- Nếu đây là tình trạng khẩn cấp, hãy gọi **115** (cấp cứu) ngay lập tức.",
          "- Nếu triệu chứng ổn hơn, hãy đặt lịch khám với bác sĩ trước khi tiếp tục tập luyện.",
          "",
          "Sau khi bác sĩ cho phép, mình rất sẵn lòng giúp bạn xây dựng chương trình tập an toàn và hiệu quả! 💪",
        ].join("\n"),
        messageEn: [
          "## ⚠️ Please Consult a Doctor First",
          "",
          "I am an **AI Fitness Coach** and cannot advise on medical symptoms such as chest pain, sudden shortness of breath, fainting, or serious injuries.",
          "",
          "🏥 **Take action now:**",
          "- If this is an emergency, call emergency services immediately.",
          "- For less urgent symptoms, schedule a doctor appointment before resuming exercise.",
          "",
          "Once you have medical clearance, I'm here to help you build a safe and effective training program! 💪",
        ].join("\n"),
      };
    }

    if (detectPedRequest(question)) {
      return {
        type: "unsafe_ped_request",
        messageVi: [
          "## ⚠️ Mình không thể tư vấn về steroid/PED",
          "",
          "Mình là **AI Fitness Coach** và không thể hướng dẫn liều dùng, chu kỳ, hoặc nguồn mua các chất tăng cường hiệu suất (steroid, SARMs, hormone tăng trưởng...) — những chất này có rủi ro sức khỏe nghiêm trọng và cần được bác sĩ nội tiết giám sát nếu cân nhắc sử dụng.",
          "",
          "💪 Mình rất sẵn lòng giúp bạn xây dựng chương trình tập và dinh dưỡng để tăng cơ **tự nhiên, an toàn và bền vững**.",
        ].join("\n"),
        messageEn: [
          "## ⚠️ I can't advise on steroids/PEDs",
          "",
          "I'm an **AI Fitness Coach** and cannot provide dosing, cycle, or sourcing guidance for performance-enhancing substances (steroids, SARMs, growth hormone, etc.) — these carry serious health risks and require supervision from an endocrinologist if being considered.",
          "",
          "💪 I'm happy to help you build a program for **safe, sustainable, natural** muscle growth instead.",
        ].join("\n"),
      };
    }

    if (detectExtremeCalorieRequest(question)) {
      return {
        type: "unsafe_extreme_calorie_request",
        messageVi: [
          "## ⚠️ Mức calo bạn đề cập quá thấp để an toàn",
          "",
          "Mình không thể lên thực đơn ở mức calo cực thấp (dưới 800 kcal/ngày) vì nguy cơ mất cơ, rối loạn điện giải và ảnh hưởng tim mạch — mức này thường chỉ dùng dưới giám sát y tế chặt chẽ.",
          "",
          "💪 Mình có thể giúp bạn xây dựng mức thâm hụt calo **an toàn và bền vững** (thường không dưới 1200-1500 kcal/ngày tùy thể trạng) để giảm mỡ hiệu quả mà vẫn giữ cơ.",
        ].join("\n"),
        messageEn: [
          "## ⚠️ That calorie target is too low to be safe",
          "",
          "I can't build a meal plan at an extremely low calorie level (under 800 kcal/day) — this carries real risks of muscle loss, electrolyte imbalance, and cardiac strain, and is normally only used under close medical supervision.",
          "",
          "💪 I can help you set a **safe, sustainable** calorie deficit (typically not below 1200-1500 kcal/day depending on your stats) for effective, muscle-preserving fat loss.",
        ].join("\n"),
      };
    }

    if (detectPromptInjection(question)) {
      return {
        type: "prompt_injection_attempt",
        messageVi: [
          "Mình là **AI Fitness Coach** và luôn tuân theo phạm vi tư vấn tập luyện, dinh dưỡng và sức khỏe thể chất — mình không thể bỏ qua hướng dẫn nội bộ hoặc đóng vai trò khác.",
          "",
          "💪 Nếu bạn có câu hỏi về **tập gym, dinh dưỡng, giảm mỡ, tăng cơ, hoặc lịch tập** — mình luôn sẵn sàng!",
        ].join("\n"),
        messageEn: [
          "I'm your **AI Fitness Coach** and I stay within the scope of training, nutrition, and physical-health advice — I can't ignore my internal guidelines or roleplay as something else.",
          "",
          "💪 If you have questions about **workouts, nutrition, fat loss, muscle gain, or training plans** — I am here to help!",
        ].join("\n"),
      };
    }

    if (isDefinitelyOffTopic(question)) {
      return {
        type: "off_topic",
        messageVi: [
          "Mình là **AI Fitness Coach** — chuyên về tập luyện, dinh dưỡng thể thao và sức khỏe thể chất.",
          "",
          "Câu hỏi của bạn có vẻ nằm ngoài lĩnh vực này, nên mình không thể hỗ trợ chính xác được.",
          "",
          "💪 Nếu bạn có câu hỏi về **tập gym, dinh dưỡng, giảm mỡ, tăng cơ, hoặc lịch tập** — mình luôn sẵn sàng!",
        ].join("\n"),
        messageEn: [
          "I'm your **AI Fitness Coach** — specialized in training, sports nutrition, and physical health.",
          "",
          "Your question doesn't seem to be within my area of expertise, so I wouldn't be able to give you reliable information on that topic.",
          "",
          "💪 If you have questions about **workouts, nutrition, fat loss, muscle gain, or training plans** — I am here to help!",
        ].join("\n"),
      };
    }

    return { type: "safe" };
  },
};
