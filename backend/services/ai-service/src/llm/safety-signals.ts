/**
 * Phase 4.7R3 — deterministic SAFETY SIGNAL resolver (symptom-aware).
 *
 * Why: Phase 4.7R2 recognised safety only through NAMED conditions/aliases, so everyday symptom wording
 * ("sinh mổ xong…", "đau lan xuống chân…", "nghe tiếng bục ở bắp chân…") fell through to generic training content.
 * This layer recognises SIGNAL CLASSES (radiating pain, neurological cue, sudden pop/snap, post-surgical / postpartum
 * state, acute trauma event, cardio/syncope red flags, unusual swelling, severe pain qualifiers) and composes them with
 * severity / location / personal-context cues. Detection means "SAFETY HANDLING REQUIRED" — it never diagnoses.
 *
 * Levels:
 *   HIGH_RISK  — ordinary retrieval is bypassed; only trusted curated evidence whose TITLE is about the condition may answer,
 *                otherwise the conservative safety path (abstention) applies.
 *   CAUTION    — same fail-closed document rule (no catalog / training / FAQ text may answer a personal symptom question).
 *   NONE       — normal RAG flow. Benign soreness / ordinary fatigue are deliberately NONE.
 *
 * Pure, no LLM, no I/O. Runs BEFORE concept / domain resolution.
 */
import { detectConcepts, fold } from "./fitness-concepts";
import { resolveSafetyNarrative, type SafetyFinalAction, type SafetyNarrativeResolution } from "./safety-narrative";

export type SafetyLevel = "NONE" | "CAUTION" | "HIGH_RISK";

export type SafetySignalClass =
  | "NAMED_CONDITION" | "POST_SURGICAL_STATE" | "POSTPARTUM_STATE" | "PREGNANCY_STATE"
  | "ACUTE_TRAUMA_EVENT" | "SUDDEN_POP_OR_SNAP" | "RADIATING_PAIN" | "NEUROLOGICAL_SYMPTOM"
  | "CHEST_OR_CARDIO_RED_FLAG" | "SEVERE_DIZZINESS_OR_FAINTING" | "SEVERE_SHORTNESS_OF_BREATH"
  | "UNUSUAL_SWELLING" | "SEVERE_OR_PERSISTENT_PAIN" | "LOCALISED_PAIN"
  | "LOW_RISK_EXERCISE_DISCOMFORT" | "NORMAL_TRAINING_FATIGUE";

export interface SafetySignal { cls: SafetySignalClass; level: SafetyLevel; matched: string }

export interface SafetySignalResolution {
  level: SafetyLevel;
  signals: SafetySignal[];
  /** a named safety condition (hypertension, diabetes, spine, pregnancy…) was also recognised by the concept layer */
  namedCondition: boolean;
  /** the user describes THEIR OWN state/event (vs asking general knowledge) */
  personal: boolean;
  reasons: string[];
  /** Phase 4.7R4: structured, deterministic narrative trace (no raw text) */
  narrative?: SafetyNarrativeResolution;
  finalSafetyAction?: SafetyFinalAction;
}

const VI_ACCENT = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

// ── signal classes (folded text) ────────────────────────────────────────────

const PAIN_FOLDED = /(@bdau@b|@bdau (nhoi|that|lan|buot)|nhuc|buot|nhoi|@bran@b|@bpain@b|@bache@b|@bhurt)/;
const BODY_PART = /(khop|goi|lung|vai|co tay|co chan|got|khuyu|gan|hong|chan|tay|bap chan|bap tay|dui|mong|bung|nguc|co@b|cang chan|ban chan|ban tay|ngon|dau goi|that lung)/;

const HIGH: Array<[SafetySignalClass, RegExp]> = [
  ["SUDDEN_POP_OR_SNAP", /(tieng (buc|rac|rop|bop|pop|snap|crack|dut|rach|bung|rang)|nghe (thay )?(tieng |cai |mot )?(buc|rac|rop|bop|pop|snap|crack|dut|rach)|@bpop@b|@bsnap(ped)?@b|(buc|rac|dut|rach) (o |trong |ngay |tai )?(bap chan|gan|co|khop|goi|vai|dui|got|cang chan|bap tay|nguc|lung)|dut (gan|co|day chang|chang)|rach (co|gan|sun|chang)|@btorn@b|@brupture)/],
  ["ACUTE_TRAUMA_EVENT", /((trat|sai|lech|tut|ra) khop|(gay|nut|ran) xuong|\btrat\b|(nga|roi|va|te) (manh|nang|vao|xuong)|(khong|ko) (the )?(di|dung|chong|cu dong|gap|duoi|nhac|xoay) (duoc|noi)|bam (tim|den|nang)|@bfractur|@bdislocat|@bsprain|@btrauma)/],
  ["RADIATING_PAIN", /((chay|lan|toa|keo) (tu )?[a-z ]{0,15}(xuong|ra|len) (tan |den |toi )?(mat ca|got|ban chan|ngon chan|ngon tay|ban tay|chan|tay)|(xuong|ra) (tan|den|toi) (mat ca|got|ban chan|ngon chan|ngon tay|ban tay)|(lan|toa|lan ra|lan xuong|lan len|toa ra|chay xuong|chay ra) ?(xuong|ra|len|sang)? ?(chan|tay|mong|dui|ban chan|ban tay|canh tay|cang chan|bap chan|got|ngon)|(@bradiat|@bshooting pain|down (the|my) (leg|arm)|@bsciatic))/],
  ["NEUROLOGICAL_SYMPTOM", /(te (ram |bi|ran|tay|chan|ban chan|ban tay|ngon|mong|dui|nguoi|mat|mot ben)|kien bo|mat cam giac|@btingl|@bnumb|pins and needles|yeu (han |hoan toan |dot ngot |bong |tu nhien )?(mot ben|tay|chan|nua nguoi|liet|nua mat)|yeu (dot ngot|liet)|liet (nua|mat|tay|chan)|(khong|ko) (co|cam thay) (luc|cam giac)|sut mi|meo mieng|noi (ngong|khong ro))/],
  ["CHEST_OR_CARDIO_RED_FLAG", /((dau|tuc|that|nhoi|thit) (nang )?(o |giua |vung )?nguc|nguc (dau|tuc|that|nhoi)|(va|toat|ra) mo hoi (lanh|hot)|mo hoi lanh|(tim dap|nhip tim) (tang )?(vot|dot ngot|bat thuong|loan|lech|khong deu|vot|hut|nhay vot|nhanh bat thuong|lo[a-z]+ nhip)|lech nhip|tim (loan|lech nhip|bi hut|nhoi)|roi loan nhip|@bpalpitation|@bchest (pain|pressure|tight)|@bangina|ho ra mau|ra mau)/],
  ["SEVERE_DIZZINESS_OR_FAINTING", /((muon|sap|suyt|bi|da|vua) (ngat|xiu|bat tinh)|ngat xiu|@bxiu@b|bat tinh|mat y thuc|choang (vang|nang|du doi|muon ngat)|chong mat (du doi|nang|muon ngat|tung con|dot ngot)|toi sam mat|@bfaint|@bsyncope|@bpassed? out)/],
  ["SEVERE_SHORTNESS_OF_BREATH", /(hut hoi (kem|va|roi)|nhip tim (tang )?vot|kho tho (dot ngot|bat thuong|du doi|nang|luc nghi|khi nghi|ca khi nghi|khong the)|nghen tho|khong tho (sau )?(duoc|noi)|hut hoi (bat thuong|dot ngot|khi nghi|luc nghi)|@bshort of breath|cannot breathe|khong tho (duoc|noi))/],
  ["SEVERE_OR_PERSISTENT_PAIN", /(sung (nong|do|dau)|nong do|dau (nhoi |that |rat |nhieu )?(du doi|doi ngot|nhoi doi ngot|khong chiu noi|khong cu dong|keo dai (nhieu|vai|mot) (ngay|tuan)|nhieu (ngay|tuan)|ca khi nghi|ve dem|khong (giam|het)|tung con)|rat dau|dau (nhoi )?(rat )?(nang|dot ngot|cap)|@bsevere pain|@bsharp pain|@bunbearable)/],
];

const CAUTION_ONLY: Array<[SafetySignalClass, RegExp]> = [
  ["UNUSUAL_SWELLING", /(sung (to|nhanh|dot ngot|nong|do|bam|khop|goi|chan|bap chan|mat ca chan|vu)|phu (mot|ca|chan|nang)|@bswelling|@bswollen)/],
];

const POSTPARTUM = /(sau sinh|sinh xong|vua sinh|moi sinh|sinh thuong|sinh non@b|lam me@b|sinh con|cho con bu|san hau|@bpostpartum|post-?natal|@bdiastasis|ha co hoanh|sau khi sinh)/;
const PREGNANCY = /(mang thai|co thai|mang bau|co bau|dang bau|me bau|ba bau|bau (bi|thang|tuan|\d)|thai (ky|nhi|nghen|phu)|@bpregnan|trimester|@bexpecting|thai (\d|tuan|thang))/;
const POSTOP_UNACCENTED = /(phau thuat|hau phau|@bpost-?op|@bsurger|@bsurgical|c-?section|@bcesarean|@boperation)/;
const POSTOP_TYPED_WITHOUT_ACCENTS = /(sau mo@b|vua mo@b|moi mo@b|mo xong|da mo@b|sinh mo@b|mo (lay thai|ruot|noi soi|goi|khop|vai|thoat vi|tim|cot song|day chang|bung))/;
const POSTOP_ACCENTED = /(mổ|phẫu thuật|hậu phẫu|sinh mổ|sau mổ|vừa mổ|mới mổ)/;

const BENIGN = /((de|cho|nham) (khong|tranh|phong) (bi )?(dau|chan thuong|dau khop)|phong (ngua|tranh) chan thuong|tranh chan thuong|nhe nhang|nhe@b|am i|e am|e ban|@bdoms@b|moi (co|nhe)|cang co nhe|dau co (nhe |nhe)?sau|(1|2|mot|hai) ngay sau|binh thuong|mai (hom sau|ngay sau)|sau (buoi|khi) tap (chan|nguc|lung|vai|tay) (nang )?(bi )?(dau co|nhuc co|e am)|muscle soreness|mild (soreness|ache))/;
const FATIGUE = /(@bmet@b|@bmoi (met|sau)|met moi|kiet suc nhe|uể oải|@btired@b|@bfatigue)/;
const GENERAL_CUE = /(la gi@b|do dau|tai sao|vi sao|la do|nghia la|nguyen nhan|dau hieu (cua|nao)|trieu chung cua|@bwhat is@b|@bcauses? of|dinh nghia)/;
const PERSONAL_CUE = /(@btoi@b|@bminh@b|@bem@b|@bchau@b|ban than|cua (toi|minh)|vua (bi|nghe|mo|sinh)|dang (bi|co|dau|mang)|moi (bi|mo|sinh|nghe)|(bi|bi bi) (dau|te|sung|trat|gay|nga|ngat)|@bmy@b|@bi am@b|@bi have@b|@bi'm@b|@bi've@b|@bme@b)/;

function build(re: RegExp): RegExp { return re; }
const bs = (r: RegExp): RegExp => new RegExp(`(?<![a-z0-9])(?:${r.source.split("@b").join("\\b")})`, r.flags);

const HIGH_RE = HIGH.map(([c, r]) => [c, bs(r)] as [SafetySignalClass, RegExp]);
const CAUTION_RE = CAUTION_ONLY.map(([c, r]) => [c, bs(r)] as [SafetySignalClass, RegExp]);
const PAIN_RE = bs(PAIN_FOLDED), BODY_RE = bs(BODY_PART), POSTPARTUM_RE = bs(POSTPARTUM), PREGNANCY_RE = bs(PREGNANCY);
const POSTOP_U = bs(POSTOP_UNACCENTED), POSTOP_T = bs(POSTOP_TYPED_WITHOUT_ACCENTS), BENIGN_RE = bs(BENIGN), FATIGUE_RE = bs(FATIGUE), GENERAL_RE = bs(GENERAL_CUE), PERSONAL_RE = bs(PERSONAL_CUE);
void build;

export function resolveSafetySignals(question: string): SafetySignalResolution {
  const q = fold(question);
  const raw = question.toLowerCase().normalize("NFC");
  const accented = VI_ACCENT.test(raw);
  const signals: SafetySignal[] = [];
  const reasons: string[] = [];
  const push = (cls: SafetySignalClass, level: SafetyLevel, m: string) => signals.push({ cls, level, matched: m.trim() });

  for (const [cls, re] of HIGH_RE) { const m = re.exec(q); if (m) push(cls, "HIGH_RISK", m[0]); }

  // pain that SPREADS needs a pain word; "lan" alone (e.g. "lan can") is not radiating pain
  const pain = accented ? /(đau|nhức|buốt|nhói|rát)/.test(raw) : PAIN_RE.test(q);
  if (signals.some((s) => s.cls === "RADIATING_PAIN") && !pain && !/(te|radiat|shooting|sciatic|numb)/.test(q)) {
    signals.splice(signals.findIndex((s) => s.cls === "RADIATING_PAIN"), 1);
  }

  // states that change what exercise is appropriate at all
  const postop = accented ? POSTOP_ACCENTED.test(raw) || POSTOP_U.test(q) : POSTOP_U.test(q) || POSTOP_T.test(q);
  if (postop) push("POST_SURGICAL_STATE", "HIGH_RISK", "post-surgical");
  if (POSTPARTUM_RE.test(q)) push("POSTPARTUM_STATE", "HIGH_RISK", "postpartum");
  if (PREGNANCY_RE.test(q)) push("PREGNANCY_STATE", "HIGH_RISK", "pregnancy");

  const personal = PERSONAL_RE.test(q) || PREGNANCY_RE.test(q) || postop || POSTPARTUM_RE.test(q);
  const general = GENERAL_RE.test(q) && !personal;

  // caution-only classes (can be raised by a trauma/severity cue)
  for (const [cls, re] of CAUTION_RE) { const m = re.exec(q); if (m) push(cls, signals.some((s) => s.level === "HIGH_RISK" && ["ACUTE_TRAUMA_EVENT", "SUDDEN_POP_OR_SNAP"].includes(s.cls)) ? "HIGH_RISK" : "CAUTION", m[0]); }

  // localised pain: caution unless benign soreness language and no high signal
  if (accented && /(\bngất\b|\bxỉu\b|bất tỉnh)/.test(raw)) push("SEVERE_DIZZINESS_OR_FAINTING", GENERAL_RE.test(q) && !PERSONAL_RE.test(q) ? "CAUTION" : "HIGH_RISK", "ngất");
  const hasHigh = signals.some((s) => s.level === "HIGH_RISK");
  if (!hasHigh && pain && BODY_RE.test(q)) {
    if (BENIGN_RE.test(q)) { push("LOW_RISK_EXERCISE_DISCOMFORT", "NONE", "benign soreness"); reasons.push("benign_soreness"); }
    else push("LOCALISED_PAIN", "CAUTION", "localised pain");
  } else if (!hasHigh && FATIGUE_RE.test(q) && !pain) {
    push("NORMAL_TRAINING_FATIGUE", "NONE", "fatigue");
  }

  const det = detectConcepts(question);
  const namedCondition = det.safety;
  if (namedCondition) push("NAMED_CONDITION", "CAUTION", det.concepts.filter((c) => c.safety).map((c) => c.id).join(","));

  // Phase 4.7R4: personal-narrative layer (procedure / indirect postpartum / heart sensation / presyncope / numbness / functional loss / conservative guard)
  const nar = resolveSafetyNarrative(question);
  for (const s of nar.signals) if (s.level !== "NONE") signals.push(s);
  reasons.push(...nar.reasons);
  const benignOnly = nar.expectedTrainingResponse && !signals.some((s) => s.level === "HIGH_RISK");
  if (benignOnly) {
    for (let i = signals.length - 1; i >= 0; i--) {
      const sg = signals[i];
      if (sg.cls === "LOCALISED_PAIN" && !signals.some((o) => o !== sg && o.level === "CAUTION" && o.cls !== "LOCALISED_PAIN")) signals.splice(i, 1);
    }
    reasons.push("expected_training_response_cancels_localised_pain");
  }

  let level: SafetyLevel = "NONE";
  if (signals.some((s) => s.level === "HIGH_RISK")) level = "HIGH_RISK";
  else if (signals.some((s) => s.level === "CAUTION")) level = "CAUTION";

  // a general-knowledge question about a symptom class is not a personal red flag
  if (level === "HIGH_RISK" && general && !signals.some((s) => ["PREGNANCY_STATE", "POST_SURGICAL_STATE", "POSTPARTUM_STATE", "ACUTE_TRAUMA_EVENT", "SUDDEN_POP_OR_SNAP"].includes(s.cls))) {
    level = "CAUTION"; reasons.push("general_knowledge_phrasing");
  }
  const finalSafetyAction: SafetyFinalAction = level === "HIGH_RISK" ? "BYPASS_RETRIEVAL_ABSTAIN" : level === "CAUTION" ? "TITLED_EVIDENCE_ONLY" : "NORMAL_RAG";
  return { level, signals, namedCondition, personal: personal || nar.personal, reasons, narrative: nar, finalSafetyAction };
}
