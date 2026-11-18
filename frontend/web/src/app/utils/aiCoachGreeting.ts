/** Signed one-decimal change ("↑ 0.5 kg" / "↓ 1.2 kg") or "" when there is nothing to compare to (AI-01: no "(↑ 0 kg)" next to a missing value). */
const kgChange = (now: unknown, before: unknown): string => {
  const a = Number(now);
  const b = Number(before);
  if (now == null || before == null || !Number.isFinite(a) || !Number.isFinite(b)) return "";
  const d = a - b;
  if (Math.abs(d) < 0.05) return " (không đổi)";
  return ` (${d < 0 ? "↓" : "↑"} ${Math.abs(d).toFixed(1)} kg)`;
};

export const buildInitialCoachText = (latest: any, prev: any): string => {
  const intro = "Xin chào! Tôi là huấn luyện viên AI của bạn. Hôm nay tôi có thể giúp gì?";
  const outro = "Hãy hỏi tôi bất cứ điều gì về tiến trình của bạn!";
  // No InBody result yet: say so plainly instead of printing "---" placeholders with a made-up trend.
  if (!latest) {
    return `${intro}

📊 Bạn chưa có kết quả InBody nào, nên tôi chưa có chỉ số cơ thể để theo dõi. Thêm một kết quả đo trong mục InBody để tôi phân tích tiến trình của bạn.

${outro}`;
  }
  const lines = [
    `- Cân nặng: ${latest.weight} kg${kgChange(latest.weight, prev?.weight)}`,
    `- Cơ: ${latest.muscleMass} kg${kgChange(latest.muscleMass, prev?.muscleMass)}`,
    `- Mỡ cơ thể: ${latest.bodyFatPct}%`,
  ];
  return `${intro}

📊 **Chỉ số mới nhất:**
${lines.join("\n")}

${outro}`;
};
