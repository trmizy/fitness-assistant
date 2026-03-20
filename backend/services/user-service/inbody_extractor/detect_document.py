"""Document detection: find the InBody sheet and warp to a flat rectangle."""
from __future__ import annotations

from typing import Optional, Tuple
import cv2
import numpy as np
import os

from .preprocess import preprocess_for_edge, resize_keep_ratio

# Canonical output size after warping (width × height).
CANONICAL_W, CANONICAL_H = 1500, 2100


def _order_points(pts: np.ndarray) -> np.ndarray:
    """Order four points as: top-left, top-right, bottom-right, bottom-left."""
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]   # top-left  has smallest x+y
    rect[2] = pts[np.argmax(s)]   # bottom-right has largest x+y
    d = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(d)]   # top-right has smallest x-y
    rect[3] = pts[np.argmax(d)]   # bottom-left has largest x-y
    return rect


def _find_document_contour(enhanced: np.ndarray) -> Optional[np.ndarray]:
    """Switch to threshold-based detection — better for white paper on dark backgrounds."""
    # Adaptive threshold to find the paper region
    thresh = cv2.adaptiveThreshold(enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
                                   cv2.THRESH_BINARY, 11, 2)
    # Invert and morph to close holes
    thresh = cv2.bitwise_not(thresh)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=3)
    
    cv2.imwrite("output_debug/debug_thresh.jpg", thresh)

    contours, _ = cv2.findContours(thresh, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    # Sort by area
    img_area = enhanced.shape[0] * enhanced.shape[1]
    contours = sorted(contours, key=cv2.contourArea, reverse=True)

    for cnt in contours[:10]:
        area = cv2.contourArea(cnt)
        if area < img_area * 0.2: 
            continue
            
        # Try to find a 4-point approximation
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
        
        if len(approx) == 4:
            return approx.reshape(4, 2).astype("float32")
            
        # If not 4 points, maybe it's wrinkled. Try convex hull
        hull = cv2.convexHull(cnt)
        h_peri = cv2.arcLength(hull, True)
        h_approx = cv2.approxPolyDP(hull, 0.02 * h_peri, True)
        if len(h_approx) == 4:
            return h_approx.reshape(4, 2).astype("float32")

    return None

    return None


def _perspective_warp(img: np.ndarray, corners: np.ndarray,
                      out_w: int = CANONICAL_W,
                      out_h: int = CANONICAL_H) -> np.ndarray:
    """Warp a quadrilateral region to a flat rectangle."""
    ordered = _order_points(corners)
    dst = np.array([
        [0, 0],
        [out_w - 1, 0],
        [out_w - 1, out_h - 1],
        [0, out_h - 1],
    ], dtype="float32")
    M = cv2.getPerspectiveTransform(ordered, dst)
    return cv2.warpPerspective(img, M, (out_w, out_h),
                               flags=cv2.INTER_LINEAR,
                               borderMode=cv2.BORDER_REPLICATE)


def detect_and_warp(img: np.ndarray) -> Tuple[np.ndarray, bool]:
    """Detect the InBody sheet and warp it flat.

    Returns:
        (warped_image, warp_applied)
        If detection fails, resizes the original image and returns
        (resized_img, False).
    """
    # Work on a resized copy for contour detection.
    resized = resize_keep_ratio(img)
    enhanced = preprocess_for_edge(img)
    
    # DEBUG: save enhanced and edges images
    if not os.path.exists("output_debug"):
        os.makedirs("output_debug", exist_ok=True)
    cv2.imwrite("output_debug/debug_enhanced.jpg", enhanced)
    
    median_val = int(np.median(enhanced))
    lower = max(0, int(median_val * 0.5))
    upper = min(255, int(median_val * 1.5))
    edges = cv2.Canny(enhanced, lower, upper)
    cv2.imwrite("output_debug/debug_edges.jpg", edges)

    corners = _find_document_contour(enhanced)

    if corners is not None:
        print(f"DEBUG: Found document corners: {corners}")
        # Scale corners back to the resized coordinate space
        # (preprocess_for_edge also calls resize_keep_ratio internally,
        #  so corners are already in resized-image coordinates).
        h_orig, w_orig = img.shape[:2]
        h_res, w_res = resized.shape[:2]
        scale_x = w_orig / w_res
        scale_y = h_orig / h_res
        corners_orig = corners.copy()
        corners_orig[:, 0] *= scale_x
        corners_orig[:, 1] *= scale_y
        warped = _perspective_warp(img, corners_orig)
        return warped, True

    # Fallback: just resize to canonical dimensions.
    fallback = cv2.resize(resized, (CANONICAL_W, CANONICAL_H),
                          interpolation=cv2.INTER_AREA)
    return fallback, False
