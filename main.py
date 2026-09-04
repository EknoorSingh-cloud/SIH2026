"""Run locally with:
    uvicorn main:app --reload --port 8001
"""
import base64
import hashlib
import io
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from preprocess import preprocess_pipeline
from ocr import extract_text_with_boxes
from classify import classify_document
from redact import find_pii, redact_image

app = FastAPI(
    title="Document OCR, Redaction & Integrity Microservice",
    description="Extracts text, hashes for Hyperledger anchoring (BSA Sec 63), "
                "and enforces Section 72 BNS victim identity redaction.",
    version="0.3.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Markers for Section 72 BNS protection (Sexual offences / POCSO)
SEXUAL_OFFENCE_MARKERS = [
    "pocso", "rape", "sexual", "376", "354", "section 64", "section 70", "outraging"
]


@app.get("/")
def health_check():
    return {"status": "ok", "service": "ocr-redaction-microservice"}


@app.post("/process-document")
async def process_document(
    file: UploadFile = File(...),
    full_base64: bool = Query(
        False, 
        description="Set to true if frontend needs the full Base64 string"
    )
):
    if file.content_type not in ("image/jpeg", "image/png", "image/jpg"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file.content_type}. Upload a JPG or PNG.",
        )

    image_bytes = await file.read()

   
    sha256_hash = hashlib.sha256(image_bytes).hexdigest()

    try:
        
        cleaned_image = preprocess_pipeline(image_bytes)

        
        ocr_result = extract_text_with_boxes(cleaned_image)

        
        classification = classify_document(ocr_result["full_text"])

        full_text_lower = ocr_result["full_text"].lower()
        is_bns_protected = any(marker in full_text_lower for marker in SEXUAL_OFFENCE_MARKERS)

       
        pii_findings = find_pii(ocr_result["full_text"])
        redacted_image = redact_image(cleaned_image, ocr_result["words"], pii_findings)

        buffer = io.BytesIO()
        redacted_image.save(buffer, format="PNG")
        raw_b64 = base64.b64encode(buffer.getvalue()).decode("utf-8")

        display_b64 = (
            raw_b64 if full_base64 
            else f"{raw_b64[:60]}... [truncated {len(raw_b64)} chars; use ?full_base64=true]"
        )

    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Processing failed: {str(e)}")

    return {
        "filename": file.filename,
        "sha256_hash": sha256_hash,
        "document_type": classification["doc_type"],
        "extracted_text": ocr_result["full_text"],
        "bns_section_72_protected": is_bns_protected,
        "pii_detected": pii_findings,
        "redacted_image_base64": display_b64,
    }