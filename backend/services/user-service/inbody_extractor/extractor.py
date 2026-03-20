"""Main pipeline orchestrator.

Usage:
    from inbody_extractor import extract_inbody_metrics
    result = extract_inbody_metrics("photo.jpg", debug=True)
    print(result.model_dump_json(indent=2))
"""
from __future__ import annotations

import os
import cv2

from .models import InBodyResult, RawOCR, DebugInfo
from .detect_document import detect_and_warp
from .ocr_engine import ocr_full_image, ocr_region, hits_to_text
from .block_locator import locate_blocks, collect_hits_in_roi
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


def extract_inbody_metrics(image_path: str,
                           debug: bool = False,
                           debug_dir: str = "output_debug") -> InBodyResult:
    """End-to-end InBody sheet extraction.

    Args:
        image_path: Path to a phone-captured InBody sheet image.
        debug:      If True, saves intermediate images and OCR dumps.
        debug_dir:  Directory for debug output.

    Returns:
        InBodyResult with all extracted metrics.
    """
    # ------------------------------------------------------------------
    # 1. Load image
    # ------------------------------------------------------------------
    img = cv2.imread(image_path)
    if img is None:
        raise FileNotFoundError(f"Cannot read image: {image_path}")

    prefix = os.path.splitext(os.path.basename(image_path))[0] + "_"

    # ------------------------------------------------------------------
    # 2–4. Detect document, warp, normalise
    # ------------------------------------------------------------------
    warped, warp_applied = detect_and_warp(img)
    h, w = warped.shape[:2]

    debug_info = DebugInfo()
    if debug:
        debug_info.warped_image_path = save_warped(warped, debug_dir, prefix)

    # ------------------------------------------------------------------
    # 5. Full-page OCR
    # ------------------------------------------------------------------
    all_hits = ocr_full_image(warped)
    if debug:
        save_raw_ocr("full_page", all_hits, debug_dir, prefix)

    # ------------------------------------------------------------------
    # 6. Anchor-based block location
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
    # 7. Collect OCR hits per block
    # ------------------------------------------------------------------
    for name, blk in blocks.items():
        blk.ocr_hits = collect_hits_in_roi(all_hits, blk.roi)
        if debug:
            save_raw_ocr(name, blk.ocr_hits, debug_dir, prefix)
            save_block_crop(warped, name, blk.roi, debug_dir, prefix)

    # ------------------------------------------------------------------
    # 8. Parse each block
    # ------------------------------------------------------------------
    result = InBodyResult()
    raw_ocr = RawOCR()

    # --- Header (height) ------------------------------------------------
    if "header" in blocks:
        # Focused OCR for header (PSM 6: Assume single uniform block of text)
        row1_roi = blocks["header"].roi
        header_hits = ocr_region(warped, *row1_roi, psm=6)
        raw_ocr.header = hits_to_text(header_hits)
        parsed = parse_header(header_hits)
        result.height = parsed["height"]
    else:
        # Fallback: try to find height from all_hits
        parsed = parse_header(all_hits)
        result.height = parsed["height"]
        raw_ocr.header = "(fallback: full-page)"

    # --- Body Composition (weight, body fat mass) -----------------------
    if "body_composition" in blocks:
        bc_hits = blocks["body_composition"].ocr_hits
        raw_ocr.body_composition = hits_to_text(bc_hits)
        parsed = parse_body_composition(bc_hits)
        result.weight = parsed["weight"]
        result.body_fat_mass = parsed["body_fat_mass"]

    # --- Muscle-Fat Analysis (weight, SMM, body fat mass) ---------------
    if "muscle_fat" in blocks:
        mf_hits = blocks["muscle_fat"].ocr_hits
        raw_ocr.muscle_fat_analysis = hits_to_text(mf_hits)
        parsed = parse_muscle_fat(mf_hits)
        # Fill only if not already set from body composition.
        if result.weight is None:
            result.weight = parsed["weight"]
        result.skeletal_muscle_mass = parsed["skeletal_muscle_mass"]
        if result.body_fat_mass is None:
            result.body_fat_mass = parsed["body_fat_mass"]

    if "segmental_lean" in blocks:
        # Re-scan segmental lean ROI with PSM 6 (Uniform block)
        sl_roi = blocks["segmental_lean"].roi
        sl_hits = ocr_region(warped, *sl_roi, psm=6)
        raw_ocr.segmental_lean_analysis = hits_to_text(sl_hits)
        result.segmental_lean_analysis = parse_segmental_lean(sl_hits)

    if "segmental_fat" in blocks:
        sf_roi = blocks["segmental_fat"].roi
        sf_hits = ocr_region(warped, *sf_roi, psm=6)
        raw_ocr.segmental_fat_analysis = hits_to_text(sf_hits)
        result.segmental_fat_analysis = parse_segmental_fat(sf_hits)

    # ------------------------------------------------------------------
    # 9. Validation + confidence
    # ------------------------------------------------------------------
    result.raw_ocr = raw_ocr
    result.debug = debug_info
    result = validate(result)

    return result
