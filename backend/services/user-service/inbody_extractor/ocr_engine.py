import pytesseract
from PIL import Image
import numpy as np
import cv2
from typing import List, Tuple, Optional
import os

# Point to the Tesseract executable on Windows
TESSERACT_PATH = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
if os.path.exists(TESSERACT_PATH):
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH

# Each OCR hit is (bbox, text, confidence).
OCRHit = Tuple[List[List[float]], str, float]

def ocr_full_image(img: np.ndarray, psm: int = 3) -> List[OCRHit]:
    """
    Run OCR on the entire image using pytesseract.
    Returns a list of (bbox, text, confidence).
    psm: Page segmentation mode (default 3 = auto).
    """
    # Convert OpenCV BGR to PIL RGB
    pil_img = Image.fromarray(img)
    
    # Use image_to_data to get bboxes and confidence
    config = f"--psm {psm}"
    data = pytesseract.image_to_data(pil_img, config=config, output_type=pytesseract.Output.DICT)
    
    hits = []
    n_boxes = len(data['text'])
    for i in range(n_boxes):
        text = data['text'][i].strip()
        try:
            conf = float(data['conf'][i])
        except (ValueError, TypeError):
            conf = -1.0
        
        # Filter out empty text and low confidence hits
        if text and conf > 0:
            x, y, w, h = data['left'][i], data['top'][i], data['width'][i], data['height'][i]
            bbox = [[float(x), float(y)], [float(x+w), float(y)], [float(x+w), float(y+h)], [float(x), float(y+h)]]
            hits.append((bbox, text, conf / 100.0))
            
    return hits

def ocr_region(img: np.ndarray, x1: int, y1: int, x2: int, y2: int, psm: int = 3) -> List[OCRHit]:
    """OCR a rectangular sub-region of an image with optional PSM."""
    h_img, w_img = img.shape[:2]
    x1, y1 = max(0, int(x1)), max(0, int(y1))
    x2, y2 = min(w_img, int(x2)), min(h_img, int(y2))
    if x2 <= x1 or y2 <= y1:
        return []
    crop = img[y1:y2, x1:x2]
    
    # Optional image enhancement for small crops: scale up
    if (x2 - x1) < 500 or (y2 - y1) < 500:
        crop = cv2.resize(crop, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
        # Subtle sharpening
        kernel = np.array([[-1,-1,-1], [-1,9,-1], [-1,-1,-1]])
        crop = cv2.filter2D(crop, -1, kernel)
        
    hits = ocr_full_image(crop, psm=psm)
    
    # Shift hits back to original image coordinates
    final_hits = []
    scale = 1.0
    if (x2 - x1) < 500 or (y2 - y1) < 500:
        scale = 1.0 / 3.0
        
    for bbox, text, conf in hits:
        shifted_bbox = []
        for p in bbox:
            shifted_bbox.append([p[0]*scale + x1, p[1]*scale + y1])
        final_hits.append((shifted_bbox, text, conf))
    return final_hits

def hits_to_text(hits: List[OCRHit]) -> str:
    """Concatenate all OCR hits into a single string (line-separated)."""
    return "\n".join(h[1] for h in hits)
