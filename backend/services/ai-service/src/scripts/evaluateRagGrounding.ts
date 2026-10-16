/**
 * Phase 4.6 — retrieval GROUNDING evaluation (not an answer benchmark).
 *
 *   npx tsx src/scripts/evaluateRagGrounding.ts --mode=baseline|v2 [--out=file.json] [--embed-cache=file.json]
 *
 * Runs the real retriever (`retriever.retrieveForChat`) against the real Qdrant with a CPU-ONLY embedder
 * (Ollama `nomic-embed-text`, options.num_gpu=0) so it never competes for VRAM with a training session.
 * `--mode=v2` sets RAG_RETRIEVAL_V2=on for the process; baseline leaves it unset (current production path).
 * Gold file: data/eval/retrieval/rag-grounding-eval-v1.json
 */
import fs from "node:fs";
import path from "node:path";
import { retriever, retrieverDeps } from "../llm/retriever";
import { compactRetrieval } from "../llm/prompt_builder";
import { classifySource, type SourceClass } from "../llm/knowledge-source";
import type { RetrievalDocument } from "../llm/types";
import { evaluateGate, type GateThresholds } from "../llm/rag-gate";
import { resolveSafetySignals } from "../llm/safety-signals";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=") as [string, string]));
const MODE = (args.mode ?? "baseline") as "baseline" | "v2";
if (MODE === "v2") process.env.RAG_RETRIEVAL_V2 = "on";
const OLLAMA = process.env.LLM_BASE_URL || "http://localhost:11434";
const MODEL = process.env.EMBEDDING_MODEL || "nomic-embed-text";
const CACHE_FILE = args["embed-cache"] ?? "";
const cache: Record<string, number[]> = CACHE_FILE && fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) : {};

async function cpuEmbed(text: string): Promise<number[]> {
  if (cache[text]) return cache[text];
  const r = await fetch(`${OLLAMA}/api/embeddings`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt: text, options: { num_gpu: 0 } }),
  });
  if (!r.ok) throw new Error(`embedding http ${r.status}`);
  const v = ((await r.json()) as { embedding: number[] }).embedding;
  cache[text] = v;
  return v;
}
retrieverDeps.embed = (async (text: string) => cpuEmbed(text)) as typeof retrieverDeps.embed;

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
type Expect = "EVIDENCE_EXPECTED" | "REFERENCE_ACCEPTABLE" | "CATALOG_EXPECTED" | "SAFE_ABSTENTION_EXPECTED" | "NO_SOURCE_EXPECTED";
interface Item { id: string; q: string; domain: string; /** OOD family label for the false-source breakdown */ oodClass?: string; /** expected safety signal level (Phase 4.7R3) */ safety?: "HIGH_RISK" | "CAUTION" | "NONE"; /** the item is a first-person / current-state narrative (4.7R4) */ personal?: boolean; pref?: "EVIDENCE" | "REFERENCE" | "CATALOG" | "ANY"; expect?: Expect; kw: string[]; noSynth?: boolean; inScope?: boolean; conflictProbe?: boolean }
const PREF_OF: Record<Expect, "EVIDENCE" | "REFERENCE" | "CATALOG" | "ANY"> = { EVIDENCE_EXPECTED: "EVIDENCE", REFERENCE_ACCEPTABLE: "REFERENCE", CATALOG_EXPECTED: "CATALOG", SAFE_ABSTENTION_EXPECTED: "EVIDENCE", NO_SOURCE_EXPECTED: "ANY" };

function docClass(d: RetrievalDocument): SourceClass {
  const ks = (d.metadata as any)?.knowledgeSource;
  if (ks?.sourceClass) return ks.sourceClass as SourceClass;
  const collection = d.source.replace(/^[a-z]+:/, "");
  return classifySource(collection, { ...(d.metadata as Record<string, unknown>) });
}
const norm = (d: RetrievalDocument) => fold(d.pageContent).replace(/\s+/g, " ");
const isRelevant = (d: RetrievalDocument, kw: string[]) => kw.some((k) => norm(d).includes(fold(k)));
function jaccard(a: string, b: string): number {
  const A = new Set(a.split(" ").filter((w) => w.length > 3)), B = new Set(b.split(" ").filter((w) => w.length > 3));
  if (!A.size || !B.size) return 0;
  let i = 0; for (const w of A) if (B.has(w)) i++;
  return i / (A.size + B.size - i);
}

(async () => {
  const goldFile = args.gold ?? "rag-grounding-eval-v1.json";
  const gold = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../../data/eval/retrieval", goldFile), "utf8")) as { items: Item[]; gate?: { thresholds: GateThresholds } };
  for (const it of gold.items) {
    if (it.expect) { it.pref = PREF_OF[it.expect]; it.inScope = it.expect !== "NO_SOURCE_EXPECTED"; it.noSynth = it.noSynth ?? it.expect === "EVIDENCE_EXPECTED"; }
    it.pref = it.pref ?? "ANY"; it.noSynth = it.noSynth ?? false;
  }
  const rows: any[] = [];
  for (const it of gold.items) {
    const t0 = Date.now();
    const res = await retriever.retrieveForChat(it.q).catch((e) => ({ documents: [] as RetrievalDocument[], isEmpty: true, reason: String(e) }));
    const latencyMs = Date.now() - t0;
    const docs = res.documents;
    const ctx = compactRetrieval(res as any);
    const classes = docs.map(docClass);
    let dup = 0;
    docs.forEach((d, i) => { if (docs.slice(0, i).some((e) => jaccard(norm(d), norm(e)) >= 0.9)) dup++; });
    rows.push({
      id: it.id, q: it.q, domain: it.domain, pref: it.pref, noSynth: it.noSynth, inScope: it.inScope !== false, abstain: it.expect === "SAFE_ABSTENTION_EXPECTED", oodClass: it.oodClass ?? null, safetyExpected: it.safety ?? null, personalLabel: it.personal === true, safetyLevel: resolveSafetySignals(it.q).level, conflictProbe: !!it.conflictProbe,
      latencyMs, empty: docs.length === 0, n: docs.length, dup,
      ctxChars: ctx.length, ctxTokensEst: Math.ceil(ctx.length / 3),
      top: docs.map((d, i) => {
        const ks = (d.metadata as any)?.knowledgeSource;
        return {
          rank: i + 1, collection: d.source, class: classes[i], score: Number(d.score.toFixed(3)), relevant: it.inScope === false ? false : isRelevant(d, it.kw),
          title: ks?.title ?? (d.metadata as any)?.title ?? null,
          titleRelevant: it.inScope === false ? false : it.kw.some((k) => fold(String(ks?.title ?? (d.metadata as any)?.title ?? "")).includes(fold(k))), hasUrl: Boolean(ks?.url ?? (d.metadata as any)?.source_url),
          hasId: Boolean(ks?.sourceId ?? (d.metadata as any)?.document_id ?? (d.metadata as any)?.chunk_id), snippet: d.pageContent.replace(/\s+/g, " ").slice(0, 110),
          conflictNote: Boolean((d.metadata as any)?.conflictNote),
        };
      }),
      reason: (res as any).reason ?? null,
    });
    process.stdout.write(".");
  }
  console.log("");
  if (CACHE_FILE) fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));

  // SAFE_ABSTENTION_EXPECTED items are scored separately (truthful abstention is success, not an empty-retrieval failure)
  const abst = rows.filter((r) => r.abstain);
  const inScope = rows.filter((r) => r.inScope && !r.abstain);
  const rate = (arr: any[], f: (r: any) => boolean) => (arr.length ? Math.round((arr.filter(f).length / arr.length) * 1000) / 1000 : null);
  const sci = inScope.filter((r) => r.pref === "EVIDENCE");
  const noSynth = inScope.filter((r) => r.noSynth);
  const top = (r: any, k: number) => r.top.slice(0, k);
  const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
  const metrics = {
    mode: MODE, queries: rows.length, inScope: inScope.length,
    emptyRetrievalRate_inScope: rate(inScope, (r) => r.empty),
    falseSourceRate_outOfScope: rate(rows.filter((r) => !r.inScope), (r) => !r.empty),
    safetySignals: (() => {
      const pos = rows.filter((r) => r.safetyExpected === "HIGH_RISK" || r.safetyExpected === "CAUTION");
      const high = rows.filter((r) => r.safetyExpected === "HIGH_RISK");
      const neg = rows.filter((r) => r.safetyExpected === "NONE" || (r.safetyExpected === null && r.domain !== "SAFETY"));
      const rate = (a: any[], f: (r: any) => boolean) => (a.length ? Math.round((a.filter(f).length / a.length) * 1000) / 1000 : null);
      return { positives: pos.length, recall: rate(pos, (r) => r.safetyLevel !== "NONE"), highRiskRecall: rate(high, (r) => r.safetyLevel === "HIGH_RISK"), negatives: neg.length, falsePositiveRate: rate(neg, (r) => r.safetyLevel !== "NONE"), falsePositives: neg.filter((r) => r.safetyLevel !== "NONE").map((r) => r.id) };
    })(),
    personalHighRiskGenericFallthrough: (() => { const pf = rows.filter((r) => r.personalLabel && (r.safetyExpected === "HIGH_RISK" || r.safetyExpected === "CAUTION")); return { n: pf.length, count: pf.filter((r) => r.top.some((d: any) => !(d.class === "CURATED_EVIDENCE" && (d.relevant || d.titleRelevant)))).length }; })(),
    unsafeGenericSafetyFallthrough: (() => { const sf = rows.filter((r) => r.domain === "SAFETY" || r.safetyExpected === "HIGH_RISK" || r.safetyExpected === "CAUTION"); return { n: sf.length, count: sf.filter((r) => r.top.some((d: any) => !(d.class === "CURATED_EVIDENCE" && (d.relevant || d.titleRelevant)))).length }; })(),
    falseSourceByClass: (() => { const o = rows.filter((r) => !r.inScope); const by: Record<string, { n: number; leaks: number }> = {}; for (const r of o) { const k = r.oodClass ?? "UNLABELLED"; by[k] = by[k] ?? { n: 0, leaks: 0 }; by[k].n++; if (!r.empty) by[k].leaks++; } return by; })(),
    ambiguousTermOodPrecision: (() => { const a = rows.filter((r) => !r.inScope && r.oodClass === "AMBIGUOUS_TERM"); return a.length ? Math.round((a.filter((r) => r.empty).length / a.length) * 1000) / 1000 : null; })(),
    safeAbstention: { n: abst.length, success: rate(abst, (r) => r.empty || r.top.every((d: any) => d.class === "CURATED_EVIDENCE" && d.relevant)), returnedNonTrusted: rate(abst, (r) => r.top.some((d: any) => d.class !== "CURATED_EVIDENCE" || !d.relevant)) },
    topicHit_at3_inScope: rate(inScope, (r) => top(r, 3).some((d: any) => d.relevant)),
    topicHit_at1_inScope: rate(inScope, (r) => top(r, 1).some((d: any) => d.relevant)),
    curatedEvidence_at1_sciQueries: rate(sci, (r) => top(r, 1).some((d: any) => d.class === "CURATED_EVIDENCE")),
    curatedEvidence_at3_sciQueries: rate(sci, (r) => top(r, 3).some((d: any) => d.class === "CURATED_EVIDENCE")),
    relevantCuratedEvidence_at1_sciQueries: rate(sci, (r) => top(r, 1).some((d: any) => d.class === "CURATED_EVIDENCE" && d.relevant)),
    relevantCuratedEvidence_at3_sciQueries: rate(sci, (r) => top(r, 3).some((d: any) => d.class === "CURATED_EVIDENCE" && d.relevant)),
    syntheticTop1Rate_noSynthQueries: rate(noSynth, (r) => r.top[0]?.class === "SYNTHETIC_KNOWLEDGE"),
    syntheticTop1Rate_all: rate(inScope, (r) => r.top[0]?.class === "SYNTHETIC_KNOWLEDGE"),
    catalogTop1Rate_catalogQueries: rate(inScope.filter((r) => r.pref === "CATALOG"), (r) => r.top[0]?.class === "CATALOG"),
    catalogRecall_at3_catalogQueries: rate(inScope.filter((r) => r.pref === "CATALOG"), (r) => top(r, 3).some((d: any) => d.class === "CATALOG" && d.relevant)),
    duplicateRate: Math.round((rows.reduce((s, r) => s + r.dup, 0) / Math.max(1, rows.reduce((s, r) => s + r.n, 0))) * 1000) / 1000,
    provenanceCompleteness_curatedEvidence: (() => { const all = rows.flatMap((r) => r.top.filter((d: any) => d.class === "CURATED_EVIDENCE")); return all.length ? Math.round((all.filter((d: any) => d.title && (d.hasUrl || d.hasId)).length / all.length) * 1000) / 1000 : null; })(),
    ctxTokensEst: { p50: pct(rows.map((r) => r.ctxTokensEst), 0.5), p90: pct(rows.map((r) => r.ctxTokensEst), 0.9), max: Math.max(...rows.map((r) => r.ctxTokensEst)) },
    latencyMs: { p50: pct(rows.map((r) => r.latencyMs), 0.5), p90: pct(rows.map((r) => r.latencyMs), 0.9) },
    avgDocsReturned: Math.round((rows.reduce((s, r) => s + r.n, 0) / rows.length) * 100) / 100,
  };
  const byDomain: Record<string, any> = {};
  for (const dom of [...new Set(inScope.map((r) => r.domain))]) {
    const g = inScope.filter((r) => r.domain === dom);
    byDomain[dom] = {
      n: g.length, topicHit_at3: rate(g, (r) => top(r, 3).some((d: any) => d.relevant)),
      relevantCuratedEvidence_at3: rate(g, (r) => top(r, 3).some((d: any) => d.class === "CURATED_EVIDENCE" && d.relevant)),
      syntheticTop1: rate(g, (r) => r.top[0]?.class === "SYNTHETIC_KNOWLEDGE"), empty: rate(g, (r) => r.empty),
    };
  }
  const out: Record<string, unknown> = { gold: goldFile, metrics, byDomain, rows };
  if (gold.gate) {
    const baseline = args.baseline && fs.existsSync(args.baseline) ? (JSON.parse(fs.readFileSync(args.baseline, "utf8")) as { metrics?: Record<string, number | null> }).metrics ?? null : null;
    out.gate = evaluateGate(metrics as never, gold.gate.thresholds, { baseline: baseline as never, byDomain });
  }
  if (args.out) fs.writeFileSync(args.out, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ metrics, byDomain, gate: out.gate }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
