/**
 * "Tôi muốn giảm cân, bây giờ nên làm gì?" / "vừa giảm cân vừa tăng cơ thì tập như thế nào?" — a question about the DIRECTION to take, not a
 * request to build a schedule. Reviewer feedback (persona playground v2): the AI answered with a full generated schedule/plan; the reviewer
 * wanted two directions to choose from (how to lift, how much cardio), how to adapt them to the person's situation (age, busy/free time),
 * and then a question whether to create the schedule.
 *
 * Deterministic and profile-aware; promises nothing it cannot do (it only offers to create the plan, as a draft that needs confirmation).
 */
import { normalizeAgentText } from "./fitness-agent-intent";

export type DirectionGoal = "fat_loss" | "recomp" | "muscle_gain";

const FAT_LOSS = /\b(giam can|giam mo|giam beo|sieu|cat mo|lean|xuong can)\b/;
const MUSCLE = /\b(tang co|tang bap|len co|xay co|bulk|bulking)\b/;
const RECOMP = /\b(vua giam (?:can|mo|beo) vua tang co|vua tang co vua giam (?:can|mo|beo)|tai cau truc|recomp|recomposition|giam mo (?:va|ma|dong thoi) tang co|giam can (?:va|ma|dong thoi) tang co|vua giam vua tang)\b/;
// A real question about how to go about it ("nên làm gì", "tập như thế nào", "bắt đầu thế nào")...
const ASK = /\b(nen lam gi|lam gi bay gio|lam gi tiep|tap nhu the nao|tap the nao|tap sao|tap ra sao|nen tap nhu|nen tap the|tap kieu gi|huong di|cach nao|lam sao|lam the nao|bat dau the nao|nen bat dau|nen the nao|the nao|ra sao)\b/;
// ...that is NOT a build/nutrition/measurement request (those have their own flows).
const OTHER_FLOW = /\b(tao|lap|len|xay dung|thiet ke|doi|sua) (?:cho toi )?(?:lich|lo trinh|thuc don|ke hoach|plan|roadmap)\b|\b(an gi|thuc don|calo|kcal|protein|dam|bua an|bua sang|bua trua|bua toi)\b|\blich tap\b|\d+\s*(?:kg|buoi|phut|tuan)\b/;

export function detectDirectionGoal(rawText: string): DirectionGoal | null {
  if (!/[a-z]/i.test(rawText)) return null;
  const s = normalizeAgentText(rawText);
  if (s.split(" ").length > 40) return null;
  if (!ASK.test(s) && !/\bnen lam\b/.test(s)) return null;
  if (OTHER_FLOW.test(s)) return null;
  // A question about the EFFECT of something ("Rượu bia ảnh hưởng thế nào đến việc tập luyện và giảm mỡ?") is knowledge, not a
  // request for a training direction (expert human review H01, 2026-11-08: it got "Có 2 hướng phổ biến…" — scored 1/5).
  if (/\b(anh huong|tac dong|tac hai|co hai|loi ich|tac dung)\b/.test(s)) return null;
  if (RECOMP.test(s)) return "recomp";
  const fat = FAT_LOSS.test(s);
  const muscle = MUSCLE.test(s);
  if (fat && muscle) return "recomp";
  if (fat) return "fat_loss";
  if (muscle) return "muscle_gain";
  return null;
}

export function isDirectionQuestion(rawText: string): boolean {
  return detectDirectionGoal(rawText) !== null;
}

type Level = "beginner" | "experienced";
const levelOf = (rawText: string, experienceLevel?: string | null): Level => {
  const s = normalizeAgentText(rawText);
  if (/\b(da biet tap|tap lau|tap duoc \d+ nam|tap \d+ nam|co kinh nghiem|da tap)\b/.test(s)) return "experienced";
  if (/\b(moi tap|chua biet tap|chua tap|nguoi moi|moi bat dau)\b/.test(s)) return "beginner";
  return experienceLevel === "INTERMEDIATE" || experienceLevel === "ADVANCED" ? "experienced" : "beginner";
};

const CLOSING = [
  "",
  "**Bạn chọn hướng nào?** Nhắn “Hướng A” hoặc “Hướng B” (hoặc cho mình biết bạn có bao nhiêu buổi và bao nhiêu phút mỗi buổi). Sau đó mình sẽ hỏi bạn một câu: **có muốn mình tạo lịch tập (và thực đơn) cho hướng đó không?** — mình chỉ cho bạn xem bản nháp, **chỉ lưu khi bạn xác nhận**.",
];

const ADAPT = [
  "**Điều chỉnh theo hoàn cảnh của bạn:**",
  "- Người bận: 3 buổi toàn thân, 40–45 phút, bài kép (squat, đẩy, kéo) — đều và đủ còn hơn 5 buổi bỏ dở.",
  "- Người rảnh hơn: 4–5 buổi, chia upper/lower hoặc push/pull/legs, thêm 1–2 buổi cardio nhẹ.",
  "- Người lớn tuổi hoặc mới trở lại tập: bắt đầu 2–3 buổi, tạ nhẹ + đi bộ, tăng dần mỗi 2–3 tuần; ưu tiên khớp khỏe, khởi động kỹ.",
  "- Nếu có đau/chấn thương hoặc bệnh nền: nói với mình để tránh bài không phù hợp, và hỏi bác sĩ trước khi tăng cường độ.",
];

export function buildDirectionAnswer(goal: DirectionGoal, opts: { rawText: string; experienceLevel?: string | null; age?: number | null }): string {
  const level = levelOf(opts.rawText, opts.experienceLevel);
  const lines: string[] = [];
  if (goal === "fat_loss") {
    lines.push(
      level === "experienced"
        ? "Vì bạn đã biết tập, mục tiêu giảm cân nên giữ cơ và giảm mỡ. Có **2 hướng** phổ biến:"
        : "Giảm cân bền vững gồm 3 phần: **ăn thâm hụt vừa phải**, **tập kháng lực** để giữ cơ và **vận động/cardio**. Có **2 hướng** để chọn:",
      "",
      "**Hướng A — Ưu tiên tạ, cardio nhẹ (giữ cơ tốt nhất)**",
      "- Tạ: 3–4 buổi/tuần (toàn thân hoặc upper/lower), 45–60 phút, giữ mức tạ, tăng dần số lần.",
      "- Cardio: 2–3 buổi đi bộ nhanh/đạp xe nhẹ 20–40 phút, hoặc 8.000–10.000 bước mỗi ngày.",
      "- Hợp với: người đã tập tạ, muốn thân hình săn chắc, có 4–5 buổi/tuần.",
      "",
      "**Hướng B — Ưu tiên cardio, tạ tối thiểu (dễ theo, ít thời gian)**",
      "- Cardio: 3–4 buổi 30–45 phút (đi bộ dốc, đạp xe, bơi; thêm 1 buổi biến tốc ngắn nếu khỏe).",
      "- Tạ: 2 buổi toàn thân 30–40 phút để không mất cơ.",
      "- Hợp với: người mới, bận rộn, hoặc khớp còn yếu.",
      "",
      "Lưu ý thực tế: không thể giảm mỡ riêng một vùng; tốc độ hợp lý là khoảng 0,3–0,7 kg/tuần.",
    );
  } else if (goal === "recomp") {
    lines.push(
      "Vừa giảm mỡ vừa tăng cơ (tái cấu trúc cơ thể) làm được, nhất là với người **mới tập, đang thừa mỡ hoặc mới tập lại** — nhưng chậm hơn từng mục tiêu riêng. Có **2 hướng**:",
      "",
      "**Hướng A — Làm đồng thời (ăn quanh mức duy trì)**",
      "- Tạ: 3–4 buổi/tuần toàn thân hoặc upper/lower, tăng tạ/lần đều đặn; đạm cao khoảng 1,6–2,2 g/kg.",
      "- Cardio nhẹ 2 buổi hoặc đi bộ hằng ngày.",
      "- Hợp với: người mới/tập lại hoặc đang có mỡ thừa. Số cân có thể ít đổi nhưng vòng eo và sức mạnh cải thiện.",
      "",
      "**Hướng B — Chia giai đoạn (rõ ràng hơn, hợp người đã tập lâu)**",
      "- 8–12 tuần giảm mỡ nhẹ (giữ cơ), rồi 8–12 tuần tăng cơ với thặng dư nhỏ; lặp lại.",
      "- Mỗi giai đoạn chỉ ưu tiên một mục tiêu nên số liệu dễ theo dõi.",
      "- Hợp với: người đã tập 1–2 năm trở lên, đã khó tiến bộ nếu ăn ở mức duy trì.",
      "",
      level === "experienced" ? "Với kinh nghiệm của bạn, hướng B thường hiệu quả hơn; hướng A phù hợp nếu bạn vừa nghỉ tập lâu." : "Vì bạn còn mới, hướng A thường hợp lý hơn và đơn giản hơn.",
    );
  } else {
    lines.push(
      "Tăng cơ cần **tập kháng lực đủ tăng tiến**, **ăn thặng dư nhẹ** (khoảng +200–400 kcal) và **ngủ đủ**. Có **2 hướng**:",
      "",
      "**Hướng A — Toàn thân 3 buổi/tuần (gọn, dễ theo)**",
      "- 45–60 phút/buổi, bài kép là chính, tăng tạ hoặc số lần mỗi tuần.",
      "- Cardio nhẹ 1–2 buổi để giữ sức bền.",
      "",
      "**Hướng B — Chia nhóm cơ 4–5 buổi/tuần (nhiều khối lượng hơn)**",
      "- Upper/lower hoặc push/pull/legs, 50–70 phút/buổi.",
      "- Hợp với người đã tập vài tháng và có thời gian ổn định.",
    );
  }
  lines.push("", ...ADAPT, ...CLOSING);
  return lines.join("\n");
}

/** "Hướng A", "chọn hướng B, 4 buổi, 60 phút" — the reply to the two-direction guide above. */
export function parseDirectionChoice(rawText: string): { option: "A" | "B"; daysPerWeek?: number; sessionMinutes?: number } | null {
  const s = normalizeAgentText(rawText);
  if (s.split(" ").length > 14) return null;
  const m = s.match(/^(?:vay |ok |oke |uh |the |a |chon |lay |theo |minh chon |toi chon )*huong ([ab])\b/);
  if (!m) return null;
  const days = s.match(/(\d)\s*(?:buoi|ngay)\b/);
  const mins = s.match(/(\d{2,3})\s*(?:phut|p|min)\b/);
  return {
    option: m[1].toUpperCase() as "A" | "B",
    ...(days ? { daysPerWeek: Number(days[1]) } : {}),
    ...(mins ? { sessionMinutes: Number(mins[1]) } : {}),
  };
}

/** The create-schedule request that continues the chosen direction (missing numbers are asked by the normal workflow). */
export function questionForDirectionChoice(c: { daysPerWeek?: number; sessionMinutes?: number }): string {
  const parts = ["Tạo lịch tập cho tôi"];
  if (c.daysPerWeek) parts.push(`${c.daysPerWeek} buổi mỗi tuần`);
  if (c.sessionMinutes) parts.push(`mỗi buổi ${c.sessionMinutes} phút`);
  return parts.join(", ");
}
