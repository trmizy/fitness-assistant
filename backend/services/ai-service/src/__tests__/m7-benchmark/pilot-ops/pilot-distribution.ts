/**
 * M8-A5 — kiểm tra phân bố / số lượng của bộ câu hỏi pilot (20 câu) và bảng phân công ý định riêng của curator.
 * Thuần: không I/O. Không tạo nhãn, không suy nhãn: bảng ý định là KHAI BÁO của writer (do curator/điều phối giữ), không phải nhãn gán.
 * Tái sử dụng: SCHEMA_VERSION, TAGS, ROUTING_QUESTION_CHARS, CATEGORIES, isValidLabelerId (schema), hasVietnameseDiacritics (validator),
 * canonicalWriterKey (dataset-checks), findDuplicateKeys (annotation-json).
 * Nguồn của bảng phân công đã duyệt: docs pilot 02 §2 / 11 §G (SINGLE 2,2,2,1; TWO 1,1,1,2; MULTI 1,1,0,1; OOS 0,1,1,0; AMBIGUOUS 1,0,1,1).
 */
import { CATEGORIES, ROUTING_QUESTION_CHARS, SCHEMA_VERSION, SOURCE_KINDS, TAGS, isValidLabelerId, type Category } from "../annotation-schema";
import { hasVietnameseDiacritics } from "../annotation-validator";
import { canonicalWriterKey } from "../annotation-dataset-checks";
import { findDuplicateKeys } from "../annotation-json";
import { RESERVED_ID_PREFIXES } from "./near-duplicate";

export const PILOT_ROWS = 20;
export const PILOT_WRITERS = 4;
export const PILOT_PER_WRITER = 5;
export const WRITER_SLOTS = ["W1", "W2", "W3", "W4"] as const;
export type WriterSlot = (typeof WRITER_SLOTS)[number];
/** Bảng đã duyệt: ý định -> số câu của [W1, W2, W3, W4]. Không đổi nếu không có quyết định mới của chủ dự án. */
export const APPROVED_ALLOCATION: Readonly<Record<Category, readonly [number, number, number, number]>> = Object.freeze({
  SINGLE: [2, 2, 2, 1], TWO: [1, 1, 1, 2], MULTI: [1, 1, 0, 1], OOS: [0, 1, 1, 0], AMBIGUOUS: [1, 0, 1, 1],
});
export const SPECIAL_TYPES = ["MINOR_SELF", "PROMPT_INJECTION", "HIGH_RISK", "SAFETY_BLOCK"] as const;
export const PILOT_FORBIDDEN_TAGS = Object.freeze(["long_question", "over_request_limit"] as const);
/** Khoá của một dòng câu hỏi TRƯỚC `prepare` (không có nhãn, không có kết quả). */
export const QUESTION_ROW_KEYS = ["schemaVersion", "id", "question", "accented", "tags", "source"] as const;

export interface PilotFinding { code: string; id: string | null; line: number; detail: string }
export interface PilotRow { line: number; raw: unknown }

/** Đọc JSONL; dòng hỏng thành finding, không ném lỗi. */
export function parseJsonl(text: string): { rows: PilotRow[]; findings: PilotFinding[] } {
  const rows: PilotRow[] = [], findings: PilotFinding[] = [];
  text.split(/\r?\n/).forEach((t, i) => {
    if (!t.trim()) return;
    const line = i + 1;
    try {
      const d = findDuplicateKeys(t);
      if (d.duplicates.length) { findings.push({ code: "DUPLICATE_JSON_KEY", id: null, line, detail: `khoá lặp: ${d.duplicates.map((x) => x.key).join(", ")}` }); return; }
      rows.push({ line, raw: JSON.parse(t) });
    } catch (e) { findings.push({ code: "MALFORMED_JSON", id: null, line, detail: (e as Error).message }); }
  });
  return { rows, findings };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const expectedIds = Array.from({ length: PILOT_ROWS }, (_, i) => `PILOT-${String(i + 1).padStart(3, "0")}`);

export interface PilotCheckOptions {
  /** "writer": tệp nộp của writer (tags phải rỗng, id nháp tự do). "curated": questions.jsonl đã qua curator (id PILOT-001..020, tags hợp lệ). */
  stage: "writer" | "curated";
}
export interface PilotCheckResult { ok: boolean; findings: PilotFinding[]; stats: { rows: number; authors: Record<string, number>; unaccentedByAuthor: Record<string, number>; tagCounts: Record<string, number> } }

export function checkPilotQuestions(rows: readonly PilotRow[], opts: PilotCheckOptions): PilotCheckResult {
  const f: PilotFinding[] = [];
  const add = (code: string, r: PilotRow | null, id: string | null, detail: string) => f.push({ code, id, line: r?.line ?? 0, detail });
  const authors = new Map<string, number>(), unacc = new Map<string, number>(), tagCounts = new Map<string, number>();
  const seen = new Map<string, number>();
  const writerStage = opts.stage === "writer";
  // Với tệp 1 writer (stage writer) chỉ cần đúng 5 dòng; bộ 20 dòng chỉ ở stage curated.
  const wantRows = writerStage ? PILOT_PER_WRITER : PILOT_ROWS;
  if (rows.length !== wantRows) add("ROW_COUNT", null, null, `cần đúng ${wantRows} dòng, có ${rows.length}`);

  for (const r of rows) {
    if (!isObj(r.raw)) { add("NOT_OBJECT", r, null, "dòng không phải đối tượng JSON"); continue; }
    const o = r.raw;
    const id = typeof o.id === "string" && o.id.trim() ? o.id : null;
    if (!id) add("MISSING_ID", r, null, "id thiếu hoặc rỗng");
    else {
      seen.set(id, (seen.get(id) ?? 0) + 1);
      if (!writerStage) {
        if (!expectedIds.includes(id)) add("ID_NOT_PILOT", r, id, "id phải thuộc PILOT-001..PILOT-020");
      } else if (RESERVED_ID_PREFIXES.some((p) => id.toUpperCase().startsWith(p))) add("RESERVED_ID_PREFIX", r, id, "id nháp của writer không được mang tiền tố PILOT-/CAL-/TRAIN-/SYN-");
    }
    for (const k of Object.keys(o)) if (!(QUESTION_ROW_KEYS as readonly string[]).includes(k)) add("UNEXPECTED_KEY", r, id, `khoá '${k}' không được có trước prepare (không nhãn, không kết quả)`);
    if (o.schemaVersion !== SCHEMA_VERSION) add("SCHEMA_VERSION", r, id, `schemaVersion phải là "${SCHEMA_VERSION}"`);

    const q = o.question;
    if (typeof q !== "string" || !q.trim()) add("QUESTION_EMPTY", r, id, "question thiếu hoặc rỗng");
    else {
      if (q.length > ROUTING_QUESTION_CHARS) add("QUESTION_TOO_LONG", r, id, `${q.length} ký tự (> ${ROUTING_QUESTION_CHARS}); pilot không dùng câu dài`);
      if (q !== q.trim() || q !== q.normalize("NFC")) add("QUESTION_NOT_CANONICAL", r, id, "question phải được trim và ở dạng NFC");
      if (typeof o.accented === "boolean" && o.accented !== hasVietnameseDiacritics(q)) add("ACCENTED_MISMATCH", r, id, `accented=${o.accented} không khớp văn bản`);
    }
    if (typeof o.accented !== "boolean") add("MISSING_FIELD", r, id, "accented phải là boolean");

    const tags = o.tags;
    if (!Array.isArray(tags) || tags.some((t) => typeof t !== "string")) add("TAGS_INVALID", r, id, "tags phải là mảng chuỗi");
    else {
      if (writerStage && tags.length) add("TAGS_NOT_EMPTY", r, id, "writer không đặt tag: tags phải là []");
      const set = new Set<string>();
      for (const t of tags as string[]) {
        if (!(TAGS as readonly string[]).includes(t)) add("TAG_INVALID", r, id, `tag '${t}' không thuộc danh sách hợp lệ`);
        if ((PILOT_FORBIDDEN_TAGS as readonly string[]).includes(t)) add("TAG_FORBIDDEN_FOR_PILOT", r, id, `pilot không dùng tag ${t}`);
        if (set.has(t)) add("TAG_DUPLICATE", r, id, `tag '${t}' lặp trong một dòng`);
        set.add(t); tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
      if (set.has("unaccented") && o.accented === true) add("TAG_UNACCENTED_MISMATCH", r, id, "tag unaccented nhưng accented=true");
    }

    const s = o.source;
    if (!isObj(s)) add("SOURCE_INVALID", r, id, "source phải là đối tượng");
    else {
      if (!(SOURCE_KINDS as readonly string[]).includes(s.kind as string)) add("SOURCE_KIND", r, id, "source.kind phải là synthetic hoặc permitted");
      if (typeof s.note !== "string" || !s.note.trim()) add("SOURCE_NOTE_EMPTY", r, id, "source.note không được rỗng");
      if (typeof s.author !== "string" || !isValidLabelerId(s.author)) add("AUTHOR_INVALID", r, id, "source.author không hợp lệ (bút danh, không phải tên công cụ/mô hình)");
      else {
        const k = canonicalWriterKey(s.author);
        authors.set(k, (authors.get(k) ?? 0) + 1);
        if (o.accented === false) unacc.set(k, (unacc.get(k) ?? 0) + 1);
        if (!unacc.has(k)) unacc.set(k, 0);
      }
    }
  }
  for (const [id, n] of seen) if (n > 1) add("DUPLICATE_ID", null, id, `id xuất hiện ${n} lần`);

  if (writerStage) {
    if (authors.size > 1) add("AUTHOR_COUNT", null, null, `tệp của một writer phải có đúng 1 bút danh, có ${authors.size}`);
  } else {
    const missing = expectedIds.filter((id) => !seen.has(id));
    if (missing.length) add("ID_SET", null, null, `thiếu id: ${missing.join(", ")}`);
    if (authors.size !== PILOT_WRITERS) add("AUTHOR_COUNT", null, null, `cần đúng ${PILOT_WRITERS} bút danh writer khác nhau, có ${authors.size}`);
  }
  for (const [a, n] of authors) {
    if (n !== PILOT_PER_WRITER) add("AUTHOR_SHARE", null, null, `bút danh ${a} có ${n} câu, cần đúng ${PILOT_PER_WRITER}`);
    if ((unacc.get(a) ?? 0) < 1) add("UNACCENTED_PER_WRITER", null, null, `bút danh ${a} chưa có câu không dấu nào (cần >= 1)`);
  }
  return {
    ok: f.length === 0, findings: f,
    stats: { rows: rows.length, authors: Object.fromEntries(authors), unaccentedByAuthor: Object.fromEntries(unacc), tagCounts: Object.fromEntries(tagCounts) },
  };
}

// ── bảng phân công ý định (CSV riêng của curator) ───────────────────────────────────────────────────────────────
/** Cột bắt buộc, theo thứ tự của mẫu: question_id, writer_slot, writer_pseudonym, intent, special_type, third_party. */
export const ALLOCATION_COLUMNS = ["question_id", "writer_slot", "writer_pseudonym", "intent", "special_type", "third_party"] as const;
export interface AllocationRow { line: number; questionId: string; slot: string; pseudonym: string; intent: string; special: string; thirdParty: string }

function splitCsvLine(s: string): string[] {
  const out: string[] = []; let cur = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur); return out.map((x) => x.trim());
}
export function parseAllocationCsv(text: string): { rows: AllocationRow[]; findings: PilotFinding[] } {
  const findings: PilotFinding[] = [], rows: AllocationRow[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  let hi = lines.findIndex((l) => l.trim() && !l.trim().startsWith("#"));
  if (hi < 0) { findings.push({ code: "ALLOC_EMPTY", id: null, line: 0, detail: "CSV rỗng" }); return { rows, findings }; }
  const head = splitCsvLine(lines[hi]);
  if (head.join(",") !== ALLOCATION_COLUMNS.join(",")) findings.push({ code: "ALLOC_HEADER", id: null, line: hi + 1, detail: `tiêu đề phải là ${ALLOCATION_COLUMNS.join(",")}` });
  for (let i = hi + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim() || l.trim().startsWith("#")) continue;
    const c = splitCsvLine(l);
    if (c.length !== ALLOCATION_COLUMNS.length) { findings.push({ code: "ALLOC_COLUMNS", id: null, line: i + 1, detail: `cần ${ALLOCATION_COLUMNS.length} cột, có ${c.length}` }); continue; }
    rows.push({ line: i + 1, questionId: c[0], slot: c[1], pseudonym: c[2], intent: c[3], special: c[4], thirdParty: c[5] });
  }
  return { rows, findings };
}

/**
 * Đối chiếu bảng phân công với bộ câu hỏi: mỗi id đúng 1 dòng; slot -> đúng 1 bút danh khớp source.author; số câu theo (slot, ý định) bằng bảng đã duyệt;
 * mỗi writer đúng 1 loại đặc biệt, 4 loại khác nhau (nếu đã điền); ngôi thứ ba tối đa 1.
 * Chỉ kiểm khai báo; không phán nhãn nào là đúng.
 */
export function checkAllocation(questions: readonly PilotRow[], alloc: readonly AllocationRow[]): PilotFinding[] {
  const f: PilotFinding[] = [];
  const add = (code: string, line: number, id: string | null, detail: string) => f.push({ code, id, line, detail });
  const authorById = new Map<string, string>();
  for (const r of questions) if (isObj(r.raw) && typeof r.raw.id === "string" && isObj(r.raw.source) && typeof r.raw.source.author === "string") authorById.set(r.raw.id, canonicalWriterKey(r.raw.source.author));

  const seenQ = new Set<string>();
  const slotAuthors = new Map<string, Set<string>>();
  const counts = new Map<string, number>(); // `${slot}|${intent}`
  const slotSpecial = new Map<string, Set<string>>();
  let third = 0;
  for (const a of alloc) {
    if (!(WRITER_SLOTS as readonly string[]).includes(a.slot)) add("ALLOC_SLOT", a.line, a.questionId, `writer_slot phải là ${WRITER_SLOTS.join("/")}`);
    if (!(CATEGORIES as readonly string[]).includes(a.intent)) add("ALLOC_INTENT", a.line, a.questionId, `intent phải thuộc ${CATEGORIES.join("/")}`);
    if (seenQ.has(a.questionId)) add("ALLOC_DUPLICATE_QUESTION", a.line, a.questionId, "question_id xuất hiện nhiều lần");
    seenQ.add(a.questionId);
    const author = authorById.get(a.questionId);
    if (author === undefined) add("ALLOC_UNKNOWN_QUESTION", a.line, a.questionId, "question_id không có trong bộ câu hỏi");
    else if (canonicalWriterKey(a.pseudonym) !== author) add("ALLOC_AUTHOR_MISMATCH", a.line, a.questionId, "writer_pseudonym không khớp source.author của câu");
    if (!slotAuthors.has(a.slot)) slotAuthors.set(a.slot, new Set());
    slotAuthors.get(a.slot)!.add(canonicalWriterKey(a.pseudonym));
    const k = `${a.slot}|${a.intent}`; counts.set(k, (counts.get(k) ?? 0) + 1);
    if (a.special) {
      if (!(SPECIAL_TYPES as readonly string[]).includes(a.special)) add("ALLOC_SPECIAL", a.line, a.questionId, `special_type phải trống hoặc thuộc ${SPECIAL_TYPES.join("/")}`);
      else { if (!slotSpecial.has(a.slot)) slotSpecial.set(a.slot, new Set()); slotSpecial.get(a.slot)!.add(a.special); }
    }
    if (a.thirdParty) { if (!/^(yes|true|1|có)$/i.test(a.thirdParty) && !/^(no|false|0|không)$/i.test(a.thirdParty)) add("ALLOC_THIRD_PARTY", a.line, a.questionId, "third_party phải là yes/no (hoặc trống)"); else if (/^(yes|true|1|có)$/i.test(a.thirdParty)) third++; }
  }
  for (const q of authorById.keys()) if (!seenQ.has(q)) add("ALLOC_MISSING_QUESTION", 0, q, "câu hỏi chưa có dòng phân công");
  for (const [slot, set] of slotAuthors) if (set.size !== 1) add("ALLOC_SLOT_PSEUDONYMS", 0, null, `${slot} gắn với ${set.size} bút danh (cần đúng 1)`);
  const owners = new Map<string, string>();
  for (const [slot, set] of slotAuthors) for (const p of set) { if (owners.has(p) && owners.get(p) !== slot) add("ALLOC_PSEUDONYM_TWO_SLOTS", 0, null, `một bút danh thuộc hai slot (${owners.get(p)}, ${slot})`); owners.set(p, slot); }
  // số câu theo (slot, ý định) so với bảng đã duyệt
  WRITER_SLOTS.forEach((slot, si) => {
    for (const c of CATEGORIES) {
      const want = APPROVED_ALLOCATION[c][si], got = counts.get(`${slot}|${c}`) ?? 0;
      if (want !== got) add("ALLOC_COUNT", 0, null, `${slot}/${c}: có ${got}, bảng đã duyệt là ${want}`);
    }
  });
  // loại đặc biệt: mỗi writer 1 loại, khác nhau (chỉ kiểm phần đã điền)
  const used = new Map<string, string>();
  for (const [slot, set] of slotSpecial) {
    if (set.size > 1) add("ALLOC_SPECIAL_PER_WRITER", 0, null, `${slot} có ${set.size} loại đặc biệt (cần đúng 1)`);
    for (const t of set) { if (used.has(t)) add("ALLOC_SPECIAL_DUPLICATE", 0, null, `loại ${t} giao cho cả ${used.get(t)} và ${slot} (4 loại phải khác nhau)`); used.set(t, slot); }
  }
  if (third > 1) add("ALLOC_THIRD_PARTY_MAX", 0, null, `${third} câu ngôi thứ ba (tối đa 1 toàn pilot)`);
  return f;
}
