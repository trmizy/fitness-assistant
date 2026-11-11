"""
V2.3A deterministic reference-grounding guard — OFFLINE CANDIDATE, not wired into
production. Pure, deterministic post-processor over a SemanticInterpretation-shaped
dict (same schema as backend/services/ai-service/src/conversational-intelligence/
schema.ts's SemanticInterpretationSchema).

Why this exists (see docs/ai-training/qwen4b-v2-3a-deterministic-reference-grounding-guard.md):
V2.2 tried to teach "is there a visible antecedent?" purely via ~30 extra QLoRA
training rows and it did not generalize (7/8 wrong on fresh-wording dev-challenge
cases). This guard instead enforces the invariant deterministically, as a
post-processing filter over the model's own proposed `references[]`.

SCOPE, confirmed by reading the real production code (task's own §1 requirement):
- `interpreter.ts`'s real production prompt sends only a fixed system instruction +
  optional `expectedSlot` + the current user message — no conversation history, no
  hidden proposal object visible to the semantic-interpretation step itself.
- `policy.ts` (lines ~154-175) ALREADY grounds the kinds `ACCEPT_PROPOSAL`,
  `LOWER_OPTION`, `HIGHER_OPTION`, `MIDDLE_OPTION` against `ci.proposal` (a
  persisted business-state object) — a different, already-existing authority this
  guard must not duplicate or conflict with.
- `THIS_ITEM`, `PREVIOUS_STATE`, `FIRST_ITEM`, `ORDINAL_ITEM` have **no existing
  grounding check anywhere** in the deterministic pipeline either — `signals.ts`'s
  `detectReferences()` fires them on a pure surface-pattern match with zero
  verification that a real antecedent exists. This guard closes exactly that gap.
- `FIRST_ITEM`/`ORDINAL_ITEM` refer to position in a candidate LIST that (per the
  same single-turn prompt constraint) is not visible text within one message
  either — grounding them would need the same kind of external-list context this
  guard deliberately does not have access to. Left untouched (REFERENCE_NOT_APPLICABLE).

Guarded kinds: THIS_ITEM, PREVIOUS_STATE.
Passed-through kinds (out of this guard's declared authority): ACCEPT_PROPOSAL,
LOWER_OPTION, HIGHER_OPTION, MIDDLE_OPTION, FIRST_ITEM, ORDINAL_ITEM.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

GUARDED_KINDS = ("THIS_ITEM", "PREVIOUS_STATE")

# Decision reason taxonomy (task §19) — kept small and stable, not proliferated.
REFERENCE_NOT_APPLICABLE = "REFERENCE_NOT_APPLICABLE"
REFERENCE_GROUNDED_UNIQUE = "REFERENCE_GROUNDED_UNIQUE"
REFERENCE_EXPLICIT_TARGET = "REFERENCE_EXPLICIT_TARGET"
REFERENCE_NO_VISIBLE_TARGET = "REFERENCE_NO_VISIBLE_TARGET"
REFERENCE_MULTIPLE_VISIBLE_TARGETS = "REFERENCE_MULTIPLE_VISIBLE_TARGETS"
REFERENCE_TYPE_MISMATCH = "REFERENCE_TYPE_MISMATCH"  # reported when domain filtering drops all candidates of the requested class while other-domain candidates exist


def normalize_text(text: str) -> str:
    """Same convention as the real codebase's normalizeAgentText (fitness-agent-intent.ts):
    NFD-strip diacritics, đ/Đ -> d, lowercase. Every candidate/domain regex below
    operates on this normalized form, exactly like signals.ts's detectReferences."""
    decomposed = unicodedata.normalize("NFD", text)
    stripped = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return re.sub(r"đ|Đ", "d", stripped, flags=re.IGNORECASE).lower()


# ── domain keywords (what KIND of thing is this reference asking about?) ──
DOMAIN_PATTERNS: dict[str, re.Pattern] = {
    "PT": re.compile(r"\b(pt|huan luyen vien|hlv|coach)\b"),
    "PROGRAM": re.compile(r"\b(chuong trinh|lich tap|thuc don|goi|plan)\b"),
    "EXERCISE": re.compile(r"\b(bai tap|bai\b|exercise)\b"),
    "NUMERIC": re.compile(r"\b(muc|so|level)\b"),
}

# ── candidate extraction patterns (what CONCRETE items are actually visible?) ──
_DEICTIC_TAIL = r"(?!\s*(?:nay|do|kia|day)\b)"

_PT_CANDIDATE_RE = re.compile(r"\b(?:pt|huan luyen vien|hlv|coach)\s+" + _DEICTIC_TAIL + r"([a-z][a-z0-9]*)")

_PROGRAM_GOAL_WORDS = r"(?:tang co|giam mo|giam can|tang can|giam beo|duy tri)"
_PROGRAM_CANDIDATE_RE = re.compile(
    r"\b(?:chuong trinh|lich tap|thuc don|goi)\s+" + _DEICTIC_TAIL + r"(\d+|" + _PROGRAM_GOAL_WORDS + r")"
)

# Small, explicit exercise vocabulary — a lexical AID for candidate identification only
# (task §5: "lexical cues may help identify a reference expression, but authority must
# come from candidate grounding" — this list locates candidates; it never decides
# grounding by itself, the counting logic below does).
_EXERCISE_VOCAB = (
    "squat", "deadlift", "bench", "leg press", "overhead press", "pull up", "push up",
    "row", "lunge", "plank", "curl", "shoulder press", "lat pulldown", "hip thrust",
)
_EXERCISE_CANDIDATE_RE = re.compile(r"\b(" + "|".join(re.escape(w) for w in _EXERCISE_VOCAB) + r")\b")

# Ordinal markers consumed by the production ORDINAL_ITEM/FIRST_ITEM detectors are not
# themselves numeric "value" candidates for a NUMERIC-domain reference — stripped first.
_ORDINAL_MARKER_RE = re.compile(r"\bthu\s*(?:\d+|hai|ba|tu|nam|sau|bay)\b|\bso\s*\d+\b")
_NUMERIC_CANDIDATE_RE = re.compile(r"\b\d+(?:[.,]\d+)?\b")

_KEEP_DISAMBIGUATOR_RE = re.compile(r"\bgiu\s+([a-z0-9 ]{2,30}?)(?:[,.]|$| thi| nhung)")

# task §12 — "explicit named target": a reference whose OWN sourceText is already a
# concrete name ("squat", "PT Lan", "chuong trinh giam mo") is self-grounded and must
# never be run through candidate counting at all — only a BARE deictic phrase (the
# demonstrative word with no identifying name attached, e.g. "cai do", "PT kia",
# "bai do", "muc nay") genuinely needs an antecedent check. Found empirically (not
# assumed): an earlier version of this guard ran every THIS_ITEM-kind reference
# through grounding regardless of sourceText shape, which wrongly invalidated
# `revision-swap-exercise-explicit-1/2` (sourceText="squat", a real exercise name,
# not a pronoun) purely because a SECOND, unrelated exercise name also appeared
# elsewhere in the same message — see docs/ai-training/
# qwen4b-v2-3a-deterministic-reference-grounding-guard.md §5 for the full trace.
_BARE_DEICTIC_SUFFIX_RE = re.compile(r"\b(nay|do|kia|day|cu|vua roi|luc nay|truoc)\s*$")


def _is_bare_deictic(source_text_norm: str) -> bool:
    return bool(_BARE_DEICTIC_SUFFIX_RE.search(source_text_norm.strip()))


@dataclass
class Candidate:
    cls: str
    span: str


def extract_candidates(message_norm: str) -> list[Candidate]:
    """All concrete, nameable items visible in this one message, independent of domain.
    Domain filtering happens separately (compatibility, task §14) so this function stays
    a single small reusable extractor rather than one per domain."""
    out: list[Candidate] = []
    for m in _PT_CANDIDATE_RE.finditer(message_norm):
        out.append(Candidate("PT", m.group(0)))
    for m in _PROGRAM_CANDIDATE_RE.finditer(message_norm):
        out.append(Candidate("PROGRAM", m.group(0)))
    seen_exercise: set[str] = set()
    for m in _EXERCISE_CANDIDATE_RE.finditer(message_norm):
        tok = m.group(1)
        if tok not in seen_exercise:
            seen_exercise.add(tok)
            out.append(Candidate("EXERCISE", tok))
    numeric_scan = _ORDINAL_MARKER_RE.sub(" ", message_norm)
    for m in _NUMERIC_CANDIDATE_RE.finditer(numeric_scan):
        out.append(Candidate("NUMERIC", m.group(0)))
    return out


def detect_domain(reference_source_text: str, message_norm: str) -> str | None:
    """The domain the reference itself is asking about (task §14 type compatibility).

    Deliberately checked ONLY against the reference's own sourceText — never against
    unrelated words elsewhere in the message. An earlier version of this function fell
    back to scanning the whole message when sourceText carried no domain noun, which
    caused a false NUMERIC-domain match on an unrelated word ("tạ" = barbell weight)
    in a message that was really about an exercise, wrongly zeroing out an otherwise
    real EXERCISE candidate (see docs/ai-training/
    qwen4b-v2-3a-deterministic-reference-grounding-guard.md §5). `message_norm` is kept
    as a parameter for interface stability / potential future narrow use, but is
    intentionally unused here now.
    Returns None for GENERIC (any candidate class is compatible — bare "cái đó/kia")."""
    del message_norm
    src_norm = normalize_text(reference_source_text or "")
    for domain, pattern in DOMAIN_PATTERNS.items():
        if pattern.search(src_norm):
            return domain
    return None


def _apply_explicit_disambiguation(message_norm: str, candidates: list[Candidate]) -> list[Candidate]:
    """task §13/§11 — "giữa squat và leg press thì giữ squat, đổi bài kia": an explicit
    "giữ <X>" clause removes X from the pool, which can collapse 2 candidates to 1
    unique remaining target. A narrow, explicit rule — not a general disambiguation NLU."""
    m = _KEEP_DISAMBIGUATOR_RE.search(message_norm)
    if not m:
        return candidates
    kept_span = m.group(1).strip()
    return [c for c in candidates if c.span not in kept_span and kept_span not in c.span]


def _compatible(domain: str | None, candidates: list[Candidate]) -> list[Candidate]:
    if domain is None:
        return candidates
    return [c for c in candidates if c.cls == domain]


@dataclass
class GuardDecision:
    reference_index: int
    kind: str
    source_text: str
    domain: str | None
    candidate_count: int
    reason: str
    invalidated: bool


@dataclass
class GuardResult:
    interpretation: dict[str, Any]
    decisions: list[GuardDecision] = field(default_factory=list)
    changed_fields: list[str] = field(default_factory=list)
    activated: bool = False  # True iff at least one reference was invalidated


def validate_reference_grounding(interpretation: dict[str, Any], message_text: str) -> GuardResult:
    """The core guard (task §18). Pure, deterministic, no LLM/DB/network call.

    interpretation: a dict shaped like SemanticInterpretationSchema (as produced by
                     the fine-tuned model, already JSON-parsed).
    message_text:   the single visible user utterance the parser actually received
                     (task §6 — visible context only, no hidden state).
    """
    references = interpretation.get("references")
    if not isinstance(references, list) or not references:
        return GuardResult(interpretation=interpretation, decisions=[], changed_fields=[], activated=False)

    message_norm = normalize_text(message_text)
    all_candidates = extract_candidates(message_norm)

    kept_refs: list[dict] = []
    decisions: list[GuardDecision] = []
    any_invalidated = False
    invalidation_reasons: list[str] = []

    for i, ref in enumerate(references):
        if not isinstance(ref, dict):
            continue
        kind = ref.get("kind")
        source_text = ref.get("sourceText", "")

        if kind not in GUARDED_KINDS:
            kept_refs.append(ref)
            decisions.append(GuardDecision(i, kind, source_text, None, -1, REFERENCE_NOT_APPLICABLE, False))
            continue

        source_norm = normalize_text(source_text)
        if not _is_bare_deictic(source_norm):
            # task §12 — sourceText already names something concrete; self-grounded.
            kept_refs.append(ref)
            decisions.append(GuardDecision(i, kind, source_text, None, -1, REFERENCE_EXPLICIT_TARGET, False))
            continue

        domain = detect_domain(source_text, message_norm)
        compatible = _compatible(domain, all_candidates)
        n = len(compatible)

        if n == 1:
            kept_refs.append(ref)
            decisions.append(GuardDecision(i, kind, source_text, domain, n, REFERENCE_GROUNDED_UNIQUE, False))
            continue

        if n >= 2:
            remaining = _apply_explicit_disambiguation(message_norm, compatible)
            if len(remaining) == 1:
                kept_refs.append(ref)
                decisions.append(GuardDecision(i, kind, source_text, domain, n, REFERENCE_EXPLICIT_TARGET, False))
                continue
            any_invalidated = True
            invalidation_reasons.append(REFERENCE_MULTIPLE_VISIBLE_TARGETS)
            decisions.append(GuardDecision(i, kind, source_text, domain, n, REFERENCE_MULTIPLE_VISIBLE_TARGETS, True))
            continue

        # n == 0
        reason = REFERENCE_NO_VISIBLE_TARGET
        if domain is not None and any(c.cls != domain for c in all_candidates) and all_candidates:
            reason = REFERENCE_TYPE_MISMATCH
        any_invalidated = True
        invalidation_reasons.append(reason)
        decisions.append(GuardDecision(i, kind, source_text, domain, n, reason, True))

    if not any_invalidated:
        return GuardResult(interpretation=interpretation, decisions=decisions, changed_fields=[], activated=False)

    # Bounded correction (task §17) — touch only what's required to make the
    # interpretation safely unresolved. primaryIntent/entities/requestedAction/
    # workflowIntent are deliberately left untouched (see module docstring / report §4).
    new_interp = dict(interpretation)
    new_interp["references"] = kept_refs
    ambiguities = list(interpretation.get("ambiguities") or [])
    if not any(isinstance(a, dict) and a.get("field") == "reference" for a in ambiguities):
        reason_text = (
            "deterministic grounding guard: no visible candidate matches this reference"
            if REFERENCE_NO_VISIBLE_TARGET in invalidation_reasons or REFERENCE_TYPE_MISMATCH in invalidation_reasons
            else "deterministic grounding guard: multiple visible candidates, no explicit disambiguation"
        )
        ambiguities.append({"field": "reference", "reason": reason_text})
    new_interp["ambiguities"] = ambiguities
    new_interp["clarificationRequired"] = True
    existing_confidence = interpretation.get("confidence")
    floor = 0.3 if REFERENCE_NO_VISIBLE_TARGET in invalidation_reasons or REFERENCE_TYPE_MISMATCH in invalidation_reasons else 0.35
    new_interp["confidence"] = min(existing_confidence, floor) if isinstance(existing_confidence, (int, float)) else floor

    changed = ["references", "ambiguities", "clarificationRequired", "confidence"]
    return GuardResult(interpretation=new_interp, decisions=decisions, changed_fields=changed, activated=True)
