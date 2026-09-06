import re
from PIL import Image, ImageDraw

try:
    import spacy
    nlp = spacy.load("en_core_web_sm")
except Exception:
    nlp = None

PII_PATTERNS = {
    "AADHAAR": re.compile(r"\b\d{4}\s?\d{4}\s?\d{4}\b"),
    "PHONE": re.compile(r"\b[6-9]\d{9}\b"),
    "PAN": re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b"),
    "EMAIL": re.compile(r"\b[\w.-]+@[\w.-]+\.\w+\b"),
}

IDENTITY_MARKERS = {
    "NAME": [
        r"(?:अभियुक्त|आरोपी|पीड़ित|शिकायतकर्ता|प्रार्थी|witness|accused)\s+([A-Za-z\u0900-\u097F\s]{2,30}?)(?=\s+(?:ने|द्वारा|का|के|की|पुत्र|उम्र|aged|\n|$))",
        r"(?:अभियुक्त|शिकायतकर्ता|पीड़ित|गवाह)\s*(?:का)?\s*नाम[:\s]+[‘'\"`-]?\s*([A-Za-z\u0900-\u097F\s]{2,30}?)(?=\s+(?:अभियुक्त|उम्र|पिता|फोन|पता|पहचान|\n|$))",
        r"(?:accused|victim|witness|complainant)\s*name[:\s]+[‘'\"`-]?\s*([A-Za-z\s]{3,30}?)(?=\s+(?:accused|victim|age|phone|pan|address|\n|$))",
    ],
    "ADDRESS": [
        r"((?:ग्राम|पोस्ट|मकान|ब्लॉक|फ्लैट|व\s+पोस्ट)\s+[A-Za-z0-9\u0900-\u097F\s,-]+?\b\d{6}\b)",
        r"((?:ग्राम|पोस्ट|मकान|ब्लॉक|फ्लैट|flat|house|sector|village)\s+[A-Za-z0-9\u0900-\u097F\s,-]{5,80}?)(?=\s+(?:उप\s*निरीक्षक|निरीक्षक|जांच|थाना|court|officer|\n|$))",
        r"(?:accused|victim|witness)\s*address[:\s]+[‘'\"`-]?\s*([A-Za-z0-9\u0900-\u097F\s,-]+?)(?=\s+(?:investigating|forwarding|officer|court|\n|$))",
    ],
}

FORBIDDEN_NAME_TOKENS = {
    "अभियुक्त का", "अभियुक्त", "आरोपी", "पीड़ित", "शिकायतकर्ता", 
    "नाम", "गवाह", "accused", "victim", "witness", "name",
    "शिकायतकर्ता का", "पीड़ित का"
}


def find_pii(text: str) -> dict:
    findings = {}
    for label, pattern in PII_PATTERNS.items():
        matches = pattern.findall(text)
        if matches:
            findings[label] = matches

    for label, patterns in IDENTITY_MARKERS.items():
        extracted_list = []
        for pattern in patterns:
            for match in re.finditer(pattern, text, re.IGNORECASE):
                val = match.group(1).strip()
                if len(val) > 2:
                    extracted_list.append(val)
        if extracted_list:
            findings.setdefault(label, []).extend(extracted_list)

    if nlp:
        doc = nlp(text)
        ner_names = [
            ent.text.strip()
            for ent in doc.ents
            if ent.label_ == "PERSON" and len(ent.text.strip()) > 2
        ]
        if ner_names:
            findings.setdefault("NAME", []).extend(ner_names)

    for key in findings:
        findings[key] = list(set(findings[key]))

    if "NAME" in findings:
        findings["NAME"] = [
            name for name in findings["NAME"]
            if name.strip().lower() not in FORBIDDEN_NAME_TOKENS and len(name.strip()) > 2
        ]
        if not findings["NAME"]:
            del findings["NAME"]

    return findings


def _word_matches_pii(word_text: str, pii_findings: dict) -> bool:
    cleaned = re.sub(r"^[^\w\u0900-\u097F]+|[^\w\u0900-\u097F]+$", "", word_text).strip()
    if not cleaned:
        return False

    cleaned_lower = cleaned.lower()

    for category, matches in pii_findings.items():
        for match in matches:
            match_tokens = [
                re.sub(r"^[^\w\u0900-\u097F]+|[^\w\u0900-\u097F]+$", "", token).lower() 
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