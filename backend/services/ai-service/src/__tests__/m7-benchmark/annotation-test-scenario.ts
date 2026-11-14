/**
 * TEST FIXTURE scenario for the annotation CLI tests (synthetic, disposable, OS temp dir). Not evaluation data.
 * Runs the full provenance chain: prepare → accept-submissions → agreement → merge → (sign from the tool's own refusal) → freeze --fixture.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { main, REQUIRED_CANDIDATE_FILES, type Io } from "./annotation-cli";
import { SCHEMA_VERSION, type CaseLabel, type DomainLabel } from "./annotation-schema";

export const NOTE = "TEST FIXTURE — not evaluation data";
export type Obj = Record<string, any>;
export const sha = (p: string) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const R = (agent: DomainLabel["agent"]): DomainLabel => ({ agent, role: "request" });
export const lab = (agent: DomainLabel["agent"], o: Partial<CaseLabel> = {}): CaseLabel => ({ domains: [R(agent)], primaryAgent: agent, category: "SINGLE", safety: "NONE", expectedPreRouting: "ALLOW", ...o });

export interface RunResult { code: number; out: string[]; err: string[]; codes: string[]; reviewCodes: string[] }
export function run(argv: string[]): RunResult {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (s) => out.push(s), err: (s) => err.push(s) };
  const code = main(argv, io);
  return { code, out, err, codes: out.filter((l) => l.startsWith("ERROR\t")).map((l) => l.split("\t")[4]), reviewCodes: out.filter((l) => l.startsWith("REVIEW\t")).map((l) => l.split("\t")[4]) };
}
export const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
export const readJsonl = (p: string): Obj[] => fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

const LONG = (() => { let s = "cau hoi dai thu nghiem cong cu gop nhan"; for (let k = 0; s.length < 700; k++) s += ` zq${k}x`; return s.slice(0, 700).trimEnd(); })();
export const QUESTIONS = [
  { id: "Q-0001", q: "Chiều thứ năm mình có nên chèn thêm một buổi kéo xà đơn ngắn không?", tags: [] as string[], A: lab("training"), B: lab("training") },
  { id: "Q-0002", q: "Bữa trưa ở căng tin toàn đồ chiên thì chọn món nào cho đỡ ngấy?", tags: [], A: lab("nutrition"), B: lab("nutrition") },
  { id: "Q-0003", q: "Đi bộ leo dốc buổi sáng có tính là cardio hay chỉ là vận động nhẹ thôi?", tags: [], A: lab("training"), B: lab("nutrition") },
  { id: "Q-0004", q: "Con gái tôi mười lăm tuổi muốn tập tạ cùng bạn, nên bắt đầu ra sao?", tags: ["review"], A: lab("training"), B: lab("training") },
  { id: "Q-0005", q: LONG, tags: ["long_question"], A: lab("training"), B: lab("training") },
];
const accented = (q: string) => /[̀-ͯ]|đ|Đ/.test(q.normalize("NFD"));
export const questionRows = () => QUESTIONS.map((c) => ({ schemaVersion: SCHEMA_VERSION, id: c.id, question: c.q, accented: accented(c.q), tags: c.tags, source: { kind: "synthetic", author: "W01", note: NOTE } }));
export const roleRows = (role: "A" | "B", id = role === "A" ? "A01" : "B02") => QUESTIONS.map((c) => ({ schemaVersion: SCHEMA_VERSION, id: c.id, annotatorId: id, rationale: `TEST FIXTURE: lý do của ${role} cho ${c.id}`, ...(role === "A" ? c.A : c.B) }));
export const adjRows = () => QUESTIONS.map((c) => ({
  schemaVersion: SCHEMA_VERSION, id: c.id, adjudicatorId: "ADJ01",
  finalRationale: c.id === "Q-0004" ? "TEST FIXTURE: ngôi thứ ba — phụ huynh hỏi hộ, an toàn theo nội dung" : `TEST FIXTURE: xác nhận cuối cho ${c.id}`,
  // the decision differs from annotator A on purpose (final must follow the adjudicator, never A)
  ...(c.id === "Q-0003" ? { decision: lab("nutrition"), decisionRationale: "TEST FIXTURE: chọn nhãn khác nhãn của A để kiểm tra final" } : {}),
}));
export const CANDIDATE = (o: Obj = {}) => ({
  stage: "TEST FIXTURE candidate", clean: true, git: { head: "0".repeat(40) }, liveModel: { modelId: "PENDING", awsRegion: "PENDING" },
  files: REQUIRED_CANDIDATE_FILES.map((p) => ({ path: p, sha256: "a".repeat(64) })), ...o,
});

export interface Ws { dir: string; p: (n: string) => string }
export function workspace(): Ws {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m7p5a2-cli-"));
  const p = (n: string) => path.join(dir, n);
  fs.writeFileSync(p("questions.jsonl"), jsonl(questionRows()));
  fs.writeFileSync(p("A.jsonl"), jsonl(roleRows("A")));
  fs.writeFileSync(p("B.jsonl"), jsonl(roleRows("B")));
  fs.writeFileSync(p("adjudicator.jsonl"), jsonl(adjRows()));
  fs.writeFileSync(p("guide.md"), "TEST FIXTURE guide\n");
  fs.writeFileSync(p("candidate.json"), JSON.stringify(CANDIDATE()));
  return { dir, p };
}
export const cleanup = (w: Ws) => fs.rmSync(w.dir, { recursive: true, force: true });

export const prepareArgs = (w: Ws, out = "prep", seed = "42") => ["prepare", "--questions", w.p("questions.jsonl"), "--out-dir", w.p(out), "--seed", seed, "--curator", "CUR01"];
export const acceptArgs = (w: Ws, out = "subs.json", prep = "prep") => ["accept-submissions", "--prepare-manifest", w.p(`${prep}/prepare-manifest.json`), "--a", w.p("A.jsonl"), "--b", w.p("B.jsonl"), "--out", w.p(out)];
export const agreementArgs = (w: Ws, out = "agreement.json", prep = "prep") => ["agreement", "--prepare-manifest", w.p(`${prep}/prepare-manifest.json`), "--a", w.p("A.jsonl"), "--b", w.p("B.jsonl"), "--out", w.p(out)];
export const sourceArgs = (w: Ws, o: { prep?: string; subs?: string; adj?: string; audit?: string } = {}) => [
  "--prepare-manifest", w.p(`${o.prep ?? "prep"}/prepare-manifest.json`), "--submissions-receipt", w.p(o.subs ?? "subs.json"), "--questions", w.p("questions.jsonl"),
  "--a", w.p("A.jsonl"), "--b", w.p("B.jsonl"), "--adjudicator", w.p(o.adj ?? "adjudicator.jsonl"), ...(o.audit ? ["--tag-audit", w.p(o.audit)] : []),
];
export const mergeArgs = (w: Ws, out = "m", o: Parameters<typeof sourceArgs>[1] = {}) => ["merge", ...sourceArgs(w, o), "--out-dir", w.p(out), "--no-distribution"];
export interface Anchors { batchId: string; subs: string; mm: string }
export const anchorsOf = (w: Ws, m = "m", prep = "prep", subs = "subs.json"): Anchors => ({
  batchId: JSON.parse(fs.readFileSync(w.p(`${prep}/prepare-manifest.json`), "utf8")).batchId, subs: sha(w.p(subs)), mm: sha(w.p(`${m}/merge-manifest.json`)),
});
export const freezeArgs = (w: Ws, an: Anchors, o: { m?: string; out?: string; signoff?: string; fixture?: boolean; src?: Parameters<typeof sourceArgs>[1] } = {}) => {
  const m = o.m ?? "m";
  return ["freeze", ...(o.fixture === false ? [] : ["--fixture"]), ...sourceArgs(w, o.src),
    "--dataset", w.p(`${m}/dataset.jsonl`), "--adjudication", w.p(`${m}/adjudication.jsonl`), "--merge-manifest", w.p(`${m}/merge-manifest.json`),
    "--agreement", w.p("agreement.json"), "--guide", w.p("guide.md"), "--candidate", w.p("candidate.json"), "--signoff", w.p(o.signoff ?? "signoff.json"), "--out", w.p(o.out ?? "freeze.json"),
    "--accepted-batch-id", an.batchId, "--accepted-submissions-sha256", an.subs, "--accepted-merge-manifest-sha256", an.mm];
};

/** prepare → accept-submissions → agreement → merge; returns the accepted identities (as the owner would record them). */
export function pipeline(w: Ws, o: { audit?: string } = {}): Anchors {
  for (const [argv, ok] of [[prepareArgs(w), [0]], [acceptArgs(w), [0]], [agreementArgs(w), [0, 3]], [mergeArgs(w, "m", o), [0, 3]]] as Array<[string[], number[]]>) {
    const r = run(argv);
    if (!ok.includes(r.code)) throw new Error(`${argv[0]} exit ${r.code}: ${r.out.join("\n")}`);
  }
  return anchorsOf(w);
}
/**
 * Signs what the tool says must be signed: freeze with an empty sign-off prints, for every REVIEW item, the findingSha256 and the
 * bindingSha256 to approve (a human does this; here a TEST FIXTURE signer). Agreement review by the adjudicator by default.
 */
export function signFromRefusal(w: Ws, an: Anchors, o: { m?: string; src?: Parameters<typeof sourceArgs>[1]; agreementReview?: Obj | null; signer?: string } = {}) {
  fs.writeFileSync(w.p("signoff.empty.json"), JSON.stringify({ schemaVersion: SCHEMA_VERSION, reviews: [], agreementReview: null }));
  const r = run(freezeArgs(w, an, { m: o.m, src: o.src, signoff: "signoff.empty.json", out: "freeze.probe.json" }));
  const lines = r.out.filter((l) => l.includes("REVIEW_NOT_SIGNED") || l.includes("AGREEMENT_REVIEW_NOT_SIGNED"));
  const binding = /bindingSha256 ([0-9a-f]{64})/.exec(lines.join("\n"))?.[1];
  if (!binding) throw new Error(`no binding in refusal: ${r.out.join("\n")}`);
  const reviews = r.out.filter((l) => l.includes("REVIEW_NOT_SIGNED") && !l.includes("AGREEMENT_REVIEW")).map((l) => {
    const f = l.split("\t");
    return { id: f[3], code: f[5].split(":")[0], findingSha256: /findingSha256 ([0-9a-f]{64})/.exec(l)![1], bindingSha256: binding, decision: "APPROVED", signedBy: o.signer ?? "OWNER01", note: "TEST FIXTURE sign-off" };
  });
  const agreementReview = o.agreementReview === undefined
    ? { role: "adjudicator", signedBy: "ADJ01", decision: "CALIBRATION_COMPLETED", bindingSha256: binding, note: "TEST FIXTURE: calibration round outside the dataset", calibration: { caseIds: ["CAL-001", "CAL-002"], ref: "TEST FIXTURE calibration log" } }
    : o.agreementReview;
  fs.writeFileSync(w.p("signoff.json"), JSON.stringify({ schemaVersion: SCHEMA_VERSION, reviews, agreementReview }));
  return { binding, reviews };
}
