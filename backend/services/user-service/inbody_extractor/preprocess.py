"""Image preprocessing: resize, grayscale, denoise, contrast enhancement."""
from __future__ import annotations

import cv2
import numpy as np

# Maximum dimension for the working image (keeps processing fast).
MAX_DIM = 1600


def resize_keep_ratio(img: np.ndarray, max_dim: int = MAX_DIM) -> np.ndarray:
    """Resize so the longest side is at most *max_dim*, keeping aspect ratio."""
    h, w = img.shape[:2]
    if max(h, w) <= max_dim:
        return img
    scale = max_dim / max(h, w)
    return cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)


def to_grayscale(img: np.ndarray) -> np.ndarray:
    """Convert BGR → grayscale, no-op if already single-channel."""
    if len(img.shape) == 2:
        return img
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def denoise(gray: np.ndarray, strength: int = 10) -> np.ndarray:
    """Light non-local-means denoising for phone-captured images."""
    return cv2.fastNlMeansDenoising(gray, h=strength)


def enhance_contrast(gray: np.ndarray, clip_limit: float = 2.0,
                     tile_size: int = 8) -> np.ndarray:
    """CLAHE (Contrast-Limited Adaptive Histogram Equalization)."""
    clahe = cv2.createCLAHE(clipLimit=clip_limit,
                            tileGridSize=(tile_size, tile_size))
    return clahe.apply(gray)


def preprocess_for_edge(img: np.ndarray) -> np.ndarray:
    """Full pipeline to prepare an image for edge/contour detection.

    Returns a single-channel, denoised, contrast-enhanced image.
    """
    resized = resize_keep_ratio(img)
    gray = to_grayscale(resized)
    denoised = denoise(gray, strength=10)
    enhanced = enhance_contrast(denoised)
    return enhanced


def preprocess_for_ocr(img: np.ndarray) -> np.ndarray:
    """Lighter preprocessing that keeps the image in BGR (PaddleOCR wants colour).

    Only resizes.  PaddleOCR has its own internal preprocessing.
    """
    return resize_keep_ratio(img, max_dim=2000)
