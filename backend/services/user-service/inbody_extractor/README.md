# InBody Sheet OCR Extractor

Extracts health metrics from phone-captured InBody270 sheets using **PaddleOCR** and **OpenCV**.

## Quick Start

```bash
# 1. Create a virtual environment (recommended)
cd backend/services/user-service
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # Linux/Mac

# 2. Install dependencies
pip install -r inbody_extractor/requirements.txt

# 3. Run on a single image
python -m inbody_extractor.cli --image ../../test/real_pic.jpg --debug

# 4. Batch mode (all images in a folder)
python -m inbody_extractor.cli --dir ../../test/ --debug
```

## Output

- **JSON** printed to stdout with all extracted metrics
- **Debug images** saved to `output_debug/` when `--debug` is used:
  - `*_warped.jpg` — perspective-corrected document
  - `*_annotated.jpg` — ROI blocks drawn on the image
  - `*_crop_<block>.jpg` — cropped region per block
  - `*_ocr_<block>.txt` — raw OCR text per block

## Pipeline Overview

1. **Load** image from file
2. **Preprocess** — resize, grayscale, CLAHE contrast enhancement
3. **Detect document** — find paper contour → perspective warp to 1200×1700
4. **Full-page OCR** — PaddleOCR with angle classification
5. **Anchor-based block location** — find text labels, define ROIs relative to anchors
6. **Parse** — regex + rule-based extraction per block
7. **Validate** — range checks + confidence scoring
8. **Output** — structured JSON

## Integration

```python
from inbody_extractor import extract_inbody_metrics

result = extract_inbody_metrics("path/to/photo.jpg", debug=True)
print(result.model_dump_json(indent=2))
```

## Troubleshooting

- **Poor document detection**: Ensure the full InBody sheet is visible in the photo with some margin
- **OCR errors**: Check `output_debug/*_ocr_*.txt` for raw text; adjust contrast of the photo
- **Missing blocks**: Check `output_debug/*_annotated.jpg` to verify block locations
