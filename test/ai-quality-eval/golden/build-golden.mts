// Builds the golden regression dataset from the 200 coach cases + the stored answers of ONE run + the CC-rater labels of
// THOSE answers, and a blank human-review sheet. Offline (no model, no network).
//
//   node node_modules/tsx/dist/cli.mjs test/ai-quality-eval/golden/build-golden.mts --rater-md <scores.md> [--label selfjudge]
//
// Label provenance is explicit: the 140/200 labels were produced by Claude Code reading the answers (an LLM rater that had
// seen the code) — labelKind "LLM_RATER", NEVER "HUMAN". Each label is bound to the exact answer it judged (run file +
// sha1), so a label is never compared with a different answer to the same question.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const LABEL = opt("--label", "selfjudge")!;
const MD = opt("--rater-md");
if (!MD || !fs.existsSync(MD)) throw new Error("--rater-md <cc-rater scores.md> is required");
const OUT = path.join(ROOT, "test/ai-quality-eval/golden");
const RESULTS = path.join(ROOT, "test/ai-quality-eval/results");
const { layer1 } = await import(pathToFileURL(path.join(ROOT, "test/ai-quality-eval/layer1-checks.mts")).href);

const cc: Record<string, { score: number; note: string }> = {};
for (const m of fs.readFileSync(MD, "utf8").matchAll(/^\| (B\d-\d\d) \| ([\d.]+) \|(.*)\|$/gm)) cc[m[1]] = { score: +m[2], note: m[3].trim() };

// Failure tags from the rater note (vocabulary used while grading) + Layer-1 flags.
const NOTE_TAGS: Array<[RegExp, string]> = [
  [/template|khung chung|mẫu|lịch mặc định/i, "template_misfire"],
  [/lộ "|FEMALE|vertical_pull/i, "internal_enum_leak"],
  [/Cable Cable|Dumbbell Dumbbell|Seated Seated|Rollout Rollout|Smith Machine Overhead/i, "exercise_name_artifact"],
  [/myth|sai bằng chứng|giữ myth|trái/i, "science_error"],
  [/tuổi|16|52|60|sinh|78|context|bịa/i, "context_error"],
  [/không dụng cụ|thiết bị|người mới|Nordic|Smith/i, "constraint_ignored"],
  [/từ chối|chặn|over-?refus/i, "over_refusal"],
];

const cases: any[] = [];
for (const b of ["b1", "b2", "b3", "b4"]) {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, `test/ai-quality-eval/coach-cases-${b}.json`), "utf8"));
  const file = fs.readdirSync(RESULTS).filter((x) => new RegExp(`^nutrition-coach-${b}-${LABEL}-.*json$`).test(x)).sort().pop()!;
  const res = new Map<string, any>(JSON.parse(fs.readFileSync(path.join(RESULTS, file), "utf8")).results.map((r: any) => [r.id, r]));
  for (const c of spec.cases) {
    const r = res.get(c.id);
    const label = cc[c.id];
    const l1 = r ? layer1({ id: c.id, message: c.message, previousTurns: c.previousTurns ?? [], answer: r.answer, responseSource: r.responseSource }) : { flags: [] };
    const tags = new Set<string>(l1.flags);
    if (label && label.score < 3) for (const [re, t] of NOTE_TAGS) if (re.test(label.note)) tags.add(t);
    cases.push({
      id: c.id,
      batch: b,
      category: c.category,
      persona: c.persona,
      // stateless = no profile-dependent content needed; stateful = needs the persona fixture; multi_turn = shares a session
      mode: c.previousTurns?.length ? "multi_turn" : /\b(tôi|em|mình)\b/i.test(c.message) ? "stateful" : "stateless",
      previousTurns: c.previousTurns ?? [],
      message: c.message,
      topic: c.topic ?? null,
      reference: c.reference ?? null,
      safety: c.safety ?? null,
      baseline: r ? {
        run: LABEL, file, responseSource: r.responseSource ?? null,
        answerSha1: createHash("sha1").update(String(r.answer ?? "")).digest("hex"),
        checkerPass: !!r.casePass, // automated checker — NOT a quality judgement
      } : null,
      labels: label ? [{
        rater: "claude-code-session-2026-11-11", labelKind: "LLM_RATER", scale: "1-5", passRule: "score>=3",
        score: label.score, pass: label.score >= 3, note: label.note, judgedAnswerSha1: r ? createHash("sha1").update(String(r.answer ?? "")).digest("hex") : null,
      }] : [],
      failureTags: [...tags],
      layer1Flags: l1.flags,
    });
  }
}

fs.mkdirSync(OUT, { recursive: true });
const golden = {
  name: "gymini-coach-golden", version: "v1", createdAt: new Date().toISOString(),
  notes: [
    "Labels are LLM_RATER (Claude Code), not human. Human labels go in labels[] with labelKind HUMAN via human-review-v1.csv.",
    "A label applies ONLY to the answer with the same sha1. Re-runs produce new answers that need new labels (or Layer-1/2 checks).",
    "checkerPass is the automated format checker, not a correctness verdict.",
  ],
  personas: JSON.parse(fs.readFileSync(path.join(ROOT, "test/ai-quality-eval/coach-cases-b1.json"), "utf8")).personas,
  summary: {
    cases: cases.length,
    byMode: cases.reduce((a: any, c) => ((a[c.mode] = (a[c.mode] ?? 0) + 1), a), {}),
    ccRaterPass: cases.filter((c) => c.labels[0]?.pass).length,
    withLayer1Flags: cases.filter((c) => c.layer1Flags.length).length,
    failureTags: cases.flatMap((c) => c.failureTags).reduce((a: any, t: string) => ((a[t] = (a[t] ?? 0) + 1), a), {}),
  },
  cases,
};
fs.writeFileSync(path.join(OUT, "coach-golden-v1.json"), JSON.stringify(golden, null, 2));

// Human review sheet (Layer 3). Priority: CC-rater fail, Layer-1 flagged, safety cases, then the rest.
const csv = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ⏎ ")}"`;
const answers = new Map<string, string>();
for (const b of ["b1", "b2", "b3", "b4"]) {
  const file = fs.readdirSync(RESULTS).filter((x) => new RegExp(`^nutrition-coach-${b}-${LABEL}-.*json$`).test(x)).sort().pop()!;
  for (const r of JSON.parse(fs.readFileSync(path.join(RESULTS, file), "utf8")).results) answers.set(r.id, r.answer);
}
const prio = (c: any) => (c.labels[0] && !c.labels[0].pass ? 0 : c.layer1Flags.length ? 1 : c.safety ? 2 : 3);
const rows = [...cases].sort((a, b) => prio(a) - prio(b) || a.id.localeCompare(b.id));
const header = ["priority", "id", "category", "persona", "previous_turns", "question", "answer", "answer_sha1", "reference", "human_rater_id", "human_score_1_5", "human_pass", "scientific_error", "context_error", "constraint_ignored", "unsafe", "comment"];
fs.writeFileSync(path.join(OUT, "human-review-v1.csv"), "﻿" + [header.join(","), ...rows.map((c) => [prio(c), c.id, c.category, c.persona, (c.previousTurns ?? []).join(" | "), c.message, answers.get(c.id), c.baseline?.answerSha1, c.reference, "", "", "", "", "", "", "", ""].map(csv).join(","))].join("\n"));
console.log(JSON.stringify(golden.summary, null, 2));
console.log("written", path.relative(ROOT, path.join(OUT, "coach-golden-v1.json")), "and human-review-v1.csv");
