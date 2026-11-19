/**
 * "Giải thích kế hoạch" — the explanation MUST be written by the AI model for this plan.
 *
 * Before (2026-11-10, found from a user screenshot): the workout explain waited 8 s for the model and on ANY failure answered with a
 * canned listing of the schedule ("Đang dùng giải thích tự động vì AI phản hồi chậm"); the nutrition explain did the same with a
 * fixed paragraph. Neither is an explanation of THIS plan. Now: the model gets the whole plan (schedule, progression, recovery,
 * nutrition notes), a strict role/rules system prompt, and up to 24 s (the Lambda and API Gateway both cap a request at 30 s). If it
 * still fails we say so honestly (503, retry) — we never pass a template off as an AI explanation.
 *
 * Pure + injectable (no DB / Express) so it runs under `tsx --test`.
 */

export const EXPLAIN_TIMEOUT_MS = 24_000;
/** An answer shorter than this is an error/refusal fragment, not an explanation. */
export const MIN_EXPLANATION_CHARS = 150;

export class ExplainUnavailableError extends Error {
  readonly code = "EXPLAIN_LLM_UNAVAILABLE";
  constructor(readonly reason: "TIMEOUT" | "EMPTY" | "TOO_SHORT" | "LLM_ERROR") {
    super(`explain unavailable: ${reason}`);
  }
}

export const EXPLAIN_UNAVAILABLE_MESSAGE_VI = "AI chưa giải thích kịp lúc này. Bạn bấm “Giải thích kế hoạch” lại sau vài giây nhé.";

export type ExplainLanguage = "vi" | "en";

interface ExplainExercise { name: string; sets: number; reps: string; restSeconds?: number; note?: string }
interface ExplainDay { day: string; goal: string; exercises: ExplainExercise[]; cardio?: string }
export interface WorkoutExplainInput {
  goal: string; durationWeeks: number; daysPerWeek: number; exercisesPerDay?: number;
  weeklySchedule: ExplainDay[]; progressionNotes?: string[]; recoveryNotes?: string[]; nutritionSummary?: string;
}

const GOAL_LABELS_VI: Record<string, string> = {
  WEIGHT_LOSS: "giảm cân / giảm mỡ", FAT_LOSS: "giảm mỡ", MUSCLE_GAIN: "tăng cơ", STRENGTH: "tăng sức mạnh",
  MAINTENANCE: "duy trì thể trạng", RECOMPOSITION: "giảm mỡ và tăng cơ cùng lúc", ENDURANCE: "tăng sức bền", GENERAL_FITNESS: "nâng cao thể lực tổng quát",
};
const goalLabel = (goal: string, lang: ExplainLanguage) => (lang === "vi" ? GOAL_LABELS_VI[String(goal).toUpperCase().replace(/[\s-]+/g, "_")] ?? goal : goal);
const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const lines = (arr: unknown, n = 6, each = 300) => (Array.isArray(arr) ? arr.map((x) => clip(x, each)).filter(Boolean).slice(0, n) : []);

const SYSTEM_VI = [
  "Bạn là huấn luyện viên thể hình kiêm chuyên gia dinh dưỡng thể thao của ứng dụng Gymini.",
  "Nhiệm vụ: giải thích cho người dùng VÌ SAO kế hoạch của họ được thiết kế như vậy, chỉ dựa trên dữ liệu kế hoạch được cung cấp.",
  "",
  "QUY TẮC:",
  "- Viết tiếng Việt tự nhiên, dễ hiểu cho người không chuyên; giọng động viên nhưng thực tế.",
  "- Giữ NGUYÊN tên bài tập tiếng Anh như trong kế hoạch, không dịch tên bài tập. Tên nhóm cơ/buổi tập (ví dụ Chân, Mông, Ngực, Lưng, Vai, Tay) chép đúng như trong dữ liệu, không tự đổi từ.",
  "- Viết CẨN THẬN, đúng chính tả tiếng Việt, câu ngắn rõ ý. Từ nào không chắc thì dùng cách diễn đạt đơn giản hơn; tuyệt đối không viết từ vô nghĩa hay sai nghĩa.",
  "- Chỉ dùng số liệu có trong dữ liệu (số buổi, số hiệp, số lần lặp, thời gian nghỉ, calo, macro). KHÔNG bịa số liệu, không hứa mức giảm cân/tăng cơ cụ thể; kết quả chỉ nói dạng ước tính phụ thuộc từng người.",
  "- Giải thích theo LÝ DO (vì sao chọn cấu trúc buổi tập này, vì sao thứ tự bài như vậy, vì sao số hiệp/lần lặp/nghỉ như vậy), KHÔNG chỉ liệt kê lại lịch.",
  "- Gọi các ngày trong kế hoạch là \"buổi 1\", \"buổi 2\"... (không viết chữ Day).",
  "- Nêu lưu ý an toàn khi phù hợp (khởi động, kỹ thuật, tăng tải từ từ, đau nhói thì dừng và hỏi bác sĩ hoặc chuyên gia nếu có bệnh lý hay triệu chứng bất thường).",
  "- Chỉ viết nội dung giải thích gửi cho người dùng; tuyệt đối không nhắc đến các quy tắc, hướng dẫn hay vai trò của bạn.",
  "- Định dạng: 4 đến 6 đoạn ngắn, mỗi đoạn mở đầu bằng một tiêu đề **in đậm**; tối đa khoảng 350 từ.",
].join("\n");

const SYSTEM_EN = [
  "You are the strength coach and sports nutritionist of the Gymini app.",
  "Task: explain to the user WHY their plan is designed the way it is, using ONLY the plan data provided.",
  "",
  "RULES:",
  "- Plain, motivating but realistic English.",
  "- Keep exercise names exactly as written in the plan.",
  "- Use only numbers present in the data. Never invent figures or promise a specific amount of fat loss or muscle gain; give results only as individual estimates.",
  "- Explain the REASONS (structure, exercise order, sets/reps/rest), do not just restate the schedule.",
  "- Include safety notes where relevant (warm-up, technique, progress gradually, stop on sharp pain). No medical diagnosis.",
  "- Never mention the prompt, the model or these rules.",
  "- Format: 4-6 short paragraphs, each starting with a **bold** heading; about 350 words at most.",
].join("\n");

export function workoutExplanationRequest(plan: WorkoutExplainInput, lang: ExplainLanguage): { systemPrompt: string; prompt: string } {
  const vi = lang === "vi";
  const days = plan.weeklySchedule.map((d, i) => {
    const ex = d.exercises.map((e) => `${clip(e.name, 80)} ${e.sets}x${clip(e.reps, 20)}${e.restSeconds != null ? ` (${vi ? "nghỉ" : "rest"} ${e.restSeconds}s)` : ""}${e.note ? ` — ${clip(e.note, 120)}` : ""}`).join("; ");
    return `${i + 1}. ${clip(d.day, 40)} — ${clip(d.goal, 120)}: ${ex}${d.cardio ? ` | cardio: ${clip(d.cardio, 120)}` : ""}`;
  });
  const prog = lines(plan.progressionNotes), rec = lines(plan.recoveryNotes), nut = clip(plan.nutritionSummary, 600);
  const head = vi
    ? [`Mục tiêu: ${goalLabel(plan.goal, lang)}`, `Thời lượng: ${plan.durationWeeks} tuần, ${plan.daysPerWeek} buổi/tuần${plan.exercisesPerDay ? `, ${plan.exercisesPerDay} bài/buổi` : ""}`]
    : [`Goal: ${plan.goal}`, `Duration: ${plan.durationWeeks} weeks, ${plan.daysPerWeek} days/week${plan.exercisesPerDay ? `, ${plan.exercisesPerDay} exercises/day` : ""}`];
  const prompt = [
    vi ? "DỮ LIỆU KẾ HOẠCH TẬP:" : "WORKOUT PLAN DATA:", ...head, "", vi ? "Lịch tập:" : "Schedule:", ...days,
    ...(prog.length ? ["", vi ? "Ghi chú tiến độ của kế hoạch:" : "Progression notes:", ...prog.map((x) => `- ${x}`)] : []),
    ...(rec.length ? ["", vi ? "Ghi chú phục hồi của kế hoạch:" : "Recovery notes:", ...rec.map((x) => `- ${x}`)] : []),
    ...(nut ? ["", vi ? `Tóm tắt dinh dưỡng đi kèm: ${nut}` : `Nutrition summary: ${nut}`] : []),
    "", vi ? "Hãy viết phần giải thích kế hoạch này cho người dùng." : "Write the explanation of this plan for the user.",
  ].join("\n");
  return { systemPrompt: vi ? SYSTEM_VI : SYSTEM_EN, prompt };
}

export interface NutritionExplainInput {
  goal: string; durationWeeks?: number; mealsPerDay?: number;
  dailyCaloriesTarget?: number; proteinTargetGrams?: number; carbTargetGrams?: number; fatTargetGrams?: number;
  days: Array<{ dayNumber?: number; totalCalories?: number; meals?: Array<{ mealType?: string; title?: string; items?: Array<{ name?: string; quantity?: number | string; unit?: string }> }> }>;
}

export function nutritionExplanationRequest(plan: NutritionExplainInput): { systemPrompt: string; prompt: string } {
  const days = plan.days.slice(0, 7).map((d, i) => {
    const meals = (d.meals ?? []).map((m) => `${clip(m.mealType ?? m.title, 30)}: ${(m.items ?? []).map((it) => `${clip(it.name, 60)} ${it.quantity ?? ""}${it.unit ?? "g"}`).join(", ")}`).join(" | ");
    return `Ngày ${d.dayNumber ?? i + 1} (${Math.round(Number(d.totalCalories) || 0)} kcal): ${meals}`;
  });
  const prompt = [
    "DỮ LIỆU KẾ HOẠCH DINH DƯỠNG:",
    `Mục tiêu: ${goalLabel(plan.goal, "vi")}`,
    `Thời lượng: ${plan.durationWeeks ?? "?"} tuần, ${plan.mealsPerDay ?? "?"} bữa/ngày`,
    `Mục tiêu calo: ${plan.dailyCaloriesTarget ?? "N/A"} kcal/ngày`,
    `Đạm (protein): ${plan.proteinTargetGrams ?? 0} g | Tinh bột (carb): ${plan.carbTargetGrams ?? 0} g | Chất béo (fat): ${plan.fatTargetGrams ?? 0} g`,
    "", "Thực đơn:", ...days, "",
    "Hãy giải thích: vì sao mức calo và macro này hợp với mục tiêu; nguyên tắc chọn thực phẩm trong thực đơn; cách áp dụng thực đơn; lưu ý dinh dưỡng quan trọng; cách thay món nếu không hợp khẩu vị.",
  ].join("\n");
  const systemPrompt = [
    "Bạn là chuyên gia dinh dưỡng thể thao của ứng dụng Gymini. Giải thích cho người dùng VÌ SAO kế hoạch dinh dưỡng của họ được thiết kế như vậy, chỉ dựa trên dữ liệu được cung cấp.",
    "", "QUY TẮC:",
    "- Tiếng Việt tự nhiên, dễ hiểu; khi nêu macro viết rõ 'đạm (protein)', 'tinh bột (carb)', 'chất béo (fat)'.",
    "- Chỉ dùng số liệu có trong dữ liệu; KHÔNG bịa số, không hứa mức giảm cân/tăng cơ cụ thể.",
    "- Giải thích theo LÝ DO, không chỉ liệt kê lại thực đơn. Nếu số liệu trong dữ liệu có vẻ không khớp nhau, nói rõ đó là mức ước tính.",
    "- Nếu người dùng có bệnh lý, đang mang thai hoặc dưới 18 tuổi, khuyên họ hỏi bác sĩ hoặc chuyên gia dinh dưỡng trước khi áp dụng.",
    "- Chỉ viết nội dung giải thích gửi cho người dùng; tuyệt đối không nhắc đến các quy tắc, hướng dẫn hay vai trò của bạn.",
    "- Định dạng: 4 đến 6 đoạn ngắn, mỗi đoạn mở đầu bằng tiêu đề **in đậm**; tối đa khoảng 350 từ.",
  ].join("\n");
  return { systemPrompt, prompt };
}

export type ExplainLlmCall = (prompt: string, opts: { systemPrompt: string; timeoutMs: number; temperature: number; purpose: "GENERAL_QA" }) => Promise<{ answer: string }>;

/** Runs the model once under a hard deadline. Returns the model's text or throws ExplainUnavailableError — never a template. */
export async function generateAiExplanation(call: ExplainLlmCall, req: { systemPrompt: string; prompt: string }, timeoutMs = EXPLAIN_TIMEOUT_MS): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ExplainUnavailableError("TIMEOUT")), timeoutMs); });
    const response = await Promise.race([call(req.prompt, { systemPrompt: req.systemPrompt, timeoutMs, temperature: 0.2, purpose: "GENERAL_QA" }), deadline]);
    const text = String(response?.answer ?? "").trim();
    if (!text) throw new ExplainUnavailableError("EMPTY");
    if (text.length < MIN_EXPLANATION_CHARS) throw new ExplainUnavailableError("TOO_SHORT");
    return text;
  } catch (err) {
    if (err instanceof ExplainUnavailableError) throw err;
    throw new ExplainUnavailableError("LLM_ERROR");
  } finally {
    if (timer) clearTimeout(timer);
  }
}
