from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter
import numpy as np


worker_path = Path(__file__).parent / "evaluators" / "siglip2-character-worker.py"
spec = spec_from_file_location("siglip2_character_worker", worker_path)
worker = module_from_spec(spec)
spec.loader.exec_module(worker)


def cinematic_character_fixture() -> Image.Image:
    width = height = 512
    image = Image.new("RGB", (width, height), (24, 28, 38))
    pixels = image.load()
    for y in range(height):
        for x in range(width):
            glow = max(0, 1 - (((x - 256) / 300) ** 2 + ((y - 250) / 360) ** 2))
            pixels[x, y] = (int(24 + 45 * glow), int(28 + 34 * glow), int(38 + 28 * glow))
    draw = ImageDraw.Draw(image)
    draw.ellipse((165, 72, 347, 278), fill=(202, 151, 123), outline=(228, 187, 158), width=3)
    draw.polygon(((158, 95), (205, 42), (318, 45), (360, 116), (323, 91), (275, 120), (217, 86)), fill=(38, 30, 28))
    for offset in range(0, 130, 9):
        draw.line((190 + offset, 58, 170 + offset, 128), fill=(84, 68, 61), width=2)
    draw.ellipse((205, 145, 235, 158), fill=(244, 241, 229), outline=(52, 42, 40), width=2)
    draw.ellipse((277, 145, 307, 158), fill=(244, 241, 229), outline=(52, 42, 40), width=2)
    draw.ellipse((217, 147, 226, 156), fill=(69, 104, 123))
    draw.ellipse((289, 147, 298, 156), fill=(69, 104, 123))
    draw.line((250, 158, 244, 204, 262, 207), fill=(124, 84, 70), width=2)
    draw.arc((218, 202, 295, 239), 20, 160, fill=(115, 65, 62), width=3)
    draw.polygon(((135, 276), (377, 276), (430, 512), (82, 512)), fill=(26, 50, 74), outline=(88, 110, 129))
    draw.polygon(((205, 274), (307, 274), (335, 512), (177, 512)), fill=(28, 125, 135))
    for y in range(286, 512, 12):
        draw.line((104, y, 408, min(511, y + 24)), fill=(62, 151, 157), width=1)
    for x in range(112, 408, 14):
        draw.line((x, 286, min(430, x + 34), 511), fill=(19, 79, 103), width=1)
    return image


clean = cinematic_character_fixture()
blurred = clean.filter(ImageFilter.GaussianBlur(2))
over_sharpened = clean.filter(ImageFilter.UnsharpMask(radius=2, percent=500, threshold=0))

clean_quality = worker._quality(clean)
blurred_quality = worker._quality(blurred)
over_sharpened_quality = worker._quality(over_sharpened)


def gradient_percentiles(image: Image.Image) -> tuple[float, float]:
    values = np.asarray(image.convert("L"), dtype=np.float32) / 255.0
    height, width = values.shape
    subject = values[height // 10:height * 9 // 10, width // 6:width * 5 // 6]
    gradients = np.concatenate((np.abs(np.diff(subject, axis=1)).ravel(), np.abs(np.diff(subject, axis=0)).ravel()))
    return tuple(float(value) for value in np.percentile(gradients, (75, 95)))


print("quality diagnostics", gradient_percentiles(clean), gradient_percentiles(blurred), gradient_percentiles(over_sharpened))

assert clean_quality >= 0.8, f"clean cinematic character should pass quality floor, got {clean_quality}"
assert blurred_quality < 0.8, f"blurred character should fail quality floor, got {blurred_quality}"
assert over_sharpened_quality <= clean_quality + 0.03, (
    f"over-sharpening must not materially improve quality: clean={clean_quality}, over={over_sharpened_quality}"
)

print(
    "PASS calibrated character image quality",
    {"clean": clean_quality, "blurred": blurred_quality, "over_sharpened": over_sharpened_quality},
)
