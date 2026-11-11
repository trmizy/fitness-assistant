/**
 * Phase 4.7R — concept-level query normalisation for RAG V2.1.
 *
 * Why: V2's hand-written regex→English glossary (45 rows) missed natural Vietnamese gym talk ("cơ nở", "hạ tạ chậm",
 * "dây quấn hạn chế máu"), so the English evidence was never asked for; and it expanded by ASSOCIATION ("cà phê" →
 * caffeine), which turned a cold-brew recipe into an ISSN caffeine hit.
 *
 * This table is CONCEPT-level, not sentence-level: each row names one fitness concept, the Vietnamese/English surface
 * forms that mean it (folded: lower-case, no diacritics, đ→d), the English phrase used to ask the English evidence, and
 * the terms a document must contain to count as being ABOUT it (topic guard). Normalisation maps a query to the
 * concepts it MEANS — it never adds associated topics. Ambiguous words carry a `needs` context cue.
 *
 * Pure & deterministic. No model, no network.
 */

export type ConceptDomain =
  | "PROGRAMMING" | "HYPERTROPHY" | "STRENGTH" | "TECHNIQUE" | "NUTRITION" | "BODY_COMPOSITION"
  | "RECOVERY" | "SUPPLEMENTS" | "SAFETY" | "TERMINOLOGY" | "EXERCISE_CATALOG";

export interface Concept {
  id: string;
  domain: ConceptDomain;
  /** folded surface forms of the query */
  match: RegExp;
  /** an ambiguous word only means this concept next to a fitness cue */
  needs?: RegExp;
  /** English phrase asked of the English evidence collections */
  en: string;
  /** folded English terms (word-start match) — the document is about this concept if it contains one */
  docTerms: string[];
  /** folded Vietnamese terms for the synthetic/Vietnamese reference text */
  viTerms?: string[];
  /** safety-relevant: only trusted curated evidence may answer (never synthetic FAQ / practitioner reference) */
  safety?: boolean;
}

export const fold = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

/** recovery vocabulary alone ("ngủ", "mệt", "stress") is ordinary life; it means sports recovery only next to training / performance context */
const RECOVERY_CONTEXT = /(co bap|tang co|phat trien co|hypertroph|muscle|the hinh|bodybuild|\btap\b|tap luyen|bai tap|workout|\bgym\b|the thao|van dong vien|athlete|exercise|training|hieu suat|performance|phuc hoi|recover|sau (buoi|khi) tap|truoc (buoi|khi) tap|nhiem vu|cardio|chay bo|doms|overtrain|buoi tap|mesocycle|deload)/;
const FITNESS_CUE = /(tap|gym|workout|the thao|exercise|training|tang co|giam mo|performance|hieu suat|pre|truoc buoi|mg|lieu|dose|suc ben|suc manh|ergogenic)/;

export const CONCEPTS: Concept[] = [
  // ── training / hypertrophy ────────────────────────────────────────────
  { id: "hypertrophy", domain: "HYPERTROPHY", match: /(tang co|len co|to co|co no\b|no co|co lon|lon co|nay no|(cham|nhanh|khong) lon\b|phat trien co|co phat trien|phi dai|co bap|hypertroph|build muscle|muscle growth|gain muscle|muscle mass|khoi luong co|cang co)/,
    en: "muscle hypertrophy resistance training muscle growth", docTerms: ["hypertroph", "muscle mass", "muscle growth", "muscle size", "lean mass", "muscle gain", "muscle thickness"], viTerms: ["tang co", "phi dai", "co bap", "tang can nac"] },
  { id: "load_intensity", domain: "HYPERTROPHY", match: /(ta nang|ta nhe|tai nang|tai nhe|heavy|light load|low[- ]?load|high[- ]?load|nhieu rep|it rep|rep cao|rep thap|muc ta|ta nhe nhieu)/,
    en: "high-load versus low-load resistance training muscle hypertrophy load intensity", docTerms: ["load", "intensity", "repetition maximum", "1rm"], viTerms: ["ta nang", "ta nhe", "rep"] },
  { id: "tempo", domain: "HYPERTROPHY", match: /(\btempo\b|ha ta (cham|nhanh|tu tu)|nang ta (cham|nhanh|tu tu)|(nang|ha) (cham|nhanh|tu tu)\b|(cham|nhanh|tu tu) (khi |luc )?(ha|nang) ta|eccentric|concentric|time under tension|\btut\b|\d+ ?(giay|s) (ha|nang|moi rep))/,
    en: "resistance training repetition tempo slow versus fast lifting speed muscle hypertrophy", docTerms: ["tempo", "repetition duration", "eccentric", "time under tension", "lifting speed", "slow"], viTerms: ["tempo", "nhip", "cham"] },
  { id: "bfr", domain: "HYPERTROPHY", match: /(\bbfr\b|blood flow|day quan|quan day|han che (mau|luu thong)|chan mau|ep mach|mach mau|occlusion|kaatsu|vong ep)/,
    en: "blood flow restriction training low-load resistance exercise", docTerms: ["blood flow restriction", "bfr", "occlusion", "restriction"], viTerms: ["han che mau", "bfr"] },
  { id: "volume", domain: "PROGRAMMING", match: /(\bvolume\b|\bvol\b|(may|bao nhieu|nhieu) (set|hiep)( cung| lam viec| tap| moi)?|so set\b|bao nhieu set|set (moi|\/) ?tuan|weekly sets|khoi luong tap|tong (so )?set|sets per week|bao nhieu hiep)/,
    en: "resistance training volume sets per week muscle hypertrophy dose-response", docTerms: ["volume", "sets per week", "weekly sets", "sets/week", "sets per muscle"], viTerms: ["volume", "set moi tuan", "so set"] },
  { id: "frequency", domain: "PROGRAMMING", match: /(tan suat|(hai|2|ba|3|bon|4|nam|5|sau|6|bay|7)( hay (hai|2|ba|3|bon|4|nam|5|sau|6|bay|7))? (lan|buoi) (mot|moi|1|trong|\/) (ngay|tuan)|(moi|mot|1) tuan (hai|2|ba|3|bon|4) (lan|buoi)|(times|sessions|days|x) (per|a|\/) week|twice (a|per) week|(may|bao nhieu) lan (mot |moi |trong |\/)?(tuan|ngay)|may buoi|bao nhieu buoi|frequency|tap may ngay|buoi (moi|\/) ?tuan|lan\/tuan|bao nhieu ngay (mot|moi) tuan)/,
    en: "resistance training frequency sessions per week", docTerms: ["frequency", "sessions per week", "times per week", "days per week", "per week", "weekly", "sessions wk", "sessions/wk", "twice"], viTerms: ["tan suat", "buoi moi tuan", "ngay moi tuan"] },
  { id: "progressive_overload", domain: "PROGRAMMING", match: /(progressive|overload|qua tai(?! sieu)|double progression|linear progression|tang ta(?![a-z])|len ta|tang tai|nang dan|tang muc ta|tien bo ta|tang (rep|ta) moi)/,
    en: "progressive overload increasing load over time", docTerms: ["progressive overload", "overload", "progression"], viTerms: ["progressive", "overload", "tang ta", "tang tai"] },
  { id: "failure", domain: "PROGRAMMING", match: /(failure|\bfail(ed|s)?\b|(cach|gan|sat|toi|den) (gioi han|that bai|failure|kiet suc)|that bai (co|moi|tung)|toi (muc )?(that bai|kiet)|toi han|can suc|het suc|sat gioi han|sat suc|chua lai|momentary|cham suc|tap toi (het|can)|den khi khong (nang|duoc))/,
    en: "training to muscular failure proximity to failure repetitions in reserve", docTerms: ["failure", "repetitions in reserve", "proximity", "momentary"], viTerms: ["failure", "can suc", "het suc", "rir"] },
  { id: "adherence", domain: "PROGRAMMING", match: /(tuan thu|bam (sat )?(lich|ke hoach|chuong trinh)|bo (buoi|tap)|deu dan|duy tri (lich|thoi quen)|adherence|complian|giu (duoc )?lich|bo lich)/,
    en: "adherence to resistance training program compliance attendance", docTerms: ["adherence", "complian", "attendance"], viTerms: ["tuan thu", "adherence"] },
  { id: "session_duration", domain: "PROGRAMMING", match: /(thoi luong (buoi )?tap|\d+ ?phut (hay|va|toi|so voi) \d+ ?phut|buoi tap (\d+ ?phut|bao nhieu phut)|buoi tap .{0,25}(keo dai|bao lau|qua dai|may tieng|bao nhieu phut)|tap (bao lau|may tieng|qua lau|bao nhieu phut)|\bsession (duration|length)|how long (should|to) (a )?(workout|session))/,
    en: "resistance training session duration length minutes per session", docTerms: ["session duration", "session length", "minutes per session", "duration of"], viTerms: ["thoi luong", "buoi tap keo dai"] },
  { id: "volume_landmarks", domain: "PROGRAMMING", match: /(\bmrv\b|\bmev\b|\bmav\b|volume landmark|maximum recoverable volume|minimum effective volume)/,
    en: "maximum recoverable volume training volume landmarks", docTerms: ["maximum recoverable", "volume landmark", "mrv", "mev"], viTerms: ["mrv", "mev", "volume"] },
  { id: "rest_interval", domain: "PROGRAMMING", match: /(nghi (bao nhieu|may|bao lau)? ?(phut|giay)? ?giua (cac )?(set|hiep)|nghi giua (cac )?(set|hiep)|rest (interval|period|between)|nghi bao lau giua|thoi gian nghi giua)/,
    en: "rest interval between sets resistance training", docTerms: ["rest interval", "rest period", "rest between"], viTerms: ["nghi giua set", "nghi giua cac set"] },
  { id: "deload", domain: "PROGRAMMING", match: /(deload|giam tai|tuan nhe|tuan nghi|xa tai|giam cuong do)/,
    en: "deload week planned reduction in training load", docTerms: ["deload", "reduction in training", "reduced training"], viTerms: ["deload", "giam tai"] },
  { id: "periodization", domain: "PROGRAMMING", match: /(periodi|mesocycle|chu ky (hoa|tap)|giao an|doi (han |hoan toan |moi )?(giao an|chuong trinh|lich tap|lich|bai tap|ke hoach|plan)|thay (han |moi )?(giao an|chuong trinh|lich tap|ke hoach)|chung (lai )?.*(doi|thay) (han )?(ke hoach|lich|chuong trinh)|(lam moi|doi|thay) (han |hoan toan )?(giao trinh|giao an)|giao (an|trinh) (chung|dung yen|cu|khong hieu qua)|bao lau.*(doi|thay).*(lich|giao an|chuong trinh|bai))/,
    en: "periodization training program mesocycle changing program", docTerms: ["periodi", "mesocycle", "training program", "program design", "training plan"], viTerms: ["chu ky", "mesocycle", "giao an", "lich tap", "chuong trinh"] },
  { id: "split", domain: "PROGRAMMING", match: /(\bsplit\b|full ?body|upper ?lower|\bppl\b|push pull legs|chia nhom co|lich chia|toan than)/,
    en: "training split full-body versus body-part split routine", docTerms: ["split", "full-body", "full body"], viTerms: ["split", "full body", "toan than"] },
  { id: "rom_length", domain: "HYPERTROPHY", match: /(tam van dong|bien do|range of motion|\brom\b|muscle length|do dai co|gian co|keo gian co|lengthened|stretch[- ]?mediated)/,
    en: "range of motion muscle length exercise selection hypertrophy", docTerms: ["range of motion", "muscle length", "lengthened"], viTerms: ["tam van dong"] },
  { id: "older_adults", domain: "HYPERTROPHY", needs: /(tap\b|tap luyen|bai tap|tang co|co bap|suc manh|the duc|van dong|ta\b|gym|muscle|strength|exercise|training|cang co|khoi luong co)/, match: /(lon tuoi|nguoi gia|cao tuoi|trung nien|\bolder\b|elderly|\baging\b|ageing|tuoi (50|60|70)|(sau|tren|qua) (50|60|70) tuoi|gia roi|ba (tuoi|cu)|cu ong)/,
    en: "older adults resistance training muscle mass gain", docTerms: ["older", "elderly", "aging", "ageing"], viTerms: ["lon tuoi", "nguoi gia", "cao tuoi"] },
  { id: "women_menstrual", domain: "HYPERTROPHY", match: /(kinh nguyet|chu ky kinh|menstrual|phu nu|nu gioi|\bwomen\b|female|phai nu|ba bau)/,
    en: "women menstrual cycle resistance training adaptation", docTerms: ["menstrual", "women", "female"], viTerms: ["kinh nguyet", "phu nu", "nu gioi"] },
  { id: "strength", domain: "STRENGTH", match: /(suc manh|\bstrength\b|\b1rm\b|one rep max|rep toi da|powerlifting|khoe hon|manh hon|nang duoc nhieu hon)/,
    en: "maximal muscular strength resistance training", docTerms: ["strength"], viTerms: ["suc manh", "1rm"] },
  { id: "asymmetry", domain: "STRENGTH", match: /(chenh lech (luc|suc|giua|hai|ben)|giua hai (chan|tay|ben)|mot chan|mot tay|don phia|unilateral|bilateral|hai ben|trai phai|chan (trai|phai)|tay (trai|phai)|lech (ben|chan|tay)|mat can bang|bat doi xung|asymmetr|ben (trai|phai) (yeu|khoe|manh))/,
    en: "inter-limb strength asymmetry unilateral versus bilateral training", docTerms: ["asymmetr", "inter-limb", "unilateral", "bilateral", "limb"], viTerms: ["mot chan", "mat can bang", "bat doi xung", "hai ben", "don phia"] },
  { id: "plyometric", domain: "STRENGTH", match: /(plyometric|pliometric|bai nhay|bat nhay|nhay hop)/,
    en: "plyometric training jump performance", docTerms: ["plyometric", "jump"], viTerms: ["plyometric", "nhay"] },
  { id: "cardio", domain: "PROGRAMMING", needs: /(tap|giam (can|mo)|suc ben|tim mach|hieu qua|loi ich|bao nhieu (phut|km|lan)|moi tuan|mat co|\bhiit\b|zone|vo2|nhip tim|calo|dot mo|cardio|aerobic|marathon|the luc)/, match: /(cardio|chay bo\b|aerobic|\bhiit\b|di bo\b|tim mach|suc ben|zone 2)/,
    en: "aerobic exercise cardiorespiratory fitness physical activity", docTerms: ["aerobic", "cardiorespiratory", "physical activity", "endurance"], viTerms: ["cardio", "chay bo", "aerobic"] },
  { id: "pa_guideline", domain: "RECOVERY", match: /(\bwho\b|\bhhs\b|khuyen nghi (ve )?(van dong|hoat dong|the duc)|bao nhieu phut|phut (moi|\/) ?tuan|150 phut|physical activity|van dong (toi thieu|moi tuan)|guideline)/,
    en: "physical activity guidelines minutes per week moderate vigorous activity", docTerms: ["physical activity", "minutes", "moderate", "vigorous", "guideline"], viTerms: ["phut moi tuan", "van dong", "who"] },
  { id: "pre_exhaustion", domain: "TECHNIQUE", match: /(pre[- ]?exhaust|(bai )?(nang|chinh|co lap|don khop|isolation|nhieu khop|da khop|compound) (lam )?(dau|truoc|cuoi|sau|lam truoc|lam sau)|thu tu bai|tap (don khop|co lap) truoc|(bai )?(co lap|don khop|isolation) truoc|truoc (bai )?(nhieu khop|da khop|compound)|(nhieu|da) khop.*(co lap|don khop)|(co lap|don khop).*(nhieu|da) khop|isolation truoc|compound truoc|bai don khop|bai da khop|exercise order|thu tu bai tap)/,
    en: "pre-exhaustion method compound isolation exercise order", docTerms: ["pre-exhaustion", "exercise order", "isolation"], viTerms: ["isolation", "compound", "don khop"] },

  // ── nutrition ─────────────────────────────────────────────────────────
  { id: "protein", domain: "NUTRITION", match: /(protein|(?<!thanh )\bdam\b|chat dam|luong dam|an dam|bot dam|g\/kg)/,
    en: "protein intake g/kg body weight resistance training", docTerms: ["protein"], viTerms: ["protein", "dam"] },
  { id: "nutrient_timing", domain: "NUTRITION", match: /(nutrient timing|truoc khi ngu|casein|an (toi|khuya|muon|sang)|bua (toi|khuya|sang)|(an|chia) (may|bao nhieu|nhieu) bua|so bua|may bua|(an|uong|nap|protein|carb|dam|bua)[a-z ]{0,20}(truoc|sau) (khi )?tap|cua so (dong hoa|anabolic)|anabolic window|thoi diem an|an luc nao|dem khuya|pre-?sleep|bao lau sau tap|nen an (luc|khi) nao|chia (nho )?bua|so bua)/,
    en: "nutrient timing protein carbohydrate meal timing pre post exercise evening", docTerms: ["timing", "pre-sleep", "post-exercise", "casein", "meal frequency", "evening", "pre-exercise", "feeding"], viTerms: ["bua an", "thoi diem", "sau tap", "truoc tap", "truoc khi ngu"] },
  { id: "energy_intake", domain: "NUTRITION", match: /(calo|calor|kcal|nap bao nhieu|tdee|\bbmr\b|\brmr\b|trao doi chat|metabolic rate|nang luong (tieu hao|nap|can)|energy (expenditure|intake|balance)|can bang nang luong|can bao nhieu nang luong)/,
    en: "energy intake energy expenditure resting metabolic rate calories", docTerms: ["energy", "calori", "metabolic rate", "expenditure", "kcal"], viTerms: ["calo", "kcal", "nang luong", "tdee", "bmr"] },
  { id: "fat_loss", domain: "NUTRITION", match: /(giam mo|mo bung|mo thua|giam can|ha can|cat mo|\bcut\b|siet|giam beo|thieu hut|deficit|dieting|an kieng|weight loss|fat loss|lean out|xuong can|cat can|sieng)/,
    en: "energy deficit fat loss weight loss preserve lean mass", docTerms: ["weight loss", "fat loss", "deficit", "energy restriction", "weight-loss"], viTerms: ["giam mo", "giam can", "cut", "thieu hut"] },
  { id: "surplus_bulk", domain: "NUTRITION", match: /(\bbulk|an du\b|du calo|surplus|tang can|an (de|cho) (to|nang)|an nhieu de|lean bulk|tang can nac|hypercaloric)/,
    en: "energy surplus muscle gain weight gain overfeeding", docTerms: ["surplus", "weight gain", "overfeed", "energy balance"], viTerms: ["bulk", "du calo", "tang can"] },
  { id: "preserve_muscle", domain: "NUTRITION", match: /(mat co|giu (duoc )?co|bao toan co|muscle loss|giu khoi luong co|so mat co|hao co|tieu co)/,
    en: "preserve lean mass muscle during energy restriction protein resistance training", docTerms: ["lean mass", "muscle mass", "preserv", "fat-free mass", "muscle loss"], viTerms: ["mat co", "giu co"] },
  { id: "carbohydrate", domain: "NUTRITION", match: /(\bcarb\b|carbs|carbohydrate|tinh bot|duong bot|com\b|gao\b|bot ngu coc)/,
    en: "carbohydrate intake exercise performance glycogen", docTerms: ["carbohydrate", "glycogen", "carb"], viTerms: ["carb", "tinh bot"] },
  { id: "dietary_fat", domain: "NUTRITION", match: /(chat beo|dietary fat|dau an|mo bao hoa|an (nhieu )?beo)/,
    en: "dietary fat intake macronutrient distribution", docTerms: ["dietary fat", "fat intake", "lipid"], viTerms: ["chat beo"] },
  { id: "macros", domain: "NUTRITION", match: /(\bmacro|ti le (dinh duong|protein)|phan bo (dinh duong|macro)|\bamdr\b|macronutrient)/,
    en: "macronutrient distribution ranges carbohydrate protein fat", docTerms: ["macronutrient", "distribution"], viTerms: ["macro"] },
  { id: "hydration", domain: "NUTRITION", match: /(nhu cau nuoc|can (bao nhieu )?nuoc|uong (bao nhieu )?nuoc(?! (dua|ep|mia|ngot|cam|chanh|gao|yen|sam|hoa qua|trai cay|loc|suoi)\b)|luong nuoc|bu nuoc|mat nuoc|hydrat|dehydrat|dien giai|electrolyte|\bfluid|khat nuoc)/,
    en: "fluid replacement hydration exercise", docTerms: ["fluid", "hydration", "dehydrat", "electrolyte"], viTerms: ["nuoc", "bu nuoc", "mat nuoc"] },
  { id: "diet_type", domain: "NUTRITION", match: /(\bketo\b|nhin an|intermittent|fasting|low[- ]?carb|an chay|\bvegan\b|paleo|mediterranean|\b16:8\b|nhin doi)/,
    en: "diet and body composition ketogenic intermittent fasting low-carbohydrate", docTerms: ["diet", "ketogenic", "fasting", "low-carbohydrate", "vegetarian"], viTerms: ["keto", "nhin an", "an chay"] },
  { id: "wearable", domain: "BODY_COMPOSITION", match: /(dong ho (thong minh|the thao|nhip tim|do (nhip tim|calo|buoc))|smart ?watch|wearable|apple watch|garmin|fitbit|vong tay (thong minh|do)|may theo doi)/,
    en: "wearable device accuracy heart rate energy expenditure", docTerms: ["wearable", "wrist", "device"], viTerms: ["dong ho", "wearable"] },
  { id: "rate_of_loss", domain: "NUTRITION", match: /(toc do (giam|ha)|giam (bao nhieu|nhanh|cham).*(tuan|thang)|rate of weight loss|giam bao nhieu kg|giam nhanh|giam cham)/,
    en: "rate of weight loss athletes body composition strength performance", docTerms: ["weight loss", "rate", "loss rate"], viTerms: ["toc do giam", "giam can"] },
  { id: "plateau_adaptation", domain: "NUTRITION", match: /(chung (can|lai)|plateau|dung can|dung yen|thich nghi|khong giam (nua|duoc)|metabolic adaptation|adaptive thermogenesis|thich nghi chuyen hoa|chuyen hoa cham)/,
    en: "adaptive thermogenesis weight loss plateau metabolic adaptation", docTerms: ["adaptive thermogenesis", "metabolic adaptation", "plateau", "weight loss"], viTerms: ["chung lai", "chung can", "plateau"] },
  { id: "energy_equation", domain: "NUTRITION", match: /(mifflin|harris|cong thuc (tinh )?(bmr|tdee|calo)|predictive equation|tinh bmr|cong thuc tinh)/,
    en: "predictive equation resting energy expenditure accuracy", docTerms: ["equation", "resting energy", "resting metabolic"], viTerms: ["cong thuc", "bmr"] },
  { id: "protein_safety", domain: "SAFETY", match: /(an (nhieu )?(protein|dam) .*(hai|co sao|anh huong)|(protein|dam).*(than|gan)\b|(than|gan)\b.*(protein|dam)|bung to.*(protein|dam))/,
    en: "high protein intake safety kidney liver health", docTerms: ["kidney", "renal", "safety", "high protein", "liver"], viTerms: ["than", "an nhieu protein"], safety: true },

  // ── supplements ───────────────────────────────────────────────────────
  { id: "creatine", domain: "SUPPLEMENTS", match: /(creatine|creatin|kreatin)/,
    en: "creatine supplementation safety and efficacy exercise", docTerms: ["creatine"], viTerms: ["creatine"] },
  { id: "caffeine", domain: "SUPPLEMENTS", match: /(caffeine|cafein|caphein|pre[- ]?workout|nuoc tang luc|energy drink|ca phe|coffee|espresso|matcha)/, needs: FITNESS_CUE,
    en: "caffeine ergogenic aid exercise performance dose mg/kg", docTerms: ["caffeine"], viTerms: ["caffeine", "cafein", "ca phe"] },
  { id: "protein_supplement", domain: "SUPPLEMENTS", match: /(\bwhey\b|protein powder|bot protein|sua protein|casein|mass gainer|sua tang can|protein supplement|bo sung protein|uong protein)/,
    en: "protein supplementation whey resistance training muscle", docTerms: ["protein supplement", "whey", "protein"], viTerms: ["whey", "bot protein"] },
  { id: "supplements", domain: "SUPPLEMENTS", match: /(thuc pham chuc nang|bo sung|supplement|vitamin|thuoc bo|khoang chat|collagen|beta[- ]?alanine|glutamine|arginine|citrulline|\bhmb\b|nitrate|\bbeet)/,
    en: "dietary supplements athletes evidence safety", docTerms: ["supplement"], viTerms: ["bo sung", "thuc pham chuc nang", "supplement"] },
  { id: "omega3", domain: "SUPPLEMENTS", match: /(omega|dau ca|fish oil|\bepa\b|\bdha\b)/,
    en: "omega-3 fatty acid supplementation", docTerms: ["omega-3", "pufa", "fatty acid", "fish oil"], viTerms: ["omega", "dau ca"] },
  { id: "bcaa", domain: "SUPPLEMENTS", match: /(\bbcaa\b|\beaa\b|amino acid|leucine|axit amin)/,
    en: "branched-chain amino acids leucine supplementation", docTerms: ["amino acid", "leucine", "bcaa", "branched"], viTerms: ["bcaa", "amino"] },
  { id: "polyphenol", domain: "SUPPLEMENTS", match: /(polyphenol|chiet xuat|curcumin|cherry|tart cherry)/,
    en: "polyphenol supplementation resistance training adaptations", docTerms: ["polyphenol", "curcumin", "cherry"], viTerms: ["polyphenol"] },

  // ── body composition ──────────────────────────────────────────────────
  { id: "bia", domain: "BODY_COMPOSITION", match: /(inbody|\bbia\b|bioimpedance|bioelectrical|tro khang( sinh hoc)?|bioelectric|can phan tich|may inbody|do thanh phan co the|body composition|do inbody|phan tich thanh phan)/,
    en: "bioelectrical impedance analysis body composition accuracy validation", docTerms: ["bioelectrical", "impedance", "inbody", "bia", "body composition"], viTerms: ["inbody", "bia", "thanh phan co the"] },
  { id: "body_fat", domain: "BODY_COMPOSITION", match: /(ti le mo|ty le mo|body fat|mo co the|phan tram mo|\bbf ?%|\d+ ?% mo|mo noi tang|visceral|do mo\b)/,
    en: "body fat percentage measurement body composition fat mass", docTerms: ["body fat", "body composition", "fat mass", "adipos"], viTerms: ["ti le mo", "ty le mo", "body fat", "mo co the"] },
  { id: "lean_mass", domain: "BODY_COMPOSITION", match: /(skeletal muscle|co xuong|\bsmm\b|\bffm\b(?!i)|fat[- ]?free(?! mass index)|lean mass|khoi luong nac|khoi luong khong mo)/,
    en: "fat-free mass skeletal muscle mass measurement", docTerms: ["fat-free mass", "fat free mass", "ffm", "ffmi", "lean body mass", "lean mass"], viTerms: ["khoi luong nac", "co xuong"] },
  { id: "ffmi", domain: "BODY_COMPOSITION", match: /(\bffmi\b|fat[- ]?free mass index|chi so khoi luong nac|chi so ffm)/,
    en: "fat-free mass index FFMI", docTerms: ["fat-free mass index", "fat free mass index", "ffmi"], viTerms: ["ffmi"] },
  { id: "phase_angle", domain: "BODY_COMPOSITION", match: /(phase angle|goc pha)/,
    en: "phase angle bioelectrical impedance", docTerms: ["phase angle"], viTerms: ["phase angle", "goc pha"] },
  { id: "dexa", domain: "BODY_COMPOSITION", match: /(\bdexa\b|\bdxa\b)/,
    en: "dual-energy x-ray absorptiometry body composition", docTerms: ["dexa", "dxa", "absorptiometry"], viTerms: ["dexa", "dxa"] },
  { id: "bmi", domain: "BODY_COMPOSITION", match: /(\bbmi\b|chi so khoi co the)/,
    en: "body mass index", docTerms: ["body mass index", "bmi"], viTerms: ["bmi"] },
  { id: "measurement_standard", domain: "BODY_COMPOSITION", match: /(chuan hoa|dieu kien do|do luc nao|truoc khi do|sai so (khi )?do|do (co )?chinh xac|do vao (buoi|luc)|do (sang|toi|sau tap|luc doi))/,
    en: "body composition assessment standardization pre-assessment conditions accuracy", docTerms: ["standardi", "pre-assessment", "accuracy", "assessment"], viTerms: ["chuan hoa", "dieu kien do", "chinh xac"] },

  // ── recovery / safety ─────────────────────────────────────────────────
  { id: "sleep", domain: "RECOVERY", needs: RECOVERY_CONTEXT, match: /(giac ngu|\bngu\b|mat ngu|ngu (it|kem|khong du)|\bsleep\b|insomnia|thieu ngu)/,
    en: "sleep deprivation recovery exercise performance", docTerms: ["sleep"], viTerms: ["giac ngu", "ngu"] },
  { id: "soreness", domain: "RECOVERY", match: /(\bdoms\b|dau (co|nhuc)|nhuc co|e co|co ban dau|dau sau (khi )?tap|muscle soreness|cung co)/,
    en: "delayed onset muscle soreness recovery after exercise", docTerms: ["soreness", "doms", "recovery"], viTerms: ["doms", "dau co", "nhuc co", "phuc hoi"] },
  { id: "palm_cooling", domain: "RECOVERY", match: /(long ban tay|ban tay|palm cool|lam mat (giua|trong)|interset|giua (cac )?hiep.*lam mat)/,
    en: "interset palm cooling resistance exercise performance", docTerms: ["palm cooling", "interset", "cooling"], viTerms: ["lam mat"] },
  { id: "cold_water", domain: "RECOVERY", match: /(ngam (nuoc )?(lanh|da)|nuoc da|ice bath|cold (water|immersion)|tam lanh|\bsauna\b|massage|foam ?roll|palm cooling|lam mat)/,
    en: "cold water immersion recovery adaptation muscle", docTerms: ["cold-water", "cold water", "immersion", "cooling", "recovery"], viTerms: ["ngam nuoc lanh", "massage", "phuc hoi"] },
  { id: "overtraining", domain: "RECOVERY", needs: RECOVERY_CONTEXT, match: /(overtrain|met moi|kiet suc|qua suc|tap qua nhieu|mat suc|giam hieu suat|burnout|tap (qua )?nang)/,
    en: "overtraining fatigue recovery training load", docTerms: ["overtraining", "fatigue", "recovery"], viTerms: ["met moi", "overtrain", "phuc hoi", "kiet suc"] },
  { id: "stress", domain: "RECOVERY", needs: RECOVERY_CONTEXT, match: /(\bstress\b|cang thang|ap luc|lo au)/,
    en: "psychological stress recovery training adaptation", docTerms: ["stress"], viTerms: ["stress", "cang thang"] },
  { id: "recovery", domain: "RECOVERY", needs: RECOVERY_CONTEXT, match: /(phuc hoi|recover|nghi (ngoi|ngay)|ngay nghi|nghi giua (cac )?buoi|giua cac buoi (tap|nghi))/,
    en: "recovery between training sessions", docTerms: ["recovery"], viTerms: ["phuc hoi", "nghi ngoi"] },
  { id: "red_s", domain: "SAFETY", safety: true, match: /((tut|ngung|mat|tre|loan|khong co|bi mat|bat thuong) (kinh|chu ky)|kinh nguyet (tut|ngung|mat|tre|loan|khong)|thieu (hut )?nang luong( tuong doi)?|nang luong (thap|khong du|thieu)|\bred-?s\b|(kinh nguyet|chu ky) (kinh )?(mat|bat thuong|ngung|tre|tut|loan|bi mat)|mat kinh|(an|nap) (khong du|qua it|rat it|it) (nang luong|calo|kcal|thuc an)|(an|nap) (khong du|qua it|rat it|it) ma (van )?(tap|the thao)|energy availability|relative energy deficiency|female athlete triad|\btriad\b|an it (ma )?tap (nhieu|nang))/,
    en: "relative energy deficiency in sport low energy availability female athlete", docTerms: ["relative energy deficiency", "energy availability", "red-s", "low energy"], viTerms: ["thieu nang luong", "red-s", "kinh nguyet"] },
  { id: "injury_pain", domain: "SAFETY", safety: true, match: /(chan thuong|dau (khop|lung|goi|vai|co tay|xuong|gan)|thoat vi|dia dem|bong gan|\binjur|\bpain\b|viem gan|dut day chang|\bacl\b|\bgan\b (bi|dau|dut)|sung (khop|dau))/,
    en: "musculoskeletal injury pain exercise rehabilitation", docTerms: ["injur", "pain"], viTerms: ["chan thuong", "dau", "thoat vi", "dia dem"] },
  { id: "hypertension", domain: "SAFETY", safety: true, match: /(huyet ap|cao huyet|tang huyet|\bhuyet ap\b|hypertens|blood pressure|\bha\b huyet)/,
    en: "hypertension blood pressure exercise resistance training safety", docTerms: ["hypertens", "blood pressure"], viTerms: ["huyet ap"] },
  { id: "diabetes", domain: "SAFETY", safety: true, match: /(tieu duong|dai thao duong|duong huyet|\bdiabet|insulin|hba1c|glycemic|hypoglycem|ha duong huyet)/,
    en: "diabetes exercise glycemic control safety", docTerms: ["diabetes", "diabetic", "glycemic", "insulin"], viTerms: ["tieu duong", "duong huyet"] },
  { id: "spine_back", domain: "SAFETY", safety: true, match: /(cot song|thoat vi|dia dem|dau (that )?lung|lung (nhoi|dau|duoi)|that lung|than kinh toa|sciatic|lumbar|\bspine|herniat|disc\b|vai gay)/,
    en: "low back pain spinal disc herniation exercise", docTerms: ["low back", "lumbar", "spine", "spinal", "herniat", "disc"], viTerms: ["cot song", "thoat vi", "dia dem"] },
  { id: "acute_pain_injury", domain: "SAFETY", safety: true, match: /(dau nhoi|nhoi (dau|lung|vai|goi|co)|dau (cap|doi ngot|du doi)|dau doi ngot|bong gan|dut (day )?(chang|gan|co)|gay xuong|trat (khop|chan|co)|sai khop|chan thuong|\bacute injur|torn|sprain|strain\b|fracture|dislocat)/,
    en: "acute musculoskeletal injury pain exercise", docTerms: ["acute injur", "sprain", "strain", "fracture", "tendon", "ligament"], viTerms: ["chan thuong", "dau nhoi"] },
  { id: "joint_osteoarthritis", domain: "SAFETY", safety: true, match: /(viem xuong khop|thoai hoa|osteoarthritis|khop goi.*(viem|thoai hoa)|viem khop)/,
    en: "knee osteoarthritis exercise therapy", docTerms: ["osteoarthritis"], viTerms: ["thoai hoa", "viem khop"] },
  { id: "cardio_symptoms", domain: "SAFETY", safety: true, match: /(tim dap (bat thuong|loan|lech|khong deu|vot|hut|nhoi|dot ngot|luc nghi|khi nghi|manh bat thuong)|lech nhip|nhip tim (bat thuong|loan|lech|khong deu|cao bat thuong|luc nghi cao)|tim (bi )?(loan|lech|nhoi)|dau (that )?nguc|tuc nguc|nguc (dau|tuc|nhoi|that)|chong mat|ngat\b|xiu|choang|kho tho|nhip tim (cao|nhanh|bat thuong|loan)|benh tim|roi loan nhip|\bheart\b|chest pain|palpitation|dizz|faint|syncope|nghen tho)/,
    en: "cardiovascular symptoms exercise safety blood pressure heart rate", docTerms: ["heart", "blood pressure", "cardiovascular", "cardiac"], viTerms: ["tim", "huyet ap", "chong mat"] },
  { id: "pregnancy", domain: "SAFETY", safety: true, match: /(mang thai|mang bau|me bau|ba bau|co thai|co bau|dang bau|dang co bau|bau bi|bau (ba|hai|bon|nam|sau|bay|tam|chin|muoi|mot) (thang|tuan)|bau (thang|tuan)|thai (nhi|nghen|phu|ky)|thang thu \w+ cua thai|sau sinh|sinh xong|cho con bu|pregnan|postpartum|trimester|expecting)/,
    en: "exercise during pregnancy and postpartum safety", docTerms: ["pregnan", "postpartum"], viTerms: ["mang thai", "bau", "sau sinh"] },

  // ── terminology ───────────────────────────────────────────────────────
  { id: "rir_rpe", domain: "TERMINOLOGY", match: /(\brir\b|\brpe\b|reps? in reserve|rating of perceived exertion|muc do gang suc|cam nhan gang suc|rep du tru|rep (con )?lai)/,
    en: "repetitions in reserve rating of perceived exertion", docTerms: ["repetitions in reserve", "perceived exertion", "rir", "rpe"], viTerms: ["rir", "rpe", "du tru"] },
  { id: "one_rm", domain: "TERMINOLOGY", match: /(\b1 ?rm\b|one rep(etition)? max(imum)?|rep max|mot rep toi da|1 rep max)/,
    en: "one repetition maximum strength testing", docTerms: ["one-repetition maximum", "one repetition maximum", "1rm", "repetition maximum"], viTerms: ["1rm", "rep toi da"] },
  { id: "set_methods", domain: "TERMINOLOGY", match: /(superset|drop ?set|giant set|\bamrap\b|\bemom\b|cluster set|rest[- ]?pause)/,
    en: "superset drop set advanced training method", docTerms: ["superset", "drop set", "set structure"], viTerms: ["superset", "drop set", "dropset"] },
];

// ── exercise catalog (names / body parts / equipment) ──────────────────────

export interface CatalogCue { id: string; match: RegExp; en: string; /** an ambiguous cue ("tại nhà", "chân") only counts next to an exercise word */ needs?: RegExp }
const EXERCISE_WORD = /(\btap\b|bai tap|workout|\bgym\b|exercise|\bset\b|\brep\b|co nao|nhom co|dung co|tac dong)/;
export const CATALOG_CUES: CatalogCue[] = [
  { id: "squat", match: /(squat|lunge|leg press|co chan|dung day|hack squat)/, en: "squat lunge leg press quadriceps" },
  { id: "deadlift", match: /(deadlift|rdl|romanian|keo dat|hip hinge)/, en: "deadlift hip hinge glute hamstring" },
  { id: "bench", match: /(bench press|incline bench|flat bench|decline bench|bench|day nguc|chest press|ep nguc|push[- ]?up|hit dat|dumbbell press)/, en: "bench press push-up chest" },
  { id: "row_pull", match: /(barbell row|dumbbell row|cable row|bent[- ]?over row|seated row|\brow\b|keo xa|pull[- ]?up|chin[- ]?up|lat pulldown|keo (ta|cap|tay)|xa don|xa ngang|keo ngang)/, en: "row pull-up chin-up lat pulldown back" },
  { id: "shoulder", match: /(shoulder press|overhead press|military press|lateral raise|day vai|nang vai|\bvai\b)/, en: "shoulder press lateral raise", needs: EXERCISE_WORD },
  { id: "arms", match: /(biceps curl|hammer curl|leg curl|wrist curl|preacher curl|tay (truoc|sau)|triceps|biceps|bench dip|tricep dip|chest dip|\bcurl\b|\bdips?\b|cang tay)/, en: "biceps curl triceps extension dip" },
  { id: "core_moves", match: /(\bplank\b|crunch|gap bung|sit[- ]?up|russian twist|leg raise)/, en: "abdominal core plank crunch" },
  { id: "core_part", match: /(\bcore\b|\bbung\b)/, en: "abdominal core plank crunch", needs: EXERCISE_WORD },
  { id: "glutes", match: /(hip thrust|\bmong\b|glute|dui sau)/, en: "glute hamstring hip thrust", needs: EXERCISE_WORD },
  { id: "equipment", match: /(tai nha|khong can may|dung cu|bodyweight|ta don|dumbbell|kettlebell|day khang luc|resistance band|thanh xa|khong (co )?ta)/, en: "bodyweight home exercise equipment", needs: EXERCISE_WORD },
  { id: "back_part", match: /(\blung\b|\btrap\b|\blats?\b|keo ngang)/, en: "back row lat pulldown", needs: EXERCISE_WORD },
  { id: "chest_part", match: /(\bnguc\b|chest|pec)/, en: "bench press push-up chest", needs: EXERCISE_WORD },
  { id: "legs_part", match: /(\bdui\b|\bquads?\b|hamstring|(tap|bai tap|nhom co|co) chan\b|chan (sau|truoc)\b|tap (chan|dui))/, en: "squat lunge leg press quadriceps hamstring", needs: EXERCISE_WORD },
  { id: "calf", match: /(bap chan|calf|gan chan)/, en: "calf raise", needs: EXERCISE_WORD },
];

// ── detection (Phase 4.7R2: query-concept RESOLUTION) ──────────────────────────

export type ResolutionStatus =
  /** ≥1 unambiguous fitness concept / catalog cue */
  | "SUPPORTED"
  /** a high-stakes safety concept was recognised: only trusted, specifically-titled curated evidence may answer, else abstain */
  | "SAFETY"
  /** the only fitness-looking tokens are polysemous ("bench", "curl", "plank"…) and no fitness context supports them */
  | "AMBIGUOUS"
  /** incompatible (legal / computing / material / food-prep) context, or a shopping/news request: not a knowledge question */
  | "OUT_OF_DOMAIN"
  /** no concept at all: only the strict whole-word synthetic/catalog lexical path may answer */
  | "UNRESOLVED";

export interface ConceptDetection {
  concepts: Concept[];
  catalog: CatalogCue[];
  domains: ConceptDomain[];
  /** English phrase for the English evidence (concept phrases joined, de-duplicated) — empty when nothing was detected */
  englishQuery: string;
  /** one English phrase per concept (≤ 3): a long mixed phrase dilutes the embedding, so concepts are asked separately */
  englishQueries: string[];
  /** any detected concept is safety-relevant → only trusted curated evidence may answer */
  safety: boolean;
  /** Phase 4.7R2 */
  status: ResolutionStatus;
  /** machine-readable why (e.g. "weak_term:bench", "accent_collision:dam", "incompatible:LEGAL", "needs_context:sleep") */
  reasons: string[];
}

export type QueryConceptResolution = ConceptDetection;

// every surface form must START at a word boundary ("e co" must not match inside "phe co"); suffixes stay free.
const bounded = new WeakMap<RegExp, RegExp>();
function atBoundary(re: RegExp): RegExp {
  let b = bounded.get(re);
  if (!b) { b = new RegExp(`(?<![a-z0-9])(?:${re.source})`, re.flags.replace("g", "")); bounded.set(re, b); }
  return b;
}
const boundedGlobal = new WeakMap<RegExp, RegExp>();
function atBoundaryAll(re: RegExp): RegExp {
  let b = boundedGlobal.get(re);
  if (!b) { b = new RegExp(`(?<![a-z0-9])(?:${re.source})`, `${re.flags.replace("g", "")}g`); boundedGlobal.set(re, b); }
  b.lastIndex = 0;
  return b;
}

// ── 1. accent policy ────────────────────────────────────────────────────────
// Aliases are written folded. When the QUERY carries Vietnamese diacritics, a folded alias token that has several accented
// readings only counts when the user's accented word is one the alias means: "đậm" (intense) must never become "đạm" (protein).
// A token typed WITHOUT accents is the user's own accentless spelling and is accepted (explicit accentless alias).
// Semantic equivalence is therefore explicit (this table), not derived from aggressive folding.
export const ACCENT_FORMS: Record<string, string[]> = {
  dam: ["đạm"], mo: ["mỡ"], co: ["cơ", "có", "cô"], ngu: ["ngủ", "ngũ"], tap: ["tập"], ta: ["tạ"], can: ["cân", "cạn"], nang: ["nặng", "nâng", "năng"],
  nhe: ["nhẹ"], lung: ["lưng"], chan: ["chân", "chấn"], bung: ["bụng"], dui: ["đùi"], dau: ["đau", "dầu"], nguc: ["ngực"],
  mach: ["mạch"], mau: ["máu"], met: ["mệt"], nuoc: ["nước"], khoe: ["khỏe", "khoẻ"], manh: ["mạnh"], cham: ["chậm"],
  thai: ["thai"], bau: ["bầu"], nhoi: ["nhói"], giam: ["giảm"], cat: ["cắt"], bua: ["bữa"], an: ["ăn", "an", "án"], lon: ["lớn"],
  no: ["nở"], han: ["hạn", "hẳn"], ep: ["ép"], thoat: ["thoát"], nhieu: ["nhiều", "nhiêu"], luc: ["lực", "lúc"], ha: ["hạ"], len: ["lên"], tang: ["tăng"],
  ngan: ["ngắn"], hang: ["hàng"], suat: ["suất"], tim: ["tim"], huyet: ["huyết"], ap: ["áp"], mat: ["mất", "mặt"], sat: ["sát"],
};

/** two-word lexical items whose individual tokens are ambiguous but whose accented readings are all legitimate for the alias */
const PHRASE_FORMS: Record<string, string[]> = { "dau goi": ["đau gối", "đầu gối"], "dau vai": ["đau vai", "đầu vai"] };

const VI_ACCENT = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

/** does this folded match span keep the user's accented words compatible with the alias? (length-preserving fold) */
function accentCompatible(foldedQ: string, rawLower: string, start: number, end: number): { ok: boolean; collision?: string } {
  if (rawLower.length !== foldedQ.length) return { ok: true }; // cannot align safely → do not reject
  const foldedSpan = foldedQ.slice(start, end);
  const rawSpan = rawLower.slice(start, end);
  for (const [ph, forms] of Object.entries(PHRASE_FORMS)) if (foldedSpan.trim() === ph) return { ok: forms.includes(rawSpan.trim()) || rawSpan.trim() === ph };
  const fw = foldedSpan.split(/[^a-z0-9]+/);
  const rw = rawSpan.split(/[^\p{L}\p{N}]+/u);
  if (fw.length !== rw.length) return { ok: true };
  for (let i = 0; i < fw.length; i++) {
    const f = fw[i], r = rw[i];
    if (!f || r === f) continue; // typed without accents = explicit accentless alias
    const allowed = ACCENT_FORMS[f];
    if (allowed && !allowed.includes(r)) return { ok: false, collision: `${f}:${r}` };
  }
  return { ok: true };
}

// ── 2. ambiguity ────────────────────────────────────────────────────────────
// Polysemous tokens look like fitness vocabulary but are ordinary words elsewhere (bench warrant, curl command, wooden plank,
// row of seats, press release…). Alone they are NOT sufficient to activate fitness RAG; they count only with positive fitness context.
export const AMBIGUOUS_TERMS = new Set(["lunge", "bench", "curl", "plank", "row", "press", "dip", "dips", "cut", "bulk", "split", "cable"]);

/** positive fitness context: training vocabulary other than the ambiguous token itself */
const POSITIVE_CONTEXT = /(\btap\b|\btap luyen|bai tap|workout|\bgym\b|exercise|training|\d+ ?sets?\b|\bsets? (x|va|rep)|\d+ ?reps?\b|nhom co|co nao|dung co|tac dong|\bta\b|ta don|ta dom|\brpe\b|\brir\b|\b1rm\b|\bform\b|ky thuat|hiep|mesocycle|cardio|kg\b.*(nang|tap|squat|deadlift)|(nang|tap|squat|deadlift|bench press).*\bkg\b|muscle|hypertroph|\bglute|abs\b|(giai doan|mua) (bulk|cut)|lean bulk|dirty bulk|\bcalo\b|kcal|\bprotein\b|\bmacros?\b|giam mo|tang co|tang can|co bap|the hinh|bodybuild|an du\b|du calo)/;

/** incompatible, strongly non-fitness phrase contexts (classes, not sentences) */
const INCOMPATIBLE: Array<[string, RegExp]> = [
  ["LEGAL", /(\bluat\b|hinh su|toa an|warrant|lawsuit|phap ly|kien tung|bi cao|bao hiem|hop dong|thu tuc|legal|court)/],
  ["COMPUTING", /(wifi|may in|printer|laptop|phan mem|ung dung|\bapp\b|dien thoai|samsung|iphone|excel|bang tinh|windows|android|\bcommand\b|terminal|\bscript\b|download|upload|\bheaders?\b|\bhttp|\bapi\b|\bcode\b|lap trinh|\bfile\b|\bserver\b|\bsql\b|python|\bbash\b|linux|\bcli\b|database|router|password|\bcsv\b|\bjson\b|\bgit\b)/],
  ["MATERIAL_COMMERCE", /(\bgo\b|\bsoi\b|\bvan go\b|\btam\b.*(go|nhua|inox)|\bday \d+ ?(cm|mm)\b|\d+ ?(cm|mm)\b|noi that|thi cong|xay dung|\bgia (mot|bao nhieu|ban|tien)\b|khuyen mai|giam gia)/],
  ["FOOD_PREP", /(cach (pha|nau|lam|nuong|chien|rang)|cong thuc (nau|pha|lam)|nguyen lieu|pha (che|sao)|\bpha (ca phe|tra|sinh to)|dam vi|ngon mieng|\bbaking?\b|\bbake\b|sourdough)/],
  ["TRAVEL_NEWS", /(ve may bay|dat (ve|phong)|lich thi dau|thoi tiet|tin tuc|ra mat|tuyen sinh)/],
];

void 0;
const NEEDS_CONTEXT_FALLBACK = POSITIVE_CONTEXT;

// VETO classes: the fitness KB is about adults who train — a child-population or non-fitness medical question is out of domain even when a fitness word is present.
const VETO: Array<[string, RegExp]> = [
  ["CHILD_POPULATION", /(tre em|tre con|em be|\bbe (mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi|\d+) tuoi|so sinh|mam non|hoc sinh|nhi khoa)/],
  ["MEDICAL_NONFITNESS", /(loang xuong|mat do xuong|ung thu|viem gan|suy than|di ung|da day|trao nguoc|hen suyen|viem phoi|benh gout|\bgout\b)/],
  ["FOOD_COMPOSITION", /((bao nhieu|co bao nhieu|ham luong|thanh phan) [^?]*(protein|dam|calo|calor|kcal|carb|chat beo|duong|muoi) [^?]*trong (mot |1 |100 ?g |nua |hai |moi )?(?!ngay|bua|tuan|thang|khau phan|ca ngay|buoi|ly nuoc|tap)\w+)/],
];

interface RawMatch { start: number; end: number; text: string }

function matchesOf(re: RegExp, q: string): RawMatch[] {
  const out: RawMatch[] = [];
  const g = atBoundaryAll(re);
  let m: RegExpExecArray | null;
  while ((m = g.exec(q)) !== null) {
    if (m[0].length === 0) { g.lastIndex++; continue; }
    const endIdx = m.index + m[0].length;
    const lastTok = (m[0].match(/[a-z0-9]+$/) ?? [""])[0];
    if (lastTok.length > 0 && lastTok.length <= 3 && /[a-z0-9]/.test(q[endIdx] ?? "")) continue; // "di bo" inside "di boi"
    out.push({ start: m.index, end: endIdx, text: m[0] });
  }
  return out;
}
const isWeakText = (t: string): boolean => AMBIGUOUS_TERMS.has(t.trim().replace(/s$/, "")) || AMBIGUOUS_TERMS.has(t.trim());

export function detectConcepts(question: string): ConceptDetection {
  const q = fold(question);
  const raw = question.toLowerCase().normalize("NFC");
  const accented = VI_ACCENT.test(raw);
  const reasons: string[] = [];

  interface Hit<T> { item: T; spans: RawMatch[]; weak: boolean }
  const collect = <T extends { match: RegExp; needs?: RegExp; id: string }>(items: T[]): Array<Hit<T>> => {
    const hits: Array<Hit<T>> = [];
    for (const it of items) {
      if (it.needs && !atBoundary(it.needs).test(q)) { if (atBoundary(it.match).test(q)) reasons.push(`needs_context:${it.id}`); continue; }
      let spans = matchesOf(it.match, q);
      if (accented) {
        const kept: RawMatch[] = [];
        for (const s of spans) {
          const c = accentCompatible(q, raw, s.start, s.end);
          if (c.ok) kept.push(s); else reasons.push(`accent_collision:${c.collision}`);
        }
        spans = kept;
      }
      if (!spans.length) continue;
      hits.push({ item: it, spans, weak: spans.every((s) => isWeakText(s.text)) });
    }
    return hits;
  };

  let cHits = collect(CONCEPTS);
  let kHits = collect(CATALOG_CUES);

  // span subsumption: a concept whose every match lies inside a LONGER match of another concept is a fragment of it
  // ("thiếu hụt" inside "thiếu hụt năng lượng tương đối" is RED-S, not fat loss)
  const allSpans = [...cHits.map((h) => ({ id: h.item.id, spans: h.spans })), ...kHits.map((h) => ({ id: h.item.id, spans: h.spans }))];
  const subsumed = (id: string, spans: RawMatch[]): boolean =>
    spans.every((s) => allSpans.some((o) => o.id !== id && o.spans.some((t) => t.start <= s.start && t.end >= s.end && (t.end - t.start) > (s.end - s.start))));
  cHits = cHits.filter((h) => !subsumed(h.item.id, h.spans));
  kHits = kHits.filter((h) => !subsumed(h.item.id, h.spans));

  const strong = [...cHits.filter((h) => !h.weak), ...kHits.filter((h) => !h.weak)];
  const weakHits = [...cHits.filter((h) => h.weak), ...kHits.filter((h) => h.weak)];
  const positive = strong.length > 0 || POSITIVE_CONTEXT.test(q);
  const vetoes = VETO.filter(([, re]) => re.test(q)).map(([n]) => n);
  const incompat = INCOMPATIBLE.filter(([, re]) => re.test(q)).map(([n]) => n);

  let keepCon = cHits.filter((h) => !h.weak).map((h) => h.item);
  let keepCat = kHits.filter((h) => !h.weak).map((h) => h.item);
  if (weakHits.length) {
    if (positive && incompat.length === 0) {
      keepCon = cHits.map((h) => h.item);
      keepCat = kHits.map((h) => h.item);
    } else {
      for (const w of weakHits) reasons.push(`weak_term:${w.item.id}`);
      if (incompat.length) for (const n of incompat) reasons.push(`incompatible:${n}`);
    }
  }
  void NEEDS_CONTEXT_FALLBACK;

  const concepts = keepCon;
  const catalog = keepCat;
  const domains: ConceptDomain[] = [];
  for (const c of concepts) if (!domains.includes(c.domain)) domains.push(c.domain);
  if (catalog.length && !domains.includes("EXERCISE_CATALOG")) domains.push("EXERCISE_CATALOG");
  const words: string[] = [];
  for (const c of concepts) for (const w of c.en.split(" ")) if (!words.includes(w)) words.push(w);
  for (const c of catalog) for (const w of c.en.split(" ")) if (!words.includes(w)) words.push(w);

  const safety = concepts.some((c) => c.safety);
  let status: ResolutionStatus;
  if (vetoes.length && !safety) { for (const n of vetoes) reasons.push(`veto:${n}`); return { concepts: [], catalog: [], domains: [], englishQuery: "", englishQueries: [], safety: false, status: "OUT_OF_DOMAIN", reasons: [...new Set(reasons)] }; }
  if (safety) status = "SAFETY";
  else if (concepts.length || catalog.length) status = "SUPPORTED";
  else if (weakHits.length) status = "AMBIGUOUS";
  else if (incompat.length && !positive) { status = "OUT_OF_DOMAIN"; for (const n of incompat) reasons.push(`incompatible:${n}`); }
  else status = "UNRESOLVED";

  return { concepts, catalog, domains, englishQuery: words.join(" "), englishQueries: concepts.slice(0, 3).map((c) => c.en), safety, status, reasons: [...new Set(reasons)] };
}

// ── token-boundary term matching (V2 used substring `includes`, so "ngan" matched "ngắn" and "hang" matched "hàng") ──

export function normalizeText(text: string): string {
  return ` ${fold(text).replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/**
 * A term occurs when it starts at a word boundary (suffixes allowed: "hypertroph" ⊂ "hypertrophy"), except that short
 * terms (≤4 chars) and hyphen-free single tokens must match a whole word so "set" never matches "setup" and "dam" never "damage".
 */
export function hasTerm(normText: string, term: string): boolean {
  const t = fold(term).replace(/[^a-z0-9]+/g, " ").trim();
  if (!t) return false;
  if (t.length <= 4) return normText.includes(` ${t} `);
  return normText.includes(` ${t}`);
}

/** how many of the detected concepts the text is about (0..concepts.length), and which */
export function conceptSupport(normText: string, concepts: Concept[], opts: { vietnamese: boolean; titleNorm?: string }): { supported: Concept[]; coverage: number } {
  // vocabulary concepts (RIR, RPE, 1RM, superset…) are only "about" a passage whose TITLE names them: papers mention RPE/1RM in passing as an outcome measure
  const supported = concepts.filter((c) => {
    const text = c.domain === "TERMINOLOGY" && opts.titleNorm !== undefined ? opts.titleNorm : normText;
    return c.docTerms.some((t) => hasTerm(text, t)) || (opts.vietnamese && (c.viTerms ?? []).some((t) => hasTerm(text, t)));
  });
  return { supported, coverage: concepts.length ? supported.length / concepts.length : 0 };
}
