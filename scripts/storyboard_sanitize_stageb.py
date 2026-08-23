#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def load_rgba(path: str, size=None) -> np.ndarray:
    image = Image.open(path).convert("RGBA")
    if size and image.size != size:
        image = image.resize(size, Image.BILINEAR)
    return np.asarray(image, dtype=np.float32)


def mask_weight(mask: np.ndarray) -> np.ndarray:
    alpha = mask[:, :, 3] / 255.0
    luminance = mask[:, :, :3].mean(axis=2) / 255.0
    weight = alpha * luminance * 1.35
    valid = (alpha > 0.04) & (luminance > 0.05) & (weight > 0.04)
    return np.where(valid, np.clip(weight, 0.0, 1.0), 0.0)


def blur_weight(weight: np.ndarray, radius: float) -> np.ndarray:
    if radius <= 0:
        return weight
    img = Image.fromarray(np.clip(weight * 255.0, 0.0, 255.0).astype(np.uint8), mode="L")
    blurred = img.filter(ImageFilter.GaussianBlur(radius=radius))
    return np.asarray(blurred, dtype=np.float32) / 255.0


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


def mask_bounds(weight: np.ndarray):
    active = weight > 0.04
    if not np.any(active):
        return None
    ys, xs = np.where(active)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def detect_foreground_bbox(image_rgba: np.ndarray):
    alpha = image_rgba[:, :, 3] / 255.0
    rgb = image_rgba[:, :, :3] / 255.0
    h, w = rgb.shape[:2]
    if h <= 0 or w <= 0:
        return None

    corner = max(2, min(24, h, w))
    corners = np.concatenate(
        [
            rgb[:corner, :corner].reshape(-1, 3),
            rgb[:corner, max(0, w - corner):].reshape(-1, 3),
            rgb[max(0, h - corner):, :corner].reshape(-1, 3),
            rgb[max(0, h - corner):, max(0, w - corner):].reshape(-1, 3),
        ],
        axis=0,
    )
    bg = np.median(corners, axis=0)
    dist = np.linalg.norm(rgb - bg, axis=2)
    luminance = rgb.mean(axis=2)
    rgb_max = np.max(rgb, axis=2)
    rgb_min = np.min(rgb, axis=2)
    saturation = np.where(rgb_max > 0, (rgb_max - rgb_min) / np.maximum(rgb_max, 1e-6), 0.0)

    margin_x = min(max(0, int(round(w * 0.06))), max(0, (w - 1) // 2))
    margin_y = min(max(0, int(round(h * 0.06))), max(0, (h - 1) // 2))
    core = np.ones((h, w), dtype=bool)
    if margin_x > 0:
        core[:, :margin_x] = False
        core[:, w - margin_x:] = False
    if margin_y > 0:
        core[:margin_y, :] = False
        core[h - margin_y:, :] = False

    def infer_bbox(mask: np.ndarray):
        if not np.any(mask):
            return None
        ys, xs = np.where(mask)
        min_x = int(xs.min())
        max_x = int(xs.max())
        min_y = int(ys.min())
        max_y = int(ys.max())
        bbox_area = max(1, (max_x - min_x + 1) * (max_y - min_y + 1))
        bbox_coverage = float(bbox_area / max(1, h * w))
        if bbox_coverage >= 0.82:
            return None
        return min_x, min_y, max_x, max_y

    foreground = (
        (alpha > 0.06)
        & (dist >= 0.085)
        & ((saturation >= 0.06) | (luminance <= 0.9))
        & core
    )
    bbox = infer_bbox(foreground)
    if bbox is not None:
        return bbox

    strict_foreground = (
        (alpha > 0.08)
        & (dist >= 0.14)
        & ((saturation >= 0.09) | (luminance <= 0.84))
        & core
    )
    bbox = infer_bbox(strict_foreground)
    if bbox is not None:
        return bbox

    alpha_only = (alpha > 0.24) & core
    return infer_bbox(alpha_only)


def place_primary_into_mask(primary: np.ndarray, stage_size, target_bounds):
    width, height = stage_size
    if primary is None:
        return None
    src_bbox = detect_foreground_bbox(primary)
    if src_bbox is None:
        return None
    sx0, sy0, sx1, sy1 = src_bbox
    source_crop = primary[sy0 : sy1 + 1, sx0 : sx1 + 1, :]
    if source_crop.size == 0:
        return None
    tx0, ty0, tx1, ty1 = target_bounds
    target_w = max(1, tx1 - tx0 + 1)
    target_h = max(1, ty1 - ty0 + 1)
    src_h, src_w = source_crop.shape[:2]
    scale = max(0.05, min((target_w * 0.92) / max(1, src_w), (target_h * 0.94) / max(1, src_h)))
    draw_w = max(1, int(round(src_w * scale)))
    draw_h = max(1, int(round(src_h * scale)))
    draw_x = max(0, min(width - draw_w, int(round(tx0 + (target_w - draw_w) * 0.5))))
    draw_y = max(0, min(height - draw_h, int(round(ty1 - draw_h + 1))))
    resized = np.asarray(
        Image.fromarray(np.clip(source_crop, 0, 255).astype(np.uint8), mode="RGBA").resize((draw_w, draw_h), Image.BILINEAR),
        dtype=np.float32,
    )
    placed = np.zeros((height, width, 4), dtype=np.float32)
    placed[draw_y : draw_y + draw_h, draw_x : draw_x + draw_w, :] = resized
    return placed, {
        "src_bbox": [sx0, sy0, sx1 - sx0 + 1, sy1 - sy0 + 1],
        "dst_bbox": [draw_x, draw_y, draw_w, draw_h],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stageB", required=True)
    parser.add_argument("--stageA", required=True)
    parser.add_argument("--char1Mask", required=True)
    parser.add_argument("--char2Mask", required=True)
    parser.add_argument("--char2Primary", required=False, default="")
    parser.add_argument("--reason", required=False, default="")
    parser.add_argument("--output", required=False, default="")
    parser.add_argument("--blur", required=False, type=float, default=1.5)
    args = parser.parse_args()

    stage_b_path = Path(args.stageB).resolve()
    stage_a_path = Path(args.stageA).resolve()
    char1_mask_path = Path(args.char1Mask).resolve()
    char2_mask_path = Path(args.char2Mask).resolve()
    output_path = Path(args.output).resolve() if args.output else stage_b_path
    inferred_scene_path = Path(str(char2_mask_path).replace("_char2_mask.png", "_scene_ref_path.png"))

    stage_b = load_rgba(str(stage_b_path))
    size = (stage_b.shape[1], stage_b.shape[0])
    stage_a = load_rgba(str(stage_a_path), size=size)
    char1_mask = load_rgba(str(char1_mask_path), size=size)
    char2_mask = load_rgba(str(char2_mask_path), size=size)
    scene = load_rgba(str(inferred_scene_path), size=size) if inferred_scene_path.exists() else None
    char2_primary = None
    if str(args.char2Primary or "").strip():
        char2_primary_path = Path(str(args.char2Primary)).resolve()
        if char2_primary_path.exists():
            char2_primary = load_rgba(str(char2_primary_path))
    validation_reason = str(args.reason or "").strip()
    prefer_primary_rescue_for_char2_identity = validation_reason == "invalid_stageB_char2_identity_or_outfit_drift"
    prefer_primary_rescue_for_char2_presence = validation_reason in {
        "invalid_stageB_char2_missing_or_too_weak",
        "invalid_stageB_char2_not_added",
    }
    preserve_stageb_char1_lane = validation_reason != "invalid_stageB_char1_identity_or_outfit_drift"

    w1 = mask_weight(char1_mask)
    w2 = mask_weight(char2_mask)
    total_pixels = max(1, int(w2.size))
    raw_char2_pixels = int(np.count_nonzero(w2 > 0.0))
    overlap_pixels = int(np.count_nonzero((w2 > 0.0) & (w1 > 0.18)))
    overlap_ratio = float(overlap_pixels / max(1, raw_char2_pixels))
    char2_geo = mask_geometry(w2)
    low_confidence_override = False
    if overlap_ratio >= 0.28:
        print(
            json.dumps(
                {
                    "ok": True,
                    "applied": False,
                    "reason": "mask_overlap_too_high",
                    "coverage": float(char2_geo["coverage"]),
                    "overlap": overlap_ratio,
                    "outputPath": str(output_path),
                },
                ensure_ascii=False,
            )
        )
        return
    mask_box_like = (
        char2_geo["fillRatio"] >= 0.95
        and char2_geo["bboxCoverage"] >= 0.03
        and char2_geo["bboxCoverage"] <= 0.24
        and char2_geo["coverage"] <= 0.24
    )
    if mask_box_like:
        print(
            json.dumps(
                {
                    "ok": True,
                    "applied": False,
                    "reason": "mask_box_like",
                    "coverage": float(char2_geo["coverage"]),
                    "bboxCoverage": float(char2_geo["bboxCoverage"]),
                    "fillRatio": float(char2_geo["fillRatio"]),
                    "outputPath": str(output_path),
                },
                ensure_ascii=False,
            )
        )
        return
    mask_geometry_low_confidence = char2_geo["fillRatio"] >= 0.86 and char2_geo["bboxCoverage"] >= 0.03
    if mask_geometry_low_confidence:
        allow_low_confidence_override = (
            char2_geo["bboxCoverage"] <= 0.18
            and char2_geo["coverage"] <= 0.16
            and overlap_ratio <= 0.08
        )
        if allow_low_confidence_override:
            low_confidence_override = True
        else:
            print(
                json.dumps(
                    {
                        "ok": True,
                        "applied": False,
                        "reason": "mask_geometry_low_confidence",
                        "coverage": float(char2_geo["coverage"]),
                        "bboxCoverage": float(char2_geo["bboxCoverage"]),
                        "fillRatio": float(char2_geo["fillRatio"]),
                        "overlap": overlap_ratio,
                        "outputPath": str(output_path),
                    },
                    ensure_ascii=False,
                )
            )
            return

    # Restrict write scope to character-B lane only, with a soft shield over character-A lane.
    mask = np.where((w2 > 0.0) & (w1 < 0.08), w2, 0.0)
    mask_coverage = float(np.count_nonzero(mask > 0.0) / total_pixels)
    if mask_coverage < 0.002:
        print(
            json.dumps(
                {
                    "ok": True,
                    "applied": False,
                    "reason": "mask_too_small",
                    "coverage": mask_coverage,
                    "outputPath": str(output_path),
                },
                ensure_ascii=False,
            )
        )
        return
    if mask_coverage >= 0.35:
        print(
            json.dumps(
                {
                    "ok": True,
                    "applied": False,
                    "reason": "mask_too_large",
                    "coverage": mask_coverage,
                    "outputPath": str(output_path),
                },
                ensure_ascii=False,
            )
        )
        return

    delta_pixels = int(np.count_nonzero(w2 > 0.04))
    if delta_pixels > 0:
        delta = np.abs(stage_b[:, :, :3] - stage_a[:, :, :3]).mean(axis=2)
        stageb_delta_mean = float(delta[w2 > 0.04].mean())
        stageb_delta_active = float(np.count_nonzero((delta >= 12) & (w2 > 0.04)) / total_pixels)
    else:
        stageb_delta_mean = 0.0
        stageb_delta_active = 0.0

    stagea_char2_baseline_mean = 0.0
    stagea_char2_baseline_active = 0.0
    stagea_char2_baseline_ratio = 0.0
    if scene is not None and delta_pixels > 0:
        stagea_delta = np.abs(stage_a[:, :, :3] - scene[:, :, :3]).mean(axis=2)
        lane_selector = w2 > 0.04
        if np.any(lane_selector):
            lane_delta = stagea_delta[lane_selector]
            stagea_char2_baseline_mean = float(lane_delta.mean())
            stagea_active_pixels = int(np.count_nonzero(lane_delta >= 12.0))
            stagea_char2_baseline_active = float(stagea_active_pixels / total_pixels)
            stagea_char2_baseline_ratio = float(stagea_active_pixels / max(1, int(lane_delta.size)))
    stagea_char2_already_visible = (
        stagea_char2_baseline_mean >= 18.0
        and stagea_char2_baseline_ratio >= 0.18
        and stagea_char2_baseline_active >= max(0.008, mask_coverage * 0.14)
    )

    target_bounds = mask_bounds(w2)
    use_primary_rescue = (
        char2_primary is not None
        and target_bounds is not None
        and not stagea_char2_already_visible
        and (
            prefer_primary_rescue_for_char2_identity
            or prefer_primary_rescue_for_char2_presence
            or stageb_delta_mean < 8.0
            or stageb_delta_active < max(0.006, mask_coverage * 0.12)
        )
    )
    source_image = stage_b
    rescue_meta = None
    if use_primary_rescue:
        placed_result = place_primary_into_mask(char2_primary, (size[0], size[1]), target_bounds)
        if placed_result is not None:
            source_image, rescue_meta = placed_result
        else:
            use_primary_rescue = False

    softened = blur_weight(mask, max(0.0, float(args.blur)))
    blend = np.where(mask > 0, np.minimum(1.0, mask * 0.9 + softened * 0.1), 0.0)
    source_alpha = source_image[:, :, 3] / 255.0 if use_primary_rescue else np.ones_like(blend, dtype=np.float32)
    effective_blend = blend * source_alpha

    output = stage_a.copy()
    blend3 = effective_blend[:, :, None]
    output[:, :, :3] = stage_a[:, :, :3] * (1.0 - blend3) + source_image[:, :, :3] * blend3
    output[:, :, 3] = 255.0
    rescued_char1_pixels = 0
    if preserve_stageb_char1_lane and np.any(w1 > 0.02):
        rescue_selector = (w1 > 0.02) & (w2 <= 0.08)
        if np.any(rescue_selector):
            rescue_blend = np.where(w1 >= 0.55, 0.94, np.where(w1 >= 0.25, 0.82, 0.68))
            rescue_blend = np.where(rescue_selector, rescue_blend, 0.0).astype(np.float32)
            rescue3 = rescue_blend[:, :, None]
            output[:, :, :3] = output[:, :, :3] * (1.0 - rescue3) + stage_b[:, :, :3] * rescue3
            rescued_char1_pixels = int(np.count_nonzero(rescue_blend > 0.0))
    output = np.clip(output, 0.0, 255.0).astype(np.uint8)

    updated_pixels = int(np.count_nonzero(effective_blend > 0.0))
    updated_coverage = float(updated_pixels / total_pixels)
    if updated_coverage > max(0.3, mask_coverage * 2.2):
        print(
            json.dumps(
                {
                    "ok": True,
                    "applied": False,
                    "reason": "update_too_large",
                    "coverage": mask_coverage,
                    "updatedCoverage": updated_coverage,
                    "outputPath": str(output_path),
                },
                ensure_ascii=False,
            )
        )
        return
    char1_pixels = int(np.count_nonzero(w1 > 0.0))
    if char1_pixels > 0:
        updated_in_char1_lane = int(np.count_nonzero((blend > 0.08) & (w1 > 0.0)))
        if (updated_in_char1_lane / char1_pixels) >= 0.06:
            print(
                json.dumps(
                    {
                        "ok": True,
                        "applied": False,
                        "reason": "char1_lane_intrusion",
                        "coverage": mask_coverage,
                        "updatedCoverage": updated_coverage,
                        "char1Intrusion": float(updated_in_char1_lane / char1_pixels),
                        "outputPath": str(output_path),
                    },
                    ensure_ascii=False,
                )
            )
            return

    output_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(output, mode="RGBA").save(output_path)

    print(
        json.dumps(
            {
                "ok": True,
                "applied": True,
                "outputPath": str(output_path),
                "coverage": mask_coverage,
                "updatedPixels": updated_pixels,
                "updatedCoverage": updated_coverage,
                "blur": float(args.blur),
                "overlap": overlap_ratio,
                "lowConfidenceOverride": low_confidence_override,
                "source": "char2_primary" if use_primary_rescue else "stageB_output",
                "stageBMaskDeltaMean": stageb_delta_mean,
                "stageBMaskDeltaActiveCoverage": stageb_delta_active,
                "stageAChar2BaselineMean": stagea_char2_baseline_mean,
                "stageAChar2BaselineActiveCoverage": stagea_char2_baseline_active,
                "stageAChar2BaselineActiveRatio": stagea_char2_baseline_ratio,
                "primaryRescueSkippedByStageABaseline": bool(
                    (char2_primary is not None)
                    and (target_bounds is not None)
                    and stagea_char2_already_visible
                    and (stageb_delta_mean < 8.0 or stageb_delta_active < max(0.006, mask_coverage * 0.12))
                ),
                "primaryRescueMeta": rescue_meta,
                "validationReason": validation_reason,
                "preserveStageBChar1Lane": preserve_stageb_char1_lane,
                "char1PreservePixels": rescued_char1_pixels,
                "primaryRescueHintChar2Identity": bool(
                    prefer_primary_rescue_for_char2_identity
                    and (char2_primary is not None)
                    and (target_bounds is not None)
                    and not stagea_char2_already_visible
                ),
                "primaryRescueHintChar2Presence": bool(
                    prefer_primary_rescue_for_char2_presence
                    and (char2_primary is not None)
                    and (target_bounds is not None)
                    and not stagea_char2_already_visible
                ),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
