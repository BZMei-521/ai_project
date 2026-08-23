#!/usr/bin/env python3
"""Desktop-only character evidence attestor using the pinned SigLIP2 worker."""
from __future__ import annotations

import hashlib
import hmac
import importlib.util
import json
import math
import os
import secrets
import stat
import sys
import re
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORKER_PATH = HERE / "siglip2-character-worker.py"
POLICY_PATH = HERE.parents[1] / "examples" / "character-consistency-benchmark" / "siglip2-evaluator.example.json"
ISSUER = "storyboard-desktop-character-evidence-v1"
TRUSTED_IMPLEMENTATION_HASH = "928799e00d8f1af139caa01be76fe750416c710711c432940a151c2f7072571e"
SHOT_IDS = ["front_close", "three_quarter_medium", "left_profile", "right_profile", "back_view", "full_body_action", "strong_expression", "different_lighting"]
DIMENSIONS = ["face", "hair", "outfit", "body", "quality"]
DIMENSION_SLOTS = {
    "face": ["face_master", "face_left", "face_right"],
    "hair": ["hair_back", "face_master", "face_left", "face_right"],
    "outfit": ["body_front", "body_side", "body_back"],
    "body": ["body_front", "body_side", "body_back"],
}
RECEIPT_ID_RE = re.compile(r"^[a-f0-9]{64}$")
SHA256_RE = re.compile(r"^[a-f0-9]{64}$", re.IGNORECASE)
CANONICAL_SLOTS = ["front", "side", "back"]
REFERENCE_SLOTS = ["face_master", "face_left", "face_right", "hair_back", "body_front", "body_side", "body_back", "expression_neutral"]
TRANSFORMS = ["none", "mirror_x", "head_shoulders_crop"]

def text(value): return value.strip() if isinstance(value, str) and value.strip() else None
def sha_value(value): return isinstance(value, str) and SHA256_RE.fullmatch(value) is not None
def score(value): return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 1 else None
def lora_strength(value): return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 < value <= 1.5 else None
def same_strength(left, right): return lora_strength(left) is not None and lora_strength(right) is not None and abs(left - right) <= 1e-9

def normalize_proof(proof):
    if not isinstance(proof, dict): return None
    models = [{"id": text(item.get("id")), "classType": text(item.get("classType")), "field": text(item.get("field")), "model": text(item.get("model"))} for item in proof.get("authoritativeModelBindings", []) if isinstance(item, dict)]
    loras = []
    for item in proof.get("authoritativeLoraBindings", []):
        if not isinstance(item, dict): continue
        strength_model = lora_strength(item.get("strengthModel"))
        strength_clip = item.get("strengthClip") if item.get("strengthClip") is None else lora_strength(item.get("strengthClip"))
        loras.append({"id": text(item.get("id")), "classType": text(item.get("classType")), "field": text(item.get("field")), "loraName": text(item.get("loraName")), "strengthModel": strength_model, "strengthClip": strength_clip, "clipStrengthPolicy": text(item.get("clipStrengthPolicy")), "modelPathNodeIds": [text(value) for value in item.get("modelPathNodeIds", [])], "modelPathEdges": [{"fromNodeId": text(edge.get("fromNodeId")), "fromOutputIndex": edge.get("fromOutputIndex") if isinstance(edge.get("fromOutputIndex"), int) and not isinstance(edge.get("fromOutputIndex"), bool) else None, "toNodeId": text(edge.get("toNodeId")), "toInput": text(edge.get("toInput"))} for edge in item.get("modelPathEdges", []) if isinstance(edge, dict)]})
    return {"providerId": text(proof.get("providerId")), "workflowDigest": text(proof.get("workflowDigest")), "terminalOutputNode": text(proof.get("terminalOutputNode")), "authoritativeModelBindings": models, "authoritativeLoraBindings": loras}

def report_payload(report):
    subject = report.get("subject") if isinstance(report.get("subject"), dict) else None
    proof = normalize_proof(report.get("preflight", {}).get("providerProof")) if isinstance(report.get("preflight"), dict) else None
    evaluator = report.get("evaluatorProof") if isinstance(report.get("evaluatorProof"), dict) else None
    return {
        "generationMode": text(report.get("generationMode")), "benchmarkVersion": text(report.get("benchmarkVersion")), "promptTemplateVersion": text(report.get("promptTemplateVersion")), "fixtureDigest": text(report.get("fixtureDigest")), "generationParametersDigest": text(report.get("generationParametersDigest")), "character": text(report.get("character")), "provider": text(report.get("provider")), "referenceManifestDigest": text(report.get("referenceManifestDigest")),
        "subject": {"characterAssetId": text(subject.get("characterAssetId")), "provider": text(subject.get("provider")), "identityPackVersion": text(subject.get("identityPackVersion")), "identityMetadataDigest": text(subject.get("identityMetadataDigest")), "modelName": text(subject.get("modelName")), "loraName": text(subject.get("loraName")), "loraVersion": text(subject.get("loraVersion")), "loraStrength": lora_strength(subject.get("loraStrength")), "candidateStatus": text(subject.get("candidateStatus"))} if subject else None,
        "references": [{"shotId": text(item.get("shotId")), "slot": text(item.get("slot")), "sourceSha256": text(item.get("sourceSha256")), "transformedSha256": text(item.get("transformedSha256")), "transform": text(item.get("transform"))} for item in report.get("references", []) if isinstance(item, dict)],
        "workflowProof": proof,
        "evaluatorProof": {"id": text(evaluator.get("id")), "version": text(evaluator.get("version")), "implementationHash": text(evaluator.get("implementationHash")), "policyHash": text(evaluator.get("policyHash")), "dimensionThreshold": evaluator.get("dimensionThreshold") if score(evaluator.get("dimensionThreshold")) not in (None, 0) else None} if evaluator else None,
        "fallbackUsed": False if report.get("preflight", {}).get("fallbackUsed") is False else True,
        "cutoutFallbackUsed": False if report.get("preflight", {}).get("cutoutFallbackUsed") is False else True,
        "aggregate": {"status": text(report.get("aggregate", {}).get("status")), "accepted": report.get("aggregate", {}).get("accepted"), "score": score(report.get("aggregate", {}).get("score"))} if isinstance(report.get("aggregate"), dict) else None,
        "shots": [{"id": text(item.get("id")), "outputSha256": text(item.get("outputSha256")), "score": score(item.get("score")), "dimensionScores": {name: score(item.get("dimensionScores", {}).get(name)) for name in DIMENSIONS} if isinstance(item.get("dimensionScores"), dict) else {}, "retries": item.get("retries") if isinstance(item.get("retries"), int) and not isinstance(item.get("retries"), bool) else None, "finalStatus": text(item.get("finalStatus")), "provenance": text(item.get("provenance")), "actualProvider": text(item.get("actualProvider")), "terminalOutputNode": text(item.get("terminalOutputNode"))} for item in report.get("shots", []) if isinstance(item, dict)]
    }

def validate_strict_report(report):
    payload = report_payload(report); subject = payload["subject"]; proof = payload["workflowProof"]; evaluator = payload["evaluatorProof"]
    required_hashes = [payload["fixtureDigest"], payload["generationParametersDigest"], payload["referenceManifestDigest"], subject.get("identityMetadataDigest") if subject else None, proof.get("workflowDigest") if proof else None, evaluator.get("implementationHash") if evaluator else None, evaluator.get("policyHash") if evaluator else None]
    required_text = [payload["benchmarkVersion"], payload["promptTemplateVersion"], payload["character"], payload["provider"], evaluator.get("id") if evaluator else None, evaluator.get("version") if evaluator else None]
    if payload["generationMode"] not in ("zero_shot_multi_reference", "lora_augmented") or not all(text(value) for value in required_text) or not all(sha_value(value) for value in required_hashes): raise ValueError("report_not_evidence_eligible")
    if not subject or subject["characterAssetId"] != payload["character"] or subject["provider"] != payload["provider"] or not all(text(subject.get(key)) for key in ("identityPackVersion", "modelName")): raise ValueError("report_not_evidence_eligible")
    models = proof.get("authoritativeModelBindings", []) if proof else []
    if not proof or proof["providerId"] != payload["provider"] or not text(proof["terminalOutputNode"]) or not models or any(not all(text(item.get(key)) for key in ("id", "classType", "field", "model")) or Path(item["model"]).name.lower() != Path(subject["modelName"]).name.lower() for item in models): raise ValueError("receipt_workflow_proof_invalid")
    loras = proof.get("authoritativeLoraBindings", [])
    if payload["generationMode"] == "zero_shot_multi_reference" and (loras or any(subject.get(key) is not None for key in ("loraName", "loraVersion", "loraStrength", "candidateStatus"))): raise ValueError("receipt_workflow_proof_invalid")
    if payload["generationMode"] == "lora_augmented":
        if not loras or not subject.get("loraName") or not subject.get("loraVersion") or lora_strength(subject.get("loraStrength")) is None or subject.get("candidateStatus") not in ("dataset_ready", "training"): raise ValueError("receipt_workflow_proof_invalid")
        for item in loras:
            nodes = item.get("modelPathNodeIds", []); edges = item.get("modelPathEdges", [])
            connected = len(nodes) >= 2 and nodes[0] == item.get("id") and len(edges) == len(nodes) - 1 and all(edge.get("fromNodeId") == nodes[index] and edge.get("fromOutputIndex") == 0 and edge.get("toNodeId") == nodes[index + 1] and edge.get("toInput") == "model" for index, edge in enumerate(edges))
            common = item.get("field") == "lora_name" and item.get("loraName") == subject.get("loraName") and same_strength(item.get("strengthModel"), subject.get("loraStrength")) and connected
            loader = item.get("classType") == "LoraLoader" and item.get("clipStrengthPolicy") == "equal_to_model" and same_strength(item.get("strengthClip"), subject.get("loraStrength")) and same_strength(item.get("strengthClip"), item.get("strengthModel"))
            model_only = item.get("classType") == "LoraLoaderModelOnly" and item.get("clipStrengthPolicy") == "not_applicable" and item.get("strengthClip") is None
            if not common or not (loader or model_only): raise ValueError("receipt_workflow_proof_invalid")
    refs = payload["references"]
    if len(refs) != 16 or any(item["shotId"] != SHOT_IDS[index // 2] or item["slot"] not in REFERENCE_SLOTS or not sha_value(item["sourceSha256"]) or not sha_value(item["transformedSha256"]) or item["transform"] not in TRANSFORMS for index, item in enumerate(refs)) or len({(item["shotId"], item["slot"]) for item in refs}) != 16: raise ValueError("receipt_reference_evidence_mismatch")
    threshold = evaluator.get("dimensionThreshold") if evaluator else None
    shots = payload["shots"]
    if payload["fallbackUsed"] or payload["cutoutFallbackUsed"] or not evaluator or not threshold or len(shots) != 8 or [item["id"] for item in shots] != SHOT_IDS: raise ValueError("report_not_evidence_eligible")
    if any(not sha_value(item["outputSha256"]) or item["finalStatus"] != "accepted" or item["provenance"] != "model_generation" or item["actualProvider"] != payload["provider"] or item["terminalOutputNode"] != proof["terminalOutputNode"] or item["score"] is None or not isinstance(item["retries"], int) or item["retries"] < 0 or set(item["dimensionScores"]) != set(DIMENSIONS) or any(value is None or value < threshold for value in item["dimensionScores"].values()) for item in shots): raise ValueError("receipt_shot_invalid")
    aggregate = payload["aggregate"]
    if not aggregate or aggregate["status"] != "accepted" or aggregate["accepted"] != 8 or aggregate["score"] is None: raise ValueError("report_not_evidence_eligible")
    expected_digest = digest(payload)
    if report.get("evidenceDigest") != expected_digest: raise ValueError("report_digest_mismatch")
    return payload

def stable(value):
    if isinstance(value, list): return "[" + ",".join(stable(item) for item in value) + "]"
    if isinstance(value, dict): return "{" + ",".join(json.dumps(key, ensure_ascii=False) + ":" + stable(value[key]) for key in sorted(value)) + "}"
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

def digest(value): return hashlib.sha256(stable(value).encode("utf-8")).hexdigest()

def claims(source, report_digest=None):
    subject = source.get("subject") if isinstance(source.get("subject"), dict) else source
    evaluator = source.get("evaluatorProof") if isinstance(source.get("evaluatorProof"), dict) else source
    shots = source.get("shots") if isinstance(source.get("shots"), list) else []
    result = {
        "reportDigest": report_digest or source.get("sourceReportDigest") or source.get("evidenceDigest"),
        "generationMode": source.get("generationMode"),
        "characterAssetId": subject.get("characterAssetId"),
        "identityPackVersion": subject.get("identityPackVersion"),
        "identityMetadataDigest": subject.get("identityMetadataDigest"),
        "fixtureDigest": source.get("fixtureDigest"),
        "evaluatorImplementationHash": evaluator.get("implementationHash") or source.get("evaluatorImplementationHash"),
        "evaluatorPolicyHash": evaluator.get("policyHash") or source.get("evaluatorPolicyHash"),
        "outputHashesDigest": digest([{"id": shot.get("id"), "outputSha256": shot.get("outputSha256")} for shot in shots]),
        "referenceBindingDigest": digest({
            "referenceManifestDigest": source.get("referenceManifestDigest"),
            "references": [{"shotId": item.get("shotId"), "slot": item.get("slot"), "sourceSha256": item.get("sourceSha256"), "transformedSha256": item.get("transformedSha256"), "transform": item.get("transform")} for item in source.get("references", [])] if isinstance(source.get("references"), list) else [],
        }),
    }
    if any(not isinstance(value, str) or not value for value in result.values()): raise ValueError("trusted_receipt_claims_invalid")
    return result

def load_worker():
    spec = importlib.util.spec_from_file_location("storyboard_siglip_worker", WORKER_PATH)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

def load_reference_preparer():
    source = HERE.parent / "prepare-character-reference.py"
    spec = importlib.util.spec_from_file_location("storyboard_reference_preparer", source)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

def image_magic_matches(path, data):
    suffix = path.suffix.lower()
    if suffix == ".png": return data.startswith(b"\x89PNG\r\n\x1a\n")
    if suffix in (".jpg", ".jpeg"): return data.startswith(b"\xff\xd8\xff")
    if suffix == ".webp": return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    return False

def snapshot_attestation_image(source, snapshot_root, label, expected_sha256, hash_error="receipt_reference_hash_mismatch"):
    source = Path(source).resolve(strict=True)
    if source.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp") or not sha_value(expected_sha256) or not source.is_file(): raise ValueError("receipt_reference_invalid")
    with source.open("rb") as handle: data = handle.read(40 * 1024 * 1024 + 1)
    if not data or len(data) > 40 * 1024 * 1024 or not image_magic_matches(source, data): raise ValueError("receipt_reference_invalid")
    actual_sha256 = hashlib.sha256(data).hexdigest()
    if not hmac.compare_digest(actual_sha256, str(expected_sha256).lower()): raise ValueError(hash_error)
    target = Path(snapshot_root) / f"{label}{source.suffix.lower()}"
    with target.open("xb") as handle:
        handle.write(data); handle.flush(); os.fsync(handle.fileno())
    try: os.chmod(target, stat.S_IRUSR)
    except OSError: pass
    return target

def snapshot_verification_inputs(report, bundle, artifact_root, snapshot_root):
    reference_items = bundle.get("references")
    if not isinstance(reference_items, list) or [item.get("slot") if isinstance(item, dict) else None for item in reference_items] != CANONICAL_SLOTS: raise ValueError("receipt_reference_invalid")
    canonical = {}
    for item in reference_items:
        expected = item.get("sourceSha256")
        snapshot = snapshot_attestation_image(item.get("sourcePath", ""), snapshot_root, f"reference-{item['slot']}", expected)
        canonical[item["slot"]] = {"sourcePath": snapshot, "sourceSha256": expected}
    output_items = bundle.get("outputs")
    if not isinstance(output_items, list) or len(output_items) != 8: raise ValueError("receipt_verification_bundle_missing")
    declared_by_id = {item.get("id"): item for item in output_items if isinstance(item, dict)}
    if set(declared_by_id) != set(SHOT_IDS): raise ValueError("receipt_verification_bundle_missing")
    shots_by_id = {item.get("id"): item for item in report.get("shots", []) if isinstance(item, dict)}
    outputs = {}
    for shot_id in SHOT_IDS:
        declared = declared_by_id[shot_id]; shot = shots_by_id.get(shot_id)
        if not shot or not sha_value(declared.get("outputSha256")) or str(declared["outputSha256"]).lower() != str(shot.get("outputSha256", "")).lower(): raise ValueError("receipt_output_hash_mismatch")
        original = Path(str(declared.get("outputPath", ""))).resolve(strict=True)
        try: original.relative_to(artifact_root)
        except ValueError: raise ValueError("receipt_path_invalid")
        outputs[shot_id] = snapshot_attestation_image(original, snapshot_root, f"output-{shot_id}", declared["outputSha256"], "receipt_output_hash_mismatch")
    return canonical, outputs

def canonical_reference_binding(report, fixture, canonical):
    bundle = report.get("verificationBundle")
    if not isinstance(bundle, dict) or bundle.get("schemaVersion") != 1: raise ValueError("receipt_verification_bundle_missing")
    semantic_to_canonical = {"face_master": "front", "body_front": "front", "expression_neutral": "front", "face_left": "side", "body_side": "side", "hair_back": "back", "body_back": "back"}
    semantic = {slot: {**canonical[source_slot], "slot": slot, "logicalLabel": slot} for slot, source_slot in semantic_to_canonical.items()}
    public_manifest = [{"slot": slot, "sourceSha256": value["sourceSha256"], "logicalLabel": slot} for slot, value in sorted(semantic.items())]
    if report.get("referenceManifest") != public_manifest: raise ValueError("receipt_reference_manifest_mismatch")
    routes = []
    routed_items = []
    for shot in fixture["shots"]:
        policy = shot["referencePolicy"]
        for requested_slot in sorted(policy["preferredSlots"]):
            slot = requested_slot; transform = policy["transforms"][requested_slot]
            if slot == "face_right" and slot not in semantic and "face_left" in semantic: slot = "face_left"; transform = "mirror_x"
            if slot not in semantic or transform not in TRANSFORMS: raise ValueError("receipt_reference_invalid")
            source = semantic[slot]
            routes.append({"shotId": shot["id"], "requestedSlot": requested_slot, "slot": slot, "sourceSha256": source["sourceSha256"], "transform": transform})
            routed_items.append((shot["id"], requested_slot, source, transform))
    if report.get("referenceManifestDigest") != digest({"sources": public_manifest, "routes": routes}): raise ValueError("receipt_reference_manifest_mismatch")
    context = bundle.get("identityContext")
    subject = report.get("subject", {})
    if not isinstance(context, dict) or any(context.get(key) != subject.get(key) for key in ("characterAssetId", "identityPackVersion", "identityMetadataDigest")): raise ValueError("receipt_identity_context_mismatch")
    preparer = load_reference_preparer(); recomputed = []
    with tempfile.TemporaryDirectory(prefix="character-attestation-reference-") as temporary:
        for index, (shot_id, requested_slot, source, transform) in enumerate(routed_items):
            output = Path(temporary) / f"{index}.png"
            image = preparer.prepare(source["sourcePath"], transform)
            with output.open("xb") as handle: image.save(handle, format="PNG")
            recomputed.append({"shotId": shot_id, "slot": requested_slot, "sourceSha256": source["sourceSha256"], "transformedSha256": hashlib.sha256(output.read_bytes()).hexdigest(), "transform": transform})
    if report.get("references") != recomputed: raise ValueError("receipt_reference_evidence_mismatch")
    return semantic

def cosine(left, right):
    value = sum(a * b for a, b in zip(left, right))
    return min(1.0, max(0.0, (min(1.0, max(-1.0, value)) + 1.0) / 2.0))

def rounded(value): return round(value + 0.0, 6)

def verify_report(report):
    validate_strict_report(report)
    fixture = json.loads((HERE.parents[1] / "examples" / "character-consistency-benchmark" / "benchmark.json").read_text(encoding="utf-8"))
    policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    proof = report.get("evaluatorProof", {})
    if proof.get("id") != policy.get("evaluatorId") or proof.get("version") != policy.get("evaluatorVersion") or proof.get("implementationHash") != TRUSTED_IMPLEMENTATION_HASH or proof.get("policyHash") != hashlib.sha256(POLICY_PATH.read_bytes()).hexdigest() or proof.get("dimensionThreshold") != min(policy["dimensionFloors"].values()): raise ValueError("receipt_evaluator_mismatch")
    shots = report.get("shots"); bundle = report.get("verificationBundle")
    if not isinstance(shots, list) or [shot.get("id") for shot in shots] != SHOT_IDS or not isinstance(bundle, dict): raise ValueError("receipt_verification_bundle_missing")
    artifact_root = Path(bundle.get("artifactRoot", "")).resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix="character-attestation-owned-") as temporary:
        canonical, outputs = snapshot_verification_inputs(report, bundle, artifact_root, Path(temporary))
        worker = load_worker()
        references = canonical_reference_binding(report, fixture, canonical)
        reference_results = []
        for slot, item in references.items():
            embedded = worker.embed(str(item["sourcePath"]))
            if not hmac.compare_digest(str(embedded.get("imageSha256", "")).lower(), str(item["sourceSha256"]).lower()): raise ValueError("receipt_reference_hash_mismatch")
            reference_results.append((slot, embedded["embedding"]))
        fixture_by_id = {shot["id"]: shot for shot in fixture["shots"]}
        for shot in shots:
            output = worker.embed(str(outputs[shot["id"]]))
            if not hmac.compare_digest(str(output.get("imageSha256", "")).lower(), str(shot.get("outputSha256", "")).lower()): raise ValueError("receipt_output_hash_mismatch")
            dimension_scores = {"quality": rounded(output["quality"])}
            for dimension in ("face", "hair", "outfit", "body"):
                matches = [cosine(output["embedding"], embedding) for slot, embedding in reference_results if slot in DIMENSION_SLOTS[dimension]]
                dimension_scores[dimension] = rounded(sum(matches) / len(matches)) if matches else 0
            fixture_shot = fixture_by_id[shot["id"]]; weights = policy["weightsByScale"][fixture_shot["scale"]]
            score = rounded(sum(dimension_scores[name] * weights[name] for name in DIMENSIONS))
            if abs(score - shot.get("score", -1)) > 1e-6 or any(abs(dimension_scores[name] - shot.get("dimensionScores", {}).get(name, -1)) > 1e-6 for name in DIMENSIONS): raise ValueError("receipt_evaluation_mismatch")
            if any(dimension_scores[name] < policy["dimensionFloors"][name] for name in fixture_shot["evaluation"]["requiredDimensions"]) or score < fixture_shot["evaluation"]["minimumScore"]: raise ValueError("receipt_evaluation_mismatch")
    return claims(report, report.get("evidenceDigest"))

def registry_root(value):
    if not isinstance(value, str) or not value.strip() or "\x00" in value: raise ValueError("receipt_registry_invalid")
    root = Path(value).resolve(); root.mkdir(parents=True, exist_ok=True)
    try: os.chmod(root, stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
    except OSError: pass
    return root

def attest(report, root):
    bound = verify_report(report); receipt_id = secrets.token_hex(32)
    receipt = {"schemaVersion": 1, "issuer": ISSUER, "receiptId": receipt_id, **bound, "claimsDigest": digest(bound)}
    target = root / f"{receipt_id}.json"
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, stat.S_IRUSR | stat.S_IWUSR)
    with os.fdopen(fd, "w", encoding="utf-8") as handle: json.dump({"receipt": receipt}, handle, separators=(",", ":")); handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
    return receipt

def verify(payload, root):
    receipt = payload.get("receipt"); evidence = payload.get("evidence")
    if not isinstance(receipt, dict) or not isinstance(evidence, dict) or not RECEIPT_ID_RE.fullmatch(str(receipt.get("receiptId", ""))) or receipt.get("schemaVersion") != 1 or receipt.get("issuer") != ISSUER: return {"valid": False, "reason": "trusted_receipt_invalid"}
    target = (root / f"{receipt['receiptId']}.json").resolve(strict=False)
    if target.parent != root: return {"valid": False, "reason": "trusted_receipt_invalid"}
    try: record = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError): return {"valid": False, "reason": "trusted_receipt_unknown"}
    if stable(record.get("receipt")) != stable(receipt): return {"valid": False, "reason": "trusted_receipt_registry_mismatch"}
    expected = claims(evidence, evidence.get("sourceReportDigest"))
    expected_keys = {"schemaVersion", "issuer", "receiptId", "claimsDigest", *expected.keys()}
    if set(receipt) != expected_keys or any(receipt.get(key) != value for key, value in expected.items()) or receipt.get("claimsDigest") != digest(expected): return {"valid": False, "reason": "trusted_receipt_claims_mismatch"}
    return {"valid": True, "reason": "ok", "receiptId": receipt["receiptId"], "claimsDigest": receipt["claimsDigest"]}

def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("attest", "verify", "validate-report"): return 2
    raw = sys.stdin.buffer.read(10 * 1024 * 1024 + 1)
    if len(raw) > 10 * 1024 * 1024: raise ValueError("attestation_input_too_large")
    payload = json.loads(raw); root = registry_root(sys.argv[2])
    if sys.argv[1] == "attest": result = attest(payload["report"], root)
    elif sys.argv[1] == "verify": result = verify(payload, root)
    else: validate_strict_report(payload["report"]); result = {"valid": True, "evidenceDigest": payload["report"].get("evidenceDigest")}
    print(json.dumps(result, separators=(",", ":"), allow_nan=False)); return 0

if __name__ == "__main__":
    try: raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, separators=(",", ":")), file=sys.stderr); raise SystemExit(1)
