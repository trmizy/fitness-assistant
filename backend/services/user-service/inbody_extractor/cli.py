"""CLI entry point for InBody extraction.

Usage:
    # Single image:
    python -m inbody_extractor.cli --image ./test/real_pic.jpg --debug

    # Batch (all jpg/png in a directory):
    python -m inbody_extractor.cli --dir ./test/ --debug

    # Custom debug output folder:
    python -m inbody_extractor.cli --image photo.jpg --debug --output output_debug
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import time


def _process_one(image_path: str, debug: bool, debug_dir: str, json_only: bool = False) -> dict:
    """Process a single image and return the result dict."""
    from .extractor import extract_inbody_metrics

    if not json_only:
        print(f"\n{'=' * 60}")
        print(f"Processing: {image_path}")
        print(f"{'=' * 60}")

    t0 = time.time()
    result = extract_inbody_metrics(image_path, debug=debug, debug_dir=debug_dir)
    elapsed = time.time() - t0

    result_dict = result.model_dump()
    if json_only:
        print(json.dumps(result_dict, ensure_ascii=False), flush=True)
    else:
        print(json.dumps(result_dict, indent=2, ensure_ascii=False))
        print(f"\n[Done] Completed in {elapsed:.2f}s")
    return result_dict


def main():
    parser = argparse.ArgumentParser(
        description="Extract health metrics from an InBody sheet photo.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--image", "-i", help="Path to a single image file.")
    group.add_argument("--dir", "-d",
                       help="Path to a directory of images (batch mode).")
    parser.add_argument("--debug", action="store_true",
                        help="Save debug images and raw OCR text.")
    parser.add_argument("--output", "-o", default="output_debug",
                        help="Debug output directory (default: output_debug).")
    parser.add_argument("--json", action="store_true",
                        help="Output only raw JSON to stdout (for machine consumption).")

    args = parser.parse_args()

    if args.image:
        if not os.path.isfile(args.image):
            print(f"Error: file not found: {args.image}", file=sys.stderr)
            sys.exit(1)
        _process_one(args.image, args.debug, args.output, json_only=args.json)
    else:
        if not os.path.isdir(args.dir):
            print(f"Error: directory not found: {args.dir}", file=sys.stderr)
            sys.exit(1)

        patterns = ["*.jpg", "*.jpeg", "*.png", "*.bmp", "*.webp"]
        files = []
        for pat in patterns:
            files.extend(glob.glob(os.path.join(args.dir, pat)))
        files = sorted(set(files))

        if not files:
            print(f"No image files found in {args.dir}", file=sys.stderr)
            sys.exit(1)

        print(f"Found {len(files)} image(s) in {args.dir}")
        results = {}
        for f in files:
            try:
                results[os.path.basename(f)] = _process_one(
                    f, args.debug, args.output)
            except Exception as e:
                print(f"  ❌ Error: {e}")
                results[os.path.basename(f)] = {"error": str(e)}

        # Save summary JSON.
        summary_path = os.path.join(args.output, "batch_results.json")
        os.makedirs(args.output, exist_ok=True)
        with open(summary_path, "w", encoding="utf-8") as fout:
            json.dump(results, fout, indent=2, ensure_ascii=False)
        print(f"\n📄 Batch results saved to {summary_path}")


if __name__ == "__main__":
    main()
