#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import importlib.util
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ATTSTOR = ROOT / "scripts" / "evaluators" / "siglip2-character-attestor.py"
spec = importlib.util.spec_from_file_location("character_attestor_under_test", ATTSTOR)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

assert hasattr(module, "snapshot_attestation_image"), "attestor must expose its single-read immutable snapshot primitive"

PNG = b"\x89PNG\r\n\x1a\n" + b"original-pixels"
REPLACEMENT = b"\x89PNG\r\n\x1a\n" + b"replacement-pixels"
with tempfile.TemporaryDirectory(prefix="attestor-snapshot-test-") as temporary:
    root = Path(temporary)
    source = root / "source.png"
    snapshot_root = root / "owned"
    snapshot_root.mkdir()
    source.write_bytes(PNG)
    expected = hashlib.sha256(PNG).hexdigest()
    snapshot = module.snapshot_attestation_image(source, snapshot_root, "canonical-front", expected)
    source.write_bytes(REPLACEMENT)
    assert snapshot.read_bytes() == PNG, "attestation must score its owned bytes after an original-path replacement"
    assert hashlib.sha256(snapshot.read_bytes()).hexdigest() == expected

    raced = root / "raced.png"
    raced.write_bytes(PNG)
    try:
        module.snapshot_attestation_image(raced, snapshot_root, "canonical-raced", hashlib.sha256(REPLACEMENT).hexdigest())
    except ValueError as error:
        assert str(error) == "receipt_reference_hash_mismatch"
    else:
        raise AssertionError("a source mutation/race that misses the declared hash must fail closed")

print("character attestor snapshot checks passed")
