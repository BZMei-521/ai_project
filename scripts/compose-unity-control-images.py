import sys
from pathlib import Path

from PIL import Image, ImageChops


def save_atomic(image: Image.Image, output: str) -> None:
    target = Path(output)
    temporary = target.with_name(f"{target.name}.{Path(__file__).stat().st_mtime_ns}.png")
    image.save(temporary, format="PNG")
    temporary.replace(target)


def compose_ids(output: str, specifications: list[str]) -> None:
    result = None
    for specification in specifications:
        color_text, source = specification.split("=", 1)
        color = tuple(int(channel) for channel in color_text.split(","))
        mask_source = Image.open(source).convert("RGB")
        mask = mask_source.convert("L").point(lambda value: 255 if value else 0)
        layer = Image.new("RGB", mask_source.size, color)
        black = Image.new("RGB", mask_source.size)
        colored = Image.composite(layer, black, mask)
        result = colored if result is None else ImageChops.add(result, colored)
    if result is None:
        raise ValueError("at least one ID mask is required")
    save_atomic(result, output)


def compose_pose(output: str, sources: list[str]) -> None:
    images = [Image.open(source).convert("RGB") for source in sources]
    if not images:
        raise ValueError("at least one pose image is required")
    result = images[0]
    for image in images[1:]:
        result = ImageChops.lighter(result, image)
    save_atomic(result, output)


if __name__ == "__main__":
    mode, output, *inputs = sys.argv[1:]
    if mode == "ids":
        compose_ids(output, inputs)
    elif mode == "pose":
        compose_pose(output, inputs)
    else:
        raise ValueError(f"unknown mode: {mode}")
