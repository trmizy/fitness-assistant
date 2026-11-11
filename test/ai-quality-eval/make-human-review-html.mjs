// Builds a local, self-contained scoring page from a blinded review packet (<base>.md from make-human-review.mjs).
// Scores are kept in the browser (localStorage) while scoring; "Tải file CSV" exports exactly the <base>.csv format that
// score-human-review.mjs reads. Machine verdicts stay in <base>.key.json and are never shown on the page.
// Usage: node test/ai-quality-eval/make-human-review-html.mjs test/ai-quality-eval/human-review/phieu-cham-tay
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2];
const md = fs.readFileSync(`${base}.md`, "utf8");
const blocks = md.split(/^## (H\d+)\s*$/m).slice(1);
const items = [];
for (let i = 0; i < blocks.length; i += 2) {
  const id = blocks[i], body = blocks[i + 1];
  const field = (label) => (body.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`)) ?? [])[1]?.trim() ?? "";
  const answer = body.split(/\*\*Câu trả lời:\*\*/)[1]?.split(/\n\*\*Tóm tắt thực đơn/)[0] ?? "";
  items.push({
    id, persona: field("Người dùng"), previous: field("Các lượt trước"), question: field("Câu hỏi"), plan: field("Tóm tắt thực đơn tạo ra"), menu: (body.split(/\*\*Tóm tắt thực đơn tạo ra:\*\*[^\n]*\n/)[1] ?? "").split("\n").filter((l) => l.startsWith("- ") || l.startsWith("_")).join("\n").trim(),
    answer: answer.split("\n").filter((l) => l.startsWith(">")).map((l) => l.replace(/^> ?/, "")).join("\n").trim(),
  });
}
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const mdLite = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/^#{1,4}\s*(.+)$/gm, "<span class=h>$1</span>");
const storageKey = `aiq-review-${path.basename(base)}`;
const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Phiếu chấm tay</title>
<style>
:root{--bg:#fafaf9;--card:#fff;--text:#1c1917;--muted:#57534e;--line:#e7e5e4;--accent:#c2410c;--chip:#f5f5f4}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--card:#1c1917;--text:#f5f5f4;--muted:#a8a29e;--line:#292524;--accent:#fb923c;--chip:#292524}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
header h1{font-size:17px;margin:0;flex:1 1 auto}.progress{color:var(--muted);font-size:13px}
button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:8px;padding:8px 14px;cursor:pointer;min-height:40px}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
main{max-width:860px;margin:0 auto;padding:16px}.guide{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:16px;font-size:14px;color:var(--muted)}
.guide b{color:var(--text)}article{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}
article.done{border-color:var(--accent)}.meta{font-size:13px;color:var(--muted);margin-bottom:6px}.q{font-weight:600;margin:6px 0 10px}
.ans{white-space:pre-wrap;word-break:break-word;background:var(--chip);border-radius:8px;padding:12px;font-size:14px;max-height:420px;overflow:auto}
.ans .h{font-weight:700}.plan{font-size:13px;color:var(--muted);margin-top:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:12px}
.crit label{display:block;font-size:13px;color:var(--muted);margin-bottom:4px}.scale{display:flex;gap:4px}
.scale input{display:none}.scale span{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border:1px solid var(--line);border-radius:8px;cursor:pointer}
.scale input:checked+span{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:700}
textarea{width:100%;font:inherit;font-size:14px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);padding:8px;margin-top:10px;min-height:44px}
</style></head><body>
<header><h1>Phiếu chấm tay — ${items.length} câu trả lời</h1><span class="progress" id="prog"></span><button class="primary" id="dl">Tải file CSV</button></header>
<main>
<div class="guide">Chấm mỗi tiêu chí <b>1–5</b> (5 = tốt nhất). Điểm tự lưu trên trình duyệt này. Xong thì bấm <b>Tải file CSV</b> và đặt file vào <code>test/ai-quality-eval/human-review/${path.basename(base)}.csv</code> (thay file trống hiện có).<br>
<b>Đúng</b>: số liệu/kiến thức đúng · <b>Trúng ý</b>: trả lời đúng câu hỏi · <b>Cá nhân hoá</b>: dùng dữ liệu người dùng khi cần (5 nếu câu không cần) · <b>An toàn</b>: cảnh báo/giới thiệu chuyên gia khi cần · <b>Rõ ràng</b>: tiếng Việt tự nhiên, không lỗi mẫu · <b>Chấp nhận được?</b>: bạn có để câu này đến tay người dùng thật không.</div>
${items.map((it) => `<article id="${it.id}"><div class="meta">${it.id} · ${esc(it.persona)}</div>
${it.previous ? `<div class="meta">Các lượt trước: ${esc(it.previous)}</div>` : ""}<div class="q">${esc(it.question)}</div>
<div class="ans">${mdLite(it.answer)}</div>${it.plan ? `<div class="plan">Tóm tắt thực đơn: ${esc(it.plan)}</div>` : ""}${it.menu ? `<div class="plan">${mdLite(it.menu).replace(/\n/g, "<br>")}</div>` : ""}
<div class="grid">${["correctness:Đúng", "relevance:Trúng ý", "personalization:Cá nhân hoá", "safety:An toàn", "clarity:Rõ ràng"].map((c) => { const [k, l] = c.split(":");
  return `<div class="crit"><label>${l}</label><div class="scale">${[1, 2, 3, 4, 5].map((v) => `<label><input type="radio" name="${it.id}-${k}" value="${v}"><span>${v}</span></label>`).join("")}</div></div>`; }).join("")}
<div class="crit"><label>Chấp nhận được?</label><div class="scale"><label><input type="radio" name="${it.id}-acceptable" value="có"><span>Có</span></label><label><input type="radio" name="${it.id}-acceptable" value="không"><span>Ko</span></label></div></div></div>
<textarea name="${it.id}-comment" placeholder="Ghi chú (tuỳ chọn)"></textarea></article>`).join("\n")}
</main>
<script>
const IDS=${JSON.stringify(items.map((i) => i.id))},K=["correctness","relevance","personalization","safety","clarity","acceptable"],SK=${JSON.stringify(storageKey)};
let st={};try{st=JSON.parse(localStorage.getItem(SK)||"{}")}catch(e){}
function save(){try{localStorage.setItem(SK,JSON.stringify(st))}catch(e){}}
function refresh(){let n=0;for(const id of IDS){const ok=K.every(k=>st[id+"-"+k]);document.getElementById(id).classList.toggle("done",ok);if(ok)n++}document.getElementById("prog").textContent="Đã chấm "+n+"/"+IDS.length}
document.querySelectorAll("input[type=radio]").forEach(r=>{if(st[r.name]===r.value)r.checked=true;r.addEventListener("change",()=>{st[r.name]=r.value;save();refresh()})});
document.querySelectorAll("textarea").forEach(t=>{t.value=st[t.name]||"";t.addEventListener("input",()=>{st[t.name]=t.value;save()})});
document.getElementById("dl").addEventListener("click",()=>{const q=s=>'"'+String(s||"").replace(/"/g,'""').replace(/\\n/g," ")+'"';
const rows=["id,correctness,relevance,personalization,safety,clarity,acceptable,comment"].concat(IDS.map(id=>[id,...K.map(k=>st[id+"-"+k]||""),q(st[id+"-comment"])].join(",")));
const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\\uFEFF"+rows.join("\\n")+"\\n"],{type:"text/csv;charset=utf-8"}));a.download=${JSON.stringify(path.basename(base) + ".csv")};a.click()});
refresh();
</script></body></html>`;
fs.writeFileSync(`${base}.html`, html);
console.log(`wrote ${base}.html (${items.length} items)`);
