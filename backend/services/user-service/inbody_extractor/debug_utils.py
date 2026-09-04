"""Debug utilities: save intermediate images and raw OCR text."""
from __future__ import annotations

import os
from typing import Dict, List, Tuple

import cv2
import numpy as np

from .ocr_engine import OCRHit

DEFAULT_DEBUG_DIR = "output_debug"


def ensure_dir(path: str) -> str:
    os.makedirs(path, exist_ok=True)
    return path


def save_warped(warped: np.ndarray, debug_dir: str = DEFAULT_DEBUG_DIR,
                prefix: str = "") -> str:
    """Save the perspective-warped image."""
    d = ensure_dir(debug_dir)
    fname = os.path.join(d, f"{prefix}warped.jpg")
    cv2.imwrite(fname, warped)
    return fname


def save_annotated(img: np.ndarray,
                   blocks: Dict[str, Tuple[int, int, int, int]],
                   debug_dir: str = DEFAULT_DEBUG_DIR,
                   prefix: str = "") -> str:
    """Draw ROI rectangles + labels on the image and save."""
    d = ensure_dir(debug_dir)
    canvas = img.copy()
    colours = [
        (0, 255, 0), (255, 0, 0), (0, 0, 255),
        (255, 255, 0), (0, 255, 255), (255, 0, 255),
    ]
    for i, (name, roi) in enumerate(blocks.items()):
        x1, y1, x2, y2 = roi
        colour = colours[i % len(colours)]
        cv2.rectangle(canvas, (x1, y1), (x2, y2), colour, 2)
        cv2.putText(canvas, name, (x1, y1 - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, colour, 1)
    fname = os.path.join(d, f"{prefix}annotated.jpg")
    cv2.imwrite(fname, canvas)
    return fname


def save_raw_ocr(block_name: str, hits: List[OCRHit],
                 debug_dir: str = DEFAULT_DEBUG_DIR,
                 prefix: str = "") -> str:
    """Save raw OCR text and confidence labels to a debug file."""
    d = ensure_dir(debug_dir)
    fname = os.path.join(d, f"{prefix}ocr_{block_name}.txt")
    with open(fname, "w", encoding="utf-8") as f:
        for bbox, text, conf in hits:
            # Top-left corner of the bbox
            x = min(p[0] for p in bbox)
            y = min(p[1] for p in bbox)
            f.write(f"[{conf:.3f}] @({int(x)}, {int(y)}) {text}\n")
    return fname


def save_block_crop(img: np.ndarray, block_name: str,
                    roi: Tuple[int, int, int, int],
                    debug_dir: str = DEFAULT_DEBUG_DIR,
                    prefix: str = "") -> str:
    """Save a cropped block region."""
    d = ensure_dir(debug_dir)
    x1, y1, x2, y2 = roi
    crop = img[y1:y2, x1:x2]
    fname = os.path.join(d, f"{prefix}crop_{block_name}.jpg")
    cv2.imwrite(fname, crop)
    return fname
