DOCUMENT_KEYWORDS = {
    "CHARGESHEET": [
        "chargesheet", "charge-sheet", "final report", "under section 173",
        "chargesheet no", "investigating officer", "sections charged"
    ],
    "FIR": [
        "first information report", "fir no.", "police station"
    ],
    "WITNESS_STATEMENT": [
        "statement of witness", "recorded under section 161", "deposition",
        "witness statement",
    ],
    "FORENSIC_REPORT": [
        "forensic", "fsl report", "forensic science laboratory",
        "post mortem", "autopsy", "ballistic",
    ],
    "COURT_ORDER": [
        "in the court of", "order dated", "hon'ble", "judgment", "bail order",
    ],
}

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
        return {"doc_type": "UNKNOWN", "matched_keywords": [], "score": 0}

    return {
        "doc_type": best_type,
        "matched_keywords": matches[best_type],
        "score": scores[best_type],
    }