/**
 * M8-A5 — CLI vận hành pilot (chỉ đọc; không ghi tệp, không mạng, không DB).
 *   npx tsx src/__tests__/m7-benchmark/pilot-ops/pilot-ops-cli.ts dup-check --candidates <jsonl> [--ban <jsonl> ...] [--no-benchmark] [--forbid-reserved-ids]
 *   npx tsx src/__tests__/m7-benchmark/pilot-ops/pilot-ops-cli.ts pilot-check --questions <jsonl> --stage writer|curated [--allocation <csv>]
 * Mã thoát: 0 sạch; 1 có lỗi phải sửa; 3 chỉ có mục REVIEW (dup-check); 2 sai cú pháp / không đọc được tệp.
 * Đầu ra chỉ có id, verdict, độ tương đồng, mã lỗi. KHÔNG in nội dung câu hỏi nào (benchmark hay ứng viên).
 */
import fs from "node:fs";
import { checkDuplicates, formatMatch, historicalBenchmarkSets, type QItem, type RefSet } from "./near-duplicate";
import { checkAllocation, checkPilotQuestions, parseAllocationCsv, parseJsonl, type PilotFinding } from "./pilot-distribution";

type Out = (s: string) => void;

function arg(argv: string[], name: string): string | undefined { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }
function args(argv: string[], name: string): string[] { const o: string[] = []; argv.forEach((a, i) => { if (a === name && argv[i + 1]) o.push(argv[i + 1]); }); return o; }

function loadItems(path: string, findings: PilotFinding[]): QItem[] {
  const { rows, findings: pf } = parseJsonl(fs.readFileSync(path, "utf8"));
  findings.push(...pf);
  const out: QItem[] = [];
  for (const r of rows) {
    const o = r.raw as Record<string, unknown>;
    if (o && typeof o.id === "string" && typeof o.question === "string") out.push({ id: o.id, question: o.question });
    else findings.push({ code: "ROW_NO_ID_OR_QUESTION", id: null, line: r.line, detail: "dòng thiếu id hoặc question dạng chuỗi" });
  }
  return out;
}

export function main(argv: string[], out: Out = (s) => process.stdout.write(s + "\n")): number {
  const cmd = argv[0];
  try {
    if (cmd === "dup-check") {
      const cPath = arg(argv, "--candidates");
      if (!cPath) { out("thiếu --candidates"); return 2; }
      const problems: PilotFinding[] = [];
      const cands = loadItems(cPath, problems);
      const refSets: RefSet[] = [];
      for (const p of args(argv, "--ban")) refSets.push({ scope: `BAN:${p.split(/[\\/]/).pop()}`, items: loadItems(p, problems) });
      if (!argv.includes("--no-benchmark")) refSets.push(...historicalBenchmarkSets());
      for (const p of problems) out(`INPUT_PROBLEM\t${p.code}\tline=${p.line}\t${p.detail}`);
      const rep = checkDuplicates(cands, { refSets, forbidReservedIdPrefixes: argv.includes("--forbid-reserved-ids") });
      for (const m of rep.errors) out(formatMatch(m));
      for (const m of rep.reviews) out(formatMatch(m));
      for (const p of rep.idProblems) out(`ID_PROBLEM\t${p.candidateId}\t${p.code}`);
      out(`SUMMARY candidates=${rep.counts.candidates} errors=${rep.counts.errors} reviews=${rep.counts.reviews} clean=${rep.counts.clean} idProblems=${rep.idProblems.length} inputProblems=${problems.length} refSets=${JSON.stringify(rep.counts.refSets)}`);
      if (rep.errors.length || rep.idProblems.length || problems.length) return 1;
      return rep.reviews.length ? 3 : 0;
    }
    if (cmd === "pilot-check") {
      const qPath = arg(argv, "--questions"), stage = arg(argv, "--stage");
      if (!qPath || (stage !== "writer" && stage !== "curated")) { out("cần --questions <jsonl> và --stage writer|curated"); return 2; }
      const { rows, findings: pf } = parseJsonl(fs.readFileSync(qPath, "utf8"));
      const res = checkPilotQuestions(rows, { stage });
      const all: PilotFinding[] = [...pf, ...res.findings];
      const aPath = arg(argv, "--allocation");
      if (aPath) {
        if (stage !== "curated") { out("--allocation chỉ dùng với --stage curated"); return 2; }
        const a = parseAllocationCsv(fs.readFileSync(aPath, "utf8"));
        all.push(...a.findings, ...checkAllocation(rows, a.rows));
      }
      for (const x of all) out(`${x.code}\tline=${x.line}\t${x.id ?? "-"}\t${x.detail}`);
      out(`SUMMARY rows=${res.stats.rows} findings=${all.length} authors=${JSON.stringify(res.stats.authors)} unaccentedByAuthor=${JSON.stringify(res.stats.unaccentedByAuthor)} allocation=${aPath ? "checked" : "not-checked"}`);
      return all.length ? 1 : 0;
    }
  } catch (e) { out(`LỖI: ${(e as Error).message}`); return 2; }
  out("cú pháp: dup-check --candidates <jsonl> [--ban <jsonl>]... [--no-benchmark] [--forbid-reserved-ids] | pilot-check --questions <jsonl> --stage writer|curated [--allocation <csv>]");
  return 2;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
