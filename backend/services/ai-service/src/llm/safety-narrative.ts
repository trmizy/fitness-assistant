/**
 * Phase 4.7R4 — deterministic PERSONAL SAFETY NARRATIVE resolver.
 *
 * Why: Phase 4.7R3 recognised signal classes by vocabulary and still missed narratives that name no condition and no
 * symptom alias: a recent procedure described by organ + verb ("cắt amidan hai tuần trước"), a postpartum return implied by
 * the baby's age ("bé nhà mình được tám tuần…"), a heartbeat described with slang ("tim cứ đập thình thịch không dứt"),
 * vision darkening, "tê dại", functional loss. Held-out V4: signal recall 0.667, HIGH-RISK recall 0.417, 2 generic fallthroughs.
 *
 * This layer is COMPOSITIONAL — it never decides from one token. It combines
 *     personal / current-state framing  ×  event | symptom | functional change  ×  temporal / persistence cues
 * and applies a DEFAULT-CONSERVATIVE guard: a personal utterance that describes an abnormal body symptom, a recent medical
 * event or a functional change, and that cannot be confidently read as ordinary training discomfort, may never be answered by
 * generic catalog / programming / hypertrophy / strength content. That is CAUTION (fail-closed documents + abstention), not a diagnosis.
 *
 * Pure, no LLM, no I/O. Detection means "SAFETY HANDLING REQUIRED", never "condition established".
 */
import type { SafetyLevel, SafetySignal, SafetySignalClass } from "./safety-signals";

export type SafetyFinalAction = "NORMAL_RAG" | "TITLED_EVIDENCE_ONLY" | "BYPASS_RETRIEVAL_ABSTAIN";

export interface SafetyNarrativeResolution {
  level: SafetyLevel;
  /** the utterance describes the speaker's own current / recent body state */
  personal: boolean;
  /** knowledge-seeking phrasing about a symptom class (not a personal report) */
  general: boolean;
  signals: SafetySignal[];
  eventSignals: string[];
  symptomSignals: string[];
  temporalSignals: string[];
  functionalSignals: string[];
  /** ordinary training discomfort was recognised with confidence and nothing abnormal accompanies it */
  expectedTrainingResponse: boolean;
  reasons: string[];
  finalSafetyAction: SafetyFinalAction;
}

const fold = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
const L = (src: string): RegExp => new RegExp(`(?<![a-z0-9])(?:${src})(?![a-z0-9])`);

// ── personal / general framing ──────────────────────────────────────────────

const PERSONAL = L("(toi|minh|em|tui|mik|ban than|con minh|be nha minh|nha minh|cua (toi|minh|em)|my|i|i'm|i've|me)(?![a-z0-9])");
const IMPLICIT_PERSONAL = L("(vua|moi|dang|da|bi|van con|cu|toan|hom qua|hom nay|sang nay|toi qua) ");
const GENERAL = L("(la gi(?![a-z])|do dau|tai sao|vi sao|la do|nghia la|nguyen nhan|dau hieu (cua|nao)|trieu chung cua|dinh nghia|what is|causes? of|co phai la|thuong do)");

// ── recent medical event: PROCEDURE ─────────────────────────────────────────

const PROC_VERB = L("(cat|noi|khau|ghep|cay|han|lay|nho|tiem|chich|choc|soi|rach|can thiep|dieu tri|tieu phau|phau thuat|xu ly)(?![a-z0-9])");
const BODY_STRUCT = L("(bao quy dau|soi than|than|tuyen tien liet|tri|mui|nguc|hut mo|rang|amidan|ruot thua|gan got|gan|day chang|sun|khop|dia dem|thoat vi|tui mat|tuyen|polyp|rang khon|goi|vai|co chan|ban chan|cot song|xuong|da day|ruot|tim|mach vanh|van tim|bang quang|tu cung|buong trung|vu|u |nang |thung|stent|nep|dinh|bot(?![a-z])|vet khau|vet mo|can thiep)(?![a-z0-9])");
const PROC_NOUN = L("((thao|dat|goi|nho) (nep|bot|stent|dinh|vit|rang)|stent|nep co tay|bat vit|tieu phau|phau thuat|hau phau|noi soi|ca mo|vet mo|chi khau|vet khau|ghep|cay ghep|c-?section|surgery|surgical|post-?op|operation|stitches|sutures?|ra vien|xuat vien)");
const TEMPORAL = L("(vua|moi|xong|hom (qua|kia)|(\\d+|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi|vai|may) (ngay|tuan|thang) (truoc|roi|nay|qua)?|tuan (truoc|roi)|thang (truoc|roi)|gan day|sau khi|hoi phuc|tai kham|tu luc|den gio|van con|van chua)");
const RETURN_Q = L("(tap|chay|nang|quay lai|tro lai|bat dau lai|duoc chua|duoc khong|co duoc|co nen|co the|bao gio|khi nao|bao lau|squat|plank|core|bung)");

// ── indirect postpartum ─────────────────────────────────────────────────────

const INFANT_NOUN = "(be|chau|nhoc ty|be yeu|con|nhoc|cu cau|em be|thang be|co be|bao bao|con trai|con gai|con nho|baby|bub)";
const NUM_WORDS: Record<string, number> = { mot: 1, hai: 2, ba: 3, bon: 4, nam: 5, sau: 6, bay: 7, tam: 8, chin: 9, muoi: 10, vai: 3, may: 3 };
const INFANT_AGE = new RegExp(`(?<![a-z0-9])${INFANT_NOUN}(?: nha| cua| cung)?(?: minh| toi| em| nha minh)?(?: moi| duoc| da| len| vua| tron| roi| hon| gan)* (?<num>\\d+|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi|vai|may) (?<unit>tuan|thang|ngay)(?! tuoi.*nam)`);
const BIRTH_DIRECT = L("(vua (de|sinh)|moi (de|sinh)|(de|sinh) xong|sau (khi )?(de|sinh)|sinh (thuong|mo|non)|cho con bu|con bu|nuoi con (nho|bu)|me (sau sinh|bim)|bim sua|postpartum|post-?natal|diastasis|ha co hoanh)");
const EXERCISE_RETURN = L("(tap|chay|nang|squat|plank|core|bung|quay lai|tro lai|bat dau lai|vận động|van dong|cardio|hiit|workout|gym)");

// ── symptom families ────────────────────────────────────────────────────────

const HEART_STRONG = L("(tim|nguc) (cu |cu cu |cu dap |cu nhay |dap |nhay )?(thinh thich|dap loan|loan nhip|lung tung|danh trong|bo lo|lo nhip|rung|run|khong deu|bat thuong|vot|hut|nhoi)|danh trong nguc|hoi hop|loan nhip|(trong|o) nguc (thinh thich|danh trong|rung|run)|palpitation|pounding heart|heart (is |was )?(racing|pounding|fluttering|skipping|jumping)|irregular heart|tim (nhu )?(muon )?(nhay|bat) ra");
const HEART_WEAK = L("(tim|nhip tim) (cu |dap |nhay |len |tang )?(nhanh|manh|cao|thinh)|hr (len|tang|cao)|nhip tim (len|tang|cao)");
const PERSISTENCE = L("(khong chiu (cham|giam|ha|lai|dung|ngung|het)|du (da )?(ngoi|nghi|nam|dung)|ngoi nghi|khong (dut|het|ngung|giam|chiu (het|dung))|mai (khong|moi)|keo dai|ca (chuc|vai|may) phut|(\\d+|chuc|vai|may|nhieu) (phut|gio|ngay|tuan|thang)|van (con|chua|cu)|sau khi (nghi|dung|ngoi|ngung|tap xong|xong)|luc nghi|khi nghi|ngoi yen|nam yen|cu (lien tuc|mai|the)|tai di tai lai|lap di lap lai|nhieu lan|tung dot|tung con)");
const VISUAL = L("(hoa mat|toi sam|sam mat|toi mat|mo mat|den mat|mat mo|sao bay|nhin khong ro|loang choang|quay cuong|xay xam|lang lang|bung binh|muon (xiu|nga|do|ngat)|chao dao|suyt (nga|do|xiu|ngat)|sap (xiu|ngat)|di khong vung|dung khong vung|vision (went|goes) (dark|black)|see(ing)? stars|black(ed)? out|light-?headed)");
const NUMBNESS = L("(te (dai|ram|ran|buot|cung|bi|nhu kien|mot (ben|nua)|nguoi|chan|tay|ngon|mat|moi|luoi|dau ngon|ban)|te liet|kien bo|cham chich|nhu kim|mat cam giac|mat cam nhan|lanh buot|tingling|numb|pins and needles)");
const WEAKNESS = L("(yeu (han|dot ngot|bong|di|dan|nhanh|mot ben|tay|chan|nua nguoi)|mat luc|(khong|ko|chang) (co |con )?(luc|nhac duoc|nam duoc|cam duoc|nang noi|giu duoc)|rot do|tut tay|mem nhun|run tay|buong roi|giu khong (nam|noi))");
const FUNCTIONAL = L("((khong|ko|chang) (the )?(duoi|gap|co|xoay|nhac|dung|di|chong|nam|cam|gio|cui|ngoi|vuon|thang|cu dong|chiu|bam)( duoc| noi| thang| tay| lai)|khuyu|sum chan|sup chan|nhung chan|long khop|keo ket|bi ket|ket cung|khap khieng|lech khop|sai khop|mat thang bang|chan khong chiu|khong chiu (tai|luc|noi))");
const SYMPTOM_ANY = L("(dau|nhuc|buot|nhoi|ran|te |tuc (nguc|bung|vung|o)|chong mat|hoa mat|choang|buon non|non |nong rat|kho tho|hut hoi|hoi hop|run |co giat|sung|bam tim|yeu(?! hon)|mat luc|khuyu|ngat|xiu|kho chiu|la lam|bat thuong|ky la|khong binh thuong|thinh thich|loan|rung)");
const EVENT_TRAUMA = L("(nga|trat|gay|bong gan|dap vao|va vao|tai nan|bat ngo|dot ngot|nghe (thay )?(tieng )?(buc|rac|rop|bop|pop|snap|phap)|tieng (buc|rac|rop|bop|pop|snap|phap)|truot chan|vap)");
const SWELLING = L("(sung|phu|bam tim|bam den|nong do|nong dau)");

// confident ordinary training response: only when nothing abnormal accompanies it
const BENIGN_CONFIDENT = L("(hom qua (tap|chay|vua tap)|hoi (nhuc|dau|moi|ne|cang|cung)|(vi|do|boi vi) (moi|kiet suc|tap|set)|set cuoi|doms|e am|nhe nhang|nhe(?![a-z])|binh thuong|cang co|moi co|pump|mo hoi|tho (manh|doc|nhanh) sau (khi )?(chay|nuoc rut|interval|sprint|hiit)|am i|cung khop (buoi sang)?|(1|2|mot|hai) ngay sau|hom sau (buoi )?tap|sau (buoi|khi) tap)");
const ABNORMAL_MODIFIER = L("(bat thuong|ky la|khong binh thuong|dot ngot|du doi|khong dut|khong het|mai (khong|moi)|keo dai|luc nghi|khi nghi|ca ngay|nhieu ngay|nhoi|te |ngat|xiu|tuc nguc|kho tho|muon (xiu|ngat))");

const HEART_DESC = /(thinh thich|loan|lung tung|danh trong|bo lo|lo nhip|rung|khong deu|bat thuong|vot|hut|nhoi|don dap|dap don|hang (mot )?nhip|nhay nhip|ngung dap|dap manh khong)/;
const HEART_SKIP = L("(hang (mot )?nhip|tim hang|mat (mot )?nhip|bo (mot )?nhip|lo (mot )?nhip|ngung (mot )?nhip|tim ngung)");
const EMOTION = L("(xem|phim|bong da|tran dau|thi cu|phong van|cang thang|lo lang|hung phan|lan dau|noi truoc|dam dong)");
const MILD_TRANSIENT = L("(hoi|nhe|thoang qua|mot chut|chut xiu|roi het|vai giay|may giay|het ngay|het nhanh)");
const COUGH_BLOOD = L("(ho ra (mau|bot|dom)|bot hong|dom (hong|mau)|khac ra mau)");
const DISLOCATE = L("((tuot|truot|lech|bat|nhay) (khoi|ra) (o|khop|vi tri)|ra khoi o|nhu bi tuot|bi tuot khoi)");
const TEAR_WORDS = L("((xe|rach|toac|dut|bung) (ra )?(co|gan|khop|bap|dui|chang|som)|kieu (bi )?(xe|rach|dut)|nhu bi (xe|rach|cat|dut)|xe toac)");
const STRONG_FUNCTIONAL = L("((nhac|gio|di|chong|duoi|gap|xoay|dung|cam|nam|nang) (khong|ko) (duoc|noi|nua)|(khong|ko) (the )?(gio|nhac|duoi|gap|xoay|dung|di|chong) [a-z ]{0,20}(duoc|noi)|(khong|ko|chang) (the )?(chiu (luc|tai)|dung (duoc|noi|vung)|di (duoc|noi)|chong (duoc|noi)|nhac (duoc|noi)|gio (len )?(duoc|noi)|duoi thang|gap (duoc|noi)|xoay (duoc|noi)|co duoc)|ket cung|sup xuong|khuyu han)");
const KHO_THO = L("(kho tho|hut hoi|tho khong (noi|duoc)|nghen tho)");
const DYSPNEA_COMPANION = L("(nguc|tim|chong mat|ngat|buon non|sung chan|khi nghi|luc nghi|chi (leo|di)|vai bac|nhe nhang|bat thuong|dot ngot|du doi)");
const CHRONIC = L("(loang xuong|osteopor|hen suyen|asthma|suy tim|nhoi mau|dot quy|stroke|ung thu|cancer|dong kinh|epilep|suy than|xo gan|roi loan nhip|benh mach vanh|tieu duong|cao huyet ap|huyet ap cao|tang huyet ap)");

const has = (re: RegExp, s: string): string | null => { const m = re.exec(s); return m ? m[0].trim() : null; };

export function resolveSafetyNarrative(question: string): SafetyNarrativeResolution {
  const q = fold(question).replace(/\s+/g, " ").trim();
  const signals: SafetySignal[] = [];
  const reasons: string[] = [];
  const eventSignals: string[] = [], symptomSignals: string[] = [], temporalSignals: string[] = [], functionalSignals: string[] = [];
  const push = (cls: SafetySignalClass, level: SafetyLevel, m: string) => signals.push({ cls, level, matched: m });

  const personalWord = PERSONAL.test(q);
  const implicitPersonal = IMPLICIT_PERSONAL.test(`${q} `);
  const general = GENERAL.test(q) && !personalWord;
  const temporal = has(TEMPORAL, q);
  if (temporal) temporalSignals.push(temporal);
  const persistence = has(PERSISTENCE, q);
  if (persistence) temporalSignals.push(persistence);
  const returnQ = !!has(RETURN_Q, q);

  // 1) recent medical event — procedure/removal/repair + body structure + recent/return framing
  const rawEarly = question.toLowerCase().normalize("NFC");
  const castAccented = /(bó bột|băng bột|bó nẹp|đóng đinh|nhổ răng)/.test(rawEarly);
  const unaccentedTyping = !/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/.test(rawEarly);
  const procVerb = has(PROC_VERB, q), bodyStruct = has(BODY_STRUCT, q), procNoun = has(PROC_NOUN, q) ?? (castAccented ? "cast" : (unaccentedTyping && /(^| )bo bot( |$)/.test(q) ? "bo bot" : null));
  if ((procVerb && bodyStruct && (temporal || returnQ) && (personalWord || implicitPersonal || temporal)) || (procNoun && (temporal || returnQ))) {
    eventSignals.push(`procedure:${procNoun ?? `${procVerb}+${bodyStruct}`}`);
    push("POST_SURGICAL_STATE", "HIGH_RISK", `procedure ${procNoun ?? bodyStruct}`);
  }

  // 2) postpartum — direct, or implied by infant age + the speaker's own return to exercise
  const ageM = INFANT_AGE.exec(q);
  if (ageM) {
    const raw = ageM.groups?.num ?? "";
    const n = /^\d+$/.test(raw) ? Number(raw) : (NUM_WORDS[raw] ?? 0);
    const unit = ageM.groups?.unit ?? "";
    const weeks = unit === "tuan" ? n : unit === "thang" ? n * 4.3 : n / 7;
    if (weeks > 0 && weeks <= 60 && (personalWord || implicitPersonal || /(minh|toi|em)/.test(q)) && EXERCISE_RETURN.test(q)) {
      eventSignals.push(`infant_age:${n}${unit}`);
      push("POSTPARTUM_STATE", "HIGH_RISK", `infant ${n} ${unit}`);
    }
  }
  if (BIRTH_DIRECT.test(q) && EXERCISE_RETURN.test(q)) { eventSignals.push("birth_direct"); push("POSTPARTUM_STATE", "HIGH_RISK", "birth"); }

  // 3) abnormal cardiac sensation — strong words need a personal report or persistence; weak words (fast/hard) only with persistence at rest
  const heartStrong = has(HEART_STRONG, q), heartWeak = has(HEART_WEAK, q);
  const emotionalHeart = !!heartStrong && /^hoi hop/.test(heartStrong) && EMOTION.test(q) && !persistence;
  if (emotionalHeart) reasons.push("emotional_context_heart");
  if (heartStrong && !emotionalHeart) {
    symptomSignals.push(`heart:${heartStrong}`);
    if (!general && (personalWord || implicitPersonal || persistence)) push("CHEST_OR_CARDIO_RED_FLAG", "HIGH_RISK", `heart ${heartStrong}`);
    else push("CHEST_OR_CARDIO_RED_FLAG", "CAUTION", `heart ${heartStrong}`);
  } else if (heartWeak && persistence && /(luc nghi|khi nghi|sau khi (nghi|dung|ngoi|ngung)|ngoi yen|nam yen|khong (dut|het|ngung|giam)|mai (khong|moi)|ca (chuc|vai|may) phut)/.test(q)) {
    symptomSignals.push(`heart_at_rest:${heartWeak}`);
    push("CHEST_OR_CARDIO_RED_FLAG", "HIGH_RISK", "persistent fast heartbeat at rest");
  }

  // 4) pre-syncope / visual darkening
  const visual = has(VISUAL, q);
  if (visual) {
    symptomSignals.push(`presyncope:${visual}`);
    const mild = MILD_TRANSIENT.test(q) && !persistence && !/(xiu|nga|ngat|do|du doi|suyt|muon)/.test(q);
    push("SEVERE_DIZZINESS_OR_FAINTING", general || mild ? "CAUTION" : "HIGH_RISK", `presyncope ${visual}`);
  }

  // 5) numbness / new weakness
  const numb = has(NUMBNESS, q), weak = has(WEAKNESS, q);
  if (numb) { symptomSignals.push(`numbness:${numb}`); push("NEUROLOGICAL_SYMPTOM", general ? "CAUTION" : "HIGH_RISK", `numbness ${numb}`); }
  if (weak) {
    symptomSignals.push(`weakness:${weak}`);
    const sudden = /(dot ngot|bong|tu nhien|mot ben|nua nguoi|moi|hom nay|vua)/.test(q);
    push("NEUROLOGICAL_SYMPTOM", sudden && !general ? "HIGH_RISK" : "CAUTION", `weakness ${weak}`);
  }

  // 6) functional limitation (composed with a trauma event ⇒ HIGH; alone but personal ⇒ CAUTION)
  const functional = has(FUNCTIONAL, q);
  const trauma = has(EVENT_TRAUMA, q);
  if (functional) {
    functionalSignals.push(functional);
    if (trauma) { eventSignals.push(`trauma:${trauma}`); push("ACUTE_TRAUMA_EVENT", "HIGH_RISK", `trauma + ${functional}`); }
    else push("ACUTE_TRAUMA_EVENT", personalWord || implicitPersonal ? "CAUTION" : "NONE", `functional ${functional}`);
  }
  if (trauma && !functional && SWELLING.test(q)) { eventSignals.push(`trauma:${trauma}`); push("ACUTE_TRAUMA_EVENT", "HIGH_RISK", `trauma + swelling`); }

  // 6b) R4 compositional / windowed rules
  const toks = q.split(/[^a-z0-9]+/).filter(Boolean);
  const winText = (i: number, a: number, b: number) => toks.slice(Math.max(0, i - a), i + b + 1).join(" ");
  const rawLowerEarly = question.toLowerCase().normalize("NFC");
  const painWord = /(đau|nhức|buốt|nhói|rát)/.test(rawLowerEarly) || /(^| )(dau|nhuc|buot|nhoi|rat) /.test(`${q} `);
  const personalNow = personalWord || implicitPersonal;

  // 6b.1 heartbeat described within a window of "tim"/"nhịp tim": slang descriptors + personal/persistent report
  toks.forEach((t, i) => {
    if (t !== "tim" && t !== "nguc") return;
    const w = winText(i, 0, 6);
    if (!signals.some((s) => s.cls === "CHEST_OR_CARDIO_RED_FLAG") && (HEART_DESC.test(w) || HEART_SKIP.test(w))) {
      const emotional = EMOTION.test(q) && !persistence && !/(thinh thich|loan|lung tung|danh trong|khong deu|bat thuong)/.test(w);
      if (emotional) { reasons.push("emotional_context_heart"); return; }
      symptomSignals.push(`heart_window:${w}`);
      push("CHEST_OR_CARDIO_RED_FLAG", !general && (personalNow || persistence || HEART_SKIP.test(w)) ? "HIGH_RISK" : "CAUTION", `heart window`);
    }
  });
  if (HEART_SKIP.test(q) && !signals.some((s) => s.cls === "CHEST_OR_CARDIO_RED_FLAG")) push("CHEST_OR_CARDIO_RED_FLAG", general ? "CAUTION" : "HIGH_RISK", "skipped beat");

  // 6b.2 numbness: bare "tê" next to a body part (accented) / presence of stroke-like signs
  toks.forEach((t, i) => {
    if (t !== "te") return;
    const w = winText(i, 3, 3);
    if (/(tay|chan|ngon|mat|moi|luoi|mong|dui|ban|canh|cang|nguoi|mot ben|nua)/.test(w) && /(tê|te )/.test(`${rawLowerEarly} ${q} `) && !signals.some((s) => s.cls === "NEUROLOGICAL_SYMPTOM")) {
      symptomSignals.push("numbness_window");
      push("NEUROLOGICAL_SYMPTOM", general ? "CAUTION" : "HIGH_RISK", "numbness window");
    }
  });
  if (/(meo mieng|mieng meo|lech mieng|noi (ngong|lap|khong ro)|sut mi|mat meo)/.test(q)) push("NEUROLOGICAL_SYMPTOM", "HIGH_RISK", "stroke-like sign");

  // 6b.3 radiating pain: a pain word + "lan/chạy/từ … xuống/lên/ra …" toward any body part
  if (painWord && !signals.some((s) => s.cls === "RADIATING_PAIN") && /(lan (len|xuong|ra|sang|toi|den)|toa (ra|xuong)|chay (xuong|len|ra|doc)|tu [a-z ]{1,24}(xuong|len|ra|sang) )/.test(q)) {
    symptomSignals.push("radiating_window");
    push("RADIATING_PAIN", general ? "CAUTION" : "HIGH_RISK", "pain spreading");
  }

  // 6b.4 acute events: dislocation feeling, tearing, head impact, fall + pain/swelling, cough with blood/foam
  if (DISLOCATE.test(q)) { eventSignals.push("dislocation_feeling"); push("ACUTE_TRAUMA_EVENT", "HIGH_RISK", "joint out of place"); }
  if (TEAR_WORDS.test(q) && (painWord || personalNow)) { eventSignals.push("tearing_feeling"); push("ACUTE_TRAUMA_EVENT", "HIGH_RISK", "tearing"); }
  if (/(đập|va|đụng|đâm|ngã) (vào |lên |xuống )?(đầu|trán|gáy)|chấn thương (sọ|đầu)/.test(rawLowerEarly)) { eventSignals.push("head_impact"); push("ACUTE_TRAUMA_EVENT", "HIGH_RISK", "head impact"); }
  const fallish = /(^| )(nga|te tu|te xuong|roi tu|roi xuong|truot chan|lat chan|lat co chan|va manh|dap manh)( |$)/.test(q);
  if (fallish && (painWord || SWELLING.test(q) || /(tho|nguc|sung|bam)/.test(q))) { eventSignals.push("fall"); push("ACUTE_TRAUMA_EVENT", "HIGH_RISK", "fall + pain/swelling"); }
  if (COUGH_BLOOD.test(q)) { symptomSignals.push("cough_blood_or_foam"); push("SEVERE_SHORTNESS_OF_BREATH", "HIGH_RISK", "cough blood/foam"); }

  // 6b.5 functional loss: strong phrases (cannot bear weight / lift / straighten) or any functional loss + swelling
  const strongFunc = has(STRONG_FUNCTIONAL, q);
  if (strongFunc && !general) { functionalSignals.push(strongFunc); push("ACUTE_TRAUMA_EVENT", "HIGH_RISK", `functional loss ${strongFunc}`); }
  else if (functional && SWELLING.test(q) && !general) push("ACUTE_TRAUMA_EVENT", "HIGH_RISK", "functional change + swelling");

  // 6b.6 breathlessness composed with chest / rest / minimal exertion
  if (KHO_THO.test(q) && DYSPNEA_COMPANION.test(q) && !general) { symptomSignals.push("dyspnea_composed"); push("SEVERE_SHORTNESS_OF_BREATH", "HIGH_RISK", "breathlessness + companion"); }

  // 6b.7 chronic condition the speaker says they have (not a symptom — it changes what exercise is appropriate)
  const chronic = has(CHRONIC, q);
  if (chronic && !general && (personalNow || /(bi |co |dang |tien su)/.test(q))) push("NAMED_CONDITION", "CAUTION", `chronic ${chronic}`);

  // 7) DEFAULT-CONSERVATIVE personal guard: personal + abnormal symptom/event/functional change, not confidently benign
  const personal = personalWord || implicitPersonal || signals.some((s) => s.cls === "POSTPARTUM_STATE" || s.cls === "POST_SURGICAL_STATE");
  const expectedTrainingResponse = BENIGN_CONFIDENT.test(q) && !ABNORMAL_MODIFIER.test(q) && !signals.some((s) => s.level === "HIGH_RISK");
  // accent-aware: folded "dau" is also "đầu" (head / beginning) — an accented query must carry the real symptom word
  const rawLower = question.toLowerCase().normalize("NFC");
  const accented = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/.test(rawLower);
  const symptomWord = accented
    ? (/(đau|nhức|buốt|nhói|rát|tê |tức (ngực|bụng|vùng|ở)|căng tức|chóng mặt|hoa mắt|choáng|buồn nôn|nôn |khó thở|hụt hơi|hồi hộp|run |co giật|sưng|bầm|yếu(?! hơn)|mất lực|khuỵu|ngất|xỉu|khó chịu|lạ lùng|bất thường|kỳ lạ|thình thịch|loạn|rung)/.exec(`${rawLower} `)?.[0] ?? null)
    : has(SYMPTOM_ANY, `${q} `);
  const hasSignal = signals.some((s) => s.level !== "NONE");
  if (!hasSignal && personal && !general && symptomWord && !expectedTrainingResponse) {
    // a bare "mình đau/sưng/tê…" with no benign reading: never let generic training content answer it
    push("LOCALISED_PAIN", "CAUTION", `uncertain personal symptom: ${symptomWord}`);
    reasons.push("default_conservative_personal_guard");
  }
  if (expectedTrainingResponse && !hasSignal) reasons.push("expected_training_response");

  let level: SafetyLevel = "NONE";
  if (signals.some((s) => s.level === "HIGH_RISK")) level = "HIGH_RISK";
  else if (signals.some((s) => s.level === "CAUTION")) level = "CAUTION";
  const finalSafetyAction: SafetyFinalAction = level === "HIGH_RISK" ? "BYPASS_RETRIEVAL_ABSTAIN" : level === "CAUTION" ? "TITLED_EVIDENCE_ONLY" : "NORMAL_RAG";
  return { level, personal, general, signals, eventSignals, symptomSignals, temporalSignals, functionalSignals, expectedTrainingResponse, reasons, finalSafetyAction };
}
