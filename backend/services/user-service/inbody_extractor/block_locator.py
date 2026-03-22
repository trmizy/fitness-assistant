"""Anchor-text-based block locator with template fallback positions.

After full-page OCR, finds section labels (multi-word anchors via line
merging) and defines ROI rectangles relative to each anchor.
If an anchor is not found, falls back to template-based positions
for the InBody 270 standard layout.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .ocr_engine import OCRHit, merge_hits_to_lines


@dataclass
class LocatedBlock:
    """A named block with its anchor bbox and expanded ROI."""
    name: str
    anchor_bbox: List[List[float]]
    roi: Tuple[int, int, int, int]          # (x1, y1, x2, y2)
    ocr_hits: List[OCRHit] = field(default_factory=list)


# -----------------------------------------------------------------------
# Template fallback ROIs (fractions of canonical image) for InBody 270
# Format: (x1_frac, y1_frac, x2_frac, y2_frac)
# -----------------------------------------------------------------------
TEMPLATE_ROIS: Dict[str, Tuple[float, float, float, float]] = {
    "header":           (0.00, 0.00, 0.60, 0.10),
    "body_composition": (0.00, 0.06, 0.55, 0.28),
    "muscle_fat":       (0.00, 0.27, 0.55, 0.42),
    "segmental_lean":   (0.00, 0.53, 0.38, 0.70),
    "segmental_fat":    (0.30, 0.53, 0.62, 0.70),
}

# Anchor definitions: name → (keywords, y_min_frac, y_max_frac)
ANCHOR_DEFS: Dict[str, Tuple[List[str], float, float]] = {
    "header":           (["height", "gender", "age"], 0.0, 0.10),
    "body_composition": (["body composition", "composition analysis"], 0.05, 0.20),
    "muscle_fat":       (["muscle-fat", "muscle fat"], 0.20, 0.40),
    "segmental_lean":   (["segmental lean"], 0.45, 0.65),
    "segmental_fat":    (["segmental fat"], 0.45, 0.65),
}

# ROI offset+size from anchor: (dx, dy, w, h) as fractions of image dims
ROI_FROM_ANCHOR: Dict[str, Tuple[float, float, float, float]] = {
    "header":           (-0.02, -0.01, 0.55, 0.06),
    "body_composition": (-0.02,  0.00, 0.55, 0.16),
    "muscle_fat":       (-0.02,  0.00, 0.55, 0.13),
    "segmental_lean":   (-0.02,  0.01, 0.38, 0.16),
    "segmental_fat":    (-0.02,  0.01, 0.38, 0.16),
}


def _find_anchor_in_lines(lines: List[Dict],
                          keywords: List[str],
                          y_min_f: float, y_max_f: float,
                          img_h: int,
                          x_min_f: float = 0.0,
                          x_max_f: float = 1.0,
                          img_w: int = 1) -> Optional[Dict]:
    """Find the first merged line whose text contains one of *keywords*
    and whose position falls within the spatial bounds.

    When x-constraints are active, checks each individual hit's x-position
    rather than the line's leftmost x — this prevents issues when two
    section titles share the same y-coordinate (e.g. "Segmental Lean
    Analysis" and "Segmental Fat Analysis" on the same line).
    """
    use_hit_x = (x_min_f > 0.01 or x_max_f < 0.99)

    for line in lines:
        y_frac = line['y'] / img_h
        if not (y_min_f <= y_frac <= y_max_f):
            continue

        text_lower = line['text'].lower()
        for kw in keywords:
            if kw in text_lower:
                if not use_hit_x:
                    return line
                # Check x at individual-hit level using the first
                # word of the keyword (handles multi-word keywords
                # like "segmental lean" matched against word-level hits)
                kw_first = kw.split()[0]
                for hit in line['hits']:
                    if kw_first in hit[1].lower():
                        hit_x = min(p[0] for p in hit[0])
                        if x_min_f <= hit_x / img_w <= x_max_f:
                            return {
                                'text': line['text'],
                                'y': line['y'],
                                'x': hit_x,
                                'hits': line['hits'],
                            }
    return None


def locate_blocks(hits: List[OCRHit],
                  img_w: int, img_h: int) -> Dict[str, LocatedBlock]:
    """Locate all named blocks using anchor text with template fallbacks.

    1. Merge word-level OCR hits into logical lines (enables multi-word
       anchor matching such as "Segmental Lean").
    2. For each block, try to find its anchor line within spatial bounds.
    3. If found → compute ROI relative to anchor position.
    4. If not found → use template-based fallback position.
    """
    lines = merge_hits_to_lines(hits, y_tolerance=15.0)
    blocks: Dict[str, LocatedBlock] = {}

    for block_name, (keywords, y_min, y_max) in ANCHOR_DEFS.items():
        # Segmental lean/fat need x-constraints to differentiate
        if block_name == "segmental_lean":
            anchor = _find_anchor_in_lines(
                lines, keywords, y_min, y_max, img_h, 0.0, 0.35, img_w)
        elif block_name == "segmental_fat":
            anchor = _find_anchor_in_lines(
                lines, keywords, y_min, y_max, img_h, 0.25, 0.70, img_w)
        else:
            anchor = _find_anchor_in_lines(
                lines, keywords, y_min, y_max, img_h, 0.0, 1.0, img_w)

        if anchor is not None:
            # Build ROI from anchor position
            ax, ay = anchor['x'], anchor['y']
            dx_f, dy_f, w_f, h_f = ROI_FROM_ANCHOR[block_name]
            x1 = int(ax + dx_f * img_w)
            y1 = int(ay + dy_f * img_h)
            x2 = int(x1 + w_f * img_w)
            y2 = int(y1 + h_f * img_h)
            anchor_bbox = (anchor['hits'][0][0]
                           if anchor['hits'] else [[0, 0]] * 4)
        else:
            # Fallback to template position
            tmpl = TEMPLATE_ROIS.get(block_name)
            if tmpl is None:
                continue
            x1 = int(tmpl[0] * img_w)
            y1 = int(tmpl[1] * img_h)
            x2 = int(tmpl[2] * img_w)
            y2 = int(tmpl[3] * img_h)
            anchor_bbox = [[0, 0]] * 4

        # Clamp to image bounds
        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(img_w, x2)
        y2 = min(img_h, y2)

        blocks[block_name] = LocatedBlock(
            name=block_name,
            anchor_bbox=anchor_bbox,
            roi=(x1, y1, x2, y2),
        )

    return blocks


def collect_hits_in_roi(all_hits: List[OCRHit],
                        roi: Tuple[int, int, int, int]) -> List[OCRHit]:
    """Filter OCR hits whose centre falls inside the given ROI."""
    x1, y1, x2, y2 = roi
    result: List[OCRHit] = []
    for bbox, text, conf in all_hits:
        cx = sum(p[0] for p in bbox) / 4
        cy = sum(p[1] for p in bbox) / 4
        if x1 <= cx <= x2 and y1 <= cy <= y2:
            result.append((bbox, text, conf))
    return result
