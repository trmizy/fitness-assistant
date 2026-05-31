"""Main pipeline orchestrator.

Usage:
    from inbody_extractor import extract_inbody_metrics
    result = extract_inbody_metrics("photo.jpg", debug=True)
    print(result.model_dump_json(indent=2))
"""
from __future__ import annotations

import os
import re
import cv2
from typing import List, Optional, Tuple

from .models import InBodyResult, RawOCR, DebugInfo
from .detect_document import detect_and_warp
from .ocr_engine import ocr_full_image, ocr_region, hits_to_text, OCRHit
from .block_locator import locate_blocks
from .parsers import (
    parse_header,
    parse_body_composition,
    parse_muscle_fat,
    parse_segmental_lean,
    parse_segmental_fat,
)
from .validators import validate
from .debug_utils import (
    save_warped,
    save_annotated,
    save_raw_ocr,
    save_block_crop,
)


# -----------------------------------------------------------------------
# EasyOCR for segmental blocks (lazy-loaded)
# -----------------------------------------------------------------------

_easyocr_reader = None
_easyocr_available: Optional[bool] = None


def _get_easyocr_reader():
    """Lazy-load EasyOCR reader. Returns None if easyocr is not installed."""
    global _easyocr_reader, _easyocr_available
    if _easyocr_available is False:
        return None
    if _easyocr_reader is None:
        try:
            import easyocr
            _easyocr_reader = easyocr.Reader(['en'], gpu=False, verbose=False)
            _easyocr_available = True
        except ImportError:
            _easyocr_available = False
            return None
    return _easyocr_reader


def _clean_ocr_text(text: str) -> str:
    """Normalize EasyOCR text for better number extraction."""
    text = text.replace(",", ".")
    # Collapse spaces around decimal points: "3. 68" → "3.68", "27 . 5" → "27.5"
    text = re.sub(r"(\d)\s*\.\s*(\d)", r"\1.\2", text)
    # Fix double dots: "2..5" → "2.5"
    text = re.sub(r"\.{2,}", ".", text)
    # Fix O→0 in numeric context
    text = re.sub(r"(\d)\.O", r"\1.0", text)
    text = re.sub(r"O(\d)", r"0\1", text)
    # Normalize unit suffixes: k5, k?, ks → kg
    text = re.sub(r"k[?5s]\b", "kg", text, flags=re.I)
    return text


def _ocr_segmental_easyocr(warped, roi: Tuple[int, int, int, int],
                            is_fat: bool = False
                            ) -> Tuple[List[OCRHit], str]:
    """OCR a segmental block using EasyOCR.

    Returns (list of OCRHit, raw_text_str).
    EasyOCR handles the body figure silhouette much better than Tesseract.
    """
    x1, y1, x2, y2 = roi
    crop = warped[y1:y2, x1:x2]
    crop_w = x2 - x1

    reader = _get_easyocr_reader()
    results = reader.readtext(crop)

    hits: List[OCRHit] = []
    raw_parts = []

    for bbox, text, conf in results:
        cx = (bbox[0][0] + bbox[2][0]) / 2
        rel_cx = cx / crop_w if crop_w > 0 else 0.5

        # Filter edge leakage from adjacent block
        if rel_cx > 0.85:
            continue

        cleaned = _clean_ocr_text(text)
        raw_parts.append(cleaned)

        # Map bbox to original image coordinates
        mapped_bbox = [[p[0] + x1, p[1] + y1] for p in bbox]
        hits.append((mapped_bbox, cleaned, conf))

    return hits, " | ".join(raw_parts)


def extract_inbody_metrics(image_path: str,
                           debug: bool = False,
                           debug_dir: str = "output_debug") -> InBodyResult:
    """End-to-end InBody sheet extraction.

    Pipeline:
        1. Load image
        2. Detect document contour and perspective-warp to canonical size
        3. Full-page OCR for anchor/block detection
        4. Locate blocks (anchor-based + template fallback)
        5. Per-block regional OCR with block-specific settings
        6. Parse each block's OCR output
        7. Validate ranges and compute confidence scores
    """
    # ------------------------------------------------------------------
    # 1. Load image
    # ------------------------------------------------------------------
    img = cv2.imread(image_path)
    if img is None:
        raise FileNotFoundError(f"Cannot read image: {image_path}")

    prefix = os.path.splitext(os.path.basename(image_path))[0] + "_"

    # ------------------------------------------------------------------
    # 2. Detect document and warp to canonical size
    # ------------------------------------------------------------------
    warped, warp_applied = detect_and_warp(img)
    h, w = warped.shape[:2]

    debug_info = DebugInfo()
    if debug:
        debug_info.warped_image_path = save_warped(warped, debug_dir, prefix)

    # ------------------------------------------------------------------
    # 3. Full-page OCR for anchor detection
    # ------------------------------------------------------------------
    all_hits = ocr_full_image(warped)
    if debug:
        save_raw_ocr("full_page", all_hits, debug_dir, prefix)

    # ------------------------------------------------------------------
    # 4. Locate blocks (anchor-based with template fallback)
    # ------------------------------------------------------------------
    blocks = locate_blocks(all_hits, w, h)

    if debug:
        roi_map = {name: blk.roi for name, blk in blocks.items()}
        debug_info.annotated_image_path = save_annotated(
            warped, roi_map, debug_dir, prefix)
        debug_info.detected_blocks = {
            name: {"roi": list(blk.roi), "anchor_text": blk.anchor_bbox}
            for name, blk in blocks.items()
        }

    # ------------------------------------------------------------------
    # 5–6. Per-block regional OCR + parsing
    # ------------------------------------------------------------------
    result = InBodyResult()
    raw_ocr = RawOCR()

    # --- Header (height) ------------------------------------------------
    if "header" in blocks:
        roi = blocks["header"].roi
        header_hits = ocr_region(warped, *roi, psm=3)
        raw_ocr.header = hits_to_text(header_hits)
        parsed = parse_header(header_hits)
        result.height = parsed["height"]
        if debug:
            save_raw_ocr("header", header_hits, debug_dir, prefix)
            save_block_crop(warped, "header", roi, debug_dir, prefix)
    else:
        parsed = parse_header(all_hits)
        result.height = parsed["height"]

    # --- Body Composition (weight, body fat mass) -----------------------
    if "body_composition" in blocks:
        roi = blocks["body_composition"].roi
        bc_hits = ocr_region(warped, *roi, psm=6)
        raw_ocr.body_composition = hits_to_text(bc_hits)
        parsed = parse_body_composition(bc_hits)
        result.weight = parsed["weight"]
        result.body_fat_mass = parsed["body_fat_mass"]
        if debug:
            save_raw_ocr("body_composition", bc_hits, debug_dir, prefix)
            save_block_crop(warped, "body_composition", roi, debug_dir, prefix)

    # --- Muscle-Fat Analysis (weight, SMM, body fat mass) ---------------
    # Tesseract first, then EasyOCR for SMM/BFM (bar chart scale labels
    # confuse Tesseract's keyword matching, so EasyOCR is more reliable).
    if "muscle_fat" in blocks:
        roi = blocks["muscle_fat"].roi
        mf_hits = ocr_region(warped, *roi, psm=6)
        raw_ocr.muscle_fat_analysis = hits_to_text(mf_hits)
        parsed = parse_muscle_fat(mf_hits)
        if result.weight is None:
            result.weight = parsed["weight"]
        if debug:
            save_raw_ocr("muscle_fat", mf_hits, debug_dir, prefix)
            save_block_crop(warped, "muscle_fat", roi, debug_dir, prefix)

        # EasyOCR positional approach for SMM and BFM.
        # Layout is always: Weight (top bar), SMM (middle bar), BFM (bottom bar).
        # Metric values are decimals (77.3, 33.6, 18.0) while scale labels
        # are integers (100, 115, 130…), so filtering by decimal presence
        # reliably isolates the metric values.
        reader = _get_easyocr_reader()
        if reader is not None:
            crop_mf = warped[roi[1]:roi[3], roi[0]:roi[2]]
            easyocr_mf = reader.readtext(crop_mf)
            decimal_hits = []
            for bbox, text, conf in easyocr_mf:
                cleaned = _clean_ocr_text(text)
                m = re.search(r"\d+\.\d+", cleaned)
                if m:
                    val = float(m.group())
                    cy = (bbox[0][1] + bbox[2][1]) / 2
                    decimal_hits.append((cy, val))
            decimal_hits.sort()

            found_w, found_smm, found_bfm = None, None, None
            for _, val in decimal_hits:
                if found_w is None and 20 < val < 300:
                    found_w = val
                elif found_smm is None and 10 < val < 80:
                    found_smm = val
                elif found_bfm is None and 1 < val < 100:
                    found_bfm = val

            if found_smm is not None:
                result.skeletal_muscle_mass = found_smm
            if found_bfm is not None and result.body_fat_mass is None:
                result.body_fat_mass = found_bfm
            if found_w is not None and result.weight is None:
                result.weight = found_w

    # --- Segmental Lean Analysis (EasyOCR) ------------------------------
    if "segmental_lean" in blocks:
        roi = blocks["segmental_lean"].roi
        if _get_easyocr_reader() is not None:
            sl_hits, raw_sl = _ocr_segmental_easyocr(warped, roi, is_fat=False)
            raw_ocr.segmental_lean_analysis = raw_sl
            result.segmental_lean_analysis = parse_segmental_lean(sl_hits)
        else:
            # Tesseract fallback (lower accuracy on segmental blocks)
            sl_hits = ocr_region(warped, *roi, psm=6)
            raw_ocr.segmental_lean_analysis = hits_to_text(sl_hits)
            result.segmental_lean_analysis = parse_segmental_lean(sl_hits)
        if debug:
            save_block_crop(warped, "segmental_lean", roi, debug_dir, prefix)

    # --- Segmental Fat Analysis (EasyOCR) -------------------------------
    if "segmental_fat" in blocks:
        roi = blocks["segmental_fat"].roi
        if _get_easyocr_reader() is not None:
            sf_hits, raw_sf = _ocr_segmental_easyocr(warped, roi, is_fat=True)
            raw_ocr.segmental_fat_analysis = raw_sf
            result.segmental_fat_analysis = parse_segmental_fat(sf_hits)
        else:
            sf_hits = ocr_region(warped, *roi, psm=6)
            raw_ocr.segmental_fat_analysis = hits_to_text(sf_hits)
            result.segmental_fat_analysis = parse_segmental_fat(sf_hits)
        if debug:
            save_block_crop(warped, "segmental_fat", roi, debug_dir, prefix)

    # ------------------------------------------------------------------
    # 6b. EasyOCR fallback for values Tesseract missed
    # ------------------------------------------------------------------
    if result.height is None:
        reader = _get_easyocr_reader()
        if reader is not None and "header" in blocks:
            roi = blocks["header"].roi
            crop = warped[roi[1]:roi[3], roi[0]:roi[2]]
            for _, text, _ in reader.readtext(crop):
                text = _clean_ocr_text(text)
                m = re.search(r"(\d{2,3})\s*(cm|crn|c[nm])", text, re.I)
                if m:
                    val = float(m.group(1))
                    if 100 < val < 250:
                        result.height = val
                        break
                # Fallback: standalone 3-digit number in height range
                if result.height is None:
                    m = re.search(r"\b(1[4-9]\d|2[0-4]\d)\b", text)
                    if m:
                        result.height = float(m.group(1))

    # ------------------------------------------------------------------
    # 7. Validation + confidence scoring
    # ------------------------------------------------------------------
    result.raw_ocr = raw_ocr
    result.debug = debug_info
    result = validate(result)

    return result
