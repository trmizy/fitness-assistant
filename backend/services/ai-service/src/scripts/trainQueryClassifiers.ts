/**
 * Phase 4.7R5 — offline trainer for the two small query ROUTERS (no LLM / GPU / sklearn at runtime).
 *
 *   --stage=train   split by TEMPLATE FAMILY (70/15/15), leakage check, train 2 fixed candidates per task
 *                   (frozen nomic-embed-text 768-d + LR, TF-IDF word+char + LR), Platt-calibrate on the
 *                   CALIBRATION split, pick threshold + candidate on train+calibration ONLY. Never reads the test split's labels.
 *   --stage=test    requires predeclared-targets file; evaluates the selected candidates on the internal test split EXACTLY ONCE
 *                   (refuses to run a second time), compares with the deterministic V2.4 resolver, writes artifacts when passing.
 *
 * Routers only: output is {SAFETY_HANDLING_REQUIRED|NORMAL_QUERY} / {PROGRAMMING|NOT_PROGRAMMING}. They never diagnose, prescribe or select sources.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolveSafetySignals } from "../llm/safety-signals";
import { detectConcepts } from "../llm/fitness-concepts";
import { foldQuery, tfidfFeatures, type TfidfModel } from "../llm/query-classifiers/classifier-runtime";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=") as [string, string]));
const STAGE = args.stage ?? "train";
const REPO = path.resolve(__dirname, "../../../../..");
const DATA = path.join(REPO, "data/eval/query-classifiers");
const ART = path.join(REPO, "backend/services/ai-service/src/llm/query-classifiers/artifacts");
const OLLAMA = process.env.LLM_BASE_URL || "http://localhost:11434";
const MODEL = "nomic-embed-text";
const WORK = args.work ?? path.join(REPO, ".dev", "r5-work");
fs.mkdirSync(WORK, { recursive: true });
const EMB_CACHE = args["embed-cache"] ?? path.join(WORK, "embed-cache.json");

const sha = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");
type Family = { id: string; label: 0 | 1; cls: string; s: string[] };
type Ex = { id: string; family: string; cls: string; label: 0 | 1; text: string; split: "train" | "calibration" | "test" };

const TASKS = {
  safety: { files: ["personal-safety-families-v1.json", "personal-safety-families-v1b.json", "personal-safety-families-v1c.json"], name: "personal-safety-router", positive: "SAFETY_HANDLING_REQUIRED", negative: "NORMAL_QUERY" },
  programming: { files: ["programming-families-v1.json", "programming-families-v1b.json", "programming-families-v1c.json"], name: "programming-domain-router", positive: "PROGRAMMING", negative: "NOT_PROGRAMMING" },
} as const;
type TaskKey = keyof typeof TASKS;

const TRAIN_CONFIG = { optimizer: "adam", lr: 0.05, epochs: 600, l2: 0.005, classWeights: "balanced", tfidf: { minDf: 2, maxFeatures: 6000, charNgrams: [3, 4], wordNgrams: [1, 2], sublinearTf: true }, calibration: "platt", split: "family-rank 70/15/15 within label by sha256(familyId)" };
const TRAIN_CONFIG_HASH = sha(JSON.stringify(TRAIN_CONFIG));

// ---------- data ----------
function loadTask(key: TaskKey): { examples: Ex[]; manifest: any; datasetHash: string; leak: ReturnType<typeof leakageCheck> } {
  const fams: Family[] = [];
  const raw: string[] = [];
  for (const f of TASKS[key].files) {
    const text = fs.readFileSync(path.join(DATA, f), "utf8");
    raw.push(text);
    fams.push(...(JSON.parse(text).families as Family[]));
  }
  const ids = new Set<string>();
  for (const f of fams) { if (ids.has(f.id)) throw new Error(`duplicate family id ${f.id}`); ids.add(f.id); }
  const examples: Ex[] = [];
  const famSplit: Record<string, Ex["split"]> = {};
  for (const label of [0, 1] as const) {
    const group = fams.filter((f) => f.label === label).sort((a, b) => sha(a.id).localeCompare(sha(b.id)));
    group.forEach((f, i) => { const r = i / group.length; famSplit[f.id] = r < 0.7 ? "train" : r < 0.85 ? "calibration" : "test"; });
  }
  const seen = new Set<string>();
  for (const f of fams) for (let i = 0; i < f.s.length; i++) {
    const key2 = foldQuery(f.s[i]);
    if (seen.has(key2)) throw new Error(`duplicate text across families: ${f.s[i]}`);
    seen.add(key2);
    examples.push({ id: `${f.id}#${i}`, family: f.id, cls: f.cls, label: f.label, text: f.s[i], split: famSplit[f.id] });
  }
  const leak = leakageCheck(examples);
  const dropIds = new Set([...leak.exact, ...leak.near.map((n) => n.id)]);
  const dropped = examples.filter((e) => dropIds.has(e.id)).map((e) => ({ id: e.id, split: e.split }));
  const kept = examples.filter((e) => !dropIds.has(e.id));
  examples.length = 0; examples.push(...kept);
  const manifest: any = { task: key, families: fams.length, examples: examples.length, droppedForLeakage: dropped, splits: {} };
  for (const sp of ["train", "calibration", "test"] as const) {
    const ex = examples.filter((e) => e.split === sp);
    const famIds = [...new Set(ex.map((e) => e.family))].sort();
    manifest.splits[sp] = { examples: ex.length, positives: ex.filter((e) => e.label === 1).length, families: famIds.length, familyIdsHash: sha(famIds.join("\n")), textHash: sha(ex.map((e) => e.id + "\t" + e.text).sort().join("\n")) };
  }
  // zero family overlap is structural (one split per family); assert anyway
  const bySplit = (s: string) => new Set(examples.filter((e) => e.split === s).map((e) => e.family));
  for (const a of ["train", "calibration", "test"]) for (const b of ["train", "calibration", "test"]) if (a < b) for (const f of bySplit(a)) if (bySplit(b).has(f)) throw new Error("family overlap");
  return { examples, manifest, datasetHash: sha(raw.join("\n")), leak };
}

/** drop (report) any synthetic example whose folded text equals / is near-identical to an observed held-out or dev sentence */
function leakageCheck(examples: Ex[]): { checked: number; exact: string[]; near: { id: string; sim: number }[] } {
  const dir = path.join(REPO, "data/eval/retrieval");
  const files = fs.readdirSync(dir).filter((f) => /^rag-grounding-(eval|heldout|generalization|ood|safety|personal).*v\d\.json$/.test(f) && !/results/.test(f));
  const sentences: string[] = [];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const items: any[] = Array.isArray(j) ? j : j.items ?? j.queries ?? [];
      for (const it of items) if (typeof it.q === "string") sentences.push(it.q);
    } catch { /* ignore */ }
  }
  const tok = (s: string) => new Set(foldQuery(s).split(" ").filter((w) => w.length > 1));
  const refs = sentences.map((s) => ({ f: foldQuery(s), t: tok(s) }));
  const exact: string[] = [], near: { id: string; sim: number }[] = [];
  for (const e of examples) {
    const f = foldQuery(e.text), t = tok(e.text);
    for (const r of refs) {
      if (r.f === f) { exact.push(e.id); break; }
      let i = 0; for (const w of t) if (r.t.has(w)) i++;
      const sim = i / (t.size + r.t.size - i || 1);
      if (sim >= 0.8) { near.push({ id: e.id, sim: +sim.toFixed(2) }); break; }
    }
  }
  return { checked: sentences.length, exact, near };
}

// ---------- embeddings (CPU Ollama, cached) ----------
const embCache: Record<string, number[]> = fs.existsSync(EMB_CACHE) ? JSON.parse(fs.readFileSync(EMB_CACHE, "utf8")) : {};
async function embed(text: string): Promise<number[]> {
  if (embCache[text]) return embCache[text];
  const r = await fetch(`${OLLAMA}/api/embeddings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, prompt: text, options: { num_gpu: 0 } }) });
  if (!r.ok) throw new Error(`embedding http ${r.status}`);
  const v = ((await r.json()) as { embedding: number[] }).embedding;
  embCache[text] = v;
  return v;
}
const l2 = (v: number[]) => { const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1; return v.map((x) => x / n); };

// ---------- model ----------
type Sparse = Map<number, number>;
interface Feat { dense?: number[]; sparse?: Sparse }
const sig = (z: number) => 1 / (1 + Math.exp(-z));
function dot(w: Float64Array, f: Feat): number {
  let s = 0;
  if (f.dense) for (let i = 0; i < f.dense.length; i++) s += w[i] * f.dense[i];
  else for (const [i, v] of f.sparse!) s += w[i] * v;
  return s;
}
function trainLR(X: Feat[], y: number[], dim: number): { w: Float64Array; b: number } {
  const n = X.length, np = y.reduce((a, b) => a + b, 0), nn = n - np;
  const wp = n / (2 * np), wn = n / (2 * nn);
  const w = new Float64Array(dim); let b = 0;
  const m = new Float64Array(dim), v = new Float64Array(dim); let mb = 0, vb = 0;
  const b1 = 0.9, b2 = 0.999, eps = 1e-8;
  for (let t = 1; t <= TRAIN_CONFIG.epochs; t++) {
    const g = new Float64Array(dim); let gb = 0;
    for (let k = 0; k < n; k++) {
      const p = sig(dot(w, X[k]) + b), cw = y[k] ? wp : wn, e = (p - y[k]) * cw / n;
      gb += e;
      if (X[k].dense) for (let i = 0; i < dim; i++) g[i] += e * X[k].dense![i];
      else for (const [i, val] of X[k].sparse!) g[i] += e * val;
    }
    for (let i = 0; i < dim; i++) {
      const gi = g[i] + TRAIN_CONFIG.l2 * w[i];
      m[i] = b1 * m[i] + (1 - b1) * gi; v[i] = b2 * v[i] + (1 - b2) * gi * gi;
      w[i] -= TRAIN_CONFIG.lr * (m[i] / (1 - b1 ** t)) / (Math.sqrt(v[i] / (1 - b2 ** t)) + eps);
    }
    mb = b1 * mb + (1 - b1) * gb; vb = b2 * vb + (1 - b2) * gb * gb;
    b -= TRAIN_CONFIG.lr * (mb / (1 - b1 ** t)) / (Math.sqrt(vb / (1 - b2 ** t)) + eps);
  }
  return { w, b };
}
/** Platt scaling p = sigmoid(a*z + c), fitted by Newton's method on the calibration split */
function platt(z: number[], y: number[]): { a: number; c: number } {
  let a = 1, c = 0;
  for (let it = 0; it < 100; it++) {
    let ga = 0, gc = 0, haa = 0, hac = 0, hcc = 0;
    for (let i = 0; i < z.length; i++) {
      const p = sig(a * z[i] + c), d = p - y[i], s = p * (1 - p);
      ga += d * z[i]; gc += d; haa += s * z[i] * z[i]; hac += s * z[i]; hcc += s;
    }
    haa += 1e-6; hcc += 1e-6;
    const det = haa * hcc - hac * hac || 1e-9;
    a -= (hcc * ga - hac * gc) / det; c -= (-hac * ga + haa * gc) / det;
  }
  return { a, c };
}
const metrics = (p: number[], y: number[], th: number) => {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (let i = 0; i < p.length; i++) { const pr = p[i] >= th; if (pr && y[i]) tp++; else if (pr) fp++; else if (y[i]) fn++; else tn++; }
  return { n: p.length, tp, fp, tn, fn, recall: tp / ((tp + fn) || 1), precision: tp / ((tp + fp) || 1), fpRate: fp / ((fp + tn) || 1) };
};
function avgPrecision(p: number[], y: number[]): number {
  const idx = p.map((_, i) => i).sort((a, b) => p[b] - p[a]);
  const P = y.reduce((a, b) => a + b, 0); let tp = 0, ap = 0;
  idx.forEach((i, r) => { if (y[i]) { tp++; ap += tp / (r + 1); } });
  return ap / (P || 1);
}
const logloss = (p: number[], y: number[]) => -p.reduce((s, pi, i) => s + (y[i] ? Math.log(Math.max(pi, 1e-9)) : Math.log(Math.max(1 - pi, 1e-9))), 0) / p.length;

// ---------- pipeline ----------
interface Candidate { featureType: "embedding" | "tfidf"; w: Float64Array; b: number; cal: { a: number; c: number }; threshold: number; tfidf?: TfidfModel; dim: number; calibrationAP: number; calibrationLogloss: number; trainMetrics: any; calibrationMetrics: any }

function buildTfidf(train: Ex[]): TfidfModel {
  const df = new Map<string, number>();
  for (const e of train) for (const f of new Set(tfidfFeatures(e.text, null).keys())) df.set(f, (df.get(f) ?? 0) + 1);
  const keep = [...df.entries()].filter(([, c]) => c >= TRAIN_CONFIG.tfidf.minDf).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, TRAIN_CONFIG.tfidf.maxFeatures);
  const vocab: Record<string, number> = {}, idf: number[] = [];
  keep.forEach(([f, c], i) => { vocab[f] = i; idf.push(Math.log((1 + train.length) / (1 + c)) + 1); });
  return { vocab, idf };
}
function toFeat(model: TfidfModel, text: string): Feat {
  const m = tfidfFeatures(text, model);
  return { sparse: m };
}

function pickThreshold(key: TaskKey, p: number[], y: number[]): number {
  // chosen on the CALIBRATION split only: maximise the WORST margin against the predeclared targets
  // (safety: min(recall-0.95, 0.08-fpRate); programming: min(precision-0.80, recall-0.70)); ties -> lower threshold for safety (conservative), higher for programming.
  const cands = [...new Set(p)].sort((a, b) => a - b);
  let best = { th: 0.5, score: -Infinity };
  for (const th of cands) {
    const m = metrics(p, y, th);
    const s = key === "safety" ? Math.min(m.recall - 0.95, 0.08 - m.fpRate) : Math.min(m.precision - 0.8, m.recall - 0.7);
    const better = s > best.score + 1e-12 || (Math.abs(s - best.score) <= 1e-12 && (key === "safety" ? th < best.th : th > best.th));
    if (better) best = { th, score: s };
  }
  return best.th;
}

async function features(_key: TaskKey, ex: Ex[]) { return Promise.all(ex.map(async (e) => l2(await embed(e.text)))); }

async function trainTask(key: TaskKey) {
  const { examples, manifest, datasetHash, leak } = loadTask(key);
  const by = (s: Ex["split"]) => examples.filter((e) => e.split === s);
  const tr = by("train"), ca = by("calibration");
  const yTr = tr.map((e) => e.label), yCa = ca.map((e) => e.label);
  const out: Record<string, Candidate> = {};

  // embedding candidate
  const eTr = (await features(key, tr)).map((d) => ({ dense: d })), eCa = (await features(key, ca)).map((d) => ({ dense: d }));
  const dimE = eTr[0].dense!.length;
  {
    const { w, b } = trainLR(eTr, yTr, dimE);
    const zCa = eCa.map((f) => dot(w, f) + b), cal = platt(zCa, yCa), pCa = zCa.map((z) => sig(cal.a * z + cal.c));
    const th = pickThreshold(key, pCa, yCa);
    const pTr = eTr.map((f) => sig(cal.a * (dot(w, f) + b) + cal.c));
    out.embedding = { featureType: "embedding", w, b, cal, threshold: th, dim: dimE, calibrationAP: avgPrecision(pCa, yCa), calibrationLogloss: logloss(pCa, yCa), trainMetrics: metrics(pTr, yTr, th), calibrationMetrics: metrics(pCa, yCa, th) };
  }
  // tf-idf candidate
  {
    const model = buildTfidf(tr), dim = model.idf.length;
    const fTr = tr.map((e) => toFeat(model, e.text)), fCa = ca.map((e) => toFeat(model, e.text));
    const { w, b } = trainLR(fTr, yTr, dim);
    const zCa = fCa.map((f) => dot(w, f) + b), cal = platt(zCa, yCa), pCa = zCa.map((z) => sig(cal.a * z + cal.c));
    const th = pickThreshold(key, pCa, yCa);
    const pTr = fTr.map((f) => sig(cal.a * (dot(w, f) + b) + cal.c));
    out.tfidf = { featureType: "tfidf", w, b, cal, threshold: th, tfidf: model, dim, calibrationAP: avgPrecision(pCa, yCa), calibrationLogloss: logloss(pCa, yCa), trainMetrics: metrics(pTr, yTr, th), calibrationMetrics: metrics(pCa, yCa, th) };
  }
  // selection on train + calibration ONLY: higher calibration average-precision, ties -> lower calibration log-loss
  const chosen = out.embedding.calibrationAP > out.tfidf.calibrationAP + 1e-9 ? "embedding"
    : out.tfidf.calibrationAP > out.embedding.calibrationAP + 1e-9 ? "tfidf"
    : out.embedding.calibrationLogloss <= out.tfidf.calibrationLogloss ? "embedding" : "tfidf";
  return { key, manifest, datasetHash, leak, out, chosen, examples };
}

function artifactOf(key: TaskKey, c: Candidate, datasetHash: string, splitHash: string) {
  const base: any = {
    version: `${TASKS[key].name}-v1`, task: TASKS[key].name, featureType: c.featureType, classes: { positive: TASKS[key].positive, negative: TASKS[key].negative },
    dimensions: c.dim, bias: c.b, calibration: { type: "platt", a: c.cal.a, c: c.cal.c }, threshold: c.threshold,
    datasetHash, splitManifestHash: splitHash, trainConfigHash: TRAIN_CONFIG_HASH, trainConfig: TRAIN_CONFIG,
  };
  if (c.featureType === "embedding") { base.embeddingModel = MODEL; base.weights = Array.from(c.w, (x) => +x.toFixed(6)); base.normalize = "l2"; }
  else { base.vocab = c.tfidf!.vocab; base.idf = c.tfidf!.idf.map((x) => +x.toFixed(5)); base.weights = Array.from(c.w, (x) => +x.toFixed(6)); }
  return base;
}

async function main() {
  const results: any = {};
  const trained: Record<string, Awaited<ReturnType<typeof trainTask>>> = {};
  for (const key of ["safety", "programming"] as TaskKey[]) trained[key] = await trainTask(key);
  fs.writeFileSync(EMB_CACHE, JSON.stringify(embCache));
  for (const key of ["safety", "programming"] as TaskKey[]) {
    const t = trained[key];
    results[key] = { manifest: t.manifest, datasetHash: t.datasetHash, leakage: { heldoutDevSentencesChecked: t.leak.checked, exact: t.leak.exact.length, near: t.leak.near }, chosen: t.chosen,
      candidates: Object.fromEntries(Object.entries(t.out).map(([k, c]) => [k, { dim: c.dim, threshold: c.threshold, platt: c.cal, calibrationAP: +c.calibrationAP.toFixed(4), calibrationLogloss: +c.calibrationLogloss.toFixed(4), train: c.trainMetrics, calibration: c.calibrationMetrics }])) };
  }
  // calibration-split error listing (calibration is not the internal test; used for diagnosis only)
  const calErr: any = {};
  for (const key of ["safety", "programming"] as TaskKey[]) {
    const t = trained[key], c = t.out[t.chosen];
    calErr[key] = [];
    for (const e of t.examples.filter((x) => x.split === "calibration")) {
      const z = c.featureType === "embedding" ? dot(c.w, { dense: l2(await embed(e.text)) }) + c.b : dot(c.w, toFeat(c.tfidf!, e.text)) + c.b;
      const p = sig(c.cal.a * z + c.cal.c);
      if ((p >= c.threshold ? 1 : 0) !== e.label) calErr[key].push({ id: e.id, cls: e.cls, label: e.label, p: +p.toFixed(3), text: e.text });
    }
  }
  fs.writeFileSync(path.join(WORK, "calibration-errors.json"), JSON.stringify(calErr, null, 1));
  fs.writeFileSync(path.join(WORK, "train-report.json"), JSON.stringify({ trainConfig: TRAIN_CONFIG, trainConfigHash: TRAIN_CONFIG_HASH, results }, null, 2));
  // persist selected + alternative artifacts into the work dir (repo artifacts are written only after the single test run passes)
  for (const key of ["safety", "programming"] as TaskKey[]) {
    const t = trained[key]; const splitHash = sha(JSON.stringify(t.manifest.splits));
    for (const [name, c] of Object.entries(t.out)) fs.writeFileSync(path.join(WORK, `${TASKS[key].name}.${name}.json`), JSON.stringify(artifactOf(key, c, t.datasetHash, splitHash)));
  }
  // the TEST stage re-derives everything deterministically from the same files
  if (STAGE === "train") {
    console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, r]: any) => [k, { chosen: r.chosen, leakage: { exact: r.leakage.exact, near: r.leakage.near.length }, manifest: r.manifest.splits, candidates: r.candidates }])), null, 1));
    return;
  }
  // ---------------- TEST (once) ----------------
  const predecl = path.join(DATA, "predeclared-targets.json");
  if (!fs.existsSync(predecl)) throw new Error("predeclared-targets.json missing: refuse to run the internal test");
  const resultFile = path.join(DATA, "internal-test-result.json");
  if (fs.existsSync(resultFile)) throw new Error("internal test already consumed; refusing a second run");
  const targets = JSON.parse(fs.readFileSync(predecl, "utf8"));
  const report: any = { predeclaredTargetsSha256: sha(fs.readFileSync(predecl)), trainConfigHash: TRAIN_CONFIG_HASH, tasks: {} };
  for (const key of ["safety", "programming"] as TaskKey[]) {
    const t = trained[key]; const c = t.out[t.chosen]; const te = t.examples.filter((e) => e.split === "test");
    const y = te.map((e) => e.label);
    let z: number[];
    if (c.featureType === "embedding") z = (await Promise.all(te.map(async (e) => l2(await embed(e.text))))).map((d) => dot(c.w, { dense: d }) + c.b);
    else z = te.map((e) => dot(c.w, toFeat(c.tfidf!, e.text)) + c.b);
    const p = z.map((zi) => sig(c.cal.a * zi + c.cal.c));
    const clf = metrics(p, y, c.threshold);
    const det = te.map((e) => key === "safety" ? (resolveSafetySignals(e.text).level !== "NONE" ? 1 : 0) : (detectConcepts(e.text).domains.includes("PROGRAMMING") ? 1 : 0));
    const detM = metrics(det.map(Number), y, 0.5);
    const comb = metrics(det.map((d, i) => (d || p[i] >= c.threshold ? 1 : 0)), y, 0.5);
    const conf = te.map((e, i) => ({ id: e.id, cls: e.cls, label: e.label, p: +p[i].toFixed(3), det: det[i], text: e.text })).filter((r) => (r.p >= c.threshold ? 1 : 0) !== r.label);
    const tg = targets[key];
    const pass = key === "safety" ? clf.recall >= tg.recallMin && clf.fpRate <= tg.fpRateMax : clf.precision >= tg.precisionMin && clf.recall >= tg.recallMin;
    const combPass = key === "safety" ? comb.recall >= tg.recallMin && comb.fpRate <= tg.fpRateMax : comb.precision >= tg.precisionMin && comb.recall >= tg.recallMin;
    report.tasks[key] = { chosen: t.chosen, threshold: c.threshold, targets: tg, classifierOnly: clf, deterministicV24: detM, deterministicOrClassifier: comb, pass, combinedPass: combPass, errors: conf };
  }
  fs.writeFileSync(resultFile, JSON.stringify(report, null, 2));
  const allPass = Object.values(report.tasks).every((t: any) => t.pass);
  if (allPass) {
    fs.mkdirSync(ART, { recursive: true });
    for (const key of ["safety", "programming"] as TaskKey[]) {
      const t = trained[key];
      fs.writeFileSync(path.join(ART, `${TASKS[key].name}-v1.json`), JSON.stringify(artifactOf(key, t.out[t.chosen], t.datasetHash, sha(JSON.stringify(t.manifest.splits)))));
    }
  }
  console.log(JSON.stringify({ allPass, tasks: Object.fromEntries(Object.entries(report.tasks).map(([k, t]: any) => [k, { chosen: t.chosen, classifierOnly: t.classifierOnly, deterministicV24: t.deterministicV24, deterministicOrClassifier: t.deterministicOrClassifier, pass: t.pass, errors: t.errors.length }])) }, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
