#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


def load_rgba(path: str, size=None) -> np.ndarray:
    image = Image.open(path).convert("RGBA")
    if size and image.size != size:
        image = image.resize(size, Image.BILINEAR)
    return np.asarray(image, dtype=np.float32)


def mask_geometry(weight: np.ndarray):
    active = weight > 0.0
    pixel_count = int(np.count_nonzero(active))
    total = max(1, int(weight.size))
    coverage = float(pixel_count / total)
    if pixel_count <= 0:
        return {
            "pixelCount": 0,
            "coverage": coverage,
            "bboxCoverage": 0.0,
            "fillRatio": 0.0,
        }
    ys, xs = np.where(active)
    min_x = int(xs.min())
    max_x = int(xs.max())
    min_y = int(ys.min())
    max_y = int(ys.max())
    bbox_area = max(1, (max_x - min_x + 1) * (max_y - min_y + 1))
    return {
        "pixelCount": pixel_count,
        "coverage": coverage,
        "bboxCoverage": float(bbox_area / total),
        "fillRatio": float(pixel_count / bbox_area),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stageA", required=True)
    parser.add_argument("--scene", required=True)
    parser.add_argument("--mask", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--forceLowConfidence", required=False, default="0")
    args = parser.parse_args()

    stage_a = load_rgba(args.stageA)
    size = (stage_a.shape[1], stage_a.shape[0])
    scene = load_rgba(args.scene, size=size)
    mask = load_rgba(args.mask, size=size)

    alpha = mask[:, :, 3] / 255.0
    luminance = mask[:, :, :3].mean(axis=2) / 255.0
    weight = alpha * luminance * 1.35
    valid = (alpha > 0.04) & (luminance > 0.05) & (weight > 0.04)
    weight = np.where(valid, np.clip(weight, 0.0, 1.0), 0.0)
    geo = mask_geometry(weight)
    coverage = float(geo["coverage"])
    strong_pixels = int(np.count_nonzero(weight >= 0.7))
    force_low_confidence = str(args.forceLowConfidence).strip().lower() in {"1", "true", "yes", "on"}
    low_confidence_override = False

    if coverage < 0.003 or strong_pixels < 120:
        print(
            json.dumps(
                {
                    "ok": True,
                    "applied": False,
                    "reason": "mask_too_small",
                    "coverage": coverage,
                    "strongPixels": strong_pixels,
                    "outputPath": str(Path(args.stageA).resolve()),
                },
                ensure_ascii=False,
            )
        )
        return
    if coverage >= 0.85 and not force_low_confidence:
        print(
            json.dumps(
                {
                    "ok": True,
                    "applied": False,
                    "reason": "mask_too_large",
                    "coverage": coverage,
                    "outputPath": str(Path(args.stageA).resolve()),
                },
                ensure_ascii=False,
            )
        )
        return
    mask_box_like = (
        geo["fillRatio"] >= 0.95
        and geo["bboxCoverage"] >= 0.03
        and geo["bboxCoverage"] <= 0.24
    )
    if mask_box_like:
        print(
            json.dumps(
                {
                    "ok": True,
                    "applied": False,
                    "reason": "mask_box_like",
                    "coverage": coverage,
                    "bboxCoverage": float(geo["bboxCoverage"]),
                    "fillRatio": float(geo["fillRatio"]),
                    "outputPath": str(Path(args.stageA).resolve()),
                },
                ensure_ascii=False,
            )
        )
        return
    if geo["fillRatio"] >= 0.86 and geo["bboxCoverage"] >= 0.03:
        allow_low_confidence_override = force_low_confidence or (
            geo["bboxCoverage"] <= 0.12 and coverage <= 0.14 and geo["fillRatio"] <= 0.9
        )
        if not allow_low_confidence_override:
            print(
                json.dumps(
                    {
                        "ok": True,
                        "applied": False,
                        "reason": "mask_geometry_low_confidence",
                        "coverage": coverage,
                        "bboxCoverage": float(geo["bboxCoverage"]),
                        "fillRatio": float(geo["fillRatio"]),
                        "outputPath": str(Path(args.stageA).resolve()),
                    },
                    ensure_ascii=False,
                )
            )
            return
        low_confidence_override = True

    output = scene.copy()
    blend = weight[:, :, None]
    output[:, :, :3] = scene[:, :, :3] * (1.0 - blend) + stage_a[:, :, :3] * blend
    output[:, :, 3] = 255.0
    output = np.clip(output, 0.0, 255.0).astype(np.uint8)

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(output, mode="RGBA").save(output_path)

    kept_pixels = int(np.count_nonzero(weight > 0.0))
    total_pixels = max(1, int(weight.shape[0] * weight.shape[1]))

    print(
        json.dumps(
            {
                "ok": True,
                "applied": True,
                "outputPath": str(output_path),
                "keptPixels": kept_pixels,
                "strongPixels": strong_pixels,
                "coverage": kept_pixels / total_pixels,
                "lowConfidenceOverride": low_confidence_override,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
