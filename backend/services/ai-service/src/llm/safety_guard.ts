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

// ── Off-topic detection ───────────────────────────────────────────────────────
const FITNESS_SIGNALS: RegExp[] = [
  /t[aậ]p|workout|exercise|train|gym|fitness|sport|th[eể]\s*h[iì]nh|the\s*hinh/i,
  /dinh\s*d[uư][oơ]ng|nutrition|meal|protein|calori|carb|fat\b|macro|th[uự]c\s*[dđ][oơ]n|b[uữ]a\s*[aă]n|an\s*u[oố]ng/i,
  /c[aâ]n\s*n[aặ]ng|weight\b|muscle|c[oơ]\s*b[aắ]p|body\s*fat|giam\s*can|tang\s*can|beo\s*phi|giam\s*mo/i,
  /s[uứ]c\s*kh[oỏ]e|health|recovery|ngu\b|sleep\b|suc\s*khoe/i,
  /bmi|bmr|tdee|inbody/i,
  /ch[aâ]n\s*th[uươ][ươ]ng|injury\b|[dđ]au\b|pain\b|dau\s*lung|dau\s*goi/i,
  /bench|squat|deadlift|plank|push.?up|pull.?up|curl\b|press\b|lunge|burpee|dips?\b/i,
  /cardio|ch[aạ]y\b|run\b|swim\b|b[oơ]i\b|yoga|pilates|hiit/i,
  /supplement|whey|creatine|bcaa|vitamin/i,
  /l[iị]ch\s*t[aậ]p|plan\s*t[aậ]p|ch[uươ]ng\s*tr[iì]nh|buoi\s*tap|bai\s*tap/i,
  /\bset[s]?\b|rep[s]?\b|hi[eệ]p\b|ngh[iỉ]\b|rest\s*time/i,
  /\bkg\b|kcal\b|cu[oờ]ng\s*[dđ][oộ]/i,
];

const OFF_TOPIC_PATTERNS: RegExp[] = [
  /\b(javascript|typescript|python|react|nodejs|html|css|sql|docker|kubernetes|git\b|github|algorithm|frontend|backend|devops|api\s+key|deploy|server|database\s+(?!thể hình|fitness|exercise))\b/i,
  /\b(chinh tri|political|election|bau cu|president|government|war|chien tranh|tin tuc|stock market|crypto|bitcoin|invest|finance)\b/i,
  /\b(phim\b|movie|nhac|music\s+(?!therapy)|game(?!\s*thể|fitness)|nha hang|restaurant|travel|du lich|visa|hotel)\b/i,
  /\b(toan hoc|math(?!ematical exercise)|physics|vat li|chemistry|hoa hoc|history|lich su|literature|van hoc|luat phap|philosophy)\b/i,
  /\b(tinh yeu|love\s+(?!of training)|dating|romantic|quan he\s+(?!tinh)|marriage|cuoi|divorce|ly hon|girlfriend|boyfriend)\b/i,
];

function hasFitnessSignal(question: string): boolean {
  return FITNESS_SIGNALS.some((p) => p.test(question));
}

function isDefinitelyOffTopic(question: string): boolean {
  if (hasFitnessSignal(question)) return false;
  return OFF_TOPIC_PATTERNS.some((p) => p.test(question));
}

function detectMedicalEmergency(question: string): boolean {
  return MEDICAL_PATTERNS.some((p) => p.test(question));
}

// ── Exported types ────────────────────────────────────────────────────────────
export type SafetyResult =
  | { type: "safe" }
  | { type: "unsafe_weight_loss"; guidance: UnsafeGuidance }
  | { type: "medical_emergency"; messageVi: string; messageEn: string }
  | { type: "off_topic"; messageVi: string; messageEn: string };

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
