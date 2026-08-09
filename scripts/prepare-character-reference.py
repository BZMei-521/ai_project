#!/usr/bin/env python3
"""Prepare one trusted character reference as an exclusive RGB PNG."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageOps


TRANSFORMS = ("none", "mirror_x", "head_shoulders_crop")
MAX_EDGE = 8192
TARGET_EDGE = 768


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--transform", required=True, choices=TRANSFORMS)
    return parser.parse_args()


def prepare(input_path: Path, transform: str) -> Image.Image:
    with Image.open(input_path) as source:
        source.load()
        if source.width > MAX_EDGE or source.height > MAX_EDGE:
            raise ValueError("reference image exceeds 8192x8192")
        image = source.convert("RGB")

    if transform == "mirror_x":
        return ImageOps.mirror(image)
    if transform == "head_shoulders_crop":
        crop_height = max(1, round(image.height * 0.58))
        image = image.crop((0, 0, image.width, crop_height))
        scale = TARGET_EDGE / max(image.size)
        size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
        return image.resize(size, Image.Resampling.LANCZOS)
    return image


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).resolve(strict=True)
    output_path = Path(args.output).resolve(strict=False)
    if input_path == output_path:
        raise ValueError("input and output paths must differ")
    if not output_path.parent.is_dir():
        raise ValueError("output staging directory does not exist")
    image = prepare(input_path, args.transform)
    with output_path.open("xb") as output:
        image.save(output, format="PNG")


if __name__ == "__main__":
    main()
