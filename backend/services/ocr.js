const OCR_SERVICE_URL =
    process.env.OCR_SERVICE_URL || "http://127.0.0.1:8000";

/**
 * Sends an uploaded image to the Python FastAPI OCR service.
 */
async function processWithOCR(file) {
    if (!file) {
        throw new Error("No file provided for OCR processing.");
    }

    const formData = new FormData();

    const blob = new Blob([file.buffer], {
        type: file.mimetype,
    });

    formData.append("file", blob, file.originalname);

    let response;

    try {
        response = await fetch(
            `${OCR_SERVICE_URL}/process-document?full_base64=false`,
            {
                method: "POST",
                body: formData,
            }
        );
    } catch (error) {
        throw new Error(
            `Could not connect to OCR service at ${OCR_SERVICE_URL}. ` +
            `Make sure the Python FastAPI server is running.`
        );
    }

    let data;

    try {
        data = await response.json();
    } catch (error) {
        throw new Error("OCR service returned an invalid response.");
    }

    if (!response.ok) {
        throw new Error(
            data.detail || "OCR service failed to process the document."
        );
    }

    return data;
}

module.exports = {
    processWithOCR,
};