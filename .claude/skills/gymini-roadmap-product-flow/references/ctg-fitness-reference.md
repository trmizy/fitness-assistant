# CTG Fitness — external reference notes

Sources:

- `https://ctg-web.hoanglongdt.workers.dev/` — public landing page
  (static fetch, 2026-09-10).
- `https://ctg-web.hoanglongdt.workers.dev/chon-lo-trinh/` ("Chọn lộ
  trình" — the real intake-form page) (static fetch, 2026-09-10). Note:
  the vanity domain `ctg.fitness` (shown in the landing page's own link
  text) does not resolve (`ENOTFOUND`) — use the `*.workers.dev` host
  directly.
- **7 real screenshots from an authenticated session (user-provided,
  2026-09-10)** — the user logged into their own real account and
  shared screenshots of the "Mục tiêu" (goal) step and the full "Báo
  cáo & Lộ trình" (report) step. This is the highest-confidence source
  here — real rendered numbers from a real generated roadmap, not
  marketing copy or a pre-submission form description.

**Confidence: high for the authenticated-screenshot section below (real
rendered app screens); moderate for the intake-form structure (fetched
directly from the real page's own markup); low/directional for
everything else (marketing copy only).** Re-verify before treating any
of this as a literal spec — a single example roadmap is not a full
spec of every edge case.

## What the real authenticated screens surfaced (highest confidence)

**The 4-tab wizard structure is confirmed live**, exactly as this
skill's own "CTG-inspired" section already assumed: **Thông tin cơ bản
/ Tập luyện & Hoạt động / Mục tiêu / Báo cáo & Lộ trình** — visible as
real tabs in the screenshots.

### TDEE breakdown (shown to the user, not hidden)

A real, itemized "Tiêu hao năng lượng hiện tại" (current energy
expenditure) card, before the goal step:

```
BMR                    1.744 kcal
Bước chân (steps)        125 kcal
Tập kháng lực (resistance)179 kcal
Bộ môn khác (other sport)  0 kcal
Tiêu hoá thức ăn (TEF)    174 kcal
──────────────────────────────────
TDEE                   2.222 kcal/ngày
```

With a real "+ Thêm môn thể thao" (add another sport) affordance and
explanation copy: *"BMR 1.744 kcal là mức cơ thể đốt khi nằm yên cả
ngày. TDEE 2.222 kcal là tổng mức đốt thật, đã cộng đi lại, tập luyện
và cả phần calo tiêu tốn cho việc tiêu hoá thức ăn. Mọi mức ăn của lộ
trình tính theo TDEE."*

**Directly relevant to `gymini-fitness-science-guardrails`**: TEF is
shown here as a real, explained, itemized component (174 kcal) — not a
hidden residual forced to make numbers sum. This is a *positive*
precedent, reinforcing (not contradicting) that guardrail's own rule:
if TEF is shown, show it as a real, understood component, with copy
explaining what it is — never as an invisible correction term.

### Goal step ("Mục tiêu" tab)

- **FFMI mục tiêu**: a real numeric input (example: target 22, current
  21.7).
- **Mỡ cơ thể mục tiêu (%)**: a real numeric input (example: 15%).
- **"Tên hình mẫu" + "Ảnh hình mẫu"** with a **"Phân tích ảnh idol"**
  (analyze idol/reference photo) action — a real goal-image feature:
  upload a reference photo, the system analyzes it toward a target
  physique. Gymini already has an equivalent concept (see
  `docs/FITNESS_ROADMAP_GOAL_IMAGE_E2E_REPORT.md`) — this confirms
  rough feature parity, not a gap to close.
- Explanation copy states real, concrete conventions: *"Chặng giảm mỡ
  sẽ cho bạn ăn ít hơn mức đốt 20%, chặng tăng cơ ăn nhiều hơn mức đốt
  10%."* — i.e. **-20% deficit for fat-loss phases, +10% surplus for
  muscle-gain phases**. A concrete real-world number, not necessarily
  Gymini's own number — cross-check against
  `cycle-thresholds.config.ts`'s actual values if this level of detail
  ever matters for a real comparison, don't assume Gymini should match
  it.

### Report step ("Báo cáo & Lộ trình" tab) — real structure

**Top-level summary**:
```
Tổng thời gian:        34 tuần · ~7.9 tháng
Hoàn thành dự kiến:    07/05/2027
Cân nặng:              79,5 → 75,46 kg
Mỡ cơ thể:             20 → 14,8%
Khối nạc (lean mass):  63,6 → 64,31 kg
FFMI:                  21,68 → 21,92
```
...plus a real multi-color horizontal progress bar segmenting the whole
timeline by campaign.

**A real 2-level hierarchy**: "K1 · Giảm mỡ" / "K2 · Tăng cơ" / "K3 ·
Điều chỉnh mỡ" are top-level **campaigns** (conceptually close to
Gymini's `RoadmapPhase`), each containing multiple **"Giai đoạn"**
(stages, conceptually close to Gymini's `TrainingCycle`). Real example:
K1 · Giảm mỡ = 3 giai đoạn · 15 tuần · TB 1827 kcal/ngày, made of:

```
Giai đoạn 1 · Giảm mỡ    11/09/2026→20/11/2026 · 10 tuần · THÂM HỤT -20% · 1.769 kcal/ngày
Giai đoạn 2 · Diet Break 20/11/2026→04/12/2026 ·  2 tuần · DUY TRÌ      · 2.210 kcal/ngày
Giai đoạn 3 · Giảm mỡ    04/12/2026→25/12/2026 ·  3 tuần · THÂM HỤT -20% · 1.764 kcal/ngày
```

Each stage shows: date range + duration, a deficit/surplus/maintain
badge, average daily calories, before→after weight/body-fat%/FFMI for
JUST that stage, BMR/TDEE for that stage, and a full macro breakdown in
grams (ĐẠM/protein, TINH BỘT/carbs, CHẤT BÉO/fat). Macros visibly shift
between stages — e.g. the Diet Break stage drops protein (171g→139g)
and raises carbs/fat relative to the deficit stages, a real, sensible
diet-break macro pattern.

**The real, explicit periodization rule**: *"Giảm mỡ về mức lý tưởng.
Sau mỗi khoảng giảm 5% cân nặng, lộ trình chèn Diet Break 2 tuần."* —
every 5% body-weight loss automatically inserts a 2-week maintenance
Diet Break before continuing the deficit. Gymini already has its own
diet-break modeling (see recent `nutrition-decision.engine.ts`/
`training-cycle.service.ts` diet-break work) — this is a useful,
concrete comparison point for periodization CADENCE (a fixed % weight-
loss trigger) if Gymini's own trigger logic is ever revisited, not a
reason to copy this exact 5%/2-week rule verbatim.

**A real, narrative "Nhận định lộ trình" (roadmap assessment) block** at
the end, explaining the reasoning behind the sequencing:

*"Hiện tại bạn có %mỡ 20,0% (cao hơn mức lý tưởng) và FFMI 21,68 (ở mức
trung bình). %mỡ hiện tại chỉ hơi cao hơn mức lý tưởng nên giai đoạn
giảm mỡ đầu sẽ ngắn, phần lớn thời gian lộ trình sẽ dành cho tăng cơ tới
FFMI 22,0. Với lựa chọn hiện tại, mục tiêu %mỡ sẽ dễ đạt hơn (tới đích
sớm hơn)."*

This is a real, concrete precedent for what a good `aiSummary`/roadmap-
reasoning block should read like — explains the CURRENT state, WHY this
specific ordering (short cut phase first, then the bulk of the time on
a K2 muscle-gain campaign), and what tradeoff the user's current choice
implies. Gymini's own `aiSummary`/forecast-reasoning copy (see
`gymini-fitness-science-guardrails`) should aim for this same level of
"here's the actual reasoning," not a generic template sentence.

Final actions: **"← Quay lại"** / **"💾 Lưu lộ trình"** (Save roadmap) —
the same Save/Draft framing Gymini's own guided wizard already uses.

## What the landing page surfaced

- **3-step framing**: "Trả lời câu hỏi" -> "Nhận lộ trình" -> "Tập &
  check-in".
- **Intake framing**: "mục tiêu, cân nặng, khẩu vị và lịch tập của bạn —
  không cần đăng ký trước" (goal, weight, food preference, training
  schedule — no registration required before seeing a plan).
- **Localized nutrition**: plans built around real Vietnamese dishes
  (e.g. cơm tấm, ~845 kcal) rather than Western food substitutes.
- **Goal framing**: a weight-range presentation, e.g. "88kg → 100kg".
- **Adherence mechanic**: check-ins after each session, real-time weight
  tracking over time, progress charts.
- **AI features**: food-photo analysis returning calorie/macro
  breakdown; a body-composition-from-photo/bodyfat-estimate feature
  described as upcoming, not confirmed live.
- **Positioning**: free tier, no equipment required, personalized
  routines + progress monitoring as the core pitch.

## What the real "Chọn lộ trình" intake-form page surfaced (more concrete)

- **No pre-listed packages.** The form does NOT show tiers/packages
  before intake — it collects real data first, then the system
  recommends a direction. This matches Gymini's own guided-wizard
  philosophy already (see SKILL.md's product model) — a real,
  independent precedent for "collect first, don't make the user pick a
  package blind."
- **Three goal directions** the system recommends toward: **Giảm mỡ**
  (cut) / **Tăng cơ** (bulk) / **Giữ dáng & khỏe** (maintain) — a
  genuinely small, closed set, not an open-ended goal picker.
- **Real form fields, in this apparent order**:
  1. Personal info — name, email, phone.
  2. Health — any medical condition (free text/flag).
  3. Body data — gender, height (cm), weight (kg), body-fat % (Bodyfat).
  4. Goal — either a specific direction, or explicitly **"Chưa rõ định
     hướng"** ("not sure yet") so the system suggests one — a real,
     named escape hatch for a user who doesn't know their own goal yet.
     Gymini's own onboarding should have (or already has, verify against
     `OnboardingWizardPage.tsx`) an equivalent for a user who can't
     confidently pick WEIGHT_LOSS/MUSCLE_GAIN/MAINTENANCE.
- **A real, explicit coaching-tier branch after intake**: "Bạn có cần
  CTG Fitness trợ giúp để hoàn thành mục tiêu này không?" with four
  options — Online coaching / Giáo án tự tập (self-guided) / Coaching
  1:1 trực tiếp / Semi online-offline coaching. This is a genuine
  business-model branch point (self-serve AI-only vs. human-PT-backed),
  conceptually close to Gymini's own client-vs-PT-contract split (see
  `gymini-cross-system-journey`'s PT overlay) — worth knowing this
  exists as a named pattern elsewhere, not a reason to copy CTG's exact
  four options.
- **Result structure (as described on the form page, before actual
  submission)**: "khối nạc, chỉ số FFMI và định hướng phù hợp" (lean
  mass, FFMI index, and a matching direction) presented alongside two
  visual REFERENCE TABLES (a body-fat chart and an FFMI chart) — i.e.
  the user's own number is shown IN CONTEXT of a reference range, not
  as a bare number with no scale. This is a concretely useful pattern
  Gymini's own FFMI/body-fat presentation (where used) could borrow —
  a reference table/range alongside the user's own value — without
  copying CTG's specific chart design.
- **A real disclaimer worth reusing the SPIRIT of** (not the exact
  wording, which is CTG's own copy): "Kết quả phân tích chỉ mang tính
  tham khảo, không thay thế tư vấn y tế." (results are for reference
  only, not a substitute for medical advice). This is exactly the
  MEASURED/ESTIMATED/PROJECTED discipline `gymini-fitness-science-
  guardrails` already requires — a real, external precedent for why
  that discipline matters in this exact product category.

## How to use this (and how not to)

Useful as inspiration for: low-friction intake copy, a Vietnamese-first
nutrition framing (Gymini's own `NutritionGoal`/meal-plan generation
already targets this — cross-check tone, not mechanics), a weight-range
goal framing, an explicit "chưa rõ định hướng" escape hatch for a goal
step (verify Gymini's own onboarding already has an equivalent before
assuming it needs one), presenting a body-composition number alongside
a real reference range/table instead of a bare figure, showing TDEE as
a real itemized breakdown (BMR + activity components + TEF) instead of
one opaque number, and writing roadmap-reasoning copy that references
the user's actual current numbers and explains an actual tradeoff
(the "Nhận định lộ trình" example above) rather than a generic template
sentence.

This also gives a concrete external reference point for what a
Gymini-equivalent ACTIVE Journey report COULD look like at the
"Báo cáo & Lộ trình" density level — real before→after stats, a
segmented timeline, per-stage macro/calorie detail — useful context for
`gymini-roadmap-product-flow`'s own "ACTIVE Journey hides too much"
known issue (SKILL.md item #3): this is roughly the level of density
that issue is about NOT losing after activation, not a literal layout
to copy.

**Not** a reason to: remove Gymini's own deterministic `CycleAssessment`
engine, versioned `NutritionGoal`, or real InBody-measurement model in
favor of a simpler photo-estimate-only approach. Gymini's adaptive depth
is a deliberate product differentiator (see
`gymini-fitness-science-guardrails`) — CTG's simpler, more mainstream-
consumer-app model is not automatically the better bar for Gymini's own
adaptive positioning.
