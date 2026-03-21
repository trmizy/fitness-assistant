"""Range-based validation and confidence scoring."""
from __future__ import annotations

from typing import Dict, Optional, Tuple

from .models import InBodyResult, SegmentalConfidence

# ---------------------------------------------------------------------------
# Acceptable ranges  (min, max)
# ---------------------------------------------------------------------------
RANGES: Dict[str, Tuple[float, float]] = {
    "height":               (100, 250),
    "weight":               (20, 300),
    "skeletal_muscle_mass": (10, 80),
    "body_fat_mass":        (1, 100),
    # segmental lean
    "lean_arm":             (0.5, 10),
    "lean_trunk":           (10, 60),
    "lean_leg":             (3, 20),
    # segmental fat
    "fat_arm":              (0, 10),
    "fat_trunk":            (0, 50),
    "fat_leg":              (0, 15),
}


def _score(value: Optional[float], lo: float, hi: float) -> Optional[float]:
    """Return confidence 0–1 for a value given acceptable range."""
    if value is None:
        return None
    if lo <= value <= hi:
        return 0.95                       # solidly in range
    # Give partial credit within 20% margin.
    margin = (hi - lo) * 0.2
    if lo - margin <= value <= hi + margin:
        return 0.5                        # borderline
    return 0.1                            # likely OCR error


def _nullify_if_garbage(value: Optional[float],
                        lo: float, hi: float) -> Optional[float]:
    """Set to None only if WAY outside range (>50% margin)."""
    if value is None:
        return None
    margin = (hi - lo) * 0.5
    if lo - margin <= value <= hi + margin:
        return value
    return None                           # almost certainly OCR noise


def validate(result: InBodyResult) -> InBodyResult:
    """Apply range checks and compute confidence scores *in-place*.

    Returns the same result object (mutated).
    """
    r = RANGES

    # --- Scalar fields -------------------------------------------------------
    for field_name in ("height", "weight", "skeletal_muscle_mass", "body_fat_mass"):
        lo, hi = r[field_name]
        val = getattr(result, field_name)
        conf = _score(val, lo, hi)
        setattr(result.confidence, field_name, conf)
        setattr(result, field_name, _nullify_if_garbage(val, lo, hi))

    # --- Segmental lean -------------------------------------------------------
    lean = result.segmental_lean_analysis
    lean_conf = SegmentalConfidence()

    for part, range_key in [
        ("right_arm_muscle", "lean_arm"),
        ("left_arm_muscle",  "lean_arm"),
        ("trunk_muscle",     "lean_trunk"),
        ("right_leg_muscle", "lean_leg"),
        ("left_leg_muscle",  "lean_leg"),
    ]:
        lo, hi = r[range_key]
        val = getattr(lean, part)
        setattr(lean_conf, part, _score(val, lo, hi))
        setattr(lean, part, _nullify_if_garbage(val, lo, hi))

    result.confidence.segmental_lean_analysis = lean_conf

    # --- Segmental fat --------------------------------------------------------
    fat = result.segmental_fat_analysis
    fat_conf = SegmentalConfidence()

    for part, range_key in [
        ("right_arm_muscle", "fat_arm"),
        ("left_arm_muscle",  "fat_arm"),
        ("trunk_muscle",     "fat_trunk"),
        ("right_leg_muscle", "fat_leg"),
        ("left_leg_muscle",  "fat_leg"),
    ]:
        lo, hi = r[range_key]
        val = getattr(fat, part)
        setattr(fat_conf, part, _score(val, lo, hi))
        setattr(fat, part, _nullify_if_garbage(val, lo, hi))

    result.confidence.segmental_fat_analysis = fat_conf

    return result
