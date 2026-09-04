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
const CALORIE_REQUEST_PATTERN =
  /(thuc don|thực đơn|meal plan|an|ăn|eat|nhin an|nhịn ăn|diet|khau phan|khẩu phần|cho toi|give me|toi muon|i want|nen an|should i eat|co duoc khong|có được không|co on khong|có ổn không)/i;

function detectExtremeCalorieRequest(question: string): boolean {
  const q = question.toLowerCase();
  // \b before the digit group is required — without it, `\d{2,3}` can match a
  // trailing substring of a larger number (e.g. "500" out of "1500"),
  // wrongly flagging a normal 1500 kcal request as extreme.
  const lowCalorieNumber = /\b(\d{1,4})\s*(kcal|calo|calories?)\b/i.exec(q);
  if (!lowCalorieNumber) return false;
  const amount = Number(lowCalorieNumber[1]);
  if (!Number.isFinite(amount) || amount >= 800) return false;
  return CALORIE_REQUEST_PATTERN.test(q);
}

// ── Severe (but not immediately medical-emergency-level) energy restriction ──
// A real gap found via E2E persona testing (24-ai-nutrition-persona-b-c.spec.ts,
// Persona C — athlete training 6x/week asking to cut to 900 kcal/day "to get
// lean faster"): detectExtremeCalorieRequest above only fires below 800
// kcal (a deliberate VLCD/medical threshold — see its own comment). 800-1199
// kcal/day is not itself an immediate medical emergency, but is still a
// genuinely risky target — especially for someone training frequently — and
// silently treating it as a normal calorie request (handing back a full
// meal plan at that level as if it were fine) is itself the bug. This is a
// DISTINCT, softer-worded tier, not a blanket lowering of the 800 threshold
// (a request under 800 kcal still hits the stronger message above first).
//
// Evidence this tier is grounded in (see docs/nutrition-persona-testing-and-bugfixes-2026-08-20.md):
//   - IOC RED-S 2023 consensus: prolonged low energy availability in athletes
//     causes performance decline, hormonal disruption, and injury risk —
//     even without an eating disorder being present.
//   - ACSM nutrition & athletic performance: nutrition targets must be
//     individualized to training load, not a one-size-fits-all number —
//     900 kcal/day is a materially different risk for someone training
//     5-6x/week than for a sedentary person.
//   - Bodybuilding cutting-phase literature (Helms/Iraki et al.): overly
//     aggressive deficits risk lean-mass loss and performance/recovery
//     decline, favoring a moderate, sustainable deficit instead.
function detectSevereEnergyRestriction(question: string): boolean {
  const q = question.toLowerCase();
  if (!CALORIE_REQUEST_PATTERN.test(q)) return false;

  const calorieMatch = /\b(\d{3,4})\s*(kcal|calo|calories?)\b/i.exec(q);
  const amount = calorieMatch ? Number(calorieMatch[1]) : undefined;
  // Owns exactly the 800-1199 band — sub-800 is detectExtremeCalorieRequest's
  // (more urgent) territory, handled separately and first in check() below.
  const inRiskyCalorieBand =
    amount !== undefined && Number.isFinite(amount) && amount >= 800 && amount < 1200;
  if (inRiskyCalorieBand) return true;

  // No explicit number, but aggressive-cut language combined with an
  // explicitly high training load stated IN THIS MESSAGE. This check runs
  // before profile fetch (fast safety gate, see orchestrator.service.ts's
  // comment on safetyGuard.check placement), so it can only see what's in
  // the question text itself — not the user's saved training-frequency
  // profile field.
  const aggressiveLanguage =
    /(c[aắ]t.{0,10}(calo|kcal).{0,10}m[aạ]nh|nhịn ăn|nhin an|ăn càng ít càng tốt|an cang it cang tot|nét (cơ )?nhanh|net (co )?nhanh|siết calo|siet calo|extremely low.calorie|cut.{0,5}hard)/i.test(
      q,
    );
  const mentionsHighTrainingLoad =
    // "6 buổi/tuần", "6 buổi mỗi tuần", "6 buổi 1 tuần" — same optional
    // `\d+\s*` allowance between the count and "tuần" that
    // intent_router.ts's own frequency_change_request pattern uses, for
    // "N buổi 1 tuần"-style phrasing.
    /\b[5-7]\s*(bu[oổ]i|sessions?|days?|ng[aà]y)\s*[/]?\s*(?:\d+\s*)?(m[oỗ]i\s*)?(tu[aầ]n|week)/i.test(
      q,
    ) ||
    /(t[aậ]p n[aặ]ng|intense training|athlete|v[aậ]n [dđ][oộ]ng vi[eê]n)/i.test(
      q,
    );
  return aggressiveLanguage && mentionsHighTrainingLoad;
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

// ── Medical-condition nutrition triage (Part 9) ──────────────────────────────
// A message that names a serious medical condition (kidney/liver/heart
// disease, diabetes, eating-disorder history) alongside a nutrition
// question (how much protein, what diet, is this plan safe) must never get
// a personalized numeric recommendation as if the person were healthy —
// nutrient needs for these conditions genuinely differ and require
// clinician oversight. This is a support-and-refer response, not a
// diagnosis, and it is checked BEFORE the general nutrition pipeline runs
// so no downstream calculator/LLM path can override it.
const MEDICAL_CONDITION_PATTERNS: RegExp[] = [
  /bệnh thận|benh than|suy thận|suy than|thận yếu|than yeu|chạy thận|chay than|kidney disease|renal (disease|failure|impairment)|dialysis/i,
  /bệnh gan|benh gan|suy gan|suy gan|xơ gan|xo gan|viêm gan|viem gan|liver disease|hepatic (disease|failure|impairment)/i,
  /bệnh tim|benh tim|suy tim|suy tim|tim mạch\b.{0,10}(bệnh|benh)|heart disease|cardiac (disease|failure|condition)/i,
  /tiểu đường|tieu duong|đái tháo đường|dai thao duong|diabetes|diabetic/i,
];

const NUTRITION_ADVICE_PATTERNS: RegExp[] =
  [
    /protein|đạm|dam\b|carb|calo|calories|macro|dinh dưỡng|dinh duong|thực đơn|thuc don|chế độ ăn|che do an|khẩu phần|khau phan|nên ăn|nen an/i,
  ];

function detectMedicalNutritionCondition(question: string): boolean {
  const hasCondition = MEDICAL_CONDITION_PATTERNS.some((p) => p.test(question));
  if (!hasCondition) return false;
  return NUTRITION_ADVICE_PATTERNS.some((p) => p.test(question));
}

// ── Additional Part 9 red flags ──────────────────────────────────────────────
// Each detector below is deliberately narrow (specific disclosure/request
// phrasing, not a bare topic word) to keep false-positive risk low while
// still catching the concrete red flags the spec names.

// Minor age disclosed alongside a nutrition/training request — pediatric
// nutrition/training needs differ substantially from adult guidance and
// this app is not designed/validated for that population.
function detectMinorAge(question: string): boolean {
  const q = question.toLowerCase();
  const ageMatch = /\b(\d{1,2})\s*tuổi\b|\btuổi\b.{0,5}(\d{1,2})\b|\b(\d{1,2})\s*years?\s*old\b/i.exec(
    q,
  );
  if (!ageMatch) return false;
  const age = Number(ageMatch[1] ?? ageMatch[2] ?? ageMatch[3]);
  if (!Number.isFinite(age) || age <= 0 || age >= 18) return false;
  return NUTRITION_ADVICE_PATTERNS.some((p) => p.test(q)) || /tập|workout|training|gym/i.test(q);
}

// Pregnancy / breastfeeding — nutrient needs (calories, specific nutrients,
// safe exercise intensity) differ and require OB/dietitian guidance.
function detectPregnancyOrBreastfeeding(question: string): boolean {
  const q = question.toLowerCase();
  return /mang thai|có thai|co thai|đang bầu|dang bau|thai kỳ|thai ky|pregnant|pregnancy|cho con bú|cho con bu|đang cho bú|breastfeeding|nursing (a )?baby/i.test(
    q,
  );
}

// Eating-disorder disclosure — carved out from the acute MEDICAL_PATTERNS
// bucket (which is tuned for "call emergency services now" crises) into its
// own supportive, non-emergency-toned response, since "tôi có rối loạn ăn
// uống, giúp tôi lên thực đơn giảm cân" is a disclosure needing a
// specialist referral, not a 115-call.
function detectEatingDisorderDisclosure(question: string): boolean {
  const q = question.toLowerCase();
  return /rối loạn ăn uống|roi loan an uong|chứng biếng ăn|chung bieng an|anorexia|bulimia|binge.eat.*disorder|chán ăn tâm thần|chan an tam than/i.test(
    q,
  );
}

// Purge behavior, laxative/diuretic misuse for weight loss, or unprescribed
// weight-loss drug requests — distinct from the PED gate (which is about
// muscle-building steroids/SARMs), this is about disordered-eating-adjacent
// or unsafe weight-loss-drug behavior.
function detectPurgeOrUnsafeWeightLossBehavior(question: string): boolean {
  const q = question.toLowerCase();
  const purgePattern =
    /nôn sau khi ăn|non sau khi an|purge (after|to lose)|self.?induced vomiting|gây nôn|gay non/i;
  const laxativeDiureticPattern =
    /thuốc nhuận tràng.{0,20}(giảm cân|giam can)|laxatives?.{0,20}(weight loss|lose weight)|thuốc lợi tiểu.{0,20}(giảm cân|giam can)|diuretics?.{0,20}(weight loss|lose weight)/i;
  const dietPillPattern =
    /thuốc giảm cân|thuoc giam can|diet pills?|weight.?loss (pills?|drugs?)|thuốc giảm mỡ|thuoc giam mo/i;
  return (
    purgePattern.test(q) || laxativeDiureticPattern.test(q) || dietPillPattern.test(q)
  );
}

// Severe/anaphylaxis-level allergy — deliberately narrow to explicit
// severe-reaction language, not a bare "dị ứng sữa" (mild food preference/
// restriction, handled as a normal dietary constraint elsewhere).
function detectSevereAllergy(question: string): boolean {
  const q = question.toLowerCase();
  return /sốc phản vệ|soc phan ve|anaphyla(xis|ctic)|dị ứng nặng|di ung nang|severe (food )?allergy|life.?threatening allergy/i.test(
    q,
  );
}

// Prolonged very-low-calorie intake DISCLOSURE (not a request — the
// existing detectExtremeCalorieRequest only catches "give me a plan at
// X kcal"; this catches "I'm currently only eating X kcal").
function detectProlongedExtremeCalorieDisclosure(question: string): boolean {
  const q = question.toLowerCase();
  const lowCalorieNumber = /\b(\d{1,4})\s*(kcal|calo|calories?)\b/i.exec(q);
  if (!lowCalorieNumber) return false;
  const amount = Number(lowCalorieNumber[1]);
  if (!Number.isFinite(amount) || amount >= 800) return false;
  const disclosurePattern =
    /(đang ăn|dang an|hiện tại.{0,10}ăn|hien tai.{0,10}an|chỉ ăn|chi an|currently eat|i('m| am) (only )?eating|i only eat)/i;
  return disclosurePattern.test(q);
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
  | {
      type: "severe_energy_restriction_warning";
      messageVi: string;
      messageEn: string;
    }
  | { type: "prompt_injection_attempt"; messageVi: string; messageEn: string }
  | { type: "medical_nutrition_condition"; messageVi: string; messageEn: string }
  | { type: "minor_age_nutrition_request"; messageVi: string; messageEn: string }
  | { type: "pregnancy_or_breastfeeding_nutrition_request"; messageVi: string; messageEn: string }
  | { type: "eating_disorder_disclosure"; messageVi: string; messageEn: string }
  | { type: "unsafe_weight_loss_behavior"; messageVi: string; messageEn: string }
  | { type: "severe_allergy_disclosure"; messageVi: string; messageEn: string }
  | { type: "prolonged_extreme_calorie_disclosure"; messageVi: string; messageEn: string };

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

    if (detectMedicalNutritionCondition(question)) {
      return {
        type: "medical_nutrition_condition",
        messageVi: [
          "## ⚠️ Cần bác sĩ/chuyên gia dinh dưỡng lâm sàng tư vấn trực tiếp",
          "",
          "Mình là **AI Fitness Coach** cho người tập luyện khỏe mạnh, không phải bác sĩ hay chuyên gia dinh dưỡng lâm sàng — với các bệnh lý như thận, gan, tim mạch, hoặc tiểu đường, nhu cầu protein/carb/chất béo có thể khác đáng kể so với người khỏe mạnh (ví dụ: protein cao có thể gây thêm gánh nặng cho thận đang suy yếu) và cần bác sĩ điều trị hoặc chuyên gia dinh dưỡng lâm sàng cá nhân hóa dựa trên xét nghiệm thực tế của bạn.",
          "",
          "🏥 Mình khuyến nghị bạn trao đổi với bác sĩ đang điều trị hoặc một chuyên gia dinh dưỡng lâm sàng trước khi thay đổi lượng protein hoặc chế độ ăn.",
          "",
          "💪 Nếu bác sĩ đã cho phép một khoảng dinh dưỡng cụ thể, mình rất sẵn lòng giúp bạn lên thực đơn tập luyện phù hợp trong khoảng đó.",
        ].join("\n"),
        messageEn: [
          "## ⚠️ This needs direct guidance from your doctor or a clinical dietitian",
          "",
          "I'm an **AI Fitness Coach** for generally healthy people training in the gym — not a doctor or clinical dietitian. With conditions like kidney disease, liver disease, heart disease, or diabetes, protein/carb/fat needs can differ significantly from a healthy adult (e.g. high protein intake can add strain to impaired kidneys), and safe targets need to be personalized by your treating physician or a clinical dietitian based on your actual labs.",
          "",
          "🏥 Please check with your doctor or a clinical dietitian before changing your protein intake or diet.",
          "",
          "💪 Once you have a cleared nutrition range from them, I'm glad to help you build a training-compatible meal plan within it.",
        ].join("\n"),
      };
    }

    if (detectMinorAge(question)) {
      return {
        type: "minor_age_nutrition_request",
        messageVi: [
          "## ⚠️ Cần phụ huynh/bác sĩ nhi khoa tư vấn",
          "",
          "Mình là **AI Fitness Coach** được thiết kế và kiểm chứng cho người trưởng thành — nhu cầu dinh dưỡng và tập luyện ở tuổi vị thành niên khác biệt đáng kể (ảnh hưởng đến tăng trưởng, phát triển xương, dậy thì) và mình không có đủ cơ sở để đưa ra khuyến nghị an toàn cho nhóm tuổi này.",
          "",
          "🏥 Hãy trao đổi với phụ huynh và bác sĩ nhi khoa hoặc chuyên gia dinh dưỡng có kinh nghiệm với trẻ vị thành niên trước khi thay đổi chế độ ăn hoặc tập luyện.",
        ].join("\n"),
        messageEn: [
          "## ⚠️ Please involve a parent/guardian and a pediatrician",
          "",
          "I'm an **AI Fitness Coach** designed and validated for adults — nutrition and training needs during adolescence differ significantly (affecting growth, bone development, puberty) and I don't have a safe basis for recommendations for this age group.",
          "",
          "🏥 Please talk with a parent/guardian and a pediatrician or a dietitian experienced with adolescents before changing diet or training.",
        ].join("\n"),
      };
    }

    if (detectPregnancyOrBreastfeeding(question)) {
      return {
        type: "pregnancy_or_breastfeeding_nutrition_request",
        messageVi: [
          "## ⚠️ Cần bác sĩ sản khoa/chuyên gia dinh dưỡng tư vấn",
          "",
          "Mình là **AI Fitness Coach** cho người tập luyện khỏe mạnh nói chung — nhu cầu calo, vi chất (sắt, canxi, axit folic...), và cường độ tập luyện an toàn trong thai kỳ/cho con bú khác biệt đáng kể theo từng giai đoạn và tình trạng sức khỏe cụ thể, cần bác sĩ sản khoa hoặc chuyên gia dinh dưỡng theo dõi trực tiếp.",
          "",
          "🏥 Hãy trao đổi với bác sĩ sản khoa hoặc chuyên gia dinh dưỡng trước khi thay đổi chế độ ăn hoặc cường độ tập luyện.",
          "",
          "💪 Nếu bác sĩ đã cho phép một khoảng calo/dinh dưỡng và mức độ vận động cụ thể, mình rất sẵn lòng giúp bạn lên lịch tập nhẹ nhàng, an toàn trong khoảng đó.",
        ].join("\n"),
        messageEn: [
          "## ⚠️ Please consult an OB-GYN or a dietitian",
          "",
          "I'm an AI Fitness Coach for the general healthy-adult population — calorie needs, micronutrients (iron, calcium, folic acid...), and safe exercise intensity during pregnancy/breastfeeding differ significantly by stage and individual health status, and need direct guidance from an OB-GYN or dietitian.",
          "",
          "🏥 Please check with your OB-GYN or a dietitian before changing your diet or exercise intensity.",
          "",
          "💪 Once you have a cleared calorie/nutrition range and activity level from them, I'm glad to help build a gentle, safe routine within it.",
        ].join("\n"),
      };
    }

    if (detectEatingDisorderDisclosure(question)) {
      return {
        type: "eating_disorder_disclosure",
        messageVi: [
          "## 💙 Cảm ơn bạn đã chia sẻ",
          "",
          "Mình là **AI Fitness Coach**, không phải chuyên gia sức khỏe tâm thần hay chuyên gia điều trị rối loạn ăn uống — mình không thể an toàn đưa ra kế hoạch giảm cân/hạn chế calo trong tình huống này, vì điều đó có thể ảnh hưởng không tốt đến quá trình hồi phục.",
          "",
          "🏥 Mình khuyến nghị bạn trao đổi với bác sĩ, chuyên gia tâm lý, hoặc chuyên gia dinh dưỡng có kinh nghiệm về rối loạn ăn uống — họ có thể hỗ trợ bạn an toàn và phù hợp nhất.",
          "",
          "💙 Nếu bạn muốn, mình vẫn ở đây để trò chuyện về tập luyện theo hướng tích cực, không tập trung vào cân nặng hay hạn chế calo.",
        ].join("\n"),
        messageEn: [
          "## 💙 Thank you for sharing this",
          "",
          "I'm an AI Fitness Coach, not a mental-health professional or eating-disorder specialist — I can't safely provide a weight-loss or calorie-restriction plan in this situation, as it could negatively affect recovery.",
          "",
          "🏥 I'd recommend speaking with a doctor, therapist, or a dietitian experienced with eating disorders — they can support you safely and appropriately.",
          "",
          "💙 If you'd like, I'm still here to talk about training in a positive way that isn't focused on weight or calorie restriction.",
        ].join("\n"),
      };
    }

    if (detectPurgeOrUnsafeWeightLossBehavior(question)) {
      return {
        type: "unsafe_weight_loss_behavior",
        messageVi: [
          "## ⚠️ Mình không thể hỗ trợ hành vi này",
          "",
          "Mình là **AI Fitness Coach** và không thể hướng dẫn hoặc khuyến khích các hành vi giảm cân nguy hiểm (gây nôn, lạm dụng thuốc nhuận tràng/lợi tiểu, thuốc giảm cân không kê đơn) — những hành vi này có thể gây rối loạn điện giải nghiêm trọng, tổn thương cơ quan, và các rủi ro sức khỏe khác.",
          "",
          "🏥 Nếu bạn đang gặp khó khăn với những hành vi này, hãy trao đổi với bác sĩ hoặc chuyên gia sức khỏe tâm thần càng sớm càng tốt — đây có thể là dấu hiệu cần hỗ trợ chuyên môn.",
          "",
          "💙 Mình rất sẵn lòng giúp bạn xây dựng cách tiếp cận giảm mỡ an toàn, bền vững khi bạn sẵn sàng.",
        ].join("\n"),
        messageEn: [
          "## ⚠️ I can't support this",
          "",
          "I'm an AI Fitness Coach and can't guide or encourage dangerous weight-loss behaviors (self-induced vomiting, laxative/diuretic misuse, unprescribed diet pills) — these can cause serious electrolyte imbalances, organ damage, and other health risks.",
          "",
          "🏥 If you're struggling with these behaviors, please talk with a doctor or mental-health professional as soon as possible — this may be a sign that professional support would help.",
          "",
          "💙 I'm glad to help you build a safe, sustainable approach to fat loss whenever you're ready.",
        ].join("\n"),
      };
    }

    if (detectSevereAllergy(question)) {
      return {
        type: "severe_allergy_disclosure",
        messageVi: [
          "## ⚠️ Cần bác sĩ dị ứng/chuyên gia y tế xác nhận trực tiếp",
          "",
          "Với dị ứng nặng hoặc sốc phản vệ, mình không thể đảm bảo độ chính xác 100% khi lọc thực phẩm chỉ dựa trên tên món trong dữ liệu — rủi ro nhiễm chéo hoặc thành phần ẩn là có thật và nguy hiểm.",
          "",
          "🏥 Hãy luôn tự kiểm tra nhãn thành phần thực tế và tham khảo bác sĩ chuyên khoa dị ứng — đừng chỉ dựa vào danh sách thực đơn AI đề xuất cho vấn đề này.",
        ].join("\n"),
        messageEn: [
          "## ⚠️ Please confirm directly with an allergist/medical professional",
          "",
          "For severe allergies or anaphylaxis risk, I cannot guarantee 100% accuracy filtering foods based only on names in a dataset — cross-contamination or hidden-ingredient risk is real and dangerous.",
          "",
          "🏥 Always verify actual ingredient labels yourself and consult an allergist — please don't rely solely on an AI-suggested meal list for this.",
        ].join("\n"),
      };
    }

    if (detectProlongedExtremeCalorieDisclosure(question)) {
      return {
        type: "prolonged_extreme_calorie_disclosure",
        messageVi: [
          "## ⚠️ Mức calo bạn đang ăn khá thấp",
          "",
          "Ăn ở mức rất thấp (dưới 800 kcal/ngày) trong thời gian dài có thể gây mất cơ, rối loạn điện giải, ảnh hưởng nội tiết, và các rủi ro sức khỏe khác — kể cả khi không phải chủ đích ăn kiêng.",
          "",
          "🏥 Nếu đây không phải do bạn chủ động ăn kiêng, hoặc bạn đã duy trì mức này một thời gian, hãy trao đổi với bác sĩ hoặc chuyên gia dinh dưỡng để kiểm tra sức khỏe tổng quát.",
          "",
          "💪 Nếu bạn muốn tăng dần lên mức an toàn hơn, mình rất sẵn lòng giúp bạn lên kế hoạch tăng calo từ từ, có kiểm soát.",
        ].join("\n"),
        messageEn: [
          "## ⚠️ That's a quite low calorie intake",
          "",
          "Eating at a very low level (under 800 kcal/day) for an extended period can cause muscle loss, electrolyte imbalance, hormonal effects, and other health risks — even if it isn't an intentional diet.",
          "",
          "🏥 If this wasn't an intentional choice, or you've been at this level for a while, please check with a doctor or dietitian for a general health check.",
          "",
          "💪 If you'd like to gradually increase to a safer level, I'm glad to help you build a controlled, gradual calorie increase plan.",
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

    if (detectSevereEnergyRestriction(question)) {
      return {
        type: "severe_energy_restriction_warning",
        messageVi: [
          "## ⚠️ Mức calo này khá rủi ro, đặc biệt nếu bạn đang tập nặng",
          "",
          "Mình không đồng ý với mức calo bạn đang cân nhắc như một kế hoạch bình thường — đây không phải mức cực đoan cần cấp cứu y tế ngay, nhưng vẫn là một mức thâm hụt rất sâu, nhất là nếu bạn đang tập nhiều buổi/tuần.",
          "",
          "**Rủi ro thực tế nếu duy trì lâu:**",
          "- Tụt hiệu suất tập luyện, khó hoàn thành buổi tập như bình thường.",
          "- Mất cơ thay vì chỉ mất mỡ, vì cơ thể không đủ năng lượng để ưu tiên giữ cơ.",
          "- Đói, mệt mỏi kéo dài, khó hồi phục giữa các buổi tập.",
          "- Nguy cơ thiếu năng lượng kéo dài (low energy availability) — có thể ảnh hưởng nội tiết và sức khỏe xương nếu duy trì nhiều tuần.",
          "",
          "**Cách an toàn hơn:**",
          "- Thâm hụt vừa phải (thường không dưới 1200-1500 kcal/ngày tùy thể trạng) thay vì cắt sâu một lần.",
          "- Theo dõi cân nặng trung bình theo TUẦN, không phản ứng theo 1 ngày.",
          "- Giữ protein đủ cao để hạn chế mất cơ; không giảm chất béo xuống quá thấp.",
          "- Nếu bạn đang thi đấu/chuẩn bị giải hoặc cần giảm rất nhanh vì lý do cụ thể, nên có huấn luyện viên hoặc chuyên gia dinh dưỡng thể thao đồng hành thay vì tự làm một mình.",
          "",
          "💪 Mình rất sẵn lòng giúp bạn lên một kế hoạch thâm hụt an toàn và bền vững hơn — vẫn giảm mỡ hiệu quả mà không đánh đổi hiệu suất tập hay khối cơ.",
        ].join("\n"),
        messageEn: [
          "## ⚠️ That calorie target is risky, especially while training hard",
          "",
          "I'm not going to hand you a normal plan at that calorie level — it's not an immediate medical emergency, but it is a very aggressive deficit, especially if you're training multiple sessions a week.",
          "",
          "**Real risks if you keep this up:**",
          "- Training performance drops; harder to complete sessions as normal.",
          "- Muscle loss instead of just fat loss, since the body doesn't have enough energy to prioritize keeping muscle.",
          "- Persistent hunger and fatigue, slower recovery between sessions.",
          "- Risk of prolonged low energy availability — can affect hormones and bone health if kept up for weeks.",
          "",
          "**A safer approach:**",
          "- A moderate deficit (typically not below 1200-1500 kcal/day depending on your stats) instead of cutting hard all at once.",
          "- Track your WEEKLY average weight trend, not day-to-day reactions.",
          "- Keep protein high to limit muscle loss; don't cut fat too low either.",
          "- If you're prepping for a competition or have a specific reason to cut fast, work with a coach or sports dietitian rather than doing it alone.",
          "",
          "💪 I'm glad to help you build a safer, more sustainable deficit plan instead — one that still gets you leaner without sacrificing performance or muscle.",
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
