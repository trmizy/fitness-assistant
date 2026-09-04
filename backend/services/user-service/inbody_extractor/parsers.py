"""Regex + rule-based parsers for each InBody block.

Uses line merging so multi-word labels like "Body Fat Mass" and "SMM"
are matched reliably even when Tesseract returns one word per hit.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

from .ocr_engine import OCRHit, merge_hits_to_lines
from .models import SegmentalAnalysis

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _all_floats(text: str) -> List[float]:
    """Extract all float-like numbers from *text*,
    ignoring numbers inside parenthesized ranges like (7.9~15.8)."""
    text = text.replace(",", ".")
    # Remove parenthesized content and tilde ranges
    text = re.sub(r"\([^)]*\)", "", text)
    text = re.sub(r"\d+\.?\d*\s*~\s*\d+\.?\d*", "", text)
    results: List[float] = []
    for m in re.findall(r"\d+\.?\d*", text):
        try:
            results.append(float(m))
        except ValueError:
            pass
    return results


# ---------------------------------------------------------------------------
# Header parser
# ---------------------------------------------------------------------------

def parse_header(hits: List[OCRHit]) -> Dict[str, Optional[float]]:
    """Extract height from the header region."""
    result: Dict[str, Optional[float]] = {"height": None}
    all_text = " ".join(h[1] for h in hits).lower()

    # Pattern: "173cm", "173 cm", "173crn" (OCR misread)
    m = re.search(r"(\d{2,3})\s*(cm|crn|cr[nm]|c[nm])", all_text)
    if m:
        val = float(m.group(1))
        if 100 < val < 250:
            result["height"] = val

    if result["height"] is None:
        # Fallback: find number near "height" keyword
        lines = merge_hits_to_lines(hits)
        for line in lines:
            if "height" in line['text'].lower():
                for n in _all_floats(line['text']):
                    if 100 < n < 250:
                        result["height"] = n
                        break
                if result["height"]:
                    break

    return result


# ---------------------------------------------------------------------------
# Body Composition parser
# ---------------------------------------------------------------------------

def parse_body_composition(hits: List[OCRHit]) -> Dict[str, Optional[float]]:
    """Extract weight and body_fat_mass from Body Composition Analysis."""
    result: Dict[str, Optional[float]] = {"weight": None, "body_fat_mass": None}
    lines = merge_hits_to_lines(hits, y_tolerance=12)

    # Body Fat Mass — must come before Weight to avoid "Weight Control"
    # matching the word "Weight" in a Fat-related line.
    for line in lines:
        t = line['text'].lower()
        if ('fat mass' in t or 'body fat' in t) and \
           'control' not in t and 'visceral' not in t:
            for n in _all_floats(line['text']):
                if 1 < n < 100:
                    result["body_fat_mass"] = n
                    break
            if result["body_fat_mass"]:
                break

    # Weight — line with "weight" but NOT "target" or "control"
    for line in lines:
        t = line['text'].lower()
        if 'weight' in t and 'target' not in t and 'control' not in t:
            for n in _all_floats(line['text']):
                if 20 < n < 300:
                    result["weight"] = n
                    break
            if result["weight"]:
                break

    return result


# ---------------------------------------------------------------------------
# Muscle-Fat Analysis parser
# ---------------------------------------------------------------------------

def parse_muscle_fat(hits: List[OCRHit]) -> Dict[str, Optional[float]]:
    """Extract Weight, SMM, Body Fat Mass from Muscle-Fat Analysis block.

    This block has 3 horizontal bar rows (top→bottom):
        Weight (kg)         →  value on the right
        SMM (kg)            →  value on the right
        Body Fat Mass (kg)  →  value on the right
    """
    result: Dict[str, Optional[float]] = {
        "weight": None,
        "skeletal_muscle_mass": None,
        "body_fat_mass": None,
    }
    lines = merge_hits_to_lines(hits, y_tolerance=12)

    # Strategy 1: keyword-based line parsing
    for line in lines:
        t = line['text'].lower()

        if 'weight' in t and 'target' not in t and result["weight"] is None:
            for n in reversed(_all_floats(line['text'])):
                if 20 < n < 300:
                    result["weight"] = n
                    break

        if ('smm' in t or 'skeletal' in t) and \
           result["skeletal_muscle_mass"] is None:
            for n in reversed(_all_floats(line['text'])):
                if 10 < n < 80:
                    result["skeletal_muscle_mass"] = n
                    break

        if ('fat mass' in t or 'body fat' in t) and \
           'control' not in t and 'visceral' not in t and \
           result["body_fat_mass"] is None:
            for n in reversed(_all_floats(line['text'])):
                if 1 < n < 100:
                    result["body_fat_mass"] = n
                    break

    # Strategy 2: positional fallback
    # The 3 bar rows always appear top-to-bottom: Weight, SMM, Fat Mass.
    # Find lines whose rightmost large number is a plausible metric value.
    if any(v is None for v in result.values()):
        value_rows: List[Tuple[float, float]] = []   # (y, value)
        last_y = -100.0
        for line in lines:
            nums = _all_floats(line['text'])
            big = [n for n in nums if n > 10]
            if big and abs(line['y'] - last_y) > 20:
                value_rows.append((line['y'], max(big)))
                last_y = line['y']

        value_rows.sort(key=lambda x: x[0])

        if result["weight"] is None and len(value_rows) >= 1:
            v = value_rows[0][1]
            if 20 < v < 300:
                result["weight"] = v

        if result["skeletal_muscle_mass"] is None and len(value_rows) >= 2:
            v = value_rows[1][1]
            if 10 < v < 80:
                result["skeletal_muscle_mass"] = v

        if result["body_fat_mass"] is None and len(value_rows) >= 3:
            v = value_rows[2][1]
            if 1 < v < 100:
                result["body_fat_mass"] = v

    return result


# ---------------------------------------------------------------------------
# Segmental analysis parsers
# ---------------------------------------------------------------------------

def _parse_segmental_block(hits: List[OCRHit],
                           is_fat: bool = False) -> SegmentalAnalysis:
    """Parse a segmental analysis block (lean or fat).

    InBody 270 layout (as labeled on the sheet):
        Left-arm value     Right-arm value       ← top row
               Trunk value                       ← middle row
        Left-leg value     Right-leg value        ← bottom row

    We extract only kg values, skipping percentages (>100) and labels.
    """
    kg_points: List[Tuple[float, float, float]] = []   # (cx, cy, value)

    for bbox, text, conf in hits:
        text_clean = text.strip().replace(",", ".")

        # Skip obvious labels
        if re.match(
            r"^(normal|over|under|left|right|evaluation|lean|fat|"
            r"mass|segmental|analysis|estimated|history|body|"
            r"composition|kg|%|\*)",
            text_clean, re.I,
        ):
            continue

        # Skip anything with a percentage sign
        if "%" in text_clean:
            continue

        val = None

        # Pattern 1: number followed by "kg" or OCR variants (ka, k9, …)
        m = re.search(
            r"(\d+\.?\d*)\s*(kg|k[gq9a8s]|ka|k\b)", text_clean, re.I)
        if m:
            val = float(m.group(1))

        if val is None:
            # Pattern 2: standalone decimal "3.68", "27.9", "9.01"
            m = re.search(r"(\d+\.\d{1,2})", text_clean)
            if m:
                f_val = float(m.group(1))
                if f_val > 100:       # definitely a percentage
                    pass
                elif is_fat and 0.1 <= f_val <= 50.0:
                    val = f_val
                elif not is_fat and 0.3 <= f_val <= 60.0:
                    val = f_val

        if val is None:
            # Pattern 3: misread integer "368" → 3.68
            m = re.search(r"^(\d{3,4})$", text_clean)
            if m:
                candidate = int(m.group(1)) / 100.0
                if is_fat and 0.1 <= candidate <= 50.0:
                    val = candidate
                elif not is_fat and 0.3 <= candidate <= 60.0:
                    val = candidate

        if val is not None:
            cx = sum(p[0] for p in bbox) / 4
            cy = sum(p[1] for p in bbox) / 4
            kg_points.append((cx, cy, val))

    if not kg_points:
        return SegmentalAnalysis()

    # ---- Classify each point into one of 5 body positions ----
    all_cx = [p[0] for p in kg_points]
    all_cy = [p[1] for p in kg_points]
    min_x, max_x = min(all_cx), max(all_cx)
    min_y, max_y = min(all_cy), max(all_cy)
    range_x = max_x - min_x if max_x > min_x else 1.0
    range_y = max_y - min_y if max_y > min_y else 1.0
    mid_x = (min_x + max_x) / 2

    left_arm = None
    right_arm = None
    trunk = None
    left_leg = None
    right_leg = None

    for cx, cy, val in kg_points:
        rel_y = (cy - min_y) / range_y
        is_left = cx < mid_x
        is_center = abs(cx - mid_x) / range_x < 0.25 if range_x > 1 else True

        if rel_y < 0.33:
            # Top row → arms
            if is_left:
                left_arm = val
            else:
                right_arm = val
        elif rel_y < 0.66:
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
