"""Anchor-text-based block locator.

After full-page OCR, this module finds known anchor labels
(e.g. "Segmental Lean Analysis") and defines ROI rectangles
*relative* to each anchor's bounding box.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
import re
import numpy as np

from .ocr_engine import OCRHit

# Each anchor maps a logical block name → (list of keywords, y_min_frac, y_max_frac)
# This helps avoid picking up the same word in different parts of the page.
# Header: look for ID, Gender, Height, Age at the very top
ANCHOR_DEFS: Dict[str, Tuple[List[str], float, float]] = {
    "header":             (["gender", "height", "age", "id", "male", "female"], 0.0, 0.12),
    "body_composition":   (["body composition", "composition"], 0.05, 0.30),
    "muscle_fat":         (["muscle-fat", "muscle fat"], 0.20, 0.45),
    "obesity":            (["obesity analysis", "obesity evaluation"], 0.30, 0.60),
    "segmental_lean":     (["segmental lean", "segmental"], 0.40, 0.65),
    "segmental_fat":      (["segmental fat", "segmental"], 0.40, 0.65),
}

# Distinguish between Lean and Fat by horizontal position if both use "segmental"
# Special logic will be added to locate_blocks for this.


@dataclass
class LocatedBlock:
    """A named block with its anchor bbox and expanded ROI."""
    name: str
    anchor_bbox: List[List[float]]         # original OCR bbox of the anchor text
    roi: Tuple[int, int, int, int]         # (x1, y1, x2, y2) in warped-image coords
    ocr_hits: List[OCRHit] = field(default_factory=list)


def _bbox_center(bbox: List[List[float]]) -> Tuple[float, float]:
    xs = [p[0] for p in bbox]
    ys = [p[1] for p in bbox]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def _bbox_top_left(bbox: List[List[float]]) -> Tuple[float, float]:
    return (min(p[0] for p in bbox), min(p[1] for p in bbox))


def _bbox_dims(bbox: List[List[float]]) -> Tuple[float, float]:
    """Return (width, height) of a bbox."""
    xs = [p[0] for p in bbox]
    ys = [p[1] for p in bbox]
    return (max(xs) - min(xs), max(ys) - min(ys))


def _find_anchor(hits: List[OCRHit], 
                 keywords: List[str], 
                 y_min_f: float, 
                 y_max_f: float,
                 img_h: int) -> Optional[OCRHit]:
    """Find the best anchor hit within the specified vertical range."""
    for bbox, text, conf in hits:
        text_lower = text.lower().strip()
        _, ay = _bbox_top_left(bbox)
        y_frac = ay / img_h
        
        if y_min_f <= y_frac <= y_max_f:
            for kw in keywords:
                if kw.lower() in text_lower:
                    print(f"DEBUG: Anchor Match Found! '{kw}' in '{text}' at y_frac={y_frac:.3f}")
                    return (bbox, text, conf)
    return None

def _find_anchor_with_x(hits: List[OCRHit], 
                        keywords: List[str], 
                        y_min_f: float, y_max_f: float,
                        x_min_f: float, x_max_f: float,
                        img_w: int, img_h: int) -> Optional[OCRHit]:
    """Find anchor hit with both x and y spatial constraints."""
    for bbox, text, conf in hits:
        text_lower = text.lower().strip()
        ax, ay = _bbox_top_left(bbox)
        y_frac = ay / img_h
        x_frac = ax / img_w
        
        if y_min_f <= y_frac <= y_max_f and x_min_f <= x_frac <= x_max_f:
            for kw in keywords:
                if kw.lower() in text_lower:
                    return (bbox, text, conf)
    return None


# ---------------------------------------------------------------------------
# ROI definitions relative to anchor
# ---------------------------------------------------------------------------
# For each block we define the ROI as an offset+size relative to the anchor's
# top-left corner.  Units are fractions of the *image* width (W) and height (H).
# Format: (dx_frac, dy_frac, w_frac, h_frac)
#   dx is shift right from anchor left edge  (negative = shift left)
#   dy is shift down  from anchor top edge   (negative = shift up)
#   w_frac, h_frac are the ROI size.

# ROI definitions relative to anchor (dx, dy, w, h)
# Be generous with height (h) to ensure we capture the full table/block.
ROI_SPEC: Dict[str, Tuple[float, float, float, float]] = {
    "header":             (-0.40, 0.0, 0.95, 0.12),
    "body_composition":   (-0.02, 0.02, 0.65, 0.25),
    "muscle_fat":         (-0.02, 0.02, 0.50, 0.20),
    "obesity":            (-0.02, 0.02, 0.50, 0.20),
    "segmental_lean":     (-0.02, 0.03, 0.35, 0.30),
    "segmental_fat":      (-0.02, 0.03, 0.35, 0.30),
}

# Wait, 0.30 is still too much. Let's use 0.25 for segmental.
ROI_SPEC["segmental_lean"] = (-0.02, 0.02, 0.35, 0.26)
ROI_SPEC["segmental_fat"]  = (-0.02, 0.02, 0.35, 0.26)


def locate_blocks(hits: List[OCRHit],
                  img_w: int, img_h: int) -> Dict[str, LocatedBlock]:
    """Locate all named blocks using anchor text from full-page OCR.

    Args:
        hits:  Full-page OCR results.
        img_w: Width of the (warped) image.
        img_h: Height of the (warped) image.

    Returns:
        Dictionary mapping block names to ``LocatedBlock``s.
    """
    blocks: Dict[str, LocatedBlock] = {}

    for block_name, (keywords, y_min, y_max) in ANCHOR_DEFS.items():
        # Custom logic for segmental to avoid picking the wrong one
        if block_name == "segmental_lean":
            anchor_hit = _find_anchor_with_x(hits, keywords, y_min, y_max, 0.0, 0.3, img_w, img_h)
        elif block_name == "segmental_fat":
            anchor_hit = _find_anchor_with_x(hits, keywords, y_min, y_max, 0.3, 0.8, img_w, img_h)
        else:
            anchor_hit = _find_anchor(hits, keywords, y_min, y_max, img_h)

        if anchor_hit is None:
            # Fallback for header: Just take the very top region
            if block_name == "header":
                # Hard fallback: Fixed ROI at the top 10%
                blocks["header"] = LocatedBlock(
                    name="header",
                    anchor_bbox=[[0,0],[0,0],[0,0],[0,0]],
                    roi=(0, 0, img_w, int(0.12 * img_h))
                )
                continue
            
        if anchor_hit is None:
            continue
            
        bbox, text, conf = anchor_hit
        ax, ay = _bbox_top_left(bbox)

        spec = ROI_SPEC.get(block_name)
        if spec is None:
            continue
        dx_f, dy_f, w_f, h_f = spec

        x1 = int(ax + dx_f * img_w)
        y1 = int(ay + dy_f * img_h)
        x2 = int(x1 + w_f * img_w)
        y2 = int(y1 + h_f * img_h)

        # Clamp to image bounds.
        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(img_w, x2)
        y2 = min(img_h, y2)

        blocks[block_name] = LocatedBlock(
            name=block_name,
            anchor_bbox=bbox,
            roi=(x1, y1, x2, y2),
        )

    return blocks


def collect_hits_in_roi(all_hits: List[OCRHit],
                        roi: Tuple[int, int, int, int]) -> List[OCRHit]:
    """Filter OCR hits whose centre falls inside the given ROI."""
    x1, y1, x2, y2 = roi
    result: List[OCRHit] = []
    for bbox, text, conf in all_hits:
        cx, cy = _bbox_center(bbox)
        if x1 <= cx <= x2 and y1 <= cy <= y2:
            result.append((bbox, text, conf))
    return result
