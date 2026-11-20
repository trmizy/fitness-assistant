// Measures near-duplicate redundancy of the top-k passages retrieved in configurations C/D (one retrieval per distinct question).
// Two passages are near-duplicates if their answer text, after removing the question-specific prefix, shares the same first 60 normalized characters.
import fs from "node:fs";
const run = process.argv[2] ?? "main-20261108";
const rows = fs.readFileSync(`results/${run}/answers.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.config === "C" && r.rep === 1);
const byQ = new Map();
for (const r of rows) { const k = r.qid === "Q5_KNOWLEDGE" ? `Q5:${r.sub}` : r.qid; if (!byQ.has(k)) byQ.set(k, r.retrieved); }
const norm = (s) => String(s).toLowerCase().normalize("NFC").replace(/^.*?(trả lời:|answer:)/s, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 60);
const out = {}; let tot = 0, uniq = 0;
for (const [q, docs] of byQ) {
  const texts = [];
  for (const d of docs) {
    const col = d.source.replace("qdrant:", ""); const id = d.id.slice(col.length + 1);
    const res = await fetch(`http://localhost:6340/collections/${col}/points`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [Number.isNaN(+id) ? id : +id], with_payload: true }) }).then((r) => r.json());
    const p = res.result?.[0]?.payload ?? {};
    texts.push(norm(p.answerVi ?? p.contentVi ?? p.text ?? p.content ?? JSON.stringify(p)));
  }
  const u = new Set(texts).size; out[q] = { k: docs.length, unique: u, sources: docs.map((d) => d.source.replace("qdrant:", "")) }; tot += docs.length; uniq += u;
}
const summary = { distinctQueries: byQ.size, passages: tot, uniquePassages: uniq, redundancyPct: Math.round((1000 * (tot - uniq)) / tot) / 10, perQuery: out };
fs.writeFileSync(`results/${run}/analysis/retrieval-redundancy.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, perQuery: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, `${v.unique}/${v.k}`])) }));
