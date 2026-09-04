
"""Run locally with:
    uvicorn main:app --reload --port 8001
"""
import base64
import io
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from preprocess import preprocess_pipeline
from ocr import extract_text_with_boxes
from classify import classify_document
from redact import find_pii, redact_image

app = FastAPI(
    title="Document OCR & Redaction Microservice",
    description="Extracts text, classifies document type, and redacts PII "
                "for the Secure Digital Document Management System (SIH26190).",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def health_check():
    return {"status": "ok", "service": "ocr-redaction-microservice"}


@app.post("/process-document")
async def process_document(file: UploadFile = File(...)):
    if file.content_type not in ("image/jpeg", "image/png", "image/jpg"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file.content_type}. "
                   f"Upload a JPG or PNG for this MVP.",
        )

    image_bytes = await file.read()

    try:
        
        cleaned_image = preprocess_pipeline(image_bytes)

        
        ocr_result = extract_text_with_boxes(cleaned_image)

        
        classification = classify_document(ocr_result["full_text"])

        
        pii_findings = find_pii(ocr_result["full_text"])

        
        redacted_image = redact_image(cleaned_image, ocr_result["words"], pii_findings)

        buffer = io.BytesIO()
        redacted_image.save(buffer, format="PNG")
        redacted_b64 = base64.b64encode(buffer.getvalue()).decode("utf-8")

    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Processing failed: {str(e)}")

    return {
        "filename": file.filename,
        "extracted_text": ocr_result["full_text"],
        "ocr_confidence": ocr_result["avg_confidence"],
        "document_type": classification["doc_type"],
        "classification_score": classification["score"],
        "pii_detected": pii_findings,
        "redacted_image_base64": redacted_b64,
    }
