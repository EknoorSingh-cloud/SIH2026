import os
import shutil
import pytesseract
from PIL import Image


# Configure Tesseract path on Windows
if os.name == "nt":
    tesseract_path = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

    if os.path.exists(tesseract_path):
        pytesseract.pytesseract.tesseract_cmd = tesseract_path


def extract_text(image: Image.Image, lang: str = "eng+hin") -> str:
    """
    Extract plain text from an image.
    """
    return pytesseract.image_to_string(
        image,
        lang=lang
    )


def extract_text_with_boxes(image: Image.Image, lang: str = "eng+hin") -> dict:
    """
    Extract text along with word positions and OCR confidence.
    """

    raw = pytesseract.image_to_data(
        image,
        lang=lang,
        output_type=pytesseract.Output.DICT
    )

    words = []

    n_boxes = len(raw["text"])

    for i in range(n_boxes):

        text = raw["text"][i].strip()

        # Tesseract confidence can sometimes be a decimal string
        try:
            confidence = float(raw["conf"][i])
        except (ValueError, TypeError):
            confidence = -1

        if not text:
            continue

        words.append({
            "text": text,
            "confidence": confidence,
            "left": raw["left"][i],
            "top": raw["top"][i],
            "width": raw["width"][i],
            "height": raw["height"][i],
        })

    full_text = " ".join(
        word["text"]
        for word in words
    )

    valid_confidences = [
        word["confidence"]
        for word in words
        if word["confidence"] >= 0
    ]

    avg_confidence = (
        sum(valid_confidences) / len(valid_confidences)
        if valid_confidences
        else 0
    )

    return {
        "full_text": full_text,
        "words": words,
        "avg_confidence": round(avg_confidence, 2),
    }