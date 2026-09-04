import re
from PIL import Image, ImageDraw

PII_PATTERNS = {
    "AADHAAR": re.compile(r"\b\d{4}\s?\d{4}\s?\d{4}\b"),
    "PHONE": re.compile(r"\b[6-9]\d{9}\b"),
    "PAN": re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b"),
    "EMAIL": re.compile(r"\b[\w.-]+@[\w.-]+\.\w+\b"),
}

# Regex to capture names and addresses from chargesheets/FIRs
IDENTITY_MARKERS = {
    "NAME": [
        r"(?:accused|victim)\s*name[:\s]+([A-Za-z\s]+?)(?=\s+(?:accused|victim|age|phone|pan|address|\n|$))",
    ],
    "ADDRESS": [
        r"(?:accused|victim)\s*address[:\s]+([A-Za-z0-9\s,-]+?)(?=\s+(?:investigating|officer|court|\n|$))",
    ],
}


def find_pii(text: str) -> dict:
    findings = {}

    # 1. Match structured identifiers (Phone, PAN, Aadhaar, Email)
    for label, pattern in PII_PATTERNS.items():
        matches = pattern.findall(text)
        if matches:
            findings[label] = matches

    # 2. Match names and addresses
    for label, patterns in IDENTITY_MARKERS.items():
        extracted_list = []
        for pattern in patterns:
            for match in re.finditer(pattern, text, re.IGNORECASE):
                val = match.group(1).strip()
                if len(val) > 2:
                    extracted_list.append(val)
        if extracted_list:
            findings[label] = extracted_list

    return findings


def _word_matches_pii(word_text: str, pii_findings: dict) -> bool:
    cleaned = re.sub(r"^[^\w]+|[^\w]+$", "", word_text).strip()
    if not cleaned:
        return False

    cleaned_lower = cleaned.lower()

    for category, matches in pii_findings.items():
        for match in matches:
            # Tokenize multi-word matches (like full names or addresses)
            match_tokens = [
                re.sub(r"^[^\w]+|[^\w]+$", "", token).lower() 
                for token in match.split()
            ]
            match_normalized = re.sub(r"\s+", "", match).lower()

            if cleaned_lower in match_tokens:
                return True
            if cleaned_lower == match.lower().strip():
                return True
            if len(cleaned_lower) >= 4 and cleaned_lower in match_normalized:
                return True
    return False


def redact_image(image: Image.Image, words: list, pii_findings: dict) -> Image.Image:
    redacted = image.convert("RGB").copy()
    draw = ImageDraw.Draw(redacted)

    if not pii_findings:
        return redacted

    for word in words:
        if _word_matches_pii(word["text"], pii_findings):
            x, y = word["left"], word["top"]
            w, h = word["width"], word["height"]
            draw.rectangle([x, y, x + w, y + h], fill="black")

    return redacted