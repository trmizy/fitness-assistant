# openGym Research — Sources

> Final P0 Closure correction (2026-08-24): the ACSM 2026 position stand used
> below is Currier BS et al., DOI `10.1249/MSS.0000000000003897` (not
> "Phillips ST et al." in the older table row). Its primary text supports the
> broad near-failure/RIR concept; this app's `HIGH_RIR_HEADROOM_THRESHOLD = 2`
> remains a `PRODUCT_HEURISTIC`, not an ACSM-derived progression trigger.

> Per the task's Phase 31 requirement. Distinguishes openGym behavior
> reference from official guidelines, peer-reviewed evidence, and product
> heuristics — never mixed.

## openGym behavior reference (feature/UX description only — no code read)

| Title | URL | Type | Date accessed | Claim supported | Reliability | Used for |
|---|---|---|---|---|---|---|
| DuarteSantos/openGym (Gitea, canonical) | https://gitea.com/DuarteSantos/openGym | Project README/feature list | 2026-08-23 | Full feature set: prefill, rest timer, exercise modes, progression policies, PR, supersets, import, offline | High (primary source, live) | Gap-analysis "openGym" column |
| DuarteSantos8/openGym (GitHub, original) | https://github.com/DuarteSantos8/openGym | — | 2026-08-23 | N/A — returned HTTP 404, repo moved off GitHub | N/A | Confirms canonical location moved; not used as a source itself |
| arvids-unavailable/openGym (fork) | https://github.com/arvids-unavailable/openGym | Fork README | 2026-08-23 | Confirms fork status, same license, 5 commits (stale, not kept current) | Medium | Ruled out as the reference; Gitea original used instead |
| openGym NOTICE.md | https://github.com/DuarteSantos8/openGym/blob/main/NOTICE.md | License notice (surfaced via search snippet) | 2026-08-23 | Exercise data from `hasaneyldrm/exercises-dataset`, separate from openGym's own AGPL code license | High | License section of gap analysis |
| openGym marketing site | https://opengym.duarte-santos.ch/ | Landing page | 2026-08-23 (search snippet only, not directly fetched) | Corroborates self-hosted/privacy-first positioning | Medium | Background context only |

## Official guidelines / peer-reviewed evidence (reused from existing project research — not re-fetched this pass)

Already sourced and graded in `docs/gym-fitness-research.md`; reused directly
rather than duplicated:

| Section | Source | Claim |
|---|---|---|
| §2 | Bell et al. (2025), *A Practical Approach to Deloading*, Strength and Conditioning Journal | Deload cadence (4-8 wk planned, or reactive), definition vs tapering |
| §3 | muscleresearch.net (2025 review, synthesis) | RPE/RIR reliability is lower in beginners, improves with deliberate practice + calibration |
| §7 | OpenSIUC, *Validation of the Brzycki and Epley Equations* (synthesis of multiple validation studies) | Epley best for 2-10 rep low-end; Brzycki degenerates near 37 reps; both unreliable >15 reps |
| §7 | Marzagao (Fitbod, Inc.), arXiv 2603.17495 (03/2026) | Newer weight-dependent 1RM formula, preprint only, not adopted as default this pass |
| §10 | (existing project research, ACSM Kraemer & Ratamess) | Beginner/Intermediate/Advanced training-age thresholds — used as-is by onboarding, unrelated to this task's scope, referenced only for consistency |

The P0 pass reused `gym-fitness-research.md`'s existing coverage rather than
re-deriving it (see note below, kept for the record — no longer accurate as
of the P1-completion pass, which added the new research in the next table).

## New research — P1-completion pass (2026-08-24)

| Source | Type | Reliability | Claim | Used for |
|---|---|---|---|---|
| **ACSM Position Stand — "Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults: An Overview of Reviews"**, Phillips ST et al., *Medicine & Science in Sports & Exercise* 58(4):851-872, April 2026. DOI [10.1249/MSS.0000000000003897](https://doi.org/10.1249/MSS.0000000000003897). Free full text: [PMC12965823](https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823/); abstract: [PubMed 41843416](https://pubmed.ncbi.nlm.nih.gov/41843416/). | 🟢 Peer-reviewed position stand, overview of 137 systematic reviews, 30,000+ participants | High (primary source identity confirmed via PubMed/PMC/DOI cross-check — genuinely exists, first ACSM update to this position stand since 2009) — **but the specific numbers below are read from secondary science-journalism summaries, not the primary PDF itself**, see limitation note | Updates 2009 ACSM guidance this project's `gym-fitness-research.md` §10 already cited | See "ACSM 2026 update" analysis below |
| [2 Minute Medicine — "Landmark ACSM/McMaster guidelines simplify resistance training for longevity"](https://www.2minutemedicine.com/landmark-acsm-mcmaster-guidelines-simplify-resistance-training-for-longevity/) | 🟡 Science journalism summary of the above primary source | Medium — independent second source corroborates the same numbers as below | Strength: ≥80% 1RM, 2-3 sets. Hypertrophy: ~10 sets/muscle/week. Frequency: 2x/week/muscle group. Failure not required. | ACSM 2026 update table |
| [Medical News Today — "Resistance training: What's the best way to train for muscle strength?"](https://www.medicalnewstoday.com/articles/new-resistance-training-guidelines-debunk-myths-stronger-muscles-strength-size) | 🟡 Science journalism summary of the same primary source | Medium — corroborates 2 Minute Medicine's numbers independently | Strength ≥80% 1RM/2-3 sets; hypertrophy ≥10 sets/muscle/week; power 30-70% 1RM fast-movement; "training experience has little impact on effectiveness of exercises"; equipment type doesn't significantly affect results | ACSM 2026 update table |
| [BULLBAR / Bulldog Gear bodyweight-progression blog posts](https://bullbarfit.com/blogs/q-as/how-do-i-safely-add-weight-to-my-pull-ups-for-strength-gains) | 🟡 Coaching/commercial blog, not peer-reviewed | Low-medium — practitioner consensus, not a study | Reps build strength/endurance up to roughly 8-20 reps depending on exercise; beyond that, added external load (not more reps) is needed to keep raising true 1RM/max-strength ceiling | Confirms (does not newly establish) this project's existing `BODYWEIGHT_REP_STEP`/rep-ceiling-then-add-load design as an industry convention, not new evidence |

### ACSM 2026 update — what it means for this app

- **Confirms, does not contradict, existing design.** Hypertrophy ≥10
  sets/muscle/week matches `gym-fitness-research.md` §4's already-cited
  Schoenfeld, Ogborn & Krieger (2017) "10 set/week" finding almost exactly —
  independent corroboration, not new information requiring a design change.
  Strength ≥80% 1RM/2-3 sets and "failure not required for
  strength/hypertrophy" both match this project's existing progression
  engine design (RIR-headroom-based advancement, never to-failure).
- **New, not yet reflected anywhere in this app**: explicit **power**
  guidance (~30-70% 1RM, moved as fast as possible) — this app has no power-
  training concept in its progression policies at all (`LINEAR`/
  `DOUBLE_PROGRESSION`/`AUTOREGULATED_RIR`/`BODYWEIGHT_REP_CLIMB`/
  `TIMED_PROGRESSION` all target strength/hypertrophy, none targets
  power/speed). Flagged as a genuine, real gap — **not implemented this
  pass** (P0/P1 scope was strength/hypertrophy/bodyweight/timed/cardio, not
  power; adding a 6th policy is new scope, not a completion-gate item).
- **Notable claim worth flagging, not acting on**: "training experience has
  little impact on the effectiveness of exercises" / "consistency beats
  complexity" — read narrowly (per the secondary sources), this is about
  *general population health outcomes* from *any* resistance training, not a
  claim that a structured app's experience-tiered progression policies
  (LINEAR for beginners vs AUTOREGULATED_RIR for advanced) are wrong. This
  project's engine is already more conservative than what the guideline
  requires (it gates autoregulation to ADVANCED + real RIR data — see
  `exercise-progression.engine.ts:135`, reviewed and confirmed correct this
  pass, no change needed), so there's no conflict to resolve — noted for
  completeness, not treated as grounds for a redesign.
- **Honest limitation of this research pass**: `acsm.org`'s own pages and
  PubMed/PMC both blocked automated fetching (403 / reCAPTCHA / cookie-gate)
  during this session — the primary PDF was never directly read. The
  existence, authorship, journal, DOI, and issue of the paper are confirmed
  with high confidence (consistent across PubMed's own indexing, PMC's own
  ID, and ACSM's own site title, not just blog say-so), but the *specific
  numbers* above come from two independent science-journalism summaries of
  it, not the primary text — flagged at 🟡-adjacent reliability for the
  numbers specifically, 🟢 for the paper's existence/identity.

### FINAL P0 CLOSURE PASS update — primary source fetched directly, limitation above resolved

The "honest limitation" paragraph above (PMC/PubMed blocked automated
fetching, numbers only came from secondary science-journalism summaries)
was true for the P0-completion pass but is now resolved: this pass
successfully fetched [PMC12965823](https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823/)
directly (PMC's own full-text mirror, not `acsm.org` or PubMed's abstract
page, both of which still block automated fetching) and searched it for
RIR/RPE progression language specifically. Two direct quotes obtained:

> "Sufficient effort (assessed using various scales) can be accomplished by
> completing sets with various RTx and completion of 'near-failure' or a
> target of 2–3 repetitions in reserve (RIR)."

> "While training to failure is not obligatory for optimizing results,
> there is insufficient evidence to quantify exact RIR and perceived
> exertion targets."

**Effect on evidence classification**: full detail and the resulting
reclassifications live in `docs/TRAINING_PROGRESSION_ARCHITECTURE.md` §9.1
(new `EVIDENCE_INFORMED` tier introduced) — summary: the RIR/proximity-to-
failure *concept* and the general "2-3 RIR" range are directly confirmed by
the primary source, but the primary source explicitly disclaims having
evidence for exact numeric targets, so this project's own `≥2` progression-
trigger threshold is correctly a `PRODUCT_HEURISTIC`, not
`EVIDENCE_SUPPORTED`, even though it sits inside the range ACSM mentions.
No code changed — only the evidence-tier label and its stated justification.

| Source | Type | Reliability | Claim | Used for |
|---|---|---|---|---|
| Remmert JF, Laurson KR, Zourdos MC (2023), "Accuracy of Predicted Intraset Repetitions in Reserve (RIR) in Single- and Multi-Joint Resistance Exercises Among Trained and Untrained Men and Women", *Perceptual and Motor Skills*. DOI [10.1177/00315125231169868](https://doi.org/10.1177/00315125231169868), PubMed [37036795](https://pubmed.ncbi.nlm.nih.gov/37036795/). | 🟢 Peer-reviewed, directly on-topic (trained vs. untrained RIR accuracy) | High — real, indexed peer-reviewed study, found via direct search (not a review-site synthesis) | Training status (trained vs. untrained) did NOT significantly influence intraset RIR prediction accuracy on machine-based single/multi-joint exercises; accuracy instead tracked proximity to failure (more accurate closer to failure, for both groups) | Re-validates (and complicates — see §9.1) the `AUTOREGULATED_RIR` gating's evidence basis; reclassified from `EVIDENCE_SUPPORTED` to `EVIDENCE_INFORMED` |

This directly replaces the single `muscleresearch.net` review-synthesis
source (`gym-fitness-research.md` §3) as the basis for the
`AUTOREGULATED_RIR` gating claim with a real peer-reviewed comparison study
— which turns out to show a **more nuanced** picture (training status
doesn't clearly move RIR-counting accuracy on the lifts studied) than the
original synthesis implied. The gating itself is unchanged (see §9.1: still
defensible on data-availability/conservative-default grounds), only its
evidence label is corrected.

## Original note (P0 pass, superseded by the above — kept for the record)

No new external scientific search was performed that pass —
`gym-fitness-research.md` already covered progression/plateau/deload,
RPE/RIR, and e1RM formula selection/limits directly on-topic, with sources
graded 🟢 (peer-reviewed) vs 🟡 (coach/practitioner) already separated.
Re-deriving the same research would have duplicated existing, dated, sourced
work rather than adding anything. This pass added genuinely new material
(ACSM 2026 update, bodyweight-progression sourcing) instead of repeating it.

## Product heuristic / industry convention (explicitly labeled, not scientific fact)

| Claim | Classification | Note |
|---|---|---|
| Warm-up sets excluded from PR/e1RM calculation | Industry convention | Common practice (openGym does it explicitly); not a peer-reviewed rule. Already precedented in this repo's own `docs/advanced-set-logging.md` treatment of "top set"/"back-off set" terminology as practitioner convention, not science. |
| "Previous performance" must be visually distinct from "recommended target" | Product heuristic (this task's own instruction, §11) | UX/trust principle, not a research claim |
| Progression engine sits strictly underneath the cycle decision engine (DELOAD caps exercise-level load increases) | Product/architecture heuristic | Follows directly from this repo's own already-implemented principle ("code tính số liệu, LLM chỉ diễn giải") extended one layer down — not an external claim |
