"""Regex + rule-based parsers for each InBody block.

Each parser receives the list of OCR hits within a block ROI
and returns extracted numeric values.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

from .ocr_engine import OCRHit
from .models import SegmentalAnalysis

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _first_float(text: str) -> Optional[float]:
    """Extract actual value, skipping numbers in parentheses or ranges."""
    # Replace comma with dot
    text = text.replace(",", ".")
    
    # Remove ranges like (7.9 ~ 15.8) or (55.8 ~ 75.7)
    text = re.sub(r"\(.*?\)", "", text)
    text = re.sub(r"\d+\.?\d*\s*~\s*\d+\.?\d*", "", text)

    m = re.search(r"(\d+\.?\d*)", text)
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            return None
    return None


def _all_floats(text: str) -> List[float]:
    """Extract all float-like numbers from *text*."""
    text = text.replace(",", ".")
    def _to_f(s):
        try: return float(s)
        except: return None
    return [v for v in (_to_f(m) for m in re.findall(r"\d+\.?\d*", text)) if v is not None]


def _find_value_near_label(hits: List[OCRHit],
                           label_keywords: List[str]) -> Optional[float]:
    """Find a numeric value in/near a hit that contains one of *label_keywords*.

    Strategy:
      1. If the label hit itself contains a number after the keyword → use it.
      2. Otherwise, look at the next hit to the right or below.
    """
    for i, (bbox, text, conf) in enumerate(hits):
        text_lower = text.lower()
        for kw in label_keywords:
            if kw in text_lower:
                # Try to grab the number from the same hit text.
                # Remove the keyword portion and extract a number.
                after = text_lower.split(kw)[-1]
                val = _first_float(after)
                if val is not None:
                    return val
                # Try full text (sometimes label and value are joined).
                val = _first_float(text)
                if val is not None:
                    return val
                # Look at subsequent hits (sorted by y, then x).
                for j in range(i + 1, min(i + 4, len(hits))):
                    val = _first_float(hits[j][1])
                    if val is not None:
                        return val
    return None


# ---------------------------------------------------------------------------
# Header parser
# ---------------------------------------------------------------------------

def parse_header(hits: List[OCRHit]) -> Dict[str, Optional[float]]:
    """Extract height from the header region."""
    result: Dict[str, Optional[float]] = {"height": None}
    all_text = " ".join(h[1] for h in hits).lower()

    # Height: look for "173cm", "173 cm", "173m", "173 m"
    m = re.search(r"(\d{2,3})\s*(cm|m\b|crn|cr|cn)", all_text)
    if m:
        val = float(m.group(1))
        if 100 < val < 250: # Standard human height range in cm
            result["height"] = val
    
    if result["height"] is None:
        result["height"] = _find_value_near_label(hits, ["height"])

    return result


# ---------------------------------------------------------------------------
# Body Composition parser
# ---------------------------------------------------------------------------

def parse_body_composition(hits: List[OCRHit]) -> Dict[str, Optional[float]]:
    """Extract weight and body fat mass from Body Composition Analysis."""
    result: Dict[str, Optional[float]] = {
        "weight": None,
        "body_fat_mass": None,
    }

    all_text = " ".join(h[1] for h in hits).lower()

    # Weight: last row with "Weight" label + kg value
    result["weight"] = _find_value_near_label(
        hits, ["weight"])

    # Body Fat Mass
    result["body_fat_mass"] = _find_value_near_label(
        hits, ["body fat mass", "fat mass"])

    return result


# ---------------------------------------------------------------------------
# Muscle-Fat Analysis parser
# ---------------------------------------------------------------------------

def parse_muscle_fat(hits: List[OCRHit]) -> Dict[str, Optional[float]]:
    """Extract Weight, SMM, and Body Fat Mass from Muscle-Fat Analysis block."""
    result: Dict[str, Optional[float]] = {
        "weight": None,
        "skeletal_muscle_mass": None,
        "body_fat_mass": None,
    }

    for bbox, text, conf in hits:
        text_lower = text.lower()
        # Weight row  (e.g. "77.3")
        if "weight" in text_lower and "target" not in text_lower:
            val = _first_float(text)
            if val and val > 20:
                result["weight"] = val

        # SMM row
        if "smm" in text_lower or "skeletal" in text_lower:
            val = _first_float(text.split(")")[-1] if ")" in text else text)
            if val is None:
                val = _first_float(text)
            if val and 15 < val < 60:
                result["skeletal_muscle_mass"] = val

        # Body Fat Mass - avoid picking up "Fat Control" or "Visceral Fat"
        if ("fat mass" in text_lower or "body fat" in text_lower) and "control" not in text_lower and "visceral" not in text_lower:
            val = _first_float(text)
            if val and 2 < val < 100:
                result["body_fat_mass"] = val

    # Fallback: look at hits that are purely numeric near the expected y-coords.
    # Sort by vertical position to get the three rows: Weight, SMM, Fat Mass.
    numeric_hits = []
    for bbox, text, conf in hits:
        nums = _all_floats(text)
        if nums:
            cy = sum(p[1] for p in bbox) / 4
            numeric_hits.append((cy, nums, text))
    numeric_hits.sort(key=lambda x: x[0])

    # The Muscle-Fat Analysis block typically has 3 bar rows:
    # Row 0 = Weight, Row 1 = SMM, Row 2 = Body Fat Mass.
    if result["weight"] is None and len(numeric_hits) >= 1:
        for num in numeric_hits[0][1]:
            if 20 < num < 300:
                result["weight"] = num
                break

    if result["skeletal_muscle_mass"] is None and len(numeric_hits) >= 2:
        for num in numeric_hits[1][1]:
            if 10 < num < 80:
                result["skeletal_muscle_mass"] = num
                break

    if result["body_fat_mass"] is None and len(numeric_hits) >= 3:
        for num in numeric_hits[2][1]:
            if 1 < num < 100:
                result["body_fat_mass"] = num
                break

    return result


# ---------------------------------------------------------------------------
# Segmental analysis parsers
# ---------------------------------------------------------------------------

def _parse_segmental_block(hits: List[OCRHit],
                           is_fat: bool = False) -> SegmentalAnalysis:
    """Parse a segmental analysis block (lean or fat).

    InBody270 layout (as viewed on the page):
        Left-arm value    Right-arm value       ← top row
              Trunk value                       ← middle row
        Left-leg value    Right-leg value       ← bottom row

    Each value line looks like "3.68 kg" or "3.68kg" optionally followed
    by percentage and "Normal"/"Over"/"Under".  We only want the kg number.
    """
    # Collect (cx, cy, kg_value) for all kg-bearing hits.
    kg_points: List[Tuple[float, float, float]] = []

    for bbox, text, conf in hits:
        text_clean = text.strip().replace(",", ".")
        # Skip labels like "Normal", "Over", "Under", "%", "Evaluation".
        if re.match(r"^(normal|over|under|left|right|evaluation|lean|fat|mass|%)", text_clean, re.I):
            continue

        # Look for "X.X kg" (handling "ka", "k.g", "k9") or just "X.X" (if it looks like a value)
        val = None
        # Pattern for numeric value with common "kg" OCR misreadings
        m_kg = re.search(r"(\d+\.?\d*)\s*(k|i[gq9a8s]|k[gq9a8s]|k\.|ka)", text_clean, re.I)
        if m_kg:
            val = float(m_kg.group(1))
        else:
            # Fallback 1: Hits with decimal points "3.61"
            m_num = re.search(r"(\d+\.\d+)", text_clean)
            if m_num:
                f_val = float(m_num.group(1))
                if 1.0 < f_val < 50.0:
                    val = f_val
            else:
                # Fallback 2: Integer hits that look like misread decimals "368" -> 3.68
                m_int = re.search(r"(\d{3,4})", text_clean)
                if m_int:
                    i_val = int(m_int.group(1))
                    if 100 < i_val < 5000:
                        val = i_val / 100.0

        if val is not None:
            cx, cy = (sum(p[0] for p in bbox) / 4, sum(p[1] for p in bbox) / 4)
            kg_points.append((cx, cy, val))

    if not kg_points:
        return SegmentalAnalysis()

    # Determine bounding box of all kg_points.
    all_cx = [p[0] for p in kg_points]
    all_cy = [p[1] for p in kg_points]
    min_x, max_x = min(all_cx), max(all_cx)
    min_y, max_y = min(all_cy), max(all_cy)
    range_x = max_x - min_x if max_x > min_x else 1.0
    range_y = max_y - min_y if max_y > min_y else 1.0
    mid_x = (min_x + max_x) / 2

    # Classify each point into one of 5 positions:
    #   top-left, top-right, middle-center, bottom-left, bottom-right
    left_arm = None
    right_arm = None
    trunk = None
    left_leg = None
    right_leg = None

    for cx, cy, val in kg_points:
        rel_y = (cy - min_y) / range_y   # 0=top, 1=bottom
        is_left = cx < mid_x
        is_center = abs(cx - mid_x) / range_x < 0.25

        if rel_y < 0.35:
            # Top row → arms
            if is_left:
                left_arm = val
            else:
                right_arm = val
        elif rel_y < 0.65:
            # Middle → trunk
            if trunk is None or is_center:
                trunk = val
        else:
            # Bottom row → legs
            if is_left:
                left_leg = val
            else:
                right_leg = val

    return SegmentalAnalysis(
        right_arm_muscle=right_arm,
        left_arm_muscle=left_arm,
        trunk_muscle=trunk,
        right_leg_muscle=right_leg,
        left_leg_muscle=left_leg,
    )


def parse_segmental_lean(hits: List[OCRHit]) -> SegmentalAnalysis:
    return _parse_segmental_block(hits, is_fat=False)


def parse_segmental_fat(hits: List[OCRHit]) -> SegmentalAnalysis:
    return _parse_segmental_block(hits, is_fat=True)
