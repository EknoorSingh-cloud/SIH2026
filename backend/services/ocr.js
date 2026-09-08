const OCR_SERVICE_URL =
    process.env.OCR_SERVICE_URL || "http://127.0.0.1:8000";

const { Jimp } = require("jimp");
const { createWorker } = require("tesseract.js");

// ---------------------------------------------------------------
// OCR configuration
// ---------------------------------------------------------------

const LANGS = process.env.OCR_LANGS || "eng+hin";

let workerPromise = null;

function getWorker() {
    if (!workerPromise) {
        workerPromise = createWorker(LANGS, 1, {
            cachePath: process.env.OCR_CACHE_PATH || "./.tesseract",
            logger: () => {},
        });
    }

    return workerPromise;
}

async function shutdown() {
    if (!workerPromise) return;

    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
}

// ---------------------------------------------------------------
// External FastAPI OCR service
// ---------------------------------------------------------------

/**
 * Sends an uploaded file to the Python FastAPI OCR service.
 * This is kept for compatibility with the existing upload endpoint.
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
            "Make sure the Python FastAPI server is running."
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

// ---------------------------------------------------------------
// Local Tesseract OCR pipeline
// ---------------------------------------------------------------

const MAX_SKEW = 6;
const SKEW_STEP = 0.5;

function profileVariance(image) {
    const { width, height, data } = image.bitmap;
    const rows = new Float64Array(height);

    for (let y = 0; y < height; y++) {
        let ink = 0;

        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) << 2] < 128) {
                ink++;
            }
        }

        rows[y] = ink;
    }

    let mean = 0;

    for (let y = 0; y < height; y++) {
        mean += rows[y];
    }

    mean /= height || 1;

    let variance = 0;

    for (let y = 0; y < height; y++) {
        variance += (rows[y] - mean) ** 2;
    }

    return variance / (height || 1);
}

async function estimateSkew(source) {
    const probe = source.clone().greyscale();

    if (probe.bitmap.width > 800) {
        probe.resize({ w: 800 });
    }

    const cw = Math.floor(probe.bitmap.width * 0.7);
    const ch = Math.floor(probe.bitmap.height * 0.7);

    if (cw < 8 || ch < 8) {
        return 0;
    }

    let best = {
        angle: 0,
        score: -1,
    };

    for (
        let angle = -MAX_SKEW;
        angle <= MAX_SKEW;
        angle += SKEW_STEP
    ) {
        const candidate = probe.clone();

        if (angle !== 0) {
            candidate.rotate(angle);
        }

        candidate.crop({
            x: Math.floor(
                (candidate.bitmap.width - cw) / 2
            ),
            y: Math.floor(
                (candidate.bitmap.height - ch) / 2
            ),
            w: cw,
            h: ch,
        });

        const score = profileVariance(candidate);

        if (score > best.score) {
            best = {
                angle,
                score,
            };
        }
    }

    return best.angle;
}

/**
 * Cleans an image before recognition.
 * Returns a PNG buffer and detected skew angle.
 */
async function preprocess(buffer) {
    const image = await Jimp.read(buffer);

    const skew = await estimateSkew(image);

    if (Math.abs(skew) >= SKEW_STEP) {
        image.rotate(skew);
    }

    image.greyscale();
    image.blur(1);
    image.normalize();
    image.contrast(0.3);

    if (image.bitmap.width < 1000) {
        image.resize({
            w: image.bitmap.width * 2,
        });
    }

    return {
        buffer: await image.getBuffer("image/png"),
        skew,
    };
}

/**
 * Recognises text using local Tesseract OCR.
 */
async function recognise(buffer) {
    const {
        buffer: cleaned,
        skew,
    } = await preprocess(buffer);

    const worker = await getWorker();

    const { data } = await worker.recognize(cleaned);

    return {
        text: (data.text || "").trim(),
        confidence: data.confidence ?? null,
        skew,
        languages: LANGS,
    };
}

/**
 * Checks whether the local image OCR pipeline supports this file.
 */
function canRead(mimeType) {
    return (
        typeof mimeType === "string" &&
        [
            "image/png",
            "image/jpeg",
            "image/jpg",
            "image/bmp",
            "image/tiff",
        ].includes(mimeType.toLowerCase())
    );
}

module.exports = {
    // Existing FastAPI OCR integration
    processWithOCR,

    // Local Tesseract OCR integration
    recognise,
    preprocess,
    estimateSkew,
    canRead,
    shutdown,

    LANGS,
};
