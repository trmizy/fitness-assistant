/**
 * Phase 4.7R6 — local, CSV-based annotation workflow for the independent query-routing corpus. No cloud, no model.
 *
 *   export-blind --in=candidates.csv --out=batch.csv            id,text only (shuffled; no family, no predictions)
 *   annotate     --in=batch.csv --annotator=A01 --out=a01.csv   blind terminal labelling; resumable
 *   audit        --in=candidates.csv [--refs-dir=data/eval/retrieval]   PII / duplicates / near-duplicates / V1-V5 leakage
 *   agreement    --a=a01.csv --b=a02.csv --column=safetyLabel   raw agreement + Cohen's kappa
 *
 * candidates.csv columns: id,familyId,text      annotation csv columns: id,text,annotator,safetyLabel,programmingLabel,domain,tags,uncertain,comment,timestamp
 * Annotators are pseudonymous ids (A01, A02 …). The tool never shows model / resolver output.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { auditAnnotationFile, axisReport, canonicalBatchHash, checkSameBatch, validateHumanProvenance, verifyGuidelineFreeze } from "../llm/query-routing-data/routing-provenance";
import { parseCsv, toCsv, blindExport, findExactDuplicates, findNearDuplicates, findLeakage, confusionMatrix, forbiddenColumns, validateRow, cohenKappa, rawAgreement, SAFETY_LABELS, PROGRAMMING_LABELS, DOMAIN_LABELS, type AnnotationRow } from "../llm/query-routing-data/routing-data-tools";

const args = Object.fromEntries(process.argv.slice(3).map((a) => a.replace(/^--/, "").split("=") as [string, string]));
const cmd = process.argv[2];
const COLS = ["id", "text", "annotator", "safetyLabel", "programmingLabel", "domain", "tags", "uncertain", "comment", "timestamp"];

function readCsv(file: string): Array<Record<string, string>> {
  const [head, ...rest] = parseCsv(fs.readFileSync(file, "utf8"));
  const bad = forbiddenColumns(head);
  if (bad.length) throw new Error(`forbidden personal-data column(s) in ${path.basename(file)}: ${bad.join(", ")}`);
  return rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
function rowsOf(file: string): AnnotationRow[] {
  // accepts the human-workflow column names too: scenario_id / family_id / utterance
  return readCsv(file).map((r) => ({ id: r.id ?? r.scenario_id, familyId: r.familyId ?? r.family_id ?? "", text: r.text ?? r.utterance }));
}

async function main() {
  if (cmd === "export-blind") {
    const rows = blindExport(rowsOf(args.in));
    fs.writeFileSync(args.out, toCsv([["id", "text"], ...rows.map((r) => [r.id, r.text])]));
    console.log(`blind batch: ${rows.length} rows -> ${args.out}`);
  } else if (cmd === "audit") {
    const rows = rowsOf(args.in);
    const refs: string[] = [];
    const dir = args["refs-dir"];
    if (dir) for (const f of fs.readdirSync(dir).filter((x) => /^rag-grounding-.*\.json$/.test(x) && !/results/.test(x))) {
      try { const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); for (const it of Array.isArray(j) ? j : j.items ?? j.queries ?? []) if (typeof it.q === "string") refs.push(it.q); } catch { /* skip */ }
    }
    const schema = rows.flatMap((r) => validateRow(r).map((e) => `${r.id}: ${e}`));
    const out = { rows: rows.length, families: new Set(rows.map((r) => r.familyId)).size, schemaErrors: schema, exactDuplicates: findExactDuplicates(rows), nearDuplicates: findNearDuplicates(rows), leakage: findLeakage(rows, refs), referenceSentences: refs.length };
    console.log(JSON.stringify(out, null, 1));
    if (schema.length || out.exactDuplicates.length || out.leakage.length) process.exitCode = 1;
  } else if (cmd === "agreement") {
    const a = readCsv(args.a), b = readCsv(args.b), col = args.column ?? "safetyLabel";
    const bm = new Map(b.map((r) => [r.id, r[col]]));
    const pairs = a.filter((r) => bm.has(r.id) && r[col] && bm.get(r.id)).map((r) => [r[col], bm.get(r.id)!]);
    const A = pairs.map((p) => p[0]), B = pairs.map((p) => p[1]);
    const am = new Map(a.map((r) => [r.id, r]));
    const disagreements = [...bm].filter(([id, lb]) => am.get(id)?.[col] && lb && am.get(id)![col] !== lb).map(([id, lb]) => ({ id, text: am.get(id)!.text, labelA: am.get(id)![col], labelB: lb, uncertainA: am.get(id)!.uncertain, commentA: am.get(id)!.comment }));
    console.log(JSON.stringify({ authority: "SIMULATED_TOOLING_DIAGNOSTIC", note: "not independent-human evidence; use human-intake for independent analysis", column: col, n: pairs.length, rawAgreement: rawAgreement(A, B), cohenKappa: cohenKappa(A, B), confusionMatrix: confusionMatrix(A, B), disagreements }, null, 1));
  } else if (cmd === "human-intake") {
    // fails closed unless BOTH human files + provenance + same batch + frozen guideline all validate
    const dir = args.dir, batchFile = args.batch, freezeFile = args.freeze, outDir = args.out;
    const verdict = (v: string, extra: object = {}) => { console.log(JSON.stringify({ authority: v === "HUMAN_PILOT_AGREEMENT_READY" ? "INDEPENDENT_HUMAN_LABELS_ON_SYNTHETIC_UTTERANCES" : "NONE", verdict: v, ...extra }, null, 1)); process.exitCode = v === "HUMAN_PILOT_AGREEMENT_READY" ? 0 : 3; };
    const paths = { a: path.join(dir, "pilot_A01.csv"), b: path.join(dir, "pilot_A02.csv"), pa: path.join(dir, "pilot_A01.provenance.json"), pb: path.join(dir, "pilot_A02.provenance.json") };
    const missing = Object.values(paths).filter((f) => !fs.existsSync(f)).map((f) => path.basename(f));
    if (missing.length) return verdict("REAL_HUMAN_ANNOTATION_REQUIRED", { missing, code: "INDEPENDENT_HUMAN_PROVENANCE_REQUIRED" });
    const freeze = JSON.parse(fs.readFileSync(freezeFile, "utf8"));
    const guideline = fs.readFileSync(path.join(path.dirname(freezeFile), freeze.file));
    const gcheck = verifyGuidelineFreeze(freeze, guideline);
    if (!gcheck.ok) return verdict("HUMAN_PILOT_AUDIT_BLOCKED", { code: gcheck.code, errors: gcheck.errors });
    const batch = readCsv(batchFile).map((r) => ({ id: r.id, text: r.text }));
    const batchHash = canonicalBatchHash(batch);
    const load = (f: string) => { const [head, ...rest] = parseCsv(fs.readFileSync(f, "utf8")); const bad = forbiddenColumns(head); if (bad.length) throw new Error(`forbidden column(s): ${bad.join(",")}`); return { head, rows: rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""]))) as Array<Record<string, string>> }; };
    const A = load(paths.a), B = load(paths.b);
    const exp = (id: string) => ({ annotatorId: id, batchHash, guidelineVersion: freeze.version, guidelineHash: freeze.sha256 });
    const provA = validateHumanProvenance(JSON.parse(fs.readFileSync(paths.pa, "utf8")), exp("A01"));
    const provB = validateHumanProvenance(JSON.parse(fs.readFileSync(paths.pb, "utf8")), exp("A02"));
    const auditA = auditAnnotationFile(A.rows, A.head, batch, "A01"), auditB = auditAnnotationFile(B.rows, B.head, batch, "A02");
    const same = checkSameBatch(batch, A.rows.map((r) => ({ id: r.id, text: r.text })), B.rows.map((r) => ({ id: r.id, text: r.text })));
    const gates = { A01_PROVENANCE: provA, A02_PROVENANCE: provB, A01_AUDIT: auditA, A02_AUDIT: auditB, SAME_BATCH: same };
    if (Object.values(gates).some((g) => !g.ok)) return verdict("HUMAN_PILOT_AUDIT_BLOCKED", { batchHash, gates });
    const safety = axisReport("safetyLabel", A.rows, B.rows), programming = axisReport("programmingLabel", A.rows, B.rows);
    const result = { batchHash, guideline: { version: freeze.version, sha256: freeze.sha256 }, gates, safety, programming, adjudication: "NOT_RUN (manual)" };
    if (outDir) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, "human_pilot_agreement.json"), JSON.stringify(result, null, 2)); fs.writeFileSync(path.join(outDir, "safety_disagreements.csv"), toCsv([["id", "text", "labelA01", "labelA02", "uncertainA01", "uncertainA02", "commentA01", "commentA02"], ...safety.disagreements.map((d) => [d.id, d.text, d.labelA01, d.labelA02, d.uncertainA01, d.uncertainA02, d.commentA01, d.commentA02])])); fs.writeFileSync(path.join(outDir, "programming_disagreements.csv"), toCsv([["id", "text", "labelA01", "labelA02", "uncertainA01", "uncertainA02", "commentA01", "commentA02"], ...programming.disagreements.map((d) => [d.id, d.text, d.labelA01, d.labelA02, d.uncertainA01, d.uncertainA02, d.commentA01, d.commentA02])])); }
    verdict("HUMAN_PILOT_AGREEMENT_READY", result);
  } else if (cmd === "annotate") {
    const batch = readCsv(args.in);
    const done = new Set(fs.existsSync(args.out) ? readCsv(args.out).map((r) => r.id) : []);
    if (!fs.existsSync(args.out)) fs.writeFileSync(args.out, toCsv([COLS]));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));
    const pick = async (label: string, opts: readonly string[], optional = false) => {
      for (;;) {
        const v = (await ask(`${label} ${opts.map((o, i) => `${i + 1}=${o}`).join(" ")}${optional ? " (enter=skip)" : ""}: `)).trim();
        if (!v && optional) return "";
        const i = Number(v) - 1;
        if (opts[i]) return opts[i];
      }
    };
    for (const r of batch) {
      if (done.has(r.id)) continue;
      console.log(`\n[${r.id}] ${r.text}`);
      const safetyLabel = await pick("safety", SAFETY_LABELS);
      const programmingLabel = await pick("programming", PROGRAMMING_LABELS);
      const domain = await pick("domain", DOMAIN_LABELS, true);
      const uncertain = (await ask("uncertain? (y/N): ")).trim().toLowerCase() === "y";
      const comment = (await ask("comment (optional): ")).trim();
      fs.appendFileSync(args.out, toCsv([[r.id, r.text, args.annotator, safetyLabel, programmingLabel, domain, "", String(uncertain), comment, new Date().toISOString()]]));
    }
    rl.close();
  } else {
    console.error("usage: export-blind | annotate | audit | agreement | human-intake  (see file header)");
    process.exitCode = 2;
  }
}
main();
