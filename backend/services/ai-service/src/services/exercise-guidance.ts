/**
 * Reviewer feedback (persona playground v2):
 *  - "Buổi tập đầu tiên tôi sẽ làm những gì? Hướng dẫn từng bước" must guide the user's REAL session (their draft / saved schedule), not an invented
 *    chest-shoulder-triceps workout; and then "bài đó tập sao" / "đổi bài đó" must be answerable.
 *  - "Tập ở nhà không có dụng cụ được không?" must answer the question asked, briefly, with exercises that EXIST in the exercise library and need
 *    no equipment (it had listed an ab wheel).
 *
 * Pure detection/formatting here; the data (draft, schedule, exercise library) is fetched by the agent service.
 */
import { normalizeAgentText } from "./fitness-agent-intent";

// ---------- first session / next session ----------
const SESSION = /\b(buoi tap (?:dau tien|ke tiep|tiep theo|hom nay|sap toi|dau)|bai tap dau tien|tap gi dau tien|bat dau tap tu bai nao)\b/;
const ASK = /\b(lam gi|nhung gi|huong dan|tung buoc|the nao|nhu the nao|ra sao|gom)\b/;
export function isFirstSessionQuestion(rawText: string): boolean {
  if (!/[a-z]/i.test(rawText)) return false;
  const s = normalizeAgentText(rawText);
  return s.split(" ").length <= 30 && SESSION.test(s) && ASK.test(s);
}

// ---------- "how do I do <exercise>" ----------
export function parseExerciseHowTo(rawText: string): string | null {
  const s = normalizeAgentText(rawText).replace(/[?.!,]+$/g, "").trim();
  if (s.split(" ").length > 12) return null;
  const lead = s.match(/^(?:huong dan|cach tap|cach thuc hien|cach lam|chi (?:toi|minh) cach (?:tap|lam))\s+(?:bai\s+)?(.{3,50})$/);
  if (lead) return lead[1].trim();
  const tail = s.match(/^(?:bai\s+)?(.{3,40}?)\s+(?:tap|lam|thuc hien)\s+(?:nhu the nao|the nao|sao|ra sao)$/);
  if (tail && !/\b(buoi|ngay|hom nay|tuan|toi|minh)\b/.test(tail[1])) return tail[1].trim();
  return null;
}

/** First sentences of a catalog instruction, short enough for a chat bubble. */
export function shortInstructions(instructions: string | null | undefined, maxChars = 320): string {
  if (!instructions) return "";
  const flat = instructions.replace(/\s+/g, " ").trim();
  const sentences = flat.split(/(?<=[.!?])\s+/).filter(Boolean);
  let out = "";
  for (const sent of sentences) { if ((out + " " + sent).trim().length > maxChars) break; out = (out + " " + sent).trim(); }
  return out || flat.slice(0, maxChars);
}

export interface GuidedExercise { name: string; sets?: number | null; reps?: number | string | null; restSeconds?: number | null; instructions?: string | null }

export function buildSessionGuidance(opts: { title?: string; source: "DRAFT" | "SAVED"; exercises: GuidedExercise[] }): string {
  const lines: string[] = [];
  lines.push(opts.source === "DRAFT"
    ? `Đây là buổi đầu tiên trong bản nháp lịch tập của bạn${opts.title ? ` (**${opts.title}**)` : ""}. Làm lần lượt như sau:`
    : `Đây là buổi tập sắp tới trong lịch đã lưu của bạn${opts.title ? ` (**${opts.title}**)` : ""}. Làm lần lượt như sau:`);
  lines.push("", "**Khởi động (5–8 phút):** đi bộ nhanh hoặc đạp xe nhẹ, xoay khớp vai–hông–gối, rồi làm 1–2 hiệp nhẹ của bài đầu tiên.", "");
  opts.exercises.forEach((e, i) => {
    const prescription = [e.sets ? `${e.sets} hiệp` : null, e.reps ? `${e.reps}` : null].filter(Boolean).join(" × ");
    lines.push(`${i + 1}. **${e.name}** — ${prescription || "theo lịch"}${e.restSeconds ? `, nghỉ ${e.restSeconds}s` : ""}`);
    const how = shortInstructions(e.instructions, 190);
    if (how) lines.push(`   Cách làm (mô tả gốc của thư viện, tiếng Anh): ${how}`);
  });
  lines.push("", "**Cuối buổi:** giãn nhẹ nhóm cơ vừa tập 3–5 phút, uống nước.",
    "**Chọn mức tạ:** hiệp cuối cùng còn dư khoảng 2 lần thì mức tạ là hợp lý; đau nhói thì dừng bài đó.",
    "", "Muốn xem kỹ một bài? Nhắn “hướng dẫn <tên bài>” (tên trong thư viện là tiếng Anh, ví dụ “hướng dẫn Goblet Squat”). Muốn đổi bài? Nhắn “đổi <tên bài>” khi bản nháp lịch đang mở.");
  return lines.join("\n");
}

export function buildExerciseHowTo(name: string, instructions: string | null | undefined): string {
  const how = shortInstructions(instructions, 600);
  return how
    ? `**${name}** — cách thực hiện (theo thư viện bài tập của app):\n${how}\n\nNếu thấy đau nhói hoặc không giữ được kỹ thuật, giảm tạ hoặc dừng bài đó. Muốn đổi bài này? Nhắn “đổi ${name}” khi bản nháp lịch tập đang mở.`
    : `Mình tìm thấy **${name}** nhưng thư viện chưa có mô tả cách làm. Bạn có thể hỏi huấn luyện viên hoặc xem video của bài trong mục thư viện bài tập.`;
}

// ---------- tập ở nhà / không dụng cụ ----------
// "tay không" (bare-handed) — but not "cổ tay không?" ("…có nên dùng băng cổ tay không?" was answered with a home-workout
// template, eval B4-19 2026-11-11).
const HOME = /\b(o nha|tai nha|khong (?:co )?(?:dung cu|thiet bi|may|ta)|(?<!\bco )tay khong|bodyweight|khong can dung cu|khong dung cu)\b/;
const CAN = /\b(duoc khong|duoc ko|co duoc|co the .* khong|co nen .* khong|lam duoc)\b/;
export function isHomeNoEquipmentQuestion(rawText: string): boolean {
  if (!/[a-z]/i.test(rawText)) return false;
  const s = normalizeAgentText(rawText);
  if (s.split(" ").length > 30) return false;
  return HOME.test(s) && CAN.test(s) && !/\b(tao|lap|len)\b.*\b(lich|ke hoach|lo trinh)\b/.test(s);
}

// Names that need equipment even when the catalog files them under BODYWEIGHT.
const NEEDS_GEAR = /\b(wheel|bench|bar\b|rings?|box|step|band|dumbbell|barbell|cable|machine|trx|suspension|pull-?up|chin-?up|dip|rope|sled|swiss|ball|bosu|rack|smith|kettlebell|weighted)\b/i;
export const usableWithoutEquipment = (name: string) => !NEEDS_GEAR.test(name);

const PREFER: Record<"LOWER_BODY" | "UPPER_BODY" | "CORE", RegExp[]> = {
  LOWER_BODY: [/^bodyweight squat$|^squat$/i, /lunge/i, /glute bridge|hip thrust/i, /calf raise/i, /wall sit/i],
  UPPER_BODY: [/^push-?up$|^pushups?$/i, /push-?up/i, /pike/i, /tricep|triceps/i],
  CORE: [/^plank$/i, /dead bug/i, /bird dog/i, /mountain climber/i, /crunch|sit-?up/i],
};

export function pickHomeExercises(byPart: Partial<Record<"LOWER_BODY" | "UPPER_BODY" | "CORE", { exerciseName: string; instructions?: string | null }[]>>): { part: string; name: string; hold: boolean }[] {
  const out: { part: string; name: string; hold: boolean }[] = [];
  const take = { LOWER_BODY: 2, UPPER_BODY: 2, CORE: 2 } as const;
  (Object.keys(take) as (keyof typeof take)[]).forEach((part) => {
    const pool = (byPart[part] ?? []).filter((e) => usableWithoutEquipment(e.exerciseName));
    const chosen: string[] = [];
    for (const re of PREFER[part]) {
      const hit = pool.find((e) => re.test(e.exerciseName) && !chosen.includes(e.exerciseName));
      if (hit) chosen.push(hit.exerciseName);
      if (chosen.length >= take[part]) break;
    }
    for (const e of [...pool].sort((a, b) => a.exerciseName.length - b.exerciseName.length)) {
      if (chosen.length >= take[part]) break;
      if (!chosen.includes(e.exerciseName)) chosen.push(e.exerciseName);
    }
    chosen.forEach((name) => out.push({ part, name, hold: /plank|hold|sit|wall/i.test(name) }));
  });
  return out;
}

export function buildHomeNoEquipmentAnswer(picks: { part: string; name: string; hold: boolean }[]): string {
  const label: Record<string, string> = { LOWER_BODY: "Chân – mông", UPPER_BODY: "Thân trên", CORE: "Cơ trung tâm" };
  const lines = [
    "**Được.** Tập ở nhà không cần dụng cụ vẫn giảm mỡ và săn chắc cơ thể được, miễn là bạn tập đều (khoảng 3 buổi/tuần, 30–40 phút) và ăn thâm hụt vừa phải. Lưu ý: không thể giảm mỡ riêng ở bụng — mỡ giảm đều khắp cơ thể.",
  ];
  if (picks.length) {
    lines.push("", "Một buổi mẫu bằng các bài **có trong thư viện của app và không cần dụng cụ** (mỗi bài 3 hiệp, nghỉ 45–60 giây):");
    for (const p of picks) lines.push(`- ${label[p.part] ?? p.part}: **${p.name}** — ${p.hold ? "30–40 giây" : "10–15 lần"}`);
  }
  lines.push("", "Muốn mình tạo lịch đầy đủ cho bạn không? Nhắn “Tạo lịch tập cho tôi” — mình chỉ cho bạn xem bản nháp, **chỉ lưu khi bạn xác nhận**.");
  return lines.join("\n");
}
