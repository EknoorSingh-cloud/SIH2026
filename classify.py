import re

DOCUMENT_KEYWORDS = {
    "CHARGESHEET": [
        "chargesheet", "charge-sheet", "final report", "under section 173",
        "chargesheet no", "investigating officer", "sections charged",
        "आरोप पत्र", "अंतिम रिपोर्ट", "चार्जशीट", "धारा 173", "जांच अधिकारी"
    ],
    "FIR": [
        "first information report", "fir no.", "police station",
        "प्रथम सूचना रिपोर्ट", "प्राथमिकी", "थाना", "प्राथमिकी संख्या"
    ],
    "WITNESS_STATEMENT": [
        "statement of witness", "recorded under section 161", "deposition",
        "witness statement", "गवाह का बयान", "धारा 161"
    ],
    "FORENSIC_REPORT": [
        "forensic", "fsl report", "forensic science laboratory",
        "post mortem", "autopsy", "ballistic", "विधि विज्ञान प्रयोगशाला", "पोस्टमार्टम"
    ],
    "COURT_ORDER": [
        "in the court of", "order dated", "hon'ble", "judgment", "bail order",
        "न्यायालय", "माननीय न्यायालय", "आदेश दिनांक", "जमानत आदेश"
    ],
}

SECTION_PATTERNS = [
    re.compile(
        r"(?:u/s|under\s+section|sections?\s+charged|sections?|sec\.?|धारा|अधिनियम\s*व\s*धाराएं)\s*:?\s*"
        r"(?:(ipc|bns|crpc|bnss|pocso|भारतीय\s*न्याय\s*संहिता|बीएनएस|आईपीसी)\s*)?"
        r"([0-9\u0966-\u096F]+(?:\s*\([0-9\u0966-\u096F\w]+\))?(?:\s*(?:read\s+with|r/w|,|\/|\band\b|व|तथा)\s*[0-9\u0966-\u096F]+(?:\s*\([0-9\u0966-\u096F\w]+\))?)*)"
        r"(?:\s*(ipc|bns|crpc|bnss|pocso|भारतीय\s*न्याय\s*संहिता|बीएनएस|आईपीसी))?",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(ipc|bns|crpc|bnss|pocso|बीएनएस|आईपीसी)\s+([0-9\u0966-\u096F]+(?:\s*\([0-9\u0966-\u096F\w]+\))?(?:\s*(?:,|\/|\band\b|व)\s*[0-9\u0966-\u096F]+(?:\s*\([0-9\u0966-\u096F\w]+\))?)*)\b",
        re.IGNORECASE,
    ),
]


def extract_legal_sections(text: str) -> list:
    detected_sections = set()
    prefix_cleaner = re.compile(
        r"^(?:sections?\s+charged|u/s|under\s+section|sections?|sec\.?|अधिनियम\s*व\s*धाराएं|धारा)\s*:?\s*",
        re.IGNORECASE
    )

    for pattern in SECTION_PATTERNS:
        for match in pattern.finditer(text):
            raw_match = match.group(0).strip().replace("\n", " ")
            cleaned = prefix_cleaner.sub("", raw_match).strip()
            cleaned = re.sub(r"\s+", " ", cleaned)
            if len(cleaned) > 1:
                detected_sections.add(cleaned.upper())

    return sorted(list(detected_sections))


def classify_document(text: str) -> dict:
    text_lower = text.lower()

    scores = {}
    matches = {}
    for doc_type, keywords in DOCUMENT_KEYWORDS.items():
        hits = [kw for kw in keywords if kw.lower() in text_lower]
        scores[doc_type] = len(hits)
        matches[doc_type] = hits

    best_type = max(scores, key=scores.get)
    if scores[best_type] == 0:
        doc_type_result = "UNKNOWN"
        matched_kw = []
        best_score = 0
    else:
        doc_type_result = best_type
        matched_kw = matches[best_type]
        best_score = scores[best_type]

    return {
        "doc_type": doc_type_result,
        "matched_keywords": matched_kw,
        "score": best_score,
        "tagged_sections": extract_legal_sections(text),
    }


def extract_legal_sections(text: str) -> list:
    detected_sections = set()
    prefix_cleaner = re.compile(r"^(?:sections?\s+charged|u/s|under\s+section|sections?|sec\.?)\s*:?\s*", re.IGNORECASE)

    for pattern in SECTION_PATTERNS:
        for match in pattern.finditer(text):
            raw_match = match.group(0).strip().replace("\n", " ")
            cleaned = prefix_cleaner.sub("", raw_match).strip()
            cleaned = re.sub(r"\s+", " ", cleaned)
            if len(cleaned) > 2:
                detected_sections.add(cleaned.upper())

    return sorted(list(detected_sections))
def classify_document(text: str) -> dict:
    text_lower = text.lower()

    scores = {}
    matches = {}
    for doc_type, keywords in DOCUMENT_KEYWORDS.items():
        hits = [kw for kw in keywords if kw in text_lower]
        scores[doc_type] = len(hits)
        matches[doc_type] = hits

    best_type = max(scores, key=scores.get)
    if scores[best_type] == 0:
        doc_type_result = "UNKNOWN"
        matched_kw = []
        best_score = 0
    else:
        doc_type_result = best_type
        matched_kw = matches[best_type]
        best_score = scores[best_type]

    return {
        "doc_type": doc_type_result,
        "matched_keywords": matched_kw,
        "score": best_score,
        "tagged_sections": extract_legal_sections(text),
    }