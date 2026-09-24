/**
 * WB-12 — pure parts of the AI Coach (web's AICoachPage + stores/pendingAiTasks coach session).
 *
 * The answer text is the small markdown dialect web renders by hand (## / ### headings, "> " notes,
 * "- " and "1. " lists, **bold**, pipe tables) — parsed here into lines so the RN renderer and the
 * tests share one reading of it.
 */
import type { AgentChatBlock, AgentImage, AiSessionMessage, CoachEvidenceItem } from "../../services/api";

export type CoachMessage = {
  id: string;
  from: "user" | "ai";
  text: string;
  time: string;
  evidenceUsed?: CoachEvidenceItem[];
  structuredBlocks?: AgentChatBlock[];
  /** Local file URI of a photo the user sent with the image-chat flow (this device only). */
  imageUri?: string;
};

// ── Markdown-ish answer text ───────────────────────────────────────────────

export type InlinePart = { text: string; bold: boolean };

export type CoachLine =
  | { kind: "h2" | "h3" | "quote" | "para"; parts: InlinePart[] }
  | { kind: "bullet"; parts: InlinePart[] }
  | { kind: "numbered"; n: string; parts: InlinePart[] }
  | { kind: "blank" }
  | { kind: "table"; headers: InlinePart[][]; rows: InlinePart[][][] };

export function parseInline(text: string): InlinePart[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter((p) => p.length > 0)
    .map((p) => (p.startsWith("**") && p.endsWith("**") && p.length > 4 ? { text: p.slice(2, -2), bold: true } : { text: p, bold: false }));
}

const cells = (l: string) =>
  l
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
const isSeparator = (l: string) => {
  const c = cells(l);
  return c.length > 0 && c.every((x) => /^[-:]*$/.test(x));
};

export function parseCoachText(text: string): CoachLine[] {
  const lines = text.split("\n");
  const out: CoachLine[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("|")) {
      const block: string[] = [];
      let j = i;
      while (j < lines.length && lines[j].trim().startsWith("|")) block.push(lines[j++]);
      if (block.length >= 2) {
        out.push({
          kind: "table",
          headers: cells(block[0]).map(parseInline),
          rows: block
            .slice(1)
            .filter((l) => !isSeparator(l))
            .map((l) => cells(l).map(parseInline)),
        });
        i = j;
        continue;
      }
    }
    const numbered = line.match(/^(\d+)\. (.*)$/);
    if (line.startsWith("## ")) out.push({ kind: "h2", parts: parseInline(line.slice(3)) });
    else if (line.startsWith("### ")) out.push({ kind: "h3", parts: parseInline(line.slice(4)) });
    else if (line.startsWith("> ")) out.push({ kind: "quote", parts: [{ text: line.slice(2), bold: false }] });
    else if (line.startsWith("- ")) out.push({ kind: "bullet", parts: parseInline(line.slice(2)) });
    else if (numbered) out.push({ kind: "numbered", n: numbered[1], parts: parseInline(numbered[2]) });
    else if (!line.trim()) out.push({ kind: "blank" });
    else out.push({ kind: "para", parts: parseInline(line) });
    i++;
  }
  return out;
}

// ── Session list / thread helpers ─────────────────────────────────────────

export function relativeTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const minutes = Math.floor((now - t) / 60000);
  if (minutes < 1) return "Vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;
  const d = new Date(t);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** A saved thread from `GET /ai/sessions/:id/messages` → question/answer bubble pairs (web's hydrateSessionMessages). */
export function sessionMessagesToChat(rows: AiSessionMessage[]): CoachMessage[] {
  return rows.flatMap((c) => [
    { id: `${c.id}-q`, from: "user" as const, text: c.question, time: c.createdAt },
    {
      id: `${c.id}-a`,
      from: "ai" as const,
      text: c.answer,
      time: c.createdAt,
      evidenceUsed: c.evidenceUsed,
      structuredBlocks: Array.isArray(c.structuredBlocks) ? c.structuredBlocks : [],
    },
  ]);
}

/** Only the first 3 evidence sources are shown under an answer, same as web. */
export function visibleEvidence(m: CoachMessage): CoachEvidenceItem[] {
  if (m.from !== "ai" || !Array.isArray(m.evidenceUsed)) return [];
  return m.evidenceUsed.slice(0, 3);
}

export const DRAFT_PREFIX = "draft:";
export const isDraftKey = (key: string) => key.startsWith(DRAFT_PREFIX);

type InBodyLike = { weight?: number | null; muscleMass?: number | null; bodyFatPct?: number | null } | null | undefined;

function delta(a: number | null | undefined, b: number | null | undefined): string {
  if (a == null || b == null) return "";
  const d = Number((a - b).toFixed(1));
  return ` (${d < 0 ? "↓" : "↑"} ${Math.abs(d)} kg)`;
}

/**
 * The first bubble of a new thread. Web seeds the same InBody numbers (latest vs previous scan);
 * the wording is the design's Vietnamese greeting instead of web's untranslated English one.
 */
export function greetingText(latest: InBodyLike, prev: InBodyLike): string {
  if (!latest) {
    return "Chào bạn 👋 Mình là AI Coach. Bạn chưa có kết quả InBody nào — hãy hỏi mình bất cứ điều gì về tập luyện và dinh dưỡng nhé!";
  }
  const w = latest.weight != null ? `${latest.weight} kg${delta(latest.weight, prev?.weight)}` : "—";
  const m = latest.muscleMass != null ? `${latest.muscleMass} kg${delta(latest.muscleMass, prev?.muscleMass)}` : "—";
  const f = latest.bodyFatPct != null ? `${latest.bodyFatPct}%` : "—";
  return `Chào bạn 👋 Mình là AI Coach, mình đã xem dữ liệu của bạn. Hôm nay bạn cần hỗ trợ gì?\n\n📊 **Chỉ số mới nhất:**\n- Cân nặng: ${w}\n- Khối cơ: ${m}\n- Mỡ cơ thể: ${f}\n\nHỏi mình bất cứ điều gì về tiến độ của bạn nhé!`;
}

const BASE_SUGGESTIONS = ["Lập lịch tập cho tôi", "Tôi nên ăn gì?", "Tạo lịch tập 3 ngày/tuần", "Tôi muốn giảm mỡ nhưng giữ cơ", "Tôi muốn tăng cơ"];

export function suggestions(hasInBody: boolean): string[] {
  return [hasInBody ? "Phân tích InBody mới nhất của tôi" : "Phân tích InBody của tôi", ...BASE_SUGGESTIONS];
}

/**
 * ACTION_RESULT's `nextUrl` is a WEB route. Only the four web allows are followed, each mapped to
 * the mobile screen that shows the same thing; anything else gets no link.
 */
export function mobileRouteForNextUrl(nextUrl: string | undefined): string | null {
  switch (nextUrl) {
    case "/client/contracts":
      return "/client/services";
    case "/client/training":
      return "/client/workout";
    case "/client/dashboard":
      return "/client/dashboard";
    case "/client/nutrition":
      return "/client/workout/nutrition";
    default:
      return null;
  }
}

/**
 * WORKFLOW_MISSING_DATA's `known` items. Web types them as strings, but ai-service really sends
 * `{ label, value }` (seen live 22/9 — "thời lượng mỗi buổi" / "60 phút"), which crashes a renderer
 * that prints the item as-is. Both shapes are accepted.
 */
// ai-service puts the raw goal enum into a known slot's value ("mục tiêu tập luyện: MUSCLE_GAIN").
const SLOT_VALUE_LABEL: Record<string, string> = {
  WEIGHT_LOSS: "Giảm mỡ",
  MUSCLE_GAIN: "Tăng cơ",
  MAINTENANCE: "Duy trì",
  ATHLETIC_PERFORMANCE: "Hiệu suất thể thao",
  ONLINE: "Online",
  OFFLINE: "Trực tiếp",
};

export function workflowItemText(item: unknown): string {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    const { label, value } = item as { label?: unknown; value?: unknown };
    if (label != null && value != null) return `${String(label)}: ${SLOT_VALUE_LABEL[String(value)] ?? String(value)}`;
    if (label != null) return String(label);
    if (value != null) return String(value);
  }
  return "";
}

/** Vietnamese weekday label for the 1..7 day numbers agent blocks use (7 = Sunday). */
export const dayLabel = (d: number) => (d === 7 ? "CN" : `T${d + 1}`);

export const AGENT_ERROR_FALLBACK = "Thao tác thất bại. Hãy thử lại.";

/**
 * A 4xx from ai-service carries a message meant for the user (e.g. "đề xuất đã hết hạn"); a 5xx
 * carries a generic English one ("An unexpected error occurred") that must not reach the screen.
 */
export function agentErrorMessage(e: any, fallback = AGENT_ERROR_FALLBACK): string {
  const status = e?.response?.status;
  if (typeof status === "number" && status >= 500) return fallback;
  return e?.response?.data?.error?.message ?? (typeof e?.message === "string" && !/status code|Network Error/i.test(e.message) ? e.message : fallback);
}

/**
 * The media type of the bytes actually picked, read from their magic number (base64 prefix).
 * The picker's own `mimeType` is the SOURCE file's: with `quality < 1` a PNG comes back re-encoded
 * as JPEG yet still labelled image/png, and ai-service (which checks magic bytes) answers 400
 * "Upload a JPEG or PNG under 4 MB" — seen live 22/9.
 */
export function detectImageMediaType(base64: string): AgentImage["mediaType"] | null {
  if (base64.startsWith("iVBORw0KGgo")) return "image/png";
  if (base64.startsWith("/9j/")) return "image/jpeg";
  return null;
}
