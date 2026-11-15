/**
 * M8-A5 — công cụ vận hành pilot: kiểm trùng / gần trùng câu hỏi ứng viên.
 * Thuần (không I/O, không mạng). KHÔNG BAO GIỜ trả về hay in nội dung câu hỏi của benchmark: kết quả chỉ có id, tập, verdict, độ tương đồng.
 *
 * TÁI SỬ DỤNG (không viết lại): `normalizeForCompare` (bỏ dấu, gộp khoảng trắng, bỏ ký tự vô hình) và `THRESHOLDS` (ngưỡng Jaccard theo token,
 * containment) của annotation-dataset-checks.ts — cùng một chuẩn so sánh với `annotation-cli validate`/`merge`. Danh sách benchmark lấy từ
 * đúng các mảng dataset mà checkBenchmarkOverlap dùng (v1, dev, heldout-v2, dev/heldout v3, v4), chỉ đọc.
 * BỔ SUNG (chưa có sẵn): Jaccard theo n-gram ký tự (n=3) trên chuỗi đã chuẩn hoá — bắt lỗi gõ sai/đổi dấu cách nhỏ mà so token bỏ lọt.
 * Ngưỡng n-gram (tài liệu hoá, chọn bảo thủ: ưu tiên bắt trùng, người đọc xác nhận ở mức REVIEW):
 *   - câu ứng viên với nhau / danh sách cấm: >= 0.85 là NEAR_DUPLICATE (lỗi), >= 0.65 là REVIEW.
 *   - câu ứng viên với benchmark: >= 0.80 là NEAR_DUPLICATE (lỗi), >= 0.60 là REVIEW (khớp tinh thần benchErrorJaccard 0.8 / benchReview 0.5).
 */
import { normalizeForCompare, THRESHOLDS } from "../annotation-dataset-checks";
import { ROUTING_CASES_V1 } from "../../m5-benchmark/dataset-v1";
import { ROUTING_CASES_DEV } from "../../m5-benchmark/dataset-dev";
import { ROUTING_CASES_HELDOUT_V2 } from "../../m5-benchmark/dataset-heldout-v2";
import { ROUTING_CASES_DEV_V3, ROUTING_CASES_HELDOUT_V3 } from "../dataset-v3";
import { ROUTING_CASES_DEV_V4, ROUTING_CASES_HELDOUT_V4 } from "../dataset-v4";

export const NEAR_DUP_THRESHOLDS = Object.freeze({
  charNgram: 3,
  charJaccardError: 0.85, charJaccardReview: 0.65,
  benchCharJaccardError: 0.8, benchCharJaccardReview: 0.6,
});

/** Tiền tố id dành riêng cho pilot / hiệu chỉnh / huấn luyện / synthetic: cấm xuất hiện trong bộ 300. */
export const RESERVED_ID_PREFIXES = Object.freeze(["PILOT-", "CAL-", "TRAIN-", "SYN-"] as const);

export interface QItem { id: string; question: string }
export interface RefSet { scope: string; items: readonly QItem[]; /** true = nội dung không được hiển thị ở đâu cả (benchmark). Kết quả vốn không có text; cờ này chỉ để tài liệu hoá. */ hidden?: boolean }
export type MatchVerdict = "EXACT" | "NEAR_DUPLICATE" | "REVIEW";
export interface Match {
  candidateId: string; refScope: string; refId: string; verdict: MatchVerdict;
  tokenJaccard: number; containment: number; charJaccard: number;
}
export interface DupReport {
  /** EXACT hoặc NEAR_DUPLICATE: phải sửa. */ errors: Match[];
  /** REVIEW: người phải xem, không tự loại. */ reviews: Match[];
  /** id ứng viên không có bất kỳ khớp nào. */ clean: string[];
  idProblems: Array<{ candidateId: string; code: "RESERVED_ID_PREFIX" | "ID_IN_BAN_LIST" | "DUPLICATE_CANDIDATE_ID"; detail: string }>;
  counts: { candidates: number; refSets: Record<string, number>; errors: number; reviews: number; clean: number };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const toks = (norm: string): Set<string> => new Set(norm.length ? norm.split(" ") : []);
export function charNgrams(norm: string, n = NEAR_DUP_THRESHOLDS.charNgram): Set<string> {
  const s = ` ${norm} `; // viền khoảng trắng để chuỗi ngắn vẫn có n-gram
  const out = new Set<string>();
  for (let i = 0; i + n <= s.length; i++) out.add(s.slice(i, i + n));
  return out;
}
function setSim(a: Set<string>, b: Set<string>): { jaccard: number; containment: number; minSize: number } {
  const [s, l] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const t of s) if (l.has(t)) inter++;
  const union = a.size + b.size - inter;
  return { jaccard: union === 0 ? 0 : inter / union, containment: s.size === 0 ? 0 : inter / s.size, minSize: s.size };
}

interface Prepared { id: string; norm: string; tok: Set<string>; chr: Set<string> }
const prep = (it: QItem): Prepared => { const norm = normalizeForCompare(it.question); return { id: it.id, norm, tok: toks(norm), chr: charNgrams(norm) }; };

function compare(a: Prepared, b: Prepared, bench: boolean): { verdict: MatchVerdict; tokenJaccard: number; containment: number; charJaccard: number } | null {
  const t = setSim(a.tok, b.tok);
  const c = setSim(a.chr, b.chr);
  const base = { tokenJaccard: r3(t.jaccard), containment: r3(t.containment), charJaccard: r3(c.jaccard) };
  if (a.norm === b.norm) return { verdict: "EXACT", ...base, tokenJaccard: 1, charJaccard: 1 };
  const tokErr = bench ? THRESHOLDS.benchErrorJaccard : THRESHOLDS.dupJaccardError;
  const tokRev = bench ? THRESHOLDS.benchReviewJaccard : THRESHOLDS.similarJaccardReview;
  const chrErr = bench ? NEAR_DUP_THRESHOLDS.benchCharJaccardError : NEAR_DUP_THRESHOLDS.charJaccardError;
  const chrRev = bench ? NEAR_DUP_THRESHOLDS.benchCharJaccardReview : NEAR_DUP_THRESHOLDS.charJaccardReview;
  if (t.jaccard >= tokErr || c.jaccard >= chrErr) return { verdict: "NEAR_DUPLICATE", ...base };
  if (t.jaccard >= tokRev || c.jaccard >= chrRev || (t.minSize >= THRESHOLDS.containmentMinTokens && t.containment >= THRESHOLDS.containmentReview)) return { verdict: "REVIEW", ...base };
  return null;
}

/** Các tập benchmark lịch sử (v1–v4 và heldout đang có trong repo), chỉ đọc. Nội dung không rời khỏi module này qua kết quả. */
export function historicalBenchmarkSets(): RefSet[] {
  const mk = (scope: string, cases: readonly { id: string; q: string }[]): RefSet => ({ scope: `BENCH:${scope}`, hidden: true, items: cases.map((c) => ({ id: c.id, question: c.q })) });
  return [
    mk("V1", ROUTING_CASES_V1), mk("DEV", ROUTING_CASES_DEV), mk("HELDOUT_V2", ROUTING_CASES_HELDOUT_V2),
    mk("DEV_V3", ROUTING_CASES_DEV_V3), mk("HELDOUT_V3", ROUTING_CASES_HELDOUT_V3),
    mk("DEV_V4", ROUTING_CASES_DEV_V4), mk("HELDOUT_V4", ROUTING_CASES_HELDOUT_V4),
  ];
}

export interface DupOptions {
  /** Các tập tham chiếu: danh sách cấm (PILOT/CAL/TRAIN...), benchmark. Tập có scope bắt đầu bằng "BENCH:" dùng ngưỡng benchmark. */
  refSets?: readonly RefSet[];
  /** Cấm id ứng viên mang tiền tố PILOT-/CAL-/TRAIN-/SYN- (dùng khi kiểm ứng viên của bộ 300). */
  forbidReservedIdPrefixes?: boolean;
}

export function checkDuplicates(candidates: readonly QItem[], opts: DupOptions = {}): DupReport {
  const refSets = opts.refSets ?? [];
  const cands = candidates.map(prep);
  const errors: Match[] = [], reviews: Match[] = [];
  const idProblems: DupReport["idProblems"] = [];
  const flagged = new Set<string>();
  const push = (m: Match) => { (m.verdict === "REVIEW" ? reviews : errors).push(m); flagged.add(m.candidateId); };

  const seenIds = new Set<string>();
  for (const c of candidates) {
    const key = c.id.trim().toLowerCase();
    if (seenIds.has(key)) idProblems.push({ candidateId: c.id, code: "DUPLICATE_CANDIDATE_ID", detail: "id xuất hiện nhiều lần (không phân biệt hoa/thường)" });
    seenIds.add(key);
    if (opts.forbidReservedIdPrefixes) {
      const hit = RESERVED_ID_PREFIXES.find((p) => c.id.toUpperCase().startsWith(p));
      if (hit) idProblems.push({ candidateId: c.id, code: "RESERVED_ID_PREFIX", detail: `id mang tiền tố dành riêng ${hit}` });
    }
  }
  const banIds = new Set<string>();
  for (const rs of refSets) if (!rs.scope.startsWith("BENCH:")) for (const it of rs.items) banIds.add(it.id.trim().toLowerCase());
  for (const c of candidates) if (banIds.has(c.id.trim().toLowerCase())) idProblems.push({ candidateId: c.id, code: "ID_IN_BAN_LIST", detail: "id trùng một id trong danh sách cấm" });

  // ứng viên với nhau
  for (let i = 0; i < cands.length; i++) for (let j = i + 1; j < cands.length; j++) {
    const r = compare(cands[i], cands[j], false);
    if (r) { push({ candidateId: cands[j].id, refScope: "CANDIDATE", refId: cands[i].id, ...r }); flagged.add(cands[i].id); } // cả hai phía của một cặp không còn "sạch"
  }
  // ứng viên với từng tập tham chiếu
  const refCounts: Record<string, number> = {};
  for (const rs of refSets) {
    const bench = rs.scope.startsWith("BENCH:");
    refCounts[rs.scope] = rs.items.length;
    const refs = rs.items.map(prep);
    for (const c of cands) for (const r of refs) {
      const res = compare(c, r, bench);
      if (res) push({ candidateId: c.id, refScope: rs.scope, refId: r.id, ...res });
    }
  }
  const clean = candidates.map((c) => c.id).filter((id) => !flagged.has(id) && !idProblems.some((p) => p.candidateId === id));
  return { errors, reviews, clean, idProblems, counts: { candidates: candidates.length, refSets: refCounts, errors: errors.length, reviews: reviews.length, clean: clean.length } };
}

/** Một dòng báo cáo chỉ gồm id + verdict + độ tương đồng. Không có text. */
export function formatMatch(m: Match): string {
  return `${m.verdict}\t${m.candidateId}\t${m.refScope}:${m.refId}\ttoken=${m.tokenJaccard}\tcontain=${m.containment}\tchar3=${m.charJaccard}`;
}
