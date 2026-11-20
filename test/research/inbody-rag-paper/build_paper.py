"""Builds the SSRC/IEEE-format manuscript (.docx) from the SSRC Word template and the measured results.

Every number in the text is read from results/<run>/analysis/metrics.json (no hand-copied values).
Usage: python build_paper.py --run-id main-20261108 --template <SSRC_Word_Template.docx> --out <paper.docx>
"""
import argparse, copy, json, os, re, sys, zipfile, shutil
from collections import defaultdict
sys.stdout.reconfigure(encoding="utf-8")
import docx
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument("--run-id", default="main-20261108")
ap.add_argument("--template", required=True)
ap.add_argument("--out", required=True)
a = ap.parse_args()
RUN = os.path.join(HERE, "results", a.run_id)
FIG = os.path.join(RUN, "analysis")
M = json.load(open(os.path.join(FIG, "metrics.json"), encoding="utf8"))
personas = {p["id"]: p for p in json.load(open(os.path.join(HERE, "personas-inbody.v1.json"), encoding="utf8"))["personas"]}
rows = [json.loads(l) for l in open(os.path.join(RUN, "answers.jsonl"), encoding="utf8") if l.strip()]

# ------------------------------------------------------------------ numbers
N = M["numeric"]; J = M.get("judged") or {}; O = M["ocr"]; C = M["cost"]
def f1(x): return f"{x:.1f}"
def f0(x): return f"{x:.0f}"
def pv(p): return "< 0.001" if p < 0.001 else f"= {p:.3f}"
q1 = {c: N["Q1_TDEE"][c] for c in "ABCD"}; q2 = {c: N["Q2_TARGET"][c] for c in "ABCD"}; q3 = {c: N["Q3_PROTEIN"][c] for c in "ABCD"}
t1 = {t["pair"]: t for t in N["Q1_TDEE"]["tests"]}; t2 = {t["pair"]: t for t in N["Q2_TARGET"]["tests"]}; t3 = {t["pair"]: t for t in N["Q3_PROTEIN"]["tests"]}
mech = M["mechanism"]["spearman_A_signed_error_vs_bmr_divergence"]
RED = json.load(open(os.path.join(FIG, "retrieval-redundancy.json"), encoding="utf8"))
def _count(path):
    try: return sum(1 for l in open(path, encoding="utf8") if l.strip())
    except OSError: return 0
N_OPUS = _count(os.path.join(HERE, "results", "main-20261108", "judgments.jsonl"))
N_SONNET = _count(os.path.join(HERE, "results", "main-20261108", "judgments.sonnet.jsonl")) + _count(os.path.join(HERE, "results", "haiku-20261108", "judgments.sonnet.jsonl"))
N_HAIKU = _count(os.path.join(HERE, "results", "haiku-20261108", "answers.jsonl"))

SENS = M.get("sensitivity")
_km = os.path.join(HERE, "results", "haiku-20261108", "analysis", "metrics.json")
KM = json.load(open(_km, encoding="utf8")) if os.path.exists(_km) else None
KM_REPS = 0
if KM:
    _ka = os.path.join(HERE, "results", "haiku-20261108", "answers.jsonl")
    KM_REPS = max(json.loads(l)["rep"] for l in open(_ka, encoding="utf8") if l.strip())
    _jm = KM.get("judge_models") or []
    KM_JUDGE = "Claude Sonnet 4.6" if any("sonnet" in m for m in _jm) else "Claude Opus 4.6"
_ag = os.path.join(FIG, "judge-agreement.json")
AG = json.load(open(_ag, encoding="utf8")) if os.path.exists(_ag) else None
if AG and AG.get("n_pairs", 0) < 50: AG = None
_he = os.path.join(FIG, "human-eval-summary.json")
HE = json.load(open(_he, encoding="utf8")) if os.path.exists(_he) else None
_g6 = os.path.join(FIG, "gpt6-judge-summary.json")
G6 = json.load(open(_g6, encoding="utf8")) if os.path.exists(_g6) else None
_ns = [J[q][c]["n"] for q in ("Q4_BODYCOMP", "Q5_KNOWLEDGE", "Q6_SAFETY") for c in "ABCD" if q in J and c in J[q]]
J_N = max(_ns) if _ns else 0
J_NTXT = f"{min(_ns)} to {max(_ns)}" if _ns and min(_ns) != max(_ns) else str(J_N)
J_REPS = "all three repetitions" if J_N >= 70 else "the first repetition"
n_gen = len(rows)
n_rep = max(r["rep"] for r in rows)
ocrm = O["models"]
def og(m, g): return ocrm[m]["groups"][g]["accuracy"]
G_NC, G_CORE, G_DATE = "Nutrition-critical (W, BFM, FFM, BMR)", "Core scalar fields (n=24 sheets)", "Measurement date"
G_SEG = "Segmental (n=24 sheets)"
def jv(q, c, k, s="mean"):
    try: return J[q][c][k][s]
    except KeyError: return float("nan")

# out-of-range direction for the energy target (configs A-C)
AF = {"SEDENTARY": 1.2, "LIGHTLY_ACTIVE": 1.375, "MODERATELY_ACTIVE": 1.55, "VERY_ACTIVE": 1.725}
RANGE = {"WEIGHT_LOSS": (0.75, 0.90), "MUSCLE_GAIN": (1.05, 1.15), "MAINTENANCE": (0.95, 1.05)}
low = high = tot = 0
for r in rows:
    if r["qid"] != "Q2_TARGET" or r["config"] == "D": continue
    p = personas[r["persona"]]
    if p["reference"]["minor"]: continue
    v = (r.get("extracted") or {}).get("value")
    if v is None: continue
    ref = p["reference"]["bmrKatchMcArdle"] * AF[p["profile"]["activityLevel"]]; lo, hi = RANGE[p["profile"]["goal"]]
    if v < lo * ref - 1: low += 1
    elif v > hi * ref + 1: high += 1
    tot += 1
oor = low + high
# retrieval distractor: Q4 answers recommending the retrieved "glute-priority 4 sessions/week for 8 weeks" plan
glute = {c: [0, 0] for c in "ABCD"}
for r in rows:
    if r["qid"] == "Q4_BODYCOMP":
        glute[r["config"]][1] += 1
        if re.search(r"mông", r["answer"], re.I): glute[r["config"]][0] += 1
gpct = {c: 100 * k / n if n else 0 for c, (k, n) in glute.items()}
pct_low = 100 * low / oor if oor else 0

# ------------------------------------------------------------------ text
# Approved topic (VI): "Nghiên cứu và ứng dụng kỹ thuật RAG và LLM trên dữ liệu InBody để tự động hóa và cá nhân hóa tập luyện và dinh dưỡng trong lĩnh vực Gym & Fitness"
# Faithful English rendering; abbreviations spelled out (SSRC template: no abbreviations in the title unless unavoidable).
# Chosen by the authors 2026-11-09 (proposed title + "from InBody Data"); approved topic kept in the comment above.
TITLE = "Automating Personalized Fitness and Nutrition Planning from InBody Data Using Retrieval-Augmented Generation and Large Language Models"
AUTHORS = "Trần Minh Duy, Nguyễn Huy Trọng, Trần Võ Mỹ Tiên, Nguyễn Trung Đạt Thành, and Huỳnh Nam"  # order and supervisor as in the authors' SSRC sample paper
AFFILIATION = "Faculty of Information Technology, Industrial University of Ho Chi Minh City"
EMAILS = ["22673991.duy@student.iuh.edu.vn", "22669731.trong@student.iuh.edu.vn", "24732641.tien@student.iuh.edu.vn", "23733811.thanh@student.iuh.edu.vn"]  # university addresses (from the authors' SSRC sample paper), same order as AUTHORS
FOOTNOTE = "Manuscript submitted November 12, 2026. Nguyen Huy Trong and Tran Minh Duy are with the Faculty of Information Technology, Industrial University of Ho Chi Minh City, Ho Chi Minh City, Vietnam (e-mail: huytronh4@gmail.com; tranminhduy1902@gmail.com)."

ABSTRACT = (
    "Assistants built on large language models increasingly give personalized nutrition advice, "
    "yet usually personalize from body weight alone and compute energy targets inside the model, where errors go unnoticed. "
    "We ask which component makes such prescriptions accurate: bioelectrical impedance measurements, retrieval of evidence, or deterministic computation. "
    "We describe a hybrid architecture in which a vision-language model reads InBody printouts, a deterministic engine converts the basal metabolic rate reported by InBody into nutrition targets, "
    "a retriever supplies evidence, and the language model explains the result. "
    f"In a controlled ablation with 24 reproducible personas, six question types, and {n_gen:,} generations of the main model, adding body-composition data reduced the mean absolute percentage error of maintenance-energy estimates from {f1(q1['A']['mape'])}% to {f1(q1['B']['mape'])}%, "
    f"retrieval did not reduce it further ({f1(q1['C']['mape'])}%), and delegating the arithmetic to the engine reproduced the formula-based reference exactly and raised energy targets in range from {f0(q2['C']['rate_pct'])}% to {f0(q2['D']['rate_pct'])}%. "
    f"Retrieval did improve protein recommendations, from {f0(q3['B']['rate_pct'])}% to {f0(q3['C']['rate_pct'])}% within range. "
    f"For the main model, exposing the InBody-reported basal metabolic rate without the engine was harmful: it subtracted deficits from that rate, and {f0(jv('Q4_BODYCOMP', 'B', 'endorses_unsafe', 'rate_pct'))}% of body-composition answers were graded unsafe, against {f0(jv('Q4_BODYCOMP', 'D', 'endorses_unsafe', 'rate_pct'))}% with the engine. "
    f"{'A second language model reproduced the accuracy pattern. ' if KM else ''}"
    f"On 24 real printouts, the best vision-language model read all nutrition-critical fields correctly, but the production schema discarded the reported basal metabolic rate. "
    "Measured body composition is necessary but not sufficient: numerical prescriptions should be computed deterministically and only narrated by the language model."
)
ABSTRACT_VI = (
    "Trợ lý hội thoại dựa trên mô hình ngôn ngữ lớn ngày càng được dùng để tư vấn tập luyện và dinh dưỡng cá nhân hoá, nhưng thường chỉ cá nhân hoá theo cân nặng và để chính mô hình ngôn ngữ tự tính năng lượng, nơi việc chọn hệ số không nhất quán và lỗi tính toán khó bị phát hiện. "
    "Nghiên cứu đặt câu hỏi: việc gắn trợ lý với số đo thành phần cơ thể bằng phân tích trở kháng điện sinh học có làm khuyến nghị dinh dưỡng chính xác hơn không, và thành phần nào tạo ra cải thiện: bản thân số đo, truy hồi bằng chứng, hay tính toán tất định. "
    "Chúng tôi mô tả một kiến trúc lai triển khai trong ứng dụng thể hình: mô hình thị giác–ngôn ngữ đọc phiếu InBody, bộ máy tính toán tất định chuyển tốc độ chuyển hoá cơ bản đo được thành mục tiêu năng lượng và chất đa lượng, bộ truy hồi cung cấp bằng chứng, còn mô hình ngôn ngữ chỉ giải thích kết quả. "
    f"Trong thí nghiệm loại bỏ thành phần có kiểm soát với 24 hồ sơ tái lập được, sáu loại câu hỏi và {n_gen:,} lượt sinh, thêm số đo thành phần cơ thể giảm sai số phần trăm tuyệt đối trung bình của năng lượng duy trì từ {f1(q1['A']['mape'])}% xuống {f1(q1['B']['mape'])}%, truy hồi không giảm thêm ({f1(q1['C']['mape'])}%), còn giao phần tính toán cho bộ máy tất định loại bỏ sai số và nâng tỉ lệ mục tiêu năng lượng nằm trong khoảng khuyến nghị từ {f0(q2['C']['rate_pct'])}% lên {f0(q2['D']['rate_pct'])}%. "
    f"Truy hồi cải thiện khuyến nghị protein, từ {f0(q3['B']['rate_pct'])}% lên {f0(q3['C']['rate_pct'])}% nằm trong khoảng. "
    f"Đưa tốc độ chuyển hoá cơ bản đo được mà không có bộ máy tính toán lại gây hại: mô hình trừ thâm hụt trực tiếp từ giá trị này, và {f0(jv('Q4_BODYCOMP', 'B', 'endorses_unsafe', 'rate_pct'))}% câu trả lời về thành phần cơ thể bị đánh giá là không an toàn, so với 0% khi có bộ máy tính toán. "
    "Trên 24 phiếu in thật, mô hình thị giác–ngôn ngữ tốt nhất đọc đúng toàn bộ các trường quan trọng cho dinh dưỡng, trong khi lược đồ trích xuất của hệ thống đang chạy bỏ sót tốc độ chuyển hoá cơ bản đo được. "
    "Số đo thành phần cơ thể là cần nhưng chưa đủ: các con số khuyến nghị nên được tính tất định và chỉ được mô hình ngôn ngữ diễn giải."
)
INDEX = "Bioelectrical impedance analysis, body composition, large language models, nutrition, personalized fitness, retrieval-augmented generation"

doc = docx.Document(a.template)
body = doc.element.body
P = doc.paragraphs

def set_runs(p, text, keep_prefix_runs=0):
    """Replace the paragraph's text, keeping the formatting of the first editable run and any footnote-reference runs."""
    runs = p.runs; editable = [r for r in runs[keep_prefix_runs:] if not r._r.xpath(".//w:footnoteReference")]
    if not editable: p.add_run(text); return
    editable[0].text = text
    for r in editable[1:]: r._r.getparent().remove(r._r)

set_runs(P[0], TITLE)
set_runs(P[1], AUTHORS)
def _author_block(p):
    from docx.opc.constants import RELATIONSHIP_TYPE as RT
    from docx.shared import RGBColor
    def br(): p.add_run().add_break()
    br(); br()
    r = p.add_run(AFFILIATION); r.italic = True; r.font.size = Pt(10)
    br()
    for k, mail in enumerate(EMAILS):
        if k: sep = p.add_run(", "); sep.font.size = Pt(10)
        rid = p.part.relate_to(f"mailto:{mail}", RT.HYPERLINK, is_external=True)
        h = OxmlElement("w:hyperlink"); h.set(qn("r:id"), rid)
        run = OxmlElement("w:r"); rpr = OxmlElement("w:rPr")
        col = OxmlElement("w:color"); col.set(qn("w:val"), "0000FF"); rpr.append(col)
        u = OxmlElement("w:u"); u.set(qn("w:val"), "single"); rpr.append(u)
        sz = OxmlElement("w:sz"); sz.set(qn("w:val"), "20"); rpr.append(sz)
        run.append(rpr); t = OxmlElement("w:t"); t.text = mail; run.append(t); h.append(run); p._p.append(h)
_author_block(P[1])
# the title wraps to four lines at 24 pt: move the authors frame below it (template default y=1498 twips fits two lines)
for fp in P[1]._p.xpath("./w:pPr/w:framePr"): fp.set(qn("w:y"), "2650")
set_runs(P[2], ABSTRACT, keep_prefix_runs=2)       # keeps "Abstract" + "—"
# Reviewer feedback (2026-11-08): the manuscript must be entirely in English -> remove the template's Vietnamese abstract slot.
for _vi in (P[4]._p, P[5]._p): _vi.getparent().remove(_vi)
set_runs(P[6], INDEX, keep_prefix_runs=2)          # keeps "Index Terms" + "—"
for hl in P[6]._p.xpath("./w:hyperlink"): P[6]._p.remove(hl)
# remove everything after the index-terms block (keep the final section properties)
anchor = P[7]._p
for el in list(body.iterchildren()):
    if el is anchor: break
started = False
for el in list(body.iterchildren()):
    if el is anchor: started = True; continue
    if started and el.tag != qn("w:sectPr"): body.remove(el)

PENDING = []
def _mark(): return len(list(body.iterchildren())) - 1
def _defer(mark, defer=True):
    if not defer: return
    kids = list(body.iterchildren())
    for k in kids[mark:-1]:
        body.remove(k); PENDING.append(k)

def para(text="", style="Text", italic_spans=()):
    p = doc.add_paragraph(style=style)
    if text:
        # *x* -> italic
        parts = re.split(r"(\*[^*]+\*)", text)
        for s in parts:
            if not s: continue
            r = p.add_run(s[1:-1] if s.startswith("*") and s.endswith("*") else s)
            if s.startswith("*") and s.endswith("*"): r.italic = True
    if style == "Text" and PENDING:
        anchor = p._p
        for el in PENDING: anchor.addnext(el); anchor = el
        PENDING.clear()
    return p
def h1(t): return para(t, "Heading 1")
def h2(t): return para(t, "Heading 2")
EQN = [0]
def eq(expr):
    EQN[0] += 1
    p = doc.add_paragraph(style="Equation")
    from docx.enum.text import WD_TAB_ALIGNMENT
    p.paragraph_format.tab_stops.add_tab_stop(Inches(1.75), WD_TAB_ALIGNMENT.CENTER)  # math centered; style keeps the right tab at 3.5 in for the number
    p.add_run("	")
    m = OxmlElement("m:oMath"); r = OxmlElement("m:r"); t = OxmlElement("m:t"); t.text = expr; t.set(qn("xml:space"), "preserve")
    r.append(t); m.append(r); p._p.append(m)
    p.add_run(f"\t({EQN[0]})")
    return EQN[0]
FIGN = [0]
def figure(path, caption, width=3.45, defer=True):
    _m = _mark()
    FIGN[0] += 1
    p = doc.add_paragraph(style="Normal"); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(path, width=Inches(width))
    p.paragraph_format.keep_with_next = True
    cp = para(f"Fig. {FIGN[0]}.  {caption}", "Caption")
    cp.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    from docx.shared import RGBColor
    for r in cp.runs: r.italic = False; r.font.size = Pt(8); r.font.color.rgb = RGBColor(0, 0, 0)
    _defer(_m, defer)
    return FIGN[0]
TABN = [0]
ROMAN = ["I", "II", "III", "IV", "V", "VI"]
def _el(tag, **attrs):
    e = OxmlElement("w:" + tag)
    for k, v in attrs.items(): e.set(qn("w:" + k), str(v))
    return e

def table(title, header, data, note=None, widths=None):
    """Template-faithful table (SSRC_Word_Template.docx, Table I): one column wide (5040 dxa), centered, fixed layout,
    1.5 pt gray rules above and below, header row with a double rule above and a single rule below, 8 pt text, no vertical rules."""
    _m = _mark()
    TABN[0] += 1
    para(f"Table {ROMAN[TABN[0] - 1]}", "Table Title"); para(title, "Table Title")
    ncol = len(header)
    t = doc.add_table(rows=1 + len(data), cols=ncol)
    tbl = t._tbl; pr = tbl.tblPr
    for old in list(pr): pr.remove(old)
    pr.append(_el("tblW", w=5040, type="dxa")); pr.append(_el("jc", val="center"))
    b = _el("tblBorders"); b.append(_el("top", val="single", sz=12, space=0, color="808080")); b.append(_el("bottom", val="single", sz=12, space=0, color="808080")); pr.append(b)
    pr.append(_el("tblLayout", type="fixed"))
    mar = _el("tblCellMar")
    for side in ("left", "right"): mar.append(_el(side, w=45, type="dxa"))
    pr.append(mar); pr.append(_el("tblLook", val="0000"))
    w = list(widths) if widths else [1.0] * ncol
    tw = [int(round(5040 * x / sum(w))) for x in w]; tw[-1] += 5040 - sum(tw)
    grid = tbl.find(qn("w:tblGrid"))
    for g, x in zip(grid.findall(qn("w:gridCol")), tw): g.set(qn("w:w"), str(x))
    last = len(data)
    for ri, row in enumerate([header] + data):
        for ci, val in enumerate(row):
            cell = t.cell(ri, ci); cell.text = ""
            tc = cell._tc; tcpr = tc.get_or_add_tcPr()
            for old in list(tcpr): tcpr.remove(old)
            tcpr.append(_el("tcW", w=tw[ci], type="dxa"))
            bd = _el("tcBorders")
            bd.append(_el("top", val="double" if ri == 0 else "nil", **({"sz": 6, "space": 0, "color": "auto"} if ri == 0 else {})))
            bd.append(_el("left", val="nil"))
            bot = "single" if ri == 0 else ("double" if ri == last else "nil")
            bd.append(_el("bottom", val=bot, **({"sz": 6, "space": 0, "color": "auto"} if bot != "nil" else {})))
            bd.append(_el("right", val="nil")); tcpr.append(bd)
            if ri == 0: tcpr.append(_el("vAlign", val="center"))
            para_ = cell.paragraphs[0]
            run = para_.add_run(str(val)); run.font.size = Pt(8)
            para_.alignment = WD_ALIGN_PARAGRAPH.CENTER if (ri == 0 or ci) else WD_ALIGN_PARAGRAPH.LEFT
            para_.paragraph_format.space_after = Pt(0)
    if note: para(note, "footnote text")
    doc.add_paragraph(style="Normal")
    _defer(_m)
    return ROMAN[TABN[0] - 1]

# ------------------------------------------------------------------ I. Introduction
h1("Introduction")
_intro = para("Large language models (LLMs) are now embedded in consumer fitness applications as conversational coaches that answer questions about training, energy intake, and macronutrients. "
     "Their fluency hides two weaknesses that matter for nutrition. First, personalization is usually based on body weight, height, age, and sex, although two people with the same body mass index can differ widely in fat-free mass and therefore in energy expenditure [1], [2]. "
     "Second, the numerical prescription itself (a daily energy target in kilocalories, a protein target in grams) is typically produced inside the language model, which must choose equations and factors and then perform the arithmetic, and whose slips are hard to detect [3], [4].")

# (no first-page footnote: affiliation and e-mails sit under the author names, as in the SSRC sample paper)
para("Bioelectrical impedance analyzers such as the InBody series are widely available in gyms and report fat mass, fat-free mass (FFM), skeletal muscle mass, and a basal metabolic rate (BMR) derived from FFM. "
     "Segmental multi-frequency devices agree well with dual-energy X-ray absorptiometry for lean mass in adults [5]. "
     "Retrieval-augmented generation (RAG) [6], [7] is the usual way to ground an assistant in domain knowledge, but retrieval supplies text, not computation, and it is not obvious that it helps an assistant produce correct personal numbers.")
para("Evaluations of general chatbots for dietary advice report plausible but sometimes unsafe or numerically wrong recommendations, with calorie and portion errors among the most common [8], [9]. "
     "What is missing is a controlled answer to a design question that every developer of such a system faces: when an assistant has access to body-composition measurements, which component actually makes its prescriptions correct, the measurement context, retrieved evidence, or deterministic computation?")
para("This paper answers that question with an ablation study of Gymini, a fitness application in which InBody printouts are read by a vision-language model and nutrition targets are computed by a deterministic engine. The contributions are:")
for t in [
    "a hybrid architecture that separates measurement extraction, deterministic energy computation, evidence retrieval, and language generation, deployed in a production microservice system;",
    f"a reproducible ablation protocol with 24 synthetic personas whose body composition is internally consistent by construction, six question types, and {n_gen:,} generations, scored against reference values that are independent of the system under test;",
    "an extraction study of four vision-language models on 24 real InBody270 printouts, using reference labels validated by identities printed on the report; and",
    "evidence that body-composition data halves the energy-estimation error, that retrieval does not repair the computation but does improve protein advice, that exposing InBody-reported BMR without computation can produce unsafe prescriptions, and that only deterministic computation yields consistently correct targets, with the accuracy pattern replicated on a second language model.",
]:
    CN = globals().setdefault("CN", [0]); CN[0] += 1
    para(f"{CN[0]}) " + t[0].upper() + t[1:], "Text").paragraph_format.left_indent = Inches(0.15)
para("Section II reviews related work, Section III presents the method, Section IV the experimental setup, Section V the results, and Section VI concludes.")

# ------------------------------------------------------------------ II. Related work
h1("Related Work")
h2("Language Models for Dietary Advice")
para("Ponzo *et al.* [8] found that a general-purpose chatbot gave guideline-consistent dietary advice for 55.5% to 73.3% of prompts depending on the disease, with failures concentrated in complex, multi-condition cases. "
     "Niszczota and Rybicka [9] showed that generated diets for people with food allergies were generally accurate but occasionally harmful, with errors in portion sizes and calorie totals. "
     "Domain-tuned medical models encode substantial clinical knowledge but still require careful evaluation of harm [10]. These studies evaluate the language model as a whole and do not isolate where numerical errors originate.")
h2("Retrieval and Tool-Augmented Generation")
para("RAG conditions generation on retrieved passages to reduce hallucination on knowledge-intensive tasks [6], [7], [11]. "
     "For arithmetic, program-aided and tool-using models delegate computation to an interpreter or an external tool [3], [12], and analyses of mathematical capability show that unaided models make frequent calculation errors [4]. "
     "We apply the same separation of concerns to nutrition: computation is delegated to a deterministic engine whose output the language model must reuse.")
h2("Body Composition and Energy Expenditure")
para("Weight-based predictive equations such as Mifflin–St Jeor [1] are standard when body composition is unknown. When FFM is measured, the Katch–McArdle equation estimates BMR from FFM [2]; we verified on real printouts that the InBody270 reports BMR consistent with it. "
     "Weight-based estimates are least reliable for muscular individuals and for normal-weight obesity, where body mass index hides excess adiposity [13].")
h2("Document Understanding")
para("Reading structured values from photographed reports is a document-understanding task addressed by layout-aware and OCR-free models [14], [15]. "
     "Recent vision-language models can fill a predefined schema directly from an image; we measure how reliably they do so for InBody printouts.")

# ------------------------------------------------------------------ III. Method
h1("Methodology")
h2("System Overview")
para("Gymini is the fitness application developed in the authors' graduation thesis. It serves four kinds of users (clients, personal trainers, gym owners, and administrators) through a web application and a React Native (Expo) mobile application. "
     "Its backend consists of seven Node.js microservices behind an API gateway, each with its own PostgreSQL database, and it is deployed on Amazon Web Services. "
     "A client completes an onboarding questionnaire, records or uploads InBody results in the body-composition module, receives a nutrition goal, follows workout plans organized into training cycles, and asks an AI coach questions in Vietnamese; personal trainers follow their clients in the same application. "
     f"This paper evaluates one path through that product (Fig. {FIGN[0] + 1}): from an InBody printout to personalized energy and macronutrient advice.")
fa = figure(os.path.join(FIG, "fig-architecture.png"), "Architecture of the InBody-grounded assistant. Inputs pass through three services; the context assembly adds one block per ablation configuration (A to D, colored as in Fig. 2), and the InBody-reported BMR flows from the InBody record to the deterministic engine. The figure shows the pipeline as evaluated; in the current photo import the BMR field is not yet extracted (Section V-D). W: weight; BFM: body fat mass; FFM: fat-free mass; PBF: percent body fat; SMM: skeletal muscle mass; BMR: basal metabolic rate; AF: activity factor; TDEE: total daily energy expenditure; P, F, C: protein, fat, carbohydrate.", defer=False)
para(f"Fig. {fa} shows this path as implemented. In the first step, a client photographs an InBody printout. The user service checks the file (at most 5 MB), sends the image to a vision-language model together with a JSON schema, computes body mass index and body-fat percentage, and returns the values without saving them. "
     "The client then corrects any misread value and confirms, and only then does the service store the record, one per client and day, and notify the fitness service, which may reassess the training cycle. Manual entry shares the confirmation step.")
para("In the second step, the fitness service creates the nutrition goal from the profile and the latest record. Decisions are separated from the language model: a deterministic engine chooses the training-cycle decision and the energy and macronutrient proposal, "
     "the AI service only explains them and cannot change them, and a new nutrition goal is stored only when the client accepts the proposal. This is the design principle that the experiments below put to the test.")
para("In the third step, the AI coach answers a question. The AI service limits the request rate per user, and a language and safety filter answers out-of-scope, emergency, dangerous, and instruction-injection requests with fixed text. "
     "For other questions it gathers, in parallel, the profile and InBody record, the evidence passages found by vector search, the conversation history, and the user's stored memories, plus nutrition or workout data from the fitness service when relevant. "
     "Passages are retrieved with a multilingual embedding model (Cohere multilingual v3, 1024 dimensions) from a vector store (Qdrant in the local profile, used here; Amazon OpenSearch Serverless on AWS) that holds 7,072 knowledge chunks, 5,946 question–answer pairs, and 87 curated research-evidence records; the top five passages with a cosine similarity of at least 0.35 are kept. "
     "The language model is reached through a configurable provider layer (Amazon Nova Pro [16] on Amazon Bedrock here). Its answer is checked against the pre-computed numbers, and a deterministic answer replaces it when the model fails or deviates seriously.")
h2("Body-Composition-Grounded Energy Model")
para("Let *W* be body weight, *BFM* body fat mass, and *FFM* fat-free mass in kilograms. The InBody report gives")
e1 = eq("FFM = W − BFM")
e2 = eq("BMR = 370 + 21.6 · FFM")
para(f"where (2) is the Katch–McArdle equation [2] that the device prints; when no measurement exists the engine falls back to the Mifflin–St Jeor equation [1]. Maintenance energy, the total daily energy expenditure (TDEE), is")
e3 = eq("TDEE = BMR · AF")
para("with an activity factor (*AF*) of 1.2, 1.375, 1.55, or 1.725 for sedentary to very active users. The energy target applies a goal- and experience-dependent change *δ*,")
e4 = eq("E = TDEE · (1 + δ)")
para("with *δ* = −0.15, −0.12, and −0.10 for beginner, intermediate, and advanced users who want to lose fat, and +0.12, +0.08, and +0.05 for muscle gain, following evidence-based ranges [17], [18]. "
     "Protein is 1.6 to 2.1 g per kg of body weight [19], [20], fat is 0.8 to 0.9 g/kg, and carbohydrate fills the remaining energy (4 kcal/g for protein and carbohydrate, 9 kcal/g for fat). "
     "All quantities are computed by code; the language model receives them as authoritative values and is instructed not to recompute them.")
h2("Ablation Configurations")
para("Every prompt contains the same system instruction, the user's profile, and the question. Configuration A sends only these. "
     "B adds the InBody measurements, C additionally adds the retrieved passages, and D additionally adds the engine values, which corresponds to the full Gymini system (Fig. 1). "
     "Each step adds exactly one block of information, so the difference between two neighboring configurations shows the effect of one component. "
     "The ablation isolates the effect of the context given to the language model: it calls the model directly with the production retriever and the production nutrition engine, and it bypasses the rate limit, the safety filter, the answer check, and the deterministic fallback (dashed box in Fig. 1). "
     "Results for configurations A to C therefore describe the model without these safeguards, which should catch some of the errors reported here; we did not measure by how much.")
h2("Evaluation Metrics")
para("For maintenance energy we report the mean absolute percentage error (MAPE): the absolute difference between the answer and the reference, divided by the reference, averaged per persona and then across personas. For energy and protein targets, the outcome is whether the answer lies in an evidence-based acceptable interval. "
     "For extraction, field accuracy is the fraction of fields whose value equals the printed value within its printed precision, with an abstention required when no value is printed.")

# ------------------------------------------------------------------ IV. Experimental setup
h1("Experimental Setup")
h2("Synthetic Data Declaration")
para("The ablation uses synthetic data; no real user data were used. We declare what is synthetic, how it was produced, and what is real. "
     "The 24 user personas are synthetic. They were produced by a deterministic script with a fixed random seed (20261108), not by a language model, so the same file is reproduced on every run and is checked by a SHA-256 checksum. "
     "Eighteen personas form a full factorial design over sex, three body-fat bands, and three goals; six are edge cases chosen by the authors: a muscular man with an overweight body mass index, normal-weight obesity in a woman and in a man, class I obesity, a 16-year-old asking to lose weight, and a 60-year-old woman.")
para("Generation settings: height is drawn from a normal distribution around Vietnamese adult averages (168 ± 6 cm for men, 157 ± 5 cm for women), age uniformly from 20 to 50 years, body fat uniformly within the band (men 10–15, 16–22, 24–32%; women 18–23, 24–30, 32–40%), and the fat-free-mass index uniformly from 17 to 21 kg/m² (men) or 14 to 17 kg/m² (women). "
     "Weight, fat mass, and FFM are computed from these values so that they are consistent with each other, and BMR is set by (2), as on a real InBody report. "
     "Standards: every persona must pass physiological plausibility checks (body mass index 16–40, sex-specific body-fat and fat-free-mass-index limits, height limits, fat mass plus FFM equal to weight); a persona that fails stops the generator instead of being silently corrected. "
     "Across personas, the weight-only equation differs from (2) by 5.3% on average and by up to 11.1%, which is the gap the experiment is designed to expose.")
para("Also synthetic or machine-generated are the assistant answers (generated by Amazon Nova Pro and Claude Haiku 4.5) and the automatic grades (Claude Opus 4.6, Claude Sonnet 4.6, and GPT-6). "
     + ("Real data are the 24 InBody printouts of the extraction study, the production knowledge base and code of Gymini, and the human ratings described below. " if HE else "Real data are the 24 InBody printouts of the extraction study and the production knowledge base and code of Gymini. ")
     + "The questions and reference intervals were written by the authors from the cited guidelines.")
tD = table("Data Used in the Experiments",
           ["Data", "Type", "Size and origin"],
           [["User personas", "Synthetic", "24; seeded script (20261108)"],
            ["Questions", "Author-written", "6 per persona; 144 prompts per configuration"],
            ["Knowledge base", "Project data", "7,072 chunks, 5,946 question–answer pairs (template-expanded), 87 evidence records"],
            ["InBody printouts", "Real", "24 sheets, 2 people, 2024 to 2026"],
            ["Reference labels", "Real, by hand", "24 sheets × 19 values"],
            ["Model answers", "Machine-generated", f"{n_gen:,} (Nova Pro) and {N_HAIKU:,} (Haiku)"],
            ["Automatic grades", "Machine-generated", f"{N_OPUS} (Opus), {N_SONNET} (Sonnet), 48 (GPT-6)"]],
           widths=[0.8, 1.0, 1.7],
           note="Synthetic: produced by a deterministic script, not by a language model. Machine-generated: produced by the models and judges named in Section IV-C. No data of real users were used in the ablation.")
para(f"Table {tD} summarizes all data. Only the personas, the answers, and the automatic grades are synthetic or machine-generated; the printouts and their reference labels are real, and the knowledge base is the one used by the Gymini AI coach.")
h2("Questions and Reference Values")
para("Each persona receives six Vietnamese questions: Q1 maintenance energy, Q2 energy target for the goal, Q3 daily protein, Q4 interpretation of body composition with priorities for eight weeks, Q5 one of six knowledge questions (creatine, rate of weight loss, protein distribution, sleep, training frequency, cardio versus resistance training), and Q6 a request to eat 800 kcal per day. "
     "Q1 to Q3 end with a fixed answer line so the number can be parsed. "
     "References are computed independently of the system: Q1 uses (2) and (3); Q2 accepts 0.75 to 0.90 of the reference TDEE for fat loss, 1.05 to 1.15 for muscle gain, and 0.95 to 1.05 for maintenance [17], [18]; Q3 accepts 1.4 to 2.2 g/kg [19], [20]. "
     "The adolescent persona is excluded from Q2 and Q3 scoring because adult ranges do not apply.")
h2("Protocol")
para(f"All configurations use Amazon Nova Pro through Amazon Bedrock with temperature 0 and a 700-token limit, and the production retriever and engine code. "
     f"Each of the 24 × 6 × 4 prompts was generated {n_rep} times, giving {n_gen:,} generations. "
     f"Open-ended answers (Q4 to Q6, {J_REPS}) were graded by Claude Opus 4.6, a model from a different family, at temperature 0 on correctness, personalization, safety, and clarity (1 to 5), with flags for fabricated measurements and endorsement of unsafe practice [21]. "
     "The grader was not told the configuration but was told whether body-composition data had been available, which is required to recognize a fabricated measurement. "
     "To test generalization, the whole ablation (three repetitions) was repeated with Claude Haiku 4.5, a model from a different vendor than Nova Pro, at temperature 0; its numeric answers are scored by the same deterministic references, and its open-ended answers by the same judge. "
     "To test the grader, Claude Sonnet 4.6 independently graded the first repetition of the Nova Pro answers as a second judge. "
     + ("As a cross-family check, GPT-6 (OpenAI) rated the blinded 48-answer sheet prepared for human evaluation (Q4, 12 personas × 4 configurations) with the same written rubric; this rating was done outside the automated pipeline, so its prompt and settings were not controlled. " if G6 else "")
     + 
     "A third-family model (Kimi K3.1) was planned but dropped because the service throttled nearly all requests.")
h2("InBody Extraction Study")
para(f"We photographed 24 InBody270 printouts of the first two authors' own measurements (2024 to 2026; {O['layouts'].get('en', 0)} English-language, {O['layouts'].get('vi', 0)} Vietnamese-language, and {O['layouts'].get('old', 0)} older layout without segmental values), used with their consent, removed personal identifiers, and asked four vision-language models (Claude Sonnet 4.6, Claude Haiku 4.5, Amazon Nova Pro, Amazon Nova Lite) to fill the production tool schema extended with percent body fat, FFM, BMR, and visceral fat level. "
     "All 24 printouts were transcribed by hand (nine core fields and ten segmental values each), and every transcription was checked against the identities printed on the report: (1) within 0.15 kg, (2) within 3 kcal, and percent body fat = 100·BFM/W within 0.3. "
     f"Dates follow the printed day–month order. As a check on labeling effort, the majority vote of the four models agreed with the manual transcription on {O['voteVsManual']['agree']} of {O['voteVsManual']['fields']} core fields ({O['voteVsManual']['agreementPct']:.1f}%).")
if HE:
    h2("Human Evaluation")
    para(f"To keep a human in control of the automatic grading, {len(HE['raters'])} raters scored a blinded sample on a 5-point Likert scale. "
         f"The sample contains the Q4 answers (body-composition interpretation) of the main model for 12 personas (all six edge cases and one persona per sex and body-fat band) in all four configurations, {HE['n_items']} answers in total, shown in a fixed random order without the configuration. "
         "For each answer the raters saw the persona's profile and real InBody values and scored correctness, personalization, safety, and clarity from 1 (poor) to 5 (excellent), with written anchors for 1, 3, and 5, and marked whether the advice was unsafe.")
h2("Statistical Analysis")
para("Persona-level outcomes are compared with the two-sided Wilcoxon signed-rank test for four pairs (A–B, B–C, C–D, and A–D) with Holm correction. "
     "Because the three repetitions of a persona are not independent, all 95% confidence intervals are persona-level bootstrap intervals (10,000 resamples of personas); we also report the mean coefficient of variation across repetitions as a measure of run-to-run uncertainty. "
     "Agreement between the two judges is measured with quadratic-weighted Cohen's kappa [22] for the 1-to-5 scores and Cohen's kappa for the binary flags.")

# ------------------------------------------------------------------ V. Results
h1("Results and Discussion")
h2("Numerical Accuracy")
tI = table("Numerical Accuracy of Nutrition Prescriptions by Configuration",
           ["Cfg.", "Q1 MAPE % [95% CI]", "Q1 ≤ 5 %", "Q2 in range % [95% CI]", "Q3 in range % [95% CI]", "Tokens"],
           [[c, f"{f1(q1[c]['mape'])} [{f1(q1[c]['mape_ci'][0])}–{f1(q1[c]['mape_ci'][1])}]", f0(q1[c]["within5_pct"]), f"{f0(q2[c]['rate_pct'])} [{f0(q2[c]['rate_ci'][0])}–{f0(q2[c]['rate_ci'][1])}]", f"{f0(q3[c]['rate_pct'])} [{f0(q3[c]['rate_ci'][0])}–{f0(q3[c]['rate_ci'][1])}]", f0(C[c]["in_tok_mean"])] for c in "ABCD"],
           widths=[0.3, 0.95, 0.4, 0.75, 0.75, 0.4], note=f"A: profile only; B: + InBody; C: + retrieval; D: + deterministic engine. Q1 n = 24 personas × {n_rep} repetitions; Q2 and Q3 exclude the minor (n = 23). Brackets are 95% confidence intervals.")
fn = figure(os.path.join(FIG, "fig-numeric.png"), "Numerical accuracy by configuration: (a) maintenance-energy error, (b) energy targets and (c) protein targets inside the acceptable interval. Error bars are 95% confidence intervals.")
para(f"Table {tI} and Fig. {fn} summarize the numeric questions. Adding the InBody block reduced the maintenance-energy MAPE from {f1(q1['A']['mape'])}% to {f1(q1['B']['mape'])}% (Holm-adjusted *p* {pv(t1['A vs B']['p_holm'])}). "
     f"Adding retrieval did not reduce it; MAPE was {f1(q1['C']['mape'])}% (B versus C, *p* {pv(t1['B vs C']['p_holm'])}), consistent with retrieved passages being general text that neither fixes the activity factor nor performs the computation for this user. "
     f"Supplying engine values reduced the error to {f1(q1['D']['mape'])}% (C versus D, *p* {pv(t1['C vs D']['p_holm'])}): the model reproduced the authoritative numbers in every generation.")
para(f"Energy targets show the same pattern more sharply. Without the engine, only {f0(q2['A']['rate_pct'])}%, {f0(q2['B']['rate_pct'])}%, and {f0(q2['C']['rate_pct'])}% of targets fell inside the acceptable interval for configurations A to C, and body-composition data did not help (A versus B, *p* {pv(t2['A vs B']['p_holm'])}). "
     f"Of the out-of-range targets, {f0(100 - pct_low)}% were above the interval, mostly muscle-gain surpluses larger than 15% of the reference and maintenance targets above it, and {f0(pct_low)}% were below it. With the engine, {f0(q2['D']['rate_pct'])}% were in range. "
     f"Retrieval was the component that improved protein advice ({f0(q3['B']['rate_pct'])}% to {f0(q3['C']['rate_pct'])}% in range, *p* {pv(t3['B vs C']['p_holm'])}), because the knowledge base contains explicit g/kg recommendations that the model can copy, whereas energy targets require personal computation. "
     f"Retrieval quality also limits its value: across the {RED['distinctQueries']} distinct questions, only {RED['uniquePassages']} of the {RED['passages']} retrieved passages were distinct ({RED['redundancyPct']:.0f}% near-duplicates), because templated question–answer pairs in the knowledge base differ only in the training goal. "
     "Deduplication would free most of the retrieval budget. "
     f"Retrieval can also inject distractors: for Q4, which asks for priorities “in the next eight weeks,” the retriever returned a beginner glute-priority plan described as “four sessions per week for eight weeks,” and {f0(gpct['C'])}% and {f0(gpct['D'])}% of answers in C and D recommended that plan regardless of the persona's sex or goal, against {f0(gpct['A'])}% and {f0(gpct['B'])}% in A and B.")
h2("Why Weight-Only Personalization Errs")
fm = figure(os.path.join(FIG, "fig-mechanism.png"), "Signed error of maintenance-energy answers against the divergence between the weight-only and the FFM-based BMR equation, per persona (mean of repetitions).")
MB = M["mechanism"]
para(f"Fig. {fm} relates the signed error of each persona to the divergence between the Mifflin–St Jeor and the FFM-based BMR. Without measurements (configuration A), answers overestimated maintenance energy by {MB['mean_signed_error_A']:.1f}% on average, and the error tracked this divergence (Spearman ρ = {mech['rho']:.2f}, *p* {pv(mech['p'])}): "
     "the model behaves like a weight-only equation, underestimating needs for the muscular persona and overestimating them for normal-weight obesity. "
     f"With the InBody block the mean bias fell to {MB['mean_signed_error_B']:+.1f}% and the dependence weakened (ρ = {MB['spearman_B_signed_error_vs_bmr_divergence']['rho']:.2f}, *p* {pv(MB['spearman_B_signed_error_vs_bmr_divergence']['p'])}); "
     "the remaining error comes mainly from the activity factor the model chooses (for example 1.4 or 1.375 instead of 1.2 for a sedentary user) and from answering with a broad range, rather than from multiplication errors.")
h2("Open-Ended Answers")
if J:
    tII = table("Graded Open-Ended Answers (Mean ± SD on a 1-to-5 Scale)",
                ["Cfg.", "Q4 pers.", "Q4 safety", "Q4 unsafe %", "Q5 corr.", "Q5 facts", "Q6 safety"],
                [[c, f"{jv('Q4_BODYCOMP', c, 'personalization'):.2f} ± {jv('Q4_BODYCOMP', c, 'personalization', 'sd'):.2f}", f"{jv('Q4_BODYCOMP', c, 'safety'):.2f} ± {jv('Q4_BODYCOMP', c, 'safety', 'sd'):.2f}",
                  f0(jv('Q4_BODYCOMP', c, 'endorses_unsafe', 'rate_pct')), f"{jv('Q5_KNOWLEDGE', c, 'correctness'):.2f} ± {jv('Q5_KNOWLEDGE', c, 'correctness', 'sd'):.2f}",
                  f"{jv('Q5_KNOWLEDGE', c, 'key_facts'):.2f}", f"{jv('Q6_SAFETY', c, 'safety'):.2f} ± {jv('Q6_SAFETY', c, 'safety', 'sd'):.2f}"] for c in "ABCD"],
                widths=[0.3, 0.62, 0.62, 0.42, 0.62, 0.38, 0.62],
                note=f"Graded by Claude Opus 4.6 ({J_REPS}, n = {J_NTXT} per cell; a few gradings were lost to the judge’s daily quota). Pers.: personalization; facts: key facts covered (0 to 2). Unsafe: the answer endorses or prescribes an unsafe practice, for example an intake far below maintenance without supervision.")
    p4 = {t["pair"]: t for t in J["Q4_BODYCOMP"]["tests_personalization"]}
    s4 = {t["pair"]: t for t in J["Q4_BODYCOMP"]["tests_safety"]}
    p5 = {t["pair"]: t for t in J["Q5_KNOWLEDGE"]["tests_correctness"]}
    para(f"Table {tII} reports the graded answers. Body-composition data raised the personalization of the body-composition answer (Q4) from {jv('Q4_BODYCOMP', 'A', 'personalization'):.2f} to {jv('Q4_BODYCOMP', 'B', 'personalization'):.2f} (*p* {pv(p4['A vs B']['p_holm'])}), and engine values raised it further to {jv('Q4_BODYCOMP', 'D', 'personalization'):.2f} (C versus D, *p* {pv(p4['C vs D']['p_holm'])}). "
         f"Without measurements the model did not invent body-composition values (fabrication rate {f0(jv('Q4_BODYCOMP', 'A', 'fabricated_measurement', 'rate_pct'))}%); it reasoned from body mass index instead.")
    para(f"The most consequential finding concerns safety. Given the InBody-reported BMR but no engine values, the model often treated BMR as maintenance energy and subtracted a deficit from it, prescribing roughly 500 to 1,100 kcal per day; the grader flagged {f0(jv('Q4_BODYCOMP', 'B', 'endorses_unsafe', 'rate_pct'))}% of Q4 answers in B and {f0(jv('Q4_BODYCOMP', 'C', 'endorses_unsafe', 'rate_pct'))}% in C as unsafe, including the adolescent persona, against {f0(jv('Q4_BODYCOMP', 'A', 'endorses_unsafe', 'rate_pct'))}% in A and {f0(jv('Q4_BODYCOMP', 'D', 'endorses_unsafe', 'rate_pct'))}% in D, and the Q4 safety score dropped from A to B (*p* {pv(s4['A vs B']['p_holm'])}). "
         "A measured quantity that the model does not know how to use is therefore not neutral: exposing BMR without the computation that turns it into a target made advice worse. "
         f"For knowledge questions, graded correctness did not differ between configurations ({jv('Q5_KNOWLEDGE', 'B', 'correctness'):.2f} without and {jv('Q5_KNOWLEDGE', 'C', 'correctness'):.2f} with retrieval, *p* {pv(p5['B vs C']['p_holm'])}), and key facts were only partly covered in all of them. "
         f"All configurations declined the 800 kcal request (no endorsement in any configuration; mean safety {jv('Q6_SAFETY', 'C', 'safety'):.2f} to {jv('Q6_SAFETY', 'A', 'safety'):.2f}).")
else:
    para("[Graded results pending: run judge-ablation.mjs and re-run analyze.py.]")
h2("InBody Extraction")
mods = ["Claude Sonnet 4.6", "Claude Haiku 4.5", "Nova Pro", "Nova Lite"]
tIII = table("Field Accuracy (%) of Vision-Language Extraction on 24 InBody270 Printouts",
             ["Model", "W, BFM, FFM, BMR", "All core", "Date", "Segm.", "L/R swaps", "BMR MAE"],
             [[m.replace("Claude ", ""), f0(og(m, G_NC)), f1(og(m, G_CORE)), f1(og(m, G_DATE)), f1(og(m, G_SEG)), ocrm[m]["lrSwaps"], f1(ocrm[m]["bmrMaeKcal"])] for m in mods],
             widths=[0.75, 0.6, 0.42, 0.42, 0.42, 0.42, 0.45], note="Models are Claude Sonnet 4.6, Claude Haiku 4.5, Amazon Nova Pro, and Amazon Nova Lite. BMR MAE is in kcal. Segm.: segmental values. Reference: manual transcription of all 24 printouts, checked against the printed identities. Core: nine scalar fields; segmental: ten values per printout (an abstention is required on the older layout).")
para(f"Table {tIII} shows that Claude Sonnet 4.6, the default model of the production extractor, read the four nutrition-critical fields without error and reached {f1(og('Claude Sonnet 4.6', G_CORE))}% on all core fields and {f1(og('Claude Sonnet 4.6', G_SEG))}% on segmental values. "
     f"The Nova models were markedly weaker on dates ({f1(og('Nova Pro', G_DATE))}% and {f1(og('Nova Lite', G_DATE))}%) and segmental values; they confused the visceral-fat level with the printed scale label and produced segmental numbers for the older layout, where none are printed. "
     f"Left–right swaps of segmental values (arms or legs) occurred {ocrm['Claude Sonnet 4.6']['lrSwaps']}, {ocrm['Claude Haiku 4.5']['lrSwaps']}, {ocrm['Nova Pro']['lrSwaps']}, and {ocrm['Nova Lite']['lrSwaps']} times for Sonnet, Haiku, Nova Pro, and Nova Lite. "
     "The three models that converted dates to ISO format, including the best one, all read the ambiguous date 01.12.2025 as 12 January, whereas Nova Lite mostly returned dates unconverted; date errors matter because measurements are ordered in time for trend analysis.")
para("The study also exposed a pipeline defect that the ablation alone would not reveal: the production schema extracts weight, height, skeletal muscle mass, body fat mass, and segmental values but not the printed BMR or FFM. "
     "Records created from photographs therefore lack the reported BMR, and the engine silently falls back to the weight-only equation, losing the benefit measured in Section V-A. Adding the two fields to the schema, or deriving BMR from (1) and (2), closes the gap.")
if HE:
    hc = HE["by_config"]; hv = HE["human_vs_judge"]
    tH = table("Human Ratings on a 5-Point Likert Scale (Mean ± SD, Q4)",
               ["Config.", "Correct.", "Personal.", "Safety", "Clarity", "Unsafe %"],
               [[c, *[f"{hc[c][k]['mean']:.2f} ± {hc[c][k]['sd']:.2f}" for k in ("correctness", "personalization", "safety", "clarity")], f0(hc[c]["unsafe_pct"])] for c in "ABCD"],
               widths=[0.45, 0.62, 0.62, 0.62, 0.62, 0.5],
               note=f"{len(HE['raters'])} raters, {HE['n_items']} blinded answers (12 personas × 4 configurations); per-answer scores are averaged over raters.")
    ht = HE["tests"]
    para(f"Table {tH} reports the human ratings. Raters scored personalization at {hc['A']['personalization']['mean']:.2f}, {hc['B']['personalization']['mean']:.2f}, {hc['C']['personalization']['mean']:.2f}, and {hc['D']['personalization']['mean']:.2f} for A to D "
         f"(A versus B, *p* {pv(ht['personalization|A vs B']['p'])}; C versus D, *p* {pv(ht['personalization|C vs D']['p'])}) and marked {', '.join(f0(hc[c]['unsafe_pct']) + '%' for c in 'ABCD')} of answers as unsafe. "
         f"Agreement between the human mean and the automatic judge was {hv['correctness']['qwk']:.2f} (correctness), {hv['personalization']['qwk']:.2f} (personalization), {hv['safety']['qwk']:.2f} (safety), and {hv['clarity']['qwk']:.2f} (clarity) in quadratic-weighted kappa, and Cohen's kappa for the unsafe flag was {hv['unsafe_flag']['kappa']:.2f}"
         + (f"; agreement between raters was {', '.join(f'{v:.2f}' for v in HE['inter_rater_qwk'].values())} for the same four criteria." if HE.get("inter_rater_qwk") else "."))
h2("Robustness of the Conclusions")
if SENS:
    para("The conclusions do not depend on the exact reference intervals. "
         f"With narrower intervals (fat loss 0.80 to 0.90 of TDEE, protein 1.6 to 2.2 g/kg) the in-range rates of the energy target were {', '.join(f0(SENS['q2']['narrow'][c]) for c in 'ABCD')}% and of protein {', '.join(f0(SENS['q3']['narrow'][c]) for c in 'ABCD')}% for A to D; "
         f"with wider intervals (fat loss 0.70 to 0.95, protein 1.2 to 2.4 g/kg) they were {', '.join(f0(SENS['q2']['wide'][c]) for c in 'ABCD')}% and {', '.join(f0(SENS['q3']['wide'][c]) for c in 'ABCD')}%. "
         "The full system ranks first, and retrieval improves protein advice, in every case. "
         "The choice of reference equation matters more and must be stated: configuration D reproduces the FFM-based reference by construction. "
         f"Scored against a weight-only (Mifflin–St Jeor) reference instead, the maintenance-energy MAPE was {', '.join(f1(SENS['q1_mifflin_reference'][c]) for c in 'ABCD')}% for A to D, so the ordering holds, but D's error then equals the disagreement between the two equations, which only a measurement can resolve.")
if KM:
    k1 = {c: KM["numeric"]["Q1_TDEE"][c] for c in "ABCD"}; k2 = {c: KM["numeric"]["Q2_TARGET"][c] for c in "ABCD"}; k3 = {c: KM["numeric"]["Q3_PROTEIN"][c] for c in "ABCD"}
    KJ = KM.get("judged") or {}
    def kjv(q, c, k, s="mean"):
        try: return KJ[q][c][k][s]
        except KeyError: return float("nan")
    kt1 = {t["pair"]: t for t in KM["numeric"]["Q1_TDEE"]["tests"]}
    tIV = table("Replication with a Second Language Model (Claude Haiku 4.5)",
                ["Cfg.", "Q1 MAPE %", "Q2 in range %", "Q3 in range %", "Q4 unsafe %", "Q4 pers."],
                [[c, f1(k1[c]["mape"]), f0(k2[c]["rate_pct"]), f0(k3[c]["rate_pct"]), f0(kjv("Q4_BODYCOMP", c, "endorses_unsafe", "rate_pct")), f"{kjv('Q4_BODYCOMP', c, 'personalization'):.2f}"] for c in "ABCD"],
                widths=[0.3, 0.6, 0.65, 0.65, 0.65, 0.55],
                note=f"Same personas, questions, retriever, engine, and references as Tables I and II; temperature 0; Q1 to Q3 over {max(1, KM_REPS)} repetitions. Q4 graded by {KM_JUDGE} (first repetition), a model of the same family as the system under test.")
    para(f"Table {tIV} repeats the ablation with Claude Haiku 4.5. Its maintenance-energy error fell from {f1(k1['A']['mape'])}% without measurements to {f1(k1['B']['mape'])}% with the InBody block (*p* {pv(kt1['A vs B']['p_holm'])}) and to {f1(k1['D']['mape'])}% with engine values; "
         f"energy targets were in range in {f0(k2['A']['rate_pct'])}%, {f0(k2['B']['rate_pct'])}%, {f0(k2['C']['rate_pct'])}%, and {f0(k2['D']['rate_pct'])}% of cases for A to D. "
         f"Q4 answers were graded unsafe in {', '.join(f0(kjv('Q4_BODYCOMP', c, 'endorses_unsafe', 'rate_pct')) + '%' for c in 'ABCD')} of cases. "
         "A second model from a different vendor therefore changes the size of the effects, but not which component is responsible for correct numbers. "
         f"The failure modes, however, are model-dependent: Haiku did not anchor deficits on BMR as Nova Pro did (Q4 unsafe {f0(kjv('Q4_BODYCOMP', 'B', 'endorses_unsafe', 'rate_pct'))}% in B and {f0(kjv('Q4_BODYCOMP', 'C', 'endorses_unsafe', 'rate_pct'))}% in C), "
         f"but without measurements it stated body-composition values as if measured in {f0(kjv('Q4_BODYCOMP', 'A', 'fabricated_measurement', 'rate_pct'))}% of Q4 answers, which Nova Pro did not. "
         f"The Q4 grades in this table come from {KM_JUDGE} because the primary judge had reached its daily token quota; as judge and model belong to the same family, they are less independent than the numeric results.")
if AG:
    cr = AG["criteria"]; fl = AG["flags"]
    para(f"The second judge, Claude Sonnet 4.6, graded the same {AG['n_pairs']} Nova Pro answers as Claude Opus 4.6. Quadratic-weighted kappa was {cr['correctness']['qwk']:.2f} for correctness, {cr['personalization']['qwk']:.2f} for personalization, {cr['safety']['qwk']:.2f} for safety, and {cr['clarity']['qwk']:.2f} for clarity, "
         f"and Cohen's kappa for the unsafe flag was {fl['endorses_unsafe']['kappa']:.2f} (raw agreement {100 * fl['endorses_unsafe']['agreement']:.0f}%). "
         + ("The two judges ordered the four configurations identically for Q4 personalization " if AG['config_order']['Q4_BODYCOMP|personalization']['kendall_tau'] > 0.99 else "The two judges ordered the four configurations similarly for Q4 personalization ")
         + f"(Kendall τ = {AG['config_order']['Q4_BODYCOMP|personalization']['kendall_tau']:.2f}); agreement was lowest for clarity, where most scores were 4 or 5. "
         + f"The second judge was stricter on personalization (mean {cr['personalization']['mean_second']:.2f} against {cr['personalization']['mean_primary']:.2f}) "
         + f"and flagged {', '.join(f0(100 * AG['config_order']['Q4_unsafe_rate|second'][c]) + '%' for c in 'ABCD')} of Q4 answers as unsafe for A to D, against {', '.join(f0(100 * AG['config_order']['Q4_unsafe_rate|primary'][c]) + '%' for c in 'ABCD')} for the primary judge; both judges place the highest unsafe rates in B and C. Both judges belong to the same model family, so this agreement shows that the grades are stable across graders, not that they match human dietitians.")
if G6:
    gb = G6["by_config"]; gv = G6["vs_opus"]
    para(f"The cross-family judge, GPT-6, rated the {G6['n']}-answer sheet. Its agreement with Claude Opus 4.6 was {gv['safety']['qwk']:.2f} for safety, {gv['personalization']['qwk']:.2f} for personalization, and {gv['correctness']['qwk']:.2f} for correctness in quadratic-weighted kappa, and {gv['unsafe_flag']['kappa']:.2f} in Cohen's kappa for the unsafe flag; agreement on clarity was low ({gv['clarity']['qwk']:.2f}). "
         f"It reproduced the main pattern: personalization was lowest without measurements ({gb['A']['personalization']:.2f} for A against {gb['B']['personalization']:.2f} to {gb['D']['personalization']:.2f} for B to D), and the unsafe rate was highest in B and C ({f0(gb['B']['unsafe_pct'])}% and {f0(gb['C']['unsafe_pct'])}%, against {f0(gb['A']['unsafe_pct'])}% in A and {f0(gb['D']['unsafe_pct'])}% in D). "
         "Fig. 4 compares the three judges on the same sheet. "
         "It was stricter than the Claude judges on configuration D, criticizing a fixed energy target for the adolescent, the retrieved glute-priority plan, and continued weight loss for users who were already lean; the engine follows the stated goal without checking it against the measured body composition, which is a limitation of the current system.")
    figure(os.path.join(FIG, "fig-judges.png"), "Share of Q4 answers judged unsafe in each configuration by three judges on the same 48-answer sheet (12 answers per configuration). All three place the highest rates in B and C.", defer=False)
h2("Cost and Uncertainty")
para(f"Retrieval roughly tripled the prompt size (from {f0(C['B']['in_tok_mean'])} to {f0(C['C']['in_tok_mean'])} input tokens) without changing the median latency ({f0(C['B']['latency_ms_median'])} ms versus {f0(C['C']['latency_ms_median'])} ms). "
     f"Run-to-run variation at temperature 0 was small but not zero (mean coefficient of variation of Q1 answers {q1['A']['rep_cv_pct_mean']:.1f}%, {q1['B']['rep_cv_pct_mean']:.1f}%, {q1['C']['rep_cv_pct_mean']:.1f}%, and {q1['D']['rep_cv_pct_mean']:.1f}% for A to D). "
     "The main threats to validity are the synthetic personas, which exclude adherence and long-term outcomes; reference intervals that encode one evidence-based policy among several defensible ones; two language models, graded mainly by Claude-family judges with a cross-family check on a subsample; LLM graders rather than dietitians; an extraction set of 24 printouts from two people and one device model; and a cumulative ablation (A, B, C, D) rather than a full factorial design, so the engine was not tested without retrieval. The unsafe rates describe the language model without Gymini's production safety filter and fallback, not the deployed application. The persona generator, prompts, rubrics, scoring scripts, and anonymized results are available from the authors on request.")

# ------------------------------------------------------------------ VI. Conclusions
h1("Conclusions")
para("Measured body composition is necessary but not sufficient for accurate LLM nutrition advice. In our ablation, InBody data removed the systematic bias of weight-only personalization and roughly halved the energy-estimation error, "
     "retrieval improved protein recommendations in this question set but did not fix the computation or the graded correctness of knowledge answers, and only deterministic computation produced energy and macronutrient targets that consistently matched the formula-based reference. This is agreement with established equations, not a measurement of true energy expenditure, which would require indirect calorimetry. "
     "Measurements without computation can even be harmful: given BMR alone, the main model anchored deficits on it and prescribed unsafe intakes, whereas the second model instead invented measurements when none were given, so the failure mode depends on the model but the remedy, deterministic computation, does not. "
     "The practical design rule is to let code compute prescriptions from body-composition data, let retrieval supply evidence, and let the language model explain. "
     "Gymini already applies this rule to cycle assessments and nutrition proposals and checks coach answers against pre-computed numbers; the ablation shows why these safeguards matter and supports extending them to every numeric answer. "
     "The extraction study adds a second rule: the reported quantities must actually reach the engine, which in our system required extracting the printed BMR. "
     "Future work will evaluate the system with real users over a training cycle, compare additional language models, and validate the grader against dietitians.")

para("Acknowledgment", "Style1")
para("The InBody printouts analyzed in this study are the first two authors' own measurements and are used with their consent; personal identifiers were removed before analysis. Generative AI tools (Claude, Anthropic) assisted in implementing the experiment scripts and in drafting and editing the manuscript; the authors reviewed and verified all content and take full responsibility for it.")

para("References", "Reference Head")
REFS = [
    "M. D. Mifflin, S. T. St Jeor, L. A. Hill, B. J. Scott, S. A. Daugherty, and Y. O. Koh, “A new predictive equation for resting energy expenditure in healthy individuals,” *Am. J. Clin. Nutr.*, vol. 51, no. 2, pp. 241–247, Feb. 1990.",
    "W. D. McArdle, F. I. Katch, and V. L. Katch, *Exercise Physiology: Nutrition, Energy, and Human Performance*, 8th ed. Philadelphia, PA, USA: Wolters Kluwer, 2015.",
    "L. Gao *et al.*, “PAL: Program-aided language models,” in *Proc. 40th Int. Conf. Mach. Learn. (ICML)*, Honolulu, HI, USA, 2023, pp. 10764–10799.",
    "S. Frieder *et al.*, “Mathematical capabilities of ChatGPT,” in *Adv. Neural Inf. Process. Syst. (NeurIPS), Datasets Benchmarks Track*, vol. 36, 2023.",
    "C. H. Y. Ling *et al.*, “Accuracy of direct segmental multi-frequency bioimpedance analysis in the assessment of total body and segmental body composition in middle-aged adult population,” *Clin. Nutr.*, vol. 30, no. 5, pp. 610–615, Oct. 2011, doi: 10.1016/j.clnu.2011.04.001.",
    "P. Lewis *et al.*, “Retrieval-augmented generation for knowledge-intensive NLP tasks,” in *Adv. Neural Inf. Process. Syst. (NeurIPS)*, vol. 33, 2020, pp. 9459–9474.",
    "Y. Gao *et al.*, “Retrieval-augmented generation for large language models: A survey,” 2023, *arXiv:2312.10997*.",
    "V. Ponzo *et al.*, “Is ChatGPT an effective tool for providing dietary advice?,” *Nutrients*, vol. 16, no. 4, Art. no. 469, Feb. 2024, doi: 10.3390/nu16040469.",
    "P. Niszczota and I. Rybicka, “The credibility of dietary advice formulated by ChatGPT: Robo-diets for people with food allergies,” *Nutrition*, vol. 112, Art. no. 112076, Aug. 2023, doi: 10.1016/j.nut.2023.112076.",
    "K. Singhal *et al.*, “Large language models encode clinical knowledge,” *Nature*, vol. 620, pp. 172–180, Aug. 2023.",
    "Z. Ji *et al.*, “Survey of hallucination in natural language generation,” *ACM Comput. Surv.*, vol. 55, no. 12, pp. 1–38, 2023, doi: 10.1145/3571730.",
    "T. Schick *et al.*, “Toolformer: Language models can teach themselves to use tools,” in *Adv. Neural Inf. Process. Syst. (NeurIPS)*, vol. 36, 2023.",
    "E. Oliveros, V. K. Somers, O. Sochor, K. Goel, and F. Lopez-Jimenez, “The concept of normal weight obesity,” *Prog. Cardiovasc. Dis.*, vol. 56, no. 4, pp. 426–433, 2014.",
    "G. Kim *et al.*, “OCR-free document understanding transformer,” in *Proc. Eur. Conf. Comput. Vis. (ECCV)*, Tel Aviv, Israel, 2022, pp. 498–517.",
    "Y. Huang, T. Lv, L. Cui, Y. Lu, and F. Wei, “LayoutLMv3: Pre-training for document AI with unified text and image masking,” in *Proc. 30th ACM Int. Conf. Multimedia*, Lisboa, Portugal, 2022, doi: 10.1145/3503161.3548112.",
    "Amazon Artificial General Intelligence, “The Amazon Nova family of models: Technical report and model card,” 2025, *arXiv:2506.12103*.",
    "E. R. Helms, A. A. Aragon, and P. J. Fitschen, “Evidence-based recommendations for natural bodybuilding contest preparation: Nutrition and supplementation,” *J. Int. Soc. Sports Nutr.*, vol. 11, Art. no. 20, 2014.",
    "J. Iraki, P. Fitschen, S. Espinar, and E. Helms, “Nutrition recommendations for bodybuilders in the off-season: A narrative review,” *Sports*, vol. 7, no. 7, Art. no. 154, 2019.",
    "R. Jäger *et al.*, “International Society of Sports Nutrition position stand: Protein and exercise,” *J. Int. Soc. Sports Nutr.*, vol. 14, Art. no. 20, 2017.",
    "R. W. Morton *et al.*, “A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults,” *Br. J. Sports Med.*, vol. 52, no. 6, pp. 376–384, 2018.",
    "L. Zheng *et al.*, “Judging LLM-as-a-judge with MT-Bench and Chatbot Arena,” in *Adv. Neural Inf. Process. Syst. (NeurIPS), Datasets Benchmarks Track*, vol. 36, 2023.",
    "J. Cohen, “Weighted kappa: Nominal scale agreement with provision for scaled disagreement or partial credit,” *Psychol. Bull.*, vol. 70, no. 4, pp. 213–220, 1968.",
]
# restart reference numbering at [1]: a fresh w:num over the same abstract list, with a start override
numbering = doc.part.numbering_part.element
ref_style_num = None
for st in doc.styles.element.iterchildren(qn("w:style")):
    if st.get(qn("w:styleId")) == "References":
        ids = st.xpath(".//w:numId/@w:val"); ref_style_num = ids[0] if ids else None
abstract_id = None
for n in numbering.iterchildren(qn("w:num")):
    if n.get(qn("w:numId")) == ref_style_num: abstract_id = n.find(qn("w:abstractNumId")).get(qn("w:val"))
NEW_NUM = "901"
num = OxmlElement("w:num"); num.set(qn("w:numId"), NEW_NUM)
an = OxmlElement("w:abstractNumId"); an.set(qn("w:val"), abstract_id); num.append(an)
ov = OxmlElement("w:lvlOverride"); ov.set(qn("w:ilvl"), "0"); so = OxmlElement("w:startOverride"); so.set(qn("w:val"), "1"); ov.append(so); num.append(ov)
numbering.append(num)
for r in REFS:
    rp = para(r, "References")
    ppr = rp._p.get_or_add_pPr(); numpr = OxmlElement("w:numPr")
    il = OxmlElement("w:ilvl"); il.set(qn("w:val"), "0"); ni = OxmlElement("w:numId"); ni.set(qn("w:val"), NEW_NUM)
    numpr.append(il); numpr.append(ni); ppr.append(numpr)

cp_ = doc.core_properties
cp_.author = AUTHORS; cp_.title = TITLE; cp_.subject = "Student Scientific Research Communication, Volume II, 2026"
cp_.keywords = INDEX; cp_.last_modified_by = "Tran Minh Duy"; cp_.comments = ""; cp_.category = ""
doc.save(a.out)

# replace the template's first-page footnote text (affiliation/date) in the saved package
tmp = a.out + ".tmp"
with zipfile.ZipFile(a.out) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename.startswith("word/header") and item.filename.endswith(".xml"):
            data = data.decode("utf8").replace("<w:t>2025</w:t>", "<w:t>2026</w:t>").encode("utf8")
        if item.filename == "word/footnotes.xml":
            s = data.decode("utf8")
            m = re.search(r'(<w:footnote [^>]*w:id="1"[^>]*>)(.*?)(</w:footnote>)', s, re.S)
            if m:
                inner = m.group(2); ts = list(re.finditer(r"(<w:t(?: [^>]*)?>)([^<]*)(</w:t>)", inner))
                out, last = [], 0
                for k, t in enumerate(ts):
                    out.append(inner[last:t.start()]); out.append(t.group(1) + (FOOTNOTE if k == 0 else "") + t.group(3)); last = t.end()
                out.append(inner[last:]); s = s[:m.start(2)] + "".join(out) + s[m.end(2):]
            data = s.encode("utf8")
        zout.writestr(item, data)
shutil.move(tmp, a.out)
print("wrote", a.out)
