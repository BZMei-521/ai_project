#!/usr/bin/env python3
import argparse
import json
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


def load_rgba(path: str, size=None):
    image = Image.open(path).convert("RGBA")
    if size and image.size != size:
        image = image.resize(size, Image.BILINEAR)
    return np.asarray(image, dtype=np.float32)


def foreground_mean_color(image: np.ndarray):
    rgb = image[:, :, :3]
    h, w = rgb.shape[0], rgb.shape[1]
    corner = 30
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
    selected = dist >= 22
    if int(selected.sum()) <= 0:
        return None
    return rgb[selected].mean(axis=0)


def masked_active_mean_color(subject: np.ndarray, reference: np.ndarray, mask: np.ndarray):
    alpha = mask[:, :, 3]
    luminance = mask[:, :, :3].mean(axis=2)
    selected = (alpha >= 24) & (luminance >= 18)
    if int(selected.sum()) <= 0:
        return None, 0.0
    diff = np.abs(subject[:, :, :3] - reference[:, :, :3]).mean(axis=2)
    active = (diff >= 18) & selected
    active_count = int(active.sum())
    total_pixels = max(1, int(mask.shape[0] * mask.shape[1]))
    if active_count <= 0:
        return None, 0.0
    return subject[:, :, :3][active].mean(axis=0), float(active_count / total_pixels)


def masked_stats(subject: np.ndarray, reference: np.ndarray, mask: np.ndarray):
    alpha = mask[:, :, 3]
    luminance = mask[:, :, :3].mean(axis=2)
    selected = (alpha >= 24) & (luminance >= 18)
    pixel_count = int(selected.sum())
    total_pixels = max(1, int(mask.shape[0] * mask.shape[1]))
    if pixel_count <= 0:
        return {
            "pixelCount": 0,
            "maskCoverage": 0.0,
            "meanDiff": 0.0,
            "activeRatio": 0.0,
            "activeCoverage": 0.0,
        }
    diff = np.abs(subject[:, :, :3] - reference[:, :, :3]).mean(axis=2)
    selected_diff = diff[selected]
    active = selected_diff >= 18
    active_count = int(active.sum())
    return {
        "pixelCount": pixel_count,
        "maskCoverage": float(pixel_count / total_pixels),
        "meanDiff": float(selected_diff.mean()) if pixel_count > 0 else 0.0,
        "activeRatio": float(active_count / pixel_count) if pixel_count > 0 else 0.0,
        "activeCoverage": float(active_count / total_pixels),
    }


def outside_stats(subject: np.ndarray, reference: np.ndarray, masks: list[np.ndarray]):
    h, w = subject.shape[0], subject.shape[1]
    total_pixels = max(1, h * w)
    covered = np.zeros((h, w), dtype=bool)
    for mask in masks:
        alpha = mask[:, :, 3]
        luminance = mask[:, :, :3].mean(axis=2)
        covered |= (alpha >= 24) & (luminance >= 18)
    outside = ~covered
    outside_count = int(outside.sum())
    if outside_count <= 0:
        return {
            "pixelCount": 0,
            "outsideCoverage": 0.0,
            "meanDiff": 0.0,
            "activeRatio": 0.0,
            "activeCoverage": 0.0,
            "componentCount": 0,
            "largestBlobCoverage": 0.0,
        }

    diff = np.abs(subject[:, :, :3] - reference[:, :, :3]).mean(axis=2)
    outside_diff = diff[outside]
    active_map = (diff >= 18) & outside
    active_count = int(active_map.sum())

    component_count = 0
    largest_blob = 0
    if active_count > 0:
        visited = np.zeros_like(active_map, dtype=bool)
        for y in range(h):
            for x in range(w):
                if not active_map[y, x] or visited[y, x]:
                    continue
                component_count += 1
                q = deque([(x, y)])
                visited[y, x] = True
                size = 0
                while q:
                    cx, cy = q.popleft()
                    size += 1
                    if cx > 0 and active_map[cy, cx - 1] and not visited[cy, cx - 1]:
                        visited[cy, cx - 1] = True
                        q.append((cx - 1, cy))
                    if cx + 1 < w and active_map[cy, cx + 1] and not visited[cy, cx + 1]:
                        visited[cy, cx + 1] = True
                        q.append((cx + 1, cy))
                    if cy > 0 and active_map[cy - 1, cx] and not visited[cy - 1, cx]:
                        visited[cy - 1, cx] = True
                        q.append((cx, cy - 1))
                    if cy + 1 < h and active_map[cy + 1, cx] and not visited[cy + 1, cx]:
                        visited[cy + 1, cx] = True
                        q.append((cx, cy + 1))
                if size > largest_blob:
                    largest_blob = size

    return {
        "pixelCount": outside_count,
        "outsideCoverage": float(outside_count / total_pixels),
        "meanDiff": float(outside_diff.mean()) if outside_count > 0 else 0.0,
        "activeRatio": float(active_count / outside_count) if outside_count > 0 else 0.0,
        "activeCoverage": float(active_count / total_pixels),
        "componentCount": int(component_count),
        "largestBlobCoverage": float(largest_blob / total_pixels),
    }


def lane_visible(stats):
    if not stats or stats["pixelCount"] <= 0:
        return False
    if stats["maskCoverage"] < 0.002:
        return False
    min_active_coverage = max(0.01, min(0.04, stats["maskCoverage"] * 0.4))
    fallback_coverage = max(0.009, min(0.04, stats["maskCoverage"] * 0.24))
    baseline_visible = (
        stats["meanDiff"] >= 18
        and stats["activeRatio"] >= 0.22
        and stats["activeCoverage"] >= min_active_coverage
    )
    fallback_visible = (
        stats["meanDiff"] >= 24
        and stats["activeRatio"] >= 0.18
        and stats["activeCoverage"] >= fallback_coverage
    )
    moderate_visible = (
        stats["meanDiff"] >= 12
        and stats["activeRatio"] >= 0.1
        and stats["activeCoverage"] >= max(0.006, min(0.024, stats["maskCoverage"] * 0.11))
    )
    large_mask_soft_visible = (
        stats["maskCoverage"] >= 0.1
        and stats["meanDiff"] >= 20
        and stats["activeRatio"] >= 0.12
        and stats["activeCoverage"] >= max(0.016, min(0.03, stats["maskCoverage"] * 0.12))
    )
    return baseline_visible or fallback_visible or moderate_visible or large_mask_soft_visible


def lane_visible_secondary(stats):
    if not stats or stats["pixelCount"] <= 0:
        return False
    if stats["maskCoverage"] < 0.002:
        return False
    min_active_coverage = max(0.014, min(0.06, stats["maskCoverage"] * 0.4))
    fallback_coverage = max(0.008, min(0.04, stats["maskCoverage"] * 0.16))
    baseline_visible = (
        stats["meanDiff"] >= 20
        and stats["activeRatio"] >= 0.3
        and stats["activeCoverage"] >= min_active_coverage
    )
    fallback_visible = (
        stats["meanDiff"] >= 18
        and stats["activeRatio"] >= 0.16
        and stats["activeCoverage"] >= fallback_coverage
    )
    moderate_visible = (
        stats["meanDiff"] >= 12
        and stats["activeRatio"] >= 0.18
        and stats["activeCoverage"] >= max(0.009, min(0.035, stats["maskCoverage"] * 0.18))
    )
    return baseline_visible or fallback_visible or moderate_visible


def lane_suppressed(stats):
    if not stats or stats["pixelCount"] <= 0:
        return True
    if stats["maskCoverage"] < 0.002:
        return True
    return stats["meanDiff"] <= 7 and stats["activeRatio"] <= 0.12


def dual_masks_broken(char1_stats, char2_stats):
    if not char1_stats or not char2_stats:
        return True
    if char1_stats["pixelCount"] <= 0 or char2_stats["pixelCount"] <= 0:
        return True
    if char1_stats["maskCoverage"] >= 0.92 and char2_stats["maskCoverage"] >= 0.92:
        return True
    if char1_stats["maskCoverage"] < 0.004 or char2_stats["maskCoverage"] < 0.004:
        return True
    return False


def outside_stable(stats):
    if not stats or stats["pixelCount"] <= 0:
        return True
    if stats["outsideCoverage"] < 0.02:
        return True
    if stats["activeCoverage"] >= 0.05 and stats["meanDiff"] >= 6.5:
        return False
    if stats["activeCoverage"] >= 0.08 and stats["meanDiff"] >= 9.5:
        return False
    if stats["activeCoverage"] >= 0.035 and stats["largestBlobCoverage"] >= 0.011 and stats["meanDiff"] >= 7.5:
        return False
    if stats["largestBlobCoverage"] >= 0.02 and stats["meanDiff"] >= 7.0:
        return False
    return True


def outside_stable_relative_stagea(stats):
    if not stats or stats["pixelCount"] <= 0:
        return True
    if stats["outsideCoverage"] < 0.02:
        return True
    if stats["activeCoverage"] >= 0.04 and stats["largestBlobCoverage"] >= 0.015 and stats["meanDiff"] >= 10:
        return False
    if stats["activeCoverage"] >= 0.15 and stats["meanDiff"] >= 16:
        return False
    if stats["activeCoverage"] >= 0.2 and stats["meanDiff"] >= 20:
        return False
    if stats["activeCoverage"] >= 0.1 and stats["largestBlobCoverage"] >= 0.05 and stats["meanDiff"] >= 14:
        return False
    if stats["largestBlobCoverage"] >= 0.09 and stats["meanDiff"] >= 14:
        return False
    return True


def outside_stable_stagea(stats):
    if not stats or stats["pixelCount"] <= 0:
        return True
    if stats["outsideCoverage"] < 0.02:
        return True
    if stats["activeCoverage"] >= 0.28 and stats["meanDiff"] >= 20:
        return False
    if stats["activeCoverage"] >= 0.22 and stats["meanDiff"] >= 24:
        return False
    if stats["largestBlobCoverage"] >= 0.14 and stats["meanDiff"] >= 16:
        return False
    return True


def validate(request):
    stage_a_path = request.get("stageAPath", "")
    stage_a_base_path = request.get("stageABasePath", stage_a_path) or stage_a_path
    stage_b_path = request.get("stageBPath", "")
    scene_path = request.get("scenePath", "")
    char1_primary_path = request.get("char1PrimaryPath", "")
    char1_mask_path = request.get("char1MaskPath", "")
    char2_mask_path = request.get("char2MaskPath", "")
    char2_primary_path = request.get("char2PrimaryPath", "")
    expect_dual = bool(request.get("expectDual", False))

    if not stage_a_path or not scene_path or not char1_mask_path:
        return {"ok": False, "reason": "validator_missing_required_paths", "metrics": {}}

    stage_a = load_rgba(stage_a_path)
    size = (stage_a.shape[1], stage_a.shape[0])
    stage_a_base = load_rgba(stage_a_base_path, size=size)
    scene = load_rgba(scene_path, size=size)
    mask1 = load_rgba(char1_mask_path, size=size)
    mask2 = load_rgba(char2_mask_path, size=size) if char2_mask_path else None

    stage_a_char1 = masked_stats(stage_a, scene, mask1)
    stage_a_char2 = masked_stats(stage_a, scene, mask2) if (expect_dual and mask2 is not None) else None
    stage_a_outside = outside_stats(stage_a, scene, [m for m in [mask1, mask2] if m is not None])

    metrics = {
        "stageA": {
            "char1_vs_scene": stage_a_char1,
            "char2_vs_scene": stage_a_char2,
            "outside_vs_scene": stage_a_outside,
        }
    }

    if not lane_visible(stage_a_char1):
        return {"ok": False, "reason": "invalid_stageA_char1_missing_or_too_weak", "metrics": metrics}
    if char1_primary_path:
        try:
            char1_primary = load_rgba(char1_primary_path)
            ref_mean = foreground_mean_color(char1_primary)
            lane_mean, lane_active_coverage = masked_active_mean_color(stage_a, scene, mask1)
            if ref_mean is not None and lane_mean is not None:
                color_distance = float(np.linalg.norm(lane_mean - ref_mean))
                metrics["stageA"]["char1_identity_color_distance"] = color_distance
                if lane_active_coverage >= 0.05 and color_distance >= 110:
                    return {"ok": False, "reason": "invalid_stageA_char1_identity_or_outfit_drift", "metrics": metrics}
        except Exception:
            pass
    if expect_dual and stage_a_char2 is not None:
        if not dual_masks_broken(stage_a_char1, stage_a_char2):
            if not lane_suppressed(stage_a_char2):
                severe_leak = (
                    stage_a_char2["meanDiff"] >= 14
                    and stage_a_char2["activeRatio"] >= 0.3
                    and stage_a_char2["activeCoverage"] >= 0.012
                )
                catastrophic_leak = (
                    severe_leak
                    and stage_a_char2["meanDiff"] >= 34
                    and stage_a_char2["activeRatio"] >= 0.9
                    and stage_a_char2["activeCoverage"] >= 0.1
                )
                if catastrophic_leak:
                    return {"ok": False, "reason": "invalid_stageA_second_person_leaked", "metrics": metrics}

    if expect_dual and not outside_stable_stagea(stage_a_outside):
        # In dual-character mode, Stage A is allowed to carry some drift/leak as long as it is not
        # catastrophic; Stage B and final outside-mask checks will enforce the real pass/fail gate.
        catastrophic_stagea_drift = (
            stage_a_outside["activeCoverage"] >= 0.3
            and stage_a_outside["largestBlobCoverage"] >= 0.2
            and stage_a_outside["meanDiff"] >= 30
        )
        if catastrophic_stagea_drift:
            return {"ok": False, "reason": "invalid_stageA_scene_drift_or_unmasked_subject", "metrics": metrics}

    if not expect_dual:
        return {"ok": True, "reason": "ok", "metrics": metrics}

    if not stage_b_path:
        return {"ok": False, "reason": "validator_missing_stageB_path", "metrics": metrics}

    stage_b = load_rgba(stage_b_path, size=size)
    stage_b_char1_scene = masked_stats(stage_b, scene, mask1)
    stage_b_char2_scene = masked_stats(stage_b, scene, mask2) if mask2 is not None else None
    stage_b_char2_stagea = masked_stats(stage_b, stage_a_base, mask2) if mask2 is not None else None
    stage_b_outside_scene = outside_stats(stage_b, scene, [m for m in [mask1, mask2] if m is not None])
    stage_b_outside_stagea = outside_stats(stage_b, stage_a_base, [m for m in [mask1, mask2] if m is not None])

    metrics["stageB"] = {
        "char1_vs_scene": stage_b_char1_scene,
        "char2_vs_scene": stage_b_char2_scene,
        "char2_vs_stageA": stage_b_char2_stagea,
        "outside_vs_scene": stage_b_outside_scene,
        "outside_vs_stageA": stage_b_outside_stagea,
    }

    if dual_masks_broken(stage_b_char1_scene, stage_b_char2_scene):
        return {"ok": True, "reason": "stageB_validation_skipped_unusable_dual_masks", "metrics": metrics}

    if not lane_visible(stage_b_char1_scene):
        return {"ok": False, "reason": "invalid_stageB_char1_missing_or_too_weak", "metrics": metrics}
    if char1_primary_path:
        try:
            char1_primary = load_rgba(char1_primary_path)
            ref_mean = foreground_mean_color(char1_primary)
            lane_mean, lane_active_coverage = masked_active_mean_color(stage_b, scene, mask1)
            stagea_lane_mean, stagea_lane_active_coverage = masked_active_mean_color(stage_a_base, scene, mask1)
            if ref_mean is not None and lane_mean is not None:
                color_distance = float(np.linalg.norm(lane_mean - ref_mean))
                metrics["stageB"]["char1_identity_color_distance"] = color_distance
                color_distance_to_char2 = None
                if char2_primary_path:
                    try:
                        char2_primary = load_rgba(char2_primary_path)
                        char2_ref_mean = foreground_mean_color(char2_primary)
                        if char2_ref_mean is not None:
                            color_distance_to_char2 = float(np.linalg.norm(lane_mean - char2_ref_mean))
                            metrics["stageB"]["char1_identity_color_distance_to_char2"] = color_distance_to_char2
                    except Exception:
                        color_distance_to_char2 = None
                stagea_color_distance = None
                if stagea_lane_mean is not None:
                    stagea_color_distance = float(np.linalg.norm(lane_mean - stagea_lane_mean))
                    metrics["stageB"]["char1_identity_color_distance_to_stageA"] = stagea_color_distance
                    metrics["stageB"]["char1_stageA_active_coverage"] = float(stagea_lane_active_coverage)
                stagea_identity_distance = None
                if stagea_lane_mean is not None:
                    stagea_identity_distance = float(np.linalg.norm(stagea_lane_mean - ref_mean))
                    metrics["stageB"]["char1_stageA_identity_color_distance"] = stagea_identity_distance
                stagea_looks_corrupted = (
                    stagea_identity_distance is not None
                    and stagea_lane_active_coverage >= 0.05
                    and stagea_identity_distance >= 110
                )
                stagea_consistency_trusted = stagea_lane_active_coverage >= max(
                    0.012, min(0.06, stage_b_char1_scene["maskCoverage"] * 0.22)
                ) and not stagea_looks_corrupted
                stagea_consistent = (
                    stagea_color_distance is not None
                    and stagea_consistency_trusted
                    and stagea_color_distance <= 28
                )
                stagea_distance_reliable = stagea_color_distance is not None
                stagea_aligned_on_corrupted_base = (
                    stagea_looks_corrupted
                    and stagea_distance_reliable
                    and stagea_color_distance <= 8
                )
                likely_replaced_by_char2 = (
                    (not stagea_aligned_on_corrupted_base)
                    and
                    color_distance_to_char2 is not None
                    and lane_active_coverage >= max(0.018, min(0.06, stage_b_char1_scene["maskCoverage"] * 0.25))
                    and color_distance_to_char2 <= 84
                    and color_distance_to_char2 + 16 < color_distance
                )
                suspicious_drift_on_corrupted_stagea = (
                    stagea_looks_corrupted
                    and lane_active_coverage >= 0.04
                    and color_distance >= 96
                    and (stagea_color_distance is None or stagea_color_distance >= 16)
                )
                aligned_corrupted_identity_carryover = (
                    stagea_aligned_on_corrupted_base
                    and lane_active_coverage >= 0.05
                    and color_distance >= 128
                    and stagea_identity_distance is not None
                    and stagea_identity_distance >= 128
                )
                severe_char1_identity_mismatch = (
                    lane_active_coverage >= 0.05
                    and color_distance >= 110
                    and (
                        (stagea_color_distance is None or stagea_color_distance >= 18)
                        if stagea_looks_corrupted
                        else (not stagea_consistent)
                    )
                )
                if (
                    severe_char1_identity_mismatch
                ) or likely_replaced_by_char2 or suspicious_drift_on_corrupted_stagea or aligned_corrupted_identity_carryover:
                    return {"ok": False, "reason": "invalid_stageB_char1_identity_or_outfit_drift", "metrics": metrics}
        except Exception:
            pass
    if not lane_visible_secondary(stage_b_char2_scene):
        return {"ok": False, "reason": "invalid_stageB_char2_missing_or_too_weak", "metrics": metrics}

    if char2_primary_path:
        try:
            char2_primary = load_rgba(char2_primary_path)
            ref_mean = foreground_mean_color(char2_primary)
            lane_mean, lane_active_coverage = masked_active_mean_color(stage_b, scene, mask2) if mask2 is not None else (None, 0.0)
            if ref_mean is not None and lane_mean is not None:
                color_distance = float(np.linalg.norm(lane_mean - ref_mean))
                metrics["stageB"]["char2_identity_color_distance"] = color_distance
                color_distance_to_char1 = None
                if char1_primary_path:
                    try:
                        char1_primary = load_rgba(char1_primary_path)
                        char1_ref_mean = foreground_mean_color(char1_primary)
                        if char1_ref_mean is not None:
                            color_distance_to_char1 = float(np.linalg.norm(lane_mean - char1_ref_mean))
                            metrics["stageB"]["char2_identity_color_distance_to_char1"] = color_distance_to_char1
                    except Exception:
                        color_distance_to_char1 = None

                strong_mismatch = lane_active_coverage >= 0.04 and color_distance >= 100
                severe_small_area_mismatch = (
                    lane_active_coverage >= max(0.012, min(0.028, stage_b_char2_scene["maskCoverage"] * 0.2))
                    and color_distance >= 122
                )
                tiny_area_extreme_mismatch = lane_active_coverage >= 0.009 and color_distance >= 145
                likely_slot_duplicate = (
                    lane_active_coverage >= 0.03
                    and color_distance >= 85
                    and color_distance_to_char1 is not None
                    and color_distance_to_char1 + 12 < color_distance
                )
                if strong_mismatch or severe_small_area_mismatch or tiny_area_extreme_mismatch or likely_slot_duplicate:
                    return {"ok": False, "reason": "invalid_stageB_char2_identity_or_outfit_drift", "metrics": metrics}
        except Exception:
            pass

    char2_added = (
        stage_b_char2_stagea is not None
        and stage_b_char2_stagea["pixelCount"] > 0
        and stage_b_char2_stagea["meanDiff"] >= 12
        and stage_b_char2_stagea["activeRatio"] >= 0.18
        and stage_b_char2_stagea["activeCoverage"]
        >= max(0.009, min(0.04, stage_b_char2_scene["maskCoverage"] * 0.18))
    )
    char2_preexisting_in_stagea = (
        stage_a_char2 is not None
        and lane_visible_secondary(stage_a_char2)
        and lane_visible_secondary(stage_b_char2_scene)
        and stage_b_char2_scene["meanDiff"] >= max(14, stage_a_char2["meanDiff"] * 0.72)
        and stage_b_char2_scene["activeCoverage"] >= max(0.008, stage_a_char2["activeCoverage"] * 0.6)
    )
    if (not char2_added) and (not char2_preexisting_in_stagea):
        return {"ok": False, "reason": "invalid_stageB_char2_not_added", "metrics": metrics}

    if (not outside_stable(stage_b_outside_scene)) and (not outside_stable_relative_stagea(stage_b_outside_stagea)):
        return {"ok": False, "reason": "invalid_stageB_unmasked_extra_subject_or_scene_drift", "metrics": metrics}

    return {"ok": True, "reason": "ok", "metrics": metrics}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    args = parser.parse_args()
    payload = json.loads(Path(args.request).read_text(encoding="utf-8"))
    result = validate(payload)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
