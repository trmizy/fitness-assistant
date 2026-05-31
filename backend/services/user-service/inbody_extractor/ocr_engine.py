"""OCR engine with Tesseract support and line merging.

Provides full-page and region-based OCR with hit merging
for multi-word phrase detection.
"""
from __future__ import annotations

import os
import cv2
import numpy as np
import pytesseract
from PIL import Image
from typing import List, Tuple, Dict

# Auto-detect Tesseract on Windows
TESSERACT_PATH = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
if os.path.exists(TESSERACT_PATH):
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH

# Each OCR hit: (bbox_4pts, text, confidence)
OCRHit = Tuple[List[List[float]], str, float]


def ocr_full_image(img: np.ndarray, psm: int = 3) -> List[OCRHit]:
    """Run Tesseract OCR on entire image. Returns word-level hits."""
    if len(img.shape) == 2:
        pil_img = Image.fromarray(img)
    else:
        pil_img = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))

    config = f"--psm {psm}"
    data = pytesseract.image_to_data(
        pil_img, config=config, output_type=pytesseract.Output.DICT)

    hits: List[OCRHit] = []
    for i in range(len(data['text'])):
        text = data['text'][i].strip()
        try:
            conf = float(data['conf'][i])
        except (ValueError, TypeError):
            conf = -1.0
        if text and conf > 0:
            x, y, w, h = (data['left'][i], data['top'][i],
                          data['width'][i], data['height'][i])
            bbox = [
                [float(x), float(y)],
                [float(x + w), float(y)],
                [float(x + w), float(y + h)],
                [float(x), float(y + h)],
            ]
            hits.append((bbox, text, conf / 100.0))
    return hits


def ocr_region(img: np.ndarray, x1: int, y1: int, x2: int, y2: int,
               psm: int = 6, binarize: bool = False) -> List[OCRHit]:
    """OCR a sub-region with auto-upscaling and optional binarization.

    Returns hits with coordinates mapped back to the full image.
    """
    h_img, w_img = img.shape[:2]
    x1, y1 = max(0, int(x1)), max(0, int(y1))
    x2, y2 = min(w_img, int(x2)), min(h_img, int(y2))
    if x2 <= x1 or y2 <= y1:
        return []

    crop = img[y1:y2, x1:x2].copy()

    # Auto-upscale small crops for better OCR
    crop_h, crop_w = crop.shape[:2]
    if crop_w < 600 or crop_h < 400:
        scale = 3.0
    elif crop_w < 1000:
        scale = 2.0
    else:
        scale = 1.0

    if scale > 1.0:
        crop = cv2.resize(crop, None, fx=scale, fy=scale,
                          interpolation=cv2.INTER_CUBIC)

    # Convert to grayscale for cleaner OCR
    if len(crop.shape) == 3:
        crop = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

    hits = ocr_full_image(crop, psm=psm)

    # Map coordinates back to original image space
    inv_scale = 1.0 / scale
    mapped: List[OCRHit] = []
    for bbox, text, conf in hits:
        shifted = [[p[0] * inv_scale + x1, p[1] * inv_scale + y1]
                   for p in bbox]
        mapped.append((shifted, text, conf))
    return mapped


# -----------------------------------------------------------------------
# Line merging — groups word-level hits into logical lines
# -----------------------------------------------------------------------

def merge_hits_to_lines(hits: List[OCRHit],
                        y_tolerance: float = 15.0) -> List[Dict]:
    """Group word-level hits into logical lines by y-coordinate proximity.

    Returns list of dicts sorted top-to-bottom:
        {'text': str, 'y': float, 'x': float, 'hits': List[OCRHit]}
    """
    if not hits:
        return []

    sorted_hits = sorted(hits, key=lambda h: (
        sum(p[1] for p in h[0]) / 4,
        sum(p[0] for p in h[0]) / 4,
    ))

    lines: List[Dict] = []
    current_line: List[OCRHit] = [sorted_hits[0]]
    current_y = sum(p[1] for p in sorted_hits[0][0]) / 4

    for hit in sorted_hits[1:]:
        hit_y = sum(p[1] for p in hit[0]) / 4
        if abs(hit_y - current_y) <= y_tolerance:
            current_line.append(hit)
        else:
            _finalize_line(lines, current_line)
            current_line = [hit]
            current_y = hit_y

    _finalize_line(lines, current_line)
    return lines


def _finalize_line(lines: List[Dict], hits: List[OCRHit]):
    """Build a merged line dict from a group of same-row hits."""
    sorted_h = sorted(hits, key=lambda h: sum(p[0] for p in h[0]) / 4)
    text = " ".join(h[1] for h in sorted_h)
    avg_y = sum(sum(p[1] for p in h[0]) / 4 for h in sorted_h) / len(sorted_h)
    min_x = min(min(p[0] for p in h[0]) for h in sorted_h)
    lines.append({'text': text, 'y': avg_y, 'x': min_x, 'hits': sorted_h})


def hits_to_text(hits: List[OCRHit]) -> str:
    """Concatenate all OCR hits into newline-separated text."""
    return "\n".join(h[1] for h in hits)
