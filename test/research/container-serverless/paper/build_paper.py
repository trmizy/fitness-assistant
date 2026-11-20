"""Builds the SSRC/IEEE-format manuscript (.docx) for paper 2 from the SSRC Word template and the measured results.

Every number in the text is read from ../results (summary.json, aws.json, container_start.json) and ../analysis/prices.json.
Usage: python build_paper.py --template SSRC_Word_Template.docx --out NCKH-Container-Serverless-v1.docx
(run make_figures.py first; layout helpers are the ones used for paper 1, test/research/inbody-rag-paper/build_paper.py)
"""
import argparse, copy, json, os, re, sys, zipfile, shutil, math
sys.stdout.reconfigure(encoding="utf-8")
import numpy as np
from scipy import stats
import docx
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import make_figures as MF
ap = argparse.ArgumentParser()
ap.add_argument("--template", required=True)
ap.add_argument("--out", required=True)
a = ap.parse_args()

S = MF.S; PR = MF.PR; CM = MF.cost_model()
AWS = json.load(open(os.path.join(ROOT, "results", "aws.json"), encoding="utf8"))
CSTART = json.load(open(os.path.join(ROOT, "results", "container_start.json"), encoding="utf8"))
PH = S["phases"]

# ------------------------------------------------------------------ numbers
def ph(arm, wl, rate, prof="steps"): return PH[f"{arm}|{wl}|{prof}|step-{rate}"]
def f0(x): return f"{x:.0f}"
def f1(x): return f"{x:.1f}"
def f2(x): return f"{x:.2f}"
def ms(x): return f"{x:.1f}" if x < 100 else f"{x:,.0f}"
def awsf(key, field, src="report"):
    v = (AWS.get(key) or {}).get(src, {}).get(field)
    return float(v) if v not in (None, "") else None
OV_RATES = [10, 25, 50, 100, 200, 400]
RD_RATES = [10, 25, 50, 100]
ovl = {r: ph("lambda", "overhead", r) for r in OV_RATES}
ovc = {r: ph("container", "overhead", r) for r in OV_RATES}
# Welch t-test on per-repetition medians (n = 3 per arm) at every rate
def welch(g1, g2, q="p50"):
    m1, s1, m2, s2 = g1[q]["mean"], g1[q]["sd"], g2[q]["mean"], g2[q]["sd"]
    n1, n2 = g1["reps"], g2["reps"]
    t, p = stats.ttest_ind_from_stats(m1, s1, n1, m2, s2, n2, equal_var=False)
    v1, v2 = s1 ** 2 / n1, s2 ** 2 / n2
    df = (v1 + v2) ** 2 / (v1 ** 2 / (n1 - 1) + v2 ** 2 / (n2 - 1)) if (v1 + v2) > 0 else n1 + n2 - 2
    half = stats.t.ppf(0.975, df) * math.sqrt(v1 + v2)
    return m1 - m2, half, p
W400 = welch(ovl[400], ovc[400])
diffs = [ovl[r]["p50"]["mean"] - ovc[r]["p50"]["mean"] for r in OV_RATES]
pmax = max(welch(ovl[r], ovc[r])[2] for r in OV_RATES)
# Lambda function duration (REPORT) on the platform path, averaged over steps and repetitions
dur_ovh = np.mean([awsf(f"lambda|overhead|steps|{rep}|step-{r}", "dur_p50") for rep in (1, 2, 3) for r in OV_RATES])
front_door = ovl[400]["p50"]["mean"] - dur_ovh
cold_l = [awsf(f"lambda|overhead|steps|{rep}|step-{r}", "cold_starts") or 0 for rep in (1, 2, 3) for r in OV_RATES]
n_ovh_l = sum(AWS[f"lambda|overhead|steps|{rep}|step-{r}"]["client_requests"] for rep in (1, 2, 3) for r in OV_RATES)
# cold start
burst = PH["lambda|overhead|burst|burst"]
cs = S["cold_start"]
init_p50 = np.mean([cs[f"lambda|overhead|burst|{r}|burst"]["init_ms_p50"] for r in (1, 2, 3)])
init_max = max(cs[f"lambda|overhead|burst|{r}|burst"]["init_ms_max"] for r in (1, 2, 3))
first_inv = np.mean([awsf(f"lambda|overhead|burst|{r}|burst", "dur_p50") for r in (1, 2, 3)])
burst_billed = np.mean([awsf(f"lambda|overhead|burst|{r}|burst", "billed_avg") for r in (1, 2, 3)])
cold_count = sum(cs[f"lambda|overhead|burst|{r}|burst"]["cold_starts"] for r in (1, 2, 3))
c_ready = [s_["ready_ms"] for rec in CSTART for s_ in rec["starts"]]
c_db = [s_["first_db_response_ms"] for rec in CSTART for s_ in rec["starts"]]
# reads
rl = {r: ph("lambda", "read", r) for r in RD_RATES + [200]}
rc = {r: ph("container", "read", r) for r in (10, 25, 50)}
r2 = {r: ph("container-r2", "read", r) for r in RD_RATES}
r3 = {r: ph("container-r3", "read", r) for r in RD_RATES}
sust = S["sustainable_offered_rps"]
dur_read = np.mean([awsf(f"lambda|read|steps|{rep}|step-{r}", "dur_p50") for rep in (1, 2, 3) for r in (10, 25, 50)])
billed100 = {rep: awsf(f"lambda|read|steps|{rep}|step-100", "billed_avg") for rep in (1, 2, 3)}
conc100 = {rep: awsf(f"lambda|read|steps|{rep}|step-100", "lconc", "metrics") for rep in (1, 2, 3)}
conn100 = {rep: awsf(f"lambda|read|steps|{rep}|step-100", "dbconn", "metrics") for rep in (1, 2, 3)}
cold100 = {rep: awsf(f"lambda|read|steps|{rep}|step-100", "cold_starts") for rep in (1, 2, 3)}
little = {rep: 100 * billed100[rep] / 1000 for rep in (2, 3)}
conc_r1 = awsf("lambda|read|steps|1|step-200", "lconc", "metrics"); conn_r1 = awsf("lambda|read|steps|1|step-200", "dbconn", "metrics")
conn_c4 = max(awsf(f"container|read|steps|4|{p}", "dbconn", "metrics") for p in ("warmup", "step-10", "step-25", "step-50"))
conn_c3 = [awsf(f"container-r3|read|steps|1|step-{r}", "dbconn", "metrics") for r in RD_RATES]
cpu_25_50 = [awsf(f"{k}|step-{r}", "dbcpu", "metrics") for k in ("lambda|read|steps|2", "lambda|read|steps|3", "container|read|steps|2", "container|read|steps|3", "container|read|steps|4", "container-r2|read|steps|1", "container-r3|read|steps|1") for r in (25, 50)]
cpu_warm = [awsf(k, "dbcpu", "metrics") for k in ("lambda|read|steps|1|warmup", "lambda|read|steps|2|warmup", "lambda|read|steps|3|warmup", "container|read|steps|4|warmup")]
n_req = sum(1 for _ in [])  # placeholder kept 0; total requests are counted below from aws.json client counts
n_req = sum(v.get("client_requests", 0) for k, v in AWS.items())
spike_l = PH["lambda|read|spike|spike"]; spike_c = PH["container|read|spike|spike"]
lam_overhead_share = PR["apigw_http_request_usd"] / CM["c_ovh"]
def usd_m(x): return f"{x * 1e6:.2f}"        # USD per million requests
month = lambda rps_, usd_req: rps_ * usd_req * 30 * 24 * 3600
cont_month_1 = CM["one_host_h"] * 720

# ------------------------------------------------------------------ text
# Title proposed by the supervisor on 2026-11-14 (second of his two options): deployment models are compared; microservices is the shared architecture.
TITLE = "An Experimental Evaluation of Container-Based and Serverless Deployment Models for Fitness Management Applications Using Microservices Architecture"
AUTHORS = "Tran Minh Duy, Nguyen Huy Trong, Tran Vo My Tien, and Huynh Nam"   # supervisor last, as in paper 1; edit here if the author list differs
AFFILIATION = "Faculty of Information Technology, Industrial University of Ho Chi Minh City"
EMAILS = ["22673991.duy@student.iuh.edu.vn", "22669731.trong@student.iuh.edu.vn", "24732641.tien@student.iuh.edu.vn"]
FOOTNOTE = "Manuscript submitted November 2026."
AUTHOR_FRAME_Y = 2650   # title wraps to four lines at 24 pt

ABSTRACT = (
    "Fitness management applications built on a microservices architecture can be deployed in two main ways: as containers that run continuously on cloud virtual machines, "
    "or as serverless functions that the cloud provider starts, scales, and bills per request. "
    "This paper experimentally evaluates the two deployment models for the same microservice and compares them in terms of latency, scalability, and cost. "
    "The fitness service of a fitness management application was deployed from one identical package both as Docker containers behind a load balancer and as AWS Lambda functions behind an HTTP gateway, "
    "with the same processor and memory share, network, configuration, and PostgreSQL database. "
    f"An open-loop load generator sent {n_req:,} requests in stepped, burst, and spike profiles to an endpoint that does not use the database and to database-backed catalogue reads. "
    f"Without the database, both models served 400 requests per second without errors, but the container-based deployment answered in {f1(ovc[400]['p50']['mean'])} ms at the median against {f1(ovl[400]['p50']['mean'])} ms for the serverless deployment, "
    f"and serverless cold starts took {burst['p50']['mean'] / 1000:.2f} s. "
    f"With the database, one container replica was limited by its five-connection pool to {f0(sust['container|read'])} requests per second and three replicas reached {f0(sust['container-r3|read'])}, "
    f"whereas the serverless deployment scaled automatically to {f0(conc_r1)} concurrent instances and {f0(conn_r1)} database connections before failing at the same database limit. "
    f"Based on measured billed durations, the serverless deployment is cheaper below about {f0(CM['be_read'])} requests per second on average. "
    "Serverless elasticity therefore moves the bottleneck to the database rather than removing it."
)
INDEX = "Cloud computing, cold start, connection pooling, containers, cost model, microservices, performance evaluation, serverless computing"

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
for fp in P[1]._p.xpath("./w:pPr/w:framePr"): fp.set(qn("w:y"), str(AUTHOR_FRAME_Y))
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
        parts = re.split(r"(\*[^*]+\*|_\{[^}]*\}|\^\{[^}]*\})", text)
        for s in parts:
            if not s: continue
            if s.startswith("*") and s.endswith("*"): r = p.add_run(s[1:-1]); r.italic = True
            elif s.startswith("_{"): r = p.add_run(s[2:-1]); r.font.subscript = True
            elif s.startswith("^{"): r = p.add_run(s[2:-1]); r.font.superscript = True
            else: p.add_run(s)
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
    m = OxmlElement("m:oMath")
    def mr(txt, plain=False):
        r = OxmlElement("m:r")
        if plain:
            rp = OxmlElement("m:rPr"); sty = OxmlElement("m:sty"); sty.set(qn("m:val"), "p"); rp.append(sty); r.append(rp)
        t = OxmlElement("m:t"); t.text = txt; t.set(qn("xml:space"), "preserve"); r.append(t); return r
    # base_{sub} / base^{sup}; base = one symbol (optionally with a combining mark)
    for tok in re.split(r"(.̄?[_^]\{[^}]*\})", expr):
        if not tok: continue
        mm = re.fullmatch(r"(.̄?)([_^])\{([^}]*)\}", tok)
        if not mm: m.append(mr(tok)); continue
        kind = "m:sSub" if mm.group(2) == "_" else "m:sSup"
        el = OxmlElement(kind); e = OxmlElement("m:e"); e.append(mr(mm.group(1))); el.append(e)
        sb = OxmlElement("m:sub" if kind == "m:sSub" else "m:sup"); sb.append(mr(mm.group(3), plain=len(mm.group(3)) > 1)); el.append(sb)
        m.append(el)
    p._p.append(m)
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
    for _tt in (para(f"Table {ROMAN[TABN[0] - 1]}", "Table Title"), para(title, "Table Title")): _tt.paragraph_format.keep_with_next = True
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
    for ri, row in enumerate(t.rows):
        for cell in row.cells:
            for cp in cell.paragraphs:
                cp.paragraph_format.keep_together = True
                if ri < len(t.rows) - 1 or note: cp.paragraph_format.keep_with_next = True
    if note:
        np_ = para(note, "footnote text"); np_.paragraph_format.keep_together = True
    doc.add_paragraph(style="Normal")
    _defer(_m)
    return ROMAN[TABN[0] - 1]


# ------------------------------------------------------------------ I. Introduction
h1("Introduction")
para("Three concepts are often conflated when cloud deployments are compared. A *microservices architecture* designs a system as small services that are developed and deployed independently; a *container* packages a service with its runtime and runs it in an isolated environment; and *serverless computing* is an operating model in which the cloud provider manages the execution infrastructure and starts, scales, and bills code per request [1], [2]. "
     "Microservices therefore do not compete with containers or serverless: the same microservice can be deployed with either model. "
     "This paper compares two deployment models for a microservices-based fitness management application: a *container-based deployment*, in which the service runs as long-lived containers on cloud virtual machines, and a *serverless deployment*, in which it runs as AWS Lambda functions.")
para("The choice between the two is often made on intuition: serverless is assumed cheaper at low traffic but slower because of cold starts. "
     "Cost studies supported the first intuition for web applications [3], [4], and measurement studies documented cold starts and performance variability on serverless platforms [5], [6]. "
     "Three gaps limit how far these results transfer to a real application. "
     "First, many comparisons deploy different code, runtimes, or resource sizes in each model, so platform effects and implementation effects are confounded. "
     "Second, closed-loop load generators slow down when the system slows down and therefore under-report tail latency; reproducibility guidelines ask for repeated runs, reported variability, and a precise description of the load [7]. "
     "Third, most benchmarks exercise stateless functions, whereas a typical microservice reads a shared relational database, and the interaction between serverless elasticity and database connections has been discussed mainly as a design concern [8] rather than measured.")
para("We therefore ask: *when the same microservice is deployed with the container-based and the serverless model in front of the same relational database, how do the two models differ in latency, scalability, and cost, and what limits each of them?* "
     "The service is the fitness service of Gymini, a fitness management application developed in the authors' thesis project. "
     "Our contributions are: (i) a controlled comparison in which both deployment models run byte-identical deployment artifacts on the same operating-system image, Node.js build, processor and memory share, network, and database; "
     "(ii) open-loop measurements that separate the platform path from the database path, with cold starts, stepped load, spikes, and horizontal scaling of the container-based deployment; "
     "(iii) an explanation of the observed limits with Little's law, showing that serverless elasticity converts load into database connections while the container-based deployment is bounded by its connection pool; and "
     "(iv) a cost model driven by measured billed durations and current on-demand prices that yields the traffic level at which the two models cost the same.")

# ------------------------------------------------------------------ II. Related work
h1("Related Work")
para("Adzic and Chatley described the economic and architectural impact of serverless computing on two production systems [4], and Villamizar *et al.* compared the infrastructure cost of a web application deployed as a monolith, as microservices on virtual machines, and on AWS Lambda, reporting large savings for the serverless model [3]. "
     "Both studies estimate cost from workload assumptions; neither measures the latency of the same artifact under both models and increasing load. "
     "Wang *et al.* reverse-engineered instance placement, cold-start latency, and performance isolation on three commercial serverless platforms [5]; Lloyd *et al.* analyzed the factors that influence the performance of microservices hosted as functions, including memory size and container reuse [9]; and Manner *et al.* isolated factors that influence cold-start time, such as runtime and deployment size [10]. "
     "Shahrad *et al.* showed that most functions in a large provider's workload are invoked rarely, which makes cold starts frequent [11], and Scheuner and Leitner's review found that most serverless performance studies use micro-benchmarks and few use realistic applications [6]. "
     "Hellerstein *et al.* argued that serverless functions are poorly suited to data-intensive work because they are short-lived and must reach state over the network [8]; we measure this effect for a database-backed microservice deployed under both models.")

# ------------------------------------------------------------------ III. Methodology
h1("Research Methodology")
h2("System Under Test")
para("Gymini follows a microservices architecture with authentication, user, fitness, artificial-intelligence, chat, gym, and payment services behind a gateway. During development every service runs as a Docker container; on AWS the request-response services use the serverless model (Lambda functions behind an API Gateway HTTP API), the real-time chat service runs in containers, and the services share an Aurora PostgreSQL Serverless v2 cluster. "
     "The fitness service owns the exercise catalogue, equipment, and workout programs. It is a Node.js 22 Express application using the Prisma object-relational mapper; on Lambda an adapter converts gateway events into HTTP requests. "
     "We used two of its read-only public operations, so no state was written during the experiment.")
fig_arch = figure(os.path.join(HERE, "fig-architecture.png"),
                  "Experimental architecture. Both deployment models run the same deployment artifact with the same resources and reach the same database and secret store from the same private subnets and security group; only the front door and the execution model differ.")
h2("Two Deployment Models")
para(f"The *serverless deployment* is the deployed Lambda function: 1,024 MB of memory, which Lambda pairs with about 0.58 virtual CPU, in two private subnets, reading the database credentials from Secrets Manager at the first invocation (Fig. {fig_arch}). "
     "For the *container-based deployment* we downloaded the deployment package of that function, unchanged, and replaced only the adapter with a short entry point that loads the same runtime configuration and starts the Express listener. "
     "It runs in the AWS Lambda Node.js 22 base image, so the operating system and Node.js build are the same, with each container replica limited to 0.58 CPU and 1,024 MB by Docker. "
     "One to three replicas run on one m7i.large instance in the same private subnet, with the same security group and environment variables, behind an Application Load Balancer. "
     "Caching was disabled in both models, and both use Prisma's default pool of five database connections per process.")
h2("Workloads and Load Generation")
para("The *platform* workload requests a protected equipment endpoint without a token; the authentication middleware returns HTTP 401 before any database call, so the latency measures the front door, the runtime, and the framework only. "
     "The *read* workload mixes 50% catalogue pages of 20 exercises, 30% exercise-detail lookups, and 20% filter-option queries, all served from PostgreSQL. "
     "The generator is open-loop: it sends each request at its scheduled time regardless of earlier responses, which avoids the coordinated omission of closed-loop tools [12]. "
     "It ran on a separate c7i.xlarge instance in the same region and reached both models through their public endpoints. "
     "The *stepped* profile warms up at 10 requests/s for 60 s and then offers 10, 25, 50, 100, 200, and 400 requests/s for 120 s each, discarding the first 15 s of every step; the *burst* profile sends 50 simultaneous requests after at least 15 idle minutes, which forces serverless cold starts; the *spike* profile jumps from 10 to 100 requests/s and back. "
     "A run stops when more than 50% of requests fail within 10 s, to protect the shared database.")
h2("Comparison Criteria and Models")
para("*Latency* is the client-side median (p50) and 99th percentile (p99) per load step; tail latency matters because a request that fans out to several services waits for the slowest one [13]. "
     "*Scalability* is the goodput as the offered load and the number of replicas grow,")
e_g = eq("G=N_{ok}/T")
para("where *N*_{ok} is the number of successful responses in a window of length *T*, together with the highest *sustained* rate (error rate at most 1% and p99 at most 1 s) and the cold-start time. "
     "Lambda logs give duration, billed duration, and initialization time; CloudWatch gives concurrency, throttles, database connections and CPU, and instance CPU. "
     "*Cost* of one successful serverless request follows from the measured mean billed duration *d̄* (s) and memory *M* (GB):")
e_cl = eq("c_{L}=p_{req}+p_{gw}+p_{GBs}·M·d̄")
para("where *p*_{req}, *p*_{gw}, and *p*_{GBs} are the Lambda request, HTTP gateway request, and gigabyte-second prices. "
     "The container-based deployment costs a fixed amount per hour for *h* hosts:")
e_cc = eq("C_{C}=h·p_{EC2}+p_{ALB}+p_{LCU}+2p_{IP}")
para("with the instance price, the load-balancer hour, one load-balancer capacity unit, and two public IPv4 addresses. "
     "With one host, the two models cost the same at the average arrival rate")
e_be = eq("λ^{*}=C_{C}/(3600·c_{L})")
para("Prices are on-demand list prices for ap-southeast-1 from the AWS Price List API, November 12, 2026 [14]; free tiers are ignored, and the database, network address translation, and secret store are shared by both models and excluded. "
     "Finally, Little's law relates concurrency *L*, arrival rate *λ*, and response time *W* [15]:")
e_ll = eq("L=λW")
para("A Lambda instance serves one request at a time, so *L* is the number of busy instances, each holding its own connections; a container replica serves *L* concurrent requests through at most *P* = 5 pooled connections, so it saturates when the database time per request exceeds *P*/*λ*.")

# ------------------------------------------------------------------ IV. Experiments
h1("Experiments and Results")
h2("Setup and Protocol")
para(f"All runs took place on November 12, 2026, in one AWS account and region (Table {ROMAN[TABN[0]]}). "
     "Latency is reported in Sections IV-B to IV-D, scalability in Sections IV-C and IV-D, and cost in Section IV-E. "
     "The platform workload was repeated three times per model up to 400 requests/s. "
     "In the first serverless read run the database reached 100% CPU at 50 to 100 requests/s and the run stopped at 200 requests/s, so later read runs were capped at 100 requests/s, each database-backed run was followed by a 3 to 5 minute cool-down, and the order of the models alternated between repetitions. "
     "The first container-based read run started while the database was still saturated by the preceding serverless run and was excluded; a fourth repetition replaced it. "
     "Scaling to two and three replicas was measured once each.")
table("Experimental Configuration",
      ["Item", "Serverless", "Container-based"],
      [["Code", "fitness-service package", "same package"],
       ["Runtime", "Node.js 22, Amazon Linux 2023", "same base image"],
       ["Compute", "1,024 MB, ≈0.58 vCPU", "0.58 CPU, 1,024 MB × 1–3"],
       ["Front door", "API Gateway HTTP API", "Application Load Balancer"],
       ["Scaling", "automatic, per request", "fixed replicas, one host"],
       ["Database", "Aurora PostgreSQL v2, 0.5–2 ACU", "same cluster"],
       ["Pool", "5 connections per instance", "5 per replica"],
       ["Client", "open-loop, c7i.xlarge", "same"]],
      note="vCPU = virtual CPU; ACU = Aurora capacity unit (about 2 GB of memory each).",
      widths=[0.8, 1.6, 1.5])
h2("Latency Without the Database")
fig_lat = figure(os.path.join(HERE, "fig-latency.png"),
                 "Client latency versus offered load: median (thin) and 99th percentile (thick), mean ± SD over three repetitions for the platform path (a) and over the valid repetitions for catalogue reads (b). Container ×1 = container-based deployment with one replica.")
para(f"Neither model produced an error or throttle on the platform path up to 400 requests/s (Table {ROMAN[TABN[0]]}, Fig. {fig_lat}a). "
     f"The container-based deployment answered in {f1(min(g['p50']['mean'] for g in ovc.values()))} to {f1(max(g['p50']['mean'] for g in ovc.values()))} ms at the median and the serverless deployment in {f1(min(g['p50']['mean'] for g in ovl.values()))} to {f1(max(g['p50']['mean'] for g in ovl.values()))} ms; "
     f"the difference was {f1(min(diffs))} to {f1(max(diffs))} ms at every rate (Welch's t-test on repetition medians, {'p < 0.001' if pmax < 0.001 else f'p ≤ {pmax:.3f}'}; at 400 requests/s {f1(W400[0])} ms, 95% CI ±{f2(W400[1])}). "
     f"The Lambda function itself ran for only {f2(dur_ovh)} ms at the median, so about {f0(front_door)} ms of every serverless request is spent in the gateway and the invocation path. "
     f"Latency did not grow with load in either model: one container replica handled 400 requests/s with instance CPU below 10%, and the serverless deployment absorbed the same load with at most {f0(max(awsf(f'lambda|overhead|steps|{r}|step-400', 'lconc', 'metrics') for r in (1, 2, 3)))} concurrent instances and {f0(sum(cold_l))} cold starts in {n_ovh_l:,} requests.")
table("Platform-Path Latency (ms), Mean ± SD over Three Repetitions",
      ["Rate (req/s)", "Serverless p50", "Serverless p99", "Container p50", "Container p99"],
      [[str(r), f"{f1(ovl[r]['p50']['mean'])} ± {f1(ovl[r]['p50']['sd'])}", f"{f1(ovl[r]['p99']['mean'])} ± {f1(ovl[r]['p99']['sd'])}",
        f"{f1(ovc[r]['p50']['mean'])} ± {f1(ovc[r]['p50']['sd'])}", f"{f1(ovc[r]['p99']['mean'])} ± {f1(ovc[r]['p99']['sd'])}"] for r in OV_RATES],
      note="Container = container-based deployment, one replica. Error rate was 0% in all cells; req/s = requests per second.",
      widths=[0.7, 1, 1, 1, 1])
h2("Cold Start")
para(f"All {cold_count} burst requests after 15 idle minutes (three bursts of 50) started new Lambda instances, and all succeeded. "
     f"Initialization took only {f0(init_p50)} ms at the median (at most {f0(init_max)} ms), but because the handler fetches the database secret and only then imports the application on its first call, the first invocation ran for {first_inv / 1000:.2f} s; the client waited {burst['p50']['mean'] / 1000:.2f} s at the median and {burst['p99']['mean'] / 1000:.2f} s at the 99th percentile, and each cold request was billed {burst_billed / 1000:.2f} s. "
     f"A container replica became ready in {min(c_ready) / 1000:.1f} to {max(c_ready) / 1000:.1f} s and answered its first database request after {min(c_db) / 1000:.1f} to {max(c_db) / 1000:.1f} s, but this cost is paid once at deployment or scale-out rather than by the first user after an idle period.")
h2("Scalability With the Database")
fig_sc = figure(os.path.join(HERE, "fig-scaling.png"),
                "Catalogue reads: goodput (a) and 99th-percentile latency (b) versus offered load for the serverless deployment and for the container-based deployment with one, two, and three replicas. The dotted lines mark ideal goodput and the 1 s objective.")
para(f"At low load the container-based deployment was faster on reads as well: {f1(rc[10]['p50']['mean'])} ms against {f1(rl[10]['p50']['mean'])} ms at the median at 10 requests/s (Table {ROMAN[TABN[0]]}, Fig. {fig_sc}b). "
     f"The Lambda function itself ran for {f0(dur_read)} ms, so the gap exceeds the {f0(front_door)} ms front-door cost; we did not isolate the remainder, which may come from connection and query-engine warm-up across many short-lived instances. "
     f"The database was the common limit: Aurora CPU was already {f0(min(cpu_warm))}% to {f0(max(cpu_warm))}% at the 10 requests/s warm-up and {f0(min(cpu_25_50))}% to 100% at 25 and 50 requests/s under both models (CloudWatch one-minute maxima).")
para(f"The two models failed differently at that limit (Fig. {fig_sc}a). "
     f"One container replica sustained {f0(sust['container|read'])} requests/s but failed at 50 requests/s in all three valid repetitions: its median latency jumped to {ms(rc[50]['p50']['mean'])} ms, the pool's 10 s acquisition timeout, and the service answered HTTP 500, as (5) predicts once the database time per request exceeds *P*/*λ*. "
     f"In container-based runs after a cool-down, the whole cluster held only {f0(conn_c4)} connections with one replica and at most {f0(max(conn_c3))} with three. "
     f"Two replicas carried 50 requests/s without errors but with a p99 of {ms(r2[50]['p99']['mean'])} ms, above the objective; three replicas carried it with {ms(r3[50]['p99']['mean'])} ms, and all replica counts failed at 100 requests/s. "
     f"The serverless deployment sustained {f0(sust['lambda|read'])} requests/s; at 100 requests/s it still delivered {f0(rl[100]['goodput_rps']['mean'])} successful requests/s but {f0(100 * rl[100]['error_rate']['mean'])}% of requests failed with HTTP 500.")
para(f"Serverless elasticity did not remove the bottleneck but multiplied the connections that reached it. "
     f"At 100 requests/s the mean billed duration rose to {f0(billed100[2])} and {f0(billed100[3])} ms in the second and third repetitions, for which (5) predicts {f0(little[2])} and {f0(little[3])} busy instances; CloudWatch recorded peaks of {f0(conc100[2])} and {f0(conc100[3])} concurrent instances, {f0(cold100[2])} and {f0(cold100[3])} new cold starts, and {f0(conn100[2])} and {f0(conn100[3])} database connections. "
     f"In the first repetition, at 200 requests/s, it reached {f0(conc_r1)} concurrent instances, close to the account limit of 1,000, and {f0(conn_r1)} database connections, with zero throttles: every slow query recruited another instance and another set of connections. "
     f"In the spike profile both models failed in the 100 requests/s phase ({f0(100 * spike_c['error_rate']['mean'])}% errors for one container replica, {f0(100 * spike_l['error_rate']['mean'])}% for the serverless deployment).")
def _rrow(name, g, reps):
    return [name, str(int(g["offered_rate"])), str(reps), f0(g["goodput_rps"]["mean"]), f1(100 * g["error_rate"]["mean"]), ms(g["p50"]["mean"]), ms(g["p99"]["mean"])]
rows_ = [_rrow("Serverless", rl[r], rl[r]["reps"]) for r in RD_RATES]
rows_ += [_rrow("Container ×1", rc[r], rc[r]["reps"]) for r in (10, 25, 50)]
rows_ += [_rrow("Container ×2", r2[r], 1) for r in RD_RATES] + [_rrow("Container ×3", r3[r], 1) for r in RD_RATES]
table("Catalogue Reads: Goodput, Errors, and Latency",
      ["Model", "Rate", "Runs", "Goodput", "Error %", "p50 (ms)", "p99 (ms)"], rows_,
      note="Container ×n = container-based deployment with n replicas. Rate and goodput in requests per second; means over runs. Container ×1 stopped at 50 requests/s in every run.",
      widths=[1.25, 0.55, 0.5, 0.75, 0.7, 0.75, 0.75])
h2("Cost")
fig_cost = figure(os.path.join(HERE, "fig-cost.png"),
                  f"Monthly compute cost versus average traffic: serverless at the measured cost per read; container-based with one m7i.large host per {f0(CM['host_cap_read'])} requests/s plus the load balancer.")
para(f"From (2), a platform-path request cost {usd_m(CM['c_ovh'])} USD per million, {f0(100 * lam_overhead_share)}% of it the gateway fee, and a read cost {usd_m(CM['c_read'])} USD per million with a mean billed duration of {f0(CM['b_read'])} ms (Table {ROMAN[TABN[0]]}). "
     f"One container host with its load balancer costs {CM['one_host_h']:.4f} USD per hour from (3), or {usd_m(CM['cont_read_per_req_at_cap'])} USD per million reads at its sustained {f0(CM['host_cap_read'])} requests/s. "
     f"Equation (4) gives a break-even at {f1(CM['be_read'])} requests/s on average (Fig. {fig_cost}): below it the serverless deployment is cheaper, for example {month(1, CM['c_read']):.1f} USD per month at one request per second against {cont_month_1:.0f} USD for an idle host, and above it the container-based deployment is cheaper by up to {CM['c_read'] / CM['cont_read_per_req_at_cap']:.1f} times. "
     "During saturation, billed durations grow with waiting time, so the serverless deployment also pays for the database bottleneck.")
table("Compute Cost per Million Successful Requests (USD)",
      ["Workload", "Serverless", "Container-based at capacity"],
      [["Platform path", usd_m(CM["c_ovh"]), f"{usd_m(CM['cont_ovh_per_req_at_cap'])} (at {f0(CM['host_cap_ovh'])} req/s)"],
       ["Catalogue reads", usd_m(CM["c_read"]), f"{usd_m(CM['cont_read_per_req_at_cap'])} (at {f0(CM['host_cap_read'])} req/s)"],
       ],
      note=f"On-demand prices, ap-southeast-1, November 12, 2026; database, network address translation, logs, and data transfer excluded. The platform-path capacity is the highest rate tested, not a measured limit.",
      widths=[1.1, 0.8, 1.7])

# ------------------------------------------------------------------ V. Discussion
h1("Discussion")
para("For Gymini, whose services see low and bursty traffic, the serverless deployment remains the cheaper default, and its cold-start cost suggests keeping user-facing paths warm or accepting a slower first request after idle periods. "
     "The container-based deployment is faster on every request, by roughly the gateway cost, and becomes cheaper once a service carries steady traffic above the break-even rate. "
     "The more important lesson concerns the database: under the serverless model the effective concurrency limit is the database, so reserved concurrency or a connection proxy should be sized from the database capacity; under the container-based model the pool size times the number of replicas is an explicit limit that should be sized from the same capacity rather than left at the library default.")
para("The results have limits. We studied one service in one region and account, with a small shared development database whose saturation dominates all database-backed results; a larger database would raise both ceilings and may change the comparison. "
     "Other development services shared the database, read loads were capped at 100 requests/s, and the scaling and spike runs were repeated once. "
     "CloudWatch values are one-minute peaks, and database connections are counted for the whole cluster. "
     "The container-based deployment had no autoscaling policy, the two models use different front doors, which is part of what each model is, and costs use on-demand prices without savings plans. "
     "The workload is synthetic but replays real public endpoints against the real catalogue; no personal data were used.")

# ------------------------------------------------------------------ VI. Conclusions
h1("Conclusions")
para(f"For the same microservice, with code, resources, network, and database held constant, the container-based deployment answered about {f0(np.mean(diffs))} ms faster at every load on the platform path, while the serverless deployment paid {burst['p50']['mean'] / 1000:.1f} s for a cold start. "
     f"With the database, both models hit the same ceiling: the serverless deployment reached it by multiplying instances and connections, and the container-based deployment reached it at its connection pool and gained capacity only by adding replicas. "
     f"The measured cost per request places the break-even near {f0(CM['be_read'])} requests per second. "
     "Choosing a deployment model is therefore less about the platform than about where the bottleneck should sit and how it is protected. "
     "Future work will repeat the study with a larger database, a connection proxy and reserved concurrency for the serverless deployment, container autoscaling, and write-heavy endpoints.")

para("Acknowledgment", "Style1")
para("Generative AI tools (Claude, Anthropic) assisted in implementing the experiment scripts and in drafting and editing the manuscript; the authors reviewed and verified all content and take full responsibility for it.")

para("References", "Reference Head")
REFS = [
    "E. Jonas *et al.*, “Cloud programming simplified: A Berkeley view on serverless computing,” Univ. California, Berkeley, CA, USA, 2019, *arXiv:1902.03383*.",
    "S. Eismann *et al.*, “Serverless applications: Why, when, and how?,” *IEEE Softw.*, vol. 38, no. 1, pp. 32–39, Jan. 2021, doi: 10.1109/MS.2020.3023302.",
    "M. Villamizar *et al.*, “Infrastructure cost comparison of running web applications in the cloud using AWS Lambda and monolithic and microservice architectures,” in *Proc. 16th IEEE/ACM Int. Symp. Cluster, Cloud Grid Comput. (CCGrid)*, 2016, pp. 179–182, doi: 10.1109/CCGrid.2016.37.",
    "G. Adzic and R. Chatley, “Serverless computing: Economic and architectural impact,” in *Proc. 11th Joint Meeting Found. Softw. Eng. (ESEC/FSE)*, 2017, pp. 884–889, doi: 10.1145/3106237.3117767.",
    "L. Wang, M. Li, Y. Zhang, T. Ristenpart, and M. Swift, “Peeking behind the curtains of serverless platforms,” in *Proc. USENIX Annu. Tech. Conf. (ATC)*, Boston, MA, USA, 2018, pp. 133–146.",
    "J. Scheuner and P. Leitner, “Function-as-a-Service performance evaluation: A multivocal literature review,” *J. Syst. Softw.*, vol. 170, Art. no. 110708, Dec. 2020, doi: 10.1016/j.jss.2020.110708.",
    "A. V. Papadopoulos *et al.*, “Methodological principles for reproducible performance evaluation in cloud computing,” *IEEE Trans. Softw. Eng.*, vol. 47, no. 8, pp. 1528–1543, Aug. 2021, doi: 10.1109/TSE.2019.2927908.",
    "J. M. Hellerstein *et al.*, “Serverless computing: One step forward, two steps back,” in *Proc. 9th Biennial Conf. Innovative Data Syst. Res. (CIDR)*, Asilomar, CA, USA, 2019.",
    "W. Lloyd, S. Ramesh, S. Chinthalapati, L. Ly, and S. Pallickara, “Serverless computing: An investigation of factors influencing microservice performance,” in *Proc. IEEE Int. Conf. Cloud Eng. (IC2E)*, 2018, pp. 159–169, doi: 10.1109/IC2E.2018.00039.",
    "J. Manner, M. Endreß, T. Heckel, and G. Wirtz, “Cold start influencing factors in function as a service,” in *Proc. IEEE/ACM Int. Conf. Utility Cloud Comput. Companion (UCC Companion)*, 2018, pp. 181–188, doi: 10.1109/UCC-Companion.2018.00054.",
    "M. Shahrad *et al.*, “Serverless in the wild: Characterizing and optimizing the serverless workload at a large cloud provider,” in *Proc. USENIX Annu. Tech. Conf. (ATC)*, 2020, pp. 205–218.",
    "B. Schroeder, A. Wierman, and M. Harchol-Balter, “Open versus closed: A cautionary tale,” in *Proc. 3rd USENIX Symp. Netw. Syst. Des. Implement. (NSDI)*, San Jose, CA, USA, 2006.",
    "J. Dean and L. A. Barroso, “The tail at scale,” *Commun. ACM*, vol. 56, no. 2, pp. 74–80, Feb. 2013, doi: 10.1145/2408776.2408794.",
    "Amazon Web Services, “AWS Lambda pricing,” 2026. [Online]. Available: https://aws.amazon.com/lambda/pricing/ (accessed Nov. 12, 2026).",
    "J. D. C. Little, “A proof for the queuing formula: L = λW,” *Oper. Res.*, vol. 9, no. 3, pp. 383–387, 1961, doi: 10.1287/opre.9.3.383.",
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

