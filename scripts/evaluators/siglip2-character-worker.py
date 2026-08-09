#!/usr/bin/env python3
"""Persistent, offline-only SigLIP2 image embedding worker."""

from __future__ import annotations

import json
import hashlib
import math
import os
import stat
import sys
import tempfile
import warnings
from pathlib import Path
from typing import Any

MODEL_ID = "google/siglip2-base-patch16-224"
MODEL_REVISION = "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2"
MODEL_DIR = Path(
    r"C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Shared\models\character_evaluators\siglip2-base-patch16-224-75de2d5"
)
SNAPSHOT_MANIFEST_PATH = Path(__file__).resolve().parents[2] / "examples" / "character-consistency-benchmark" / "siglip2-snapshot-manifest.json"
SNAPSHOT_MANIFEST_SHA256 = "451ee614b7cf3349a125ffb24fa757238a455d369cb1b7ce15f6fc19b33a3b68"
MAX_IMAGE_BYTES = 40 * 1024 * 1024
MAX_DIMENSION = 8192
APPROVED_FORMATS = {"PNG", "JPEG", "WEBP"}

_processor = None
_model = None
_device = None
_snapshot_manifest_hash = None


class WorkerError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _sha256_file(file_path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with file_path.open("rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
    except OSError as exc:
        raise WorkerError("EMODEL_REVISION") from exc
    return digest.hexdigest()


def _verify_snapshot(model_dir: Path = MODEL_DIR, manifest_path: Path = SNAPSHOT_MANIFEST_PATH, expected_manifest_hash: str = SNAPSHOT_MANIFEST_SHA256) -> str:
    try:
        manifest_bytes = manifest_path.read_bytes()
    except OSError as exc:
        raise WorkerError("EMODEL_REVISION") from exc
    try:
        manifest = json.loads(manifest_bytes)
    except (json.JSONDecodeError, UnicodeError) as exc:
        raise WorkerError("EMODEL_INTEGRITY") from exc
    if not isinstance(manifest, dict):
        raise WorkerError("EMODEL_INTEGRITY")
    canonical_manifest = json.dumps(manifest, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    manifest_hash = hashlib.sha256(canonical_manifest).hexdigest()
    if not isinstance(expected_manifest_hash, str) or len(expected_manifest_hash) != 64 or manifest_hash != expected_manifest_hash.lower():
        raise WorkerError("EMODEL_INTEGRITY")
    files = manifest.get("files")
    if manifest.get("manifestVersion") != 1 or manifest.get("modelId") != MODEL_ID or manifest.get("modelRevision") != MODEL_REVISION or not isinstance(files, list) or not files:
        raise WorkerError("EMODEL_REVISION")
    try:
        root = model_dir.resolve(strict=True)
    except OSError as exc:
        raise WorkerError("EMODEL_REVISION") from exc
    seen = set()
    for entry in files:
        relative = entry.get("path") if isinstance(entry, dict) else None
        size = entry.get("size") if isinstance(entry, dict) else None
        expected_hash = entry.get("sha256") if isinstance(entry, dict) else None
        if not isinstance(relative, str) or not relative or relative in seen or "\\" in relative or Path(relative).is_absolute() or any(part in ("", ".", "..") for part in relative.split("/")):
            raise WorkerError("EMODEL_INTEGRITY")
        if not isinstance(size, int) or isinstance(size, bool) or size <= 0 or not isinstance(expected_hash, str) or len(expected_hash) != 64:
            raise WorkerError("EMODEL_INTEGRITY")
        seen.add(relative)
        try:
            candidate = (root / Path(*relative.split("/"))).resolve(strict=True)
            candidate.relative_to(root)
            file_stat = candidate.stat()
        except (OSError, ValueError) as exc:
            raise WorkerError("EMODEL_REVISION") from exc
        if not stat.S_ISREG(file_stat.st_mode):
            raise WorkerError("EMODEL_REVISION")
        if file_stat.st_size != size or _sha256_file(candidate) != expected_hash.lower():
            raise WorkerError("EMODEL_INTEGRITY")
    return manifest_hash


def _load_model():
    global _processor, _model, _device, _snapshot_manifest_hash
    if _model is not None:
        return _processor, _model, _device
    _snapshot_manifest_hash = _verify_snapshot()
    try:
        import torch
        from transformers import AutoModel, AutoProcessor

        _device = "cuda" if torch.cuda.is_available() else "cpu"
        _processor = AutoProcessor.from_pretrained(str(MODEL_DIR), local_files_only=True)
        _model = AutoModel.from_pretrained(str(MODEL_DIR), local_files_only=True).eval().to(_device)
        return _processor, _model, _device
    except WorkerError:
        raise
    except Exception as exc:
        raise WorkerError("EMODEL_MISSING") from exc


def _validated_image(path_value: Any):
    if not isinstance(path_value, str) or not path_value.strip() or "\x00" in path_value:
        raise WorkerError("EIMAGE_PATH")
    image_path = Path(path_value)
    try:
        file_stat = image_path.stat()
    except OSError as exc:
        raise WorkerError("EIMAGE_PATH") from exc
    if not stat.S_ISREG(file_stat.st_mode) or file_stat.st_size <= 0 or file_stat.st_size > MAX_IMAGE_BYTES:
        raise WorkerError("EIMAGE_PATH")
    try:
        from PIL import Image

        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(image_path) as opened:
                if opened.format not in APPROVED_FORMATS:
                    raise WorkerError("EIMAGE_FORMAT")
                width, height = opened.size
                if width < 1 or height < 1 or width > MAX_DIMENSION or height > MAX_DIMENSION:
                    raise WorkerError("EIMAGE_DIMENSIONS")
                opened.load()
                image = opened.convert("RGB")
    except WorkerError:
        raise
    except Exception as exc:
        raise WorkerError("EIMAGE_DECODE") from exc
    return image


def _quality(image) -> float:
    from PIL import ImageFilter, ImageStat

    luminance = image.convert("L")
    edges = luminance.filter(ImageFilter.FIND_EDGES)
    sharpness = min(1.0, math.sqrt(max(0.0, ImageStat.Stat(edges).var[0])) / 64.0)
    histogram = luminance.histogram()
    pixels = max(1, image.width * image.height)
    clipped = (sum(histogram[:4]) + sum(histogram[-4:])) / pixels
    clipping = max(0.0, 1.0 - min(1.0, clipped * 2.0))
    entropy = min(1.0, max(0.0, luminance.entropy() / 8.0))
    value = 0.45 * sharpness + 0.25 * clipping + 0.30 * entropy
    if not math.isfinite(value):
        raise WorkerError("EQUALITY")
    return round(min(1.0, max(0.0, value)), 6)


def embed(path_value: Any) -> dict[str, Any]:
    image = _validated_image(path_value)
    processor, model, device = _load_model()
    try:
        import torch

        inputs = processor(images=image, return_tensors="pt").to(device)
        with torch.inference_mode():
            features = model.get_image_features(**inputs)
            pooled = features.pooler_output if hasattr(features, "pooler_output") else features
            vector = pooled[0].float().cpu()
        norm = vector.norm()
        if not torch.isfinite(vector).all() or not torch.isfinite(norm) or norm.item() < 1e-12:
            raise WorkerError("EEMBEDDING")
        vector = vector / norm
        embedding = vector.tolist()
        if not embedding or any(not math.isfinite(value) for value in embedding):
            raise WorkerError("EEMBEDDING")
        return {"embedding": embedding, "quality": _quality(image)}
    except WorkerError:
        raise
    except Exception as exc:
        raise WorkerError("EINFERENCE") from exc


def _response(request: Any) -> dict[str, Any]:
    request_id = request.get("id") if isinstance(request, dict) else None
    if not isinstance(request, dict) or request.get("type") != "embed":
        return {"id": request_id, "ok": False, "errorCode": "EREQUEST"}
    try:
        result = embed(request.get("path"))
        return {
            "id": request_id,
            "ok": True,
            **result,
            "modelId": MODEL_ID,
            "modelRevision": MODEL_REVISION,
            "snapshotManifestHash": _snapshot_manifest_hash,
            "device": _device,
        }
    except WorkerError as exc:
        return {"id": request_id, "ok": False, "errorCode": exc.code}
    except Exception:
        return {"id": request_id, "ok": False, "errorCode": "EWORKER"}


def _self_test() -> int:
    try:
        from PIL import Image

        handle, temporary_path = tempfile.mkstemp(suffix=".png")
        os.close(handle)
        try:
            image = Image.new("RGB", (224, 224))
            pixels = image.load()
            for y in range(224):
                for x in range(224):
                    pixels[x, y] = ((x * 7) % 256, (y * 11) % 256, ((x + y) * 5) % 256)
            image.save(temporary_path, format="PNG")
            result = embed(temporary_path)
        finally:
            try:
                os.unlink(temporary_path)
            except OSError:
                pass
        vector = result["embedding"]
        norm = math.sqrt(sum(value * value for value in vector))
        output = {
            "ok": bool(vector) and all(math.isfinite(value) for value in vector) and abs(norm - 1.0) <= 1e-5,
            "modelId": MODEL_ID,
            "modelRevision": MODEL_REVISION,
            "snapshotManifestHash": _snapshot_manifest_hash,
            "device": _device,
            "embeddingLength": len(vector),
            "embeddingNorm": round(norm, 6),
        }
        print(json.dumps(output, separators=(",", ":")), flush=True)
        return 0 if output["ok"] else 1
    except WorkerError as exc:
        print(json.dumps({"ok": False, "errorCode": exc.code, "modelId": MODEL_ID, "modelRevision": MODEL_REVISION}, separators=(",", ":")), flush=True)
        return 1
    except Exception:
        print(json.dumps({"ok": False, "errorCode": "ESELF_TEST", "modelId": MODEL_ID, "modelRevision": MODEL_REVISION}, separators=(",", ":")), flush=True)
        return 1


def main() -> int:
    if sys.argv[1:] == ["--self-test"]:
        return _self_test()
    if len(sys.argv) == 5 and sys.argv[1] == "--verify-snapshot":
        try:
            manifest_hash = _verify_snapshot(Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4])
            print(json.dumps({"ok": True, "snapshotManifestHash": manifest_hash, "modelId": MODEL_ID, "modelRevision": MODEL_REVISION}, separators=(",", ":")), flush=True)
            return 0
        except WorkerError as exc:
            print(json.dumps({"ok": False, "errorCode": exc.code}, separators=(",", ":")), flush=True)
            return 1
    if sys.argv[1:]:
        return 2
    for line in sys.stdin:
        try:
            request = json.loads(line)
        except (json.JSONDecodeError, UnicodeError):
            response = {"id": None, "ok": False, "errorCode": "EMALFORMED"}
        else:
            response = _response(request)
        print(json.dumps(response, separators=(",", ":"), allow_nan=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
