# pyrefly: ignore [missing-import]
import os
import shutil
import pytesseract
from PIL import Image

# Automatically use Windows path if running locally on Windows and not on PATH
if os.name == "nt" and not shutil.which("tesseract"):
    default_win_path = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    if os.path.exists(default_win_path):
        pytesseract.pytesseract.tesseract_cmd = default_win_path
def extract_text(image: Image.Image, lang: str = "eng") -> str:
    return pytesseract.image_to_string(image, lang=lang)


def extract_text_with_boxes(image: Image.Image, lang: str = "eng") -> dict:
    raw = pytesseract.image_to_data(
        image, lang=lang, output_type=pytesseract.Output.DICT
    )

    words = []
    n_boxes = len(raw["text"])
    for i in range(n_boxes):
        text = raw["text"][i].strip()
        conf = int(raw["conf"][i]) if raw["conf"][i] != "-1" else -1

        if not text:
            continue

        words.append({
            "text": text,
            "confidence": conf,
            "left": raw["left"][i],
            "top": raw["top"][i],
            "width": raw["width"][i],
            "height": raw["height"][i],
        })

    full_text = " ".join(w["text"] for w in words)
    avg_confidence = (
        sum(w["confidence"] for w in words if w["confidence"] >= 0) / len(words)
        if words else 0
    )

    return {
        "full_text": full_text,
        "words": words,
        "avg_confidence": round(avg_confidence, 2),
    }
