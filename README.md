# OCR / Redaction Microservice

Takes a scanned document image, extracts the text, guesses the document type (FIR, chargesheet, etc.), finds PII (Aadhaar/phone/PAN/email), and returns a redacted copy of the image.

Part of SIH26190 — Secure Digital Document Management System.

## Setup

**Docker (Recommended)**

```bash
docker build -t ocr-service .
docker run -p 8001:8001 ocr-service
```

Go to `http://localhost:8001/docs` to test it.


**Install Tesseract first (this is separate from the pip packages below):**
- Mac: `brew install tesseract`
- Windows: install from https://github.com/UB-Mannheim/tesseract/wiki

**Then:**
```bash
python -m venv venv

# Windows:
.\venv\Scripts\activate
# macOS / Linux:
source venv/bin/activate

pip install -r requirements.txt
```

**Windows only** — open `ocr.py` and uncomment/edit this line near the top with your actual install path:
```python
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
```
Mac doesn't need this — `brew install` puts tesseract on PATH automatically.

## Run it

```bash
uvicorn main:app --reload --port 8001
```
Go to `http://localhost:8001/docs` — upload `test_fir.png` on the `/process-document` endpoint to try it.

## Files

| File | What it does |
|---|---|
| `preprocess.py` | Cleans up the image before OCR (grayscale, denoise, straighten) |
| `ocr.py` | Runs Tesseract, gets text + word positions |
| `classify.py` | Guesses document type from keywords |
| `redact.py` | Finds PII via regex, blacks it out on the image |
| `main.py` | FastAPI app — the actual API endpoint |

## API

Upload a document image (.png, .jpg, .jpeg) via multipart/form-data.

Form Field: file (Binary Image)

## Returns
```json
{
  "filename": "sample_document.png",
  "extracted_text": "Full extracted plain text...",
  "ocr_confidence": 84.5,
  "document_type": "FIR",
  "classification_score": 3,
  "pii_detected": {
    "PHONE": ["9876543210"],
    "PAN": ["ABCDE1234F"],
    "AADHAAR": ["[Aadhaar Redacted]"]
  },
  "redacted_image_base64": "iVBORw0KGgoAAAANSUhEUgAA..."
}
```
## Frontend Display Snippet (JavaScript)
```
const previewImg = document.getElementById("preview");
previewImg.src = `data:image/png;base64,${data.redacted_image_base64}`;
```
## Known limitations

- OCR accuracy isn't perfect, especially on messy/angled scans — that's why `ocr_confidence` is returned, treat low scores as "needs manual review"
- PII detection is regex-only right now (Aadhaar, phone, PAN, email) — doesn't catch names yet
- Runs as a plain image upload for now — PDF support isn't in yet
