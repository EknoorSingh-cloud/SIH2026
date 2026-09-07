const { Jimp } = require("jimp");
const { createWorker } = require("tesseract.js");

// ---------------------------------------------------------------
// OCR pipeline: deskew -> denoise -> contrast -> recognise.
//
// tesseract.js rather than a native Tesseract binary on purpose. It is
// WASM, so it installs with npm on any machine including the Windows
// laptop this gets demonstrated from, and there is no toolchain to get
// working the morning of a deadline.
//
// LANGUAGES: English and Hindi are what is actually tested. Do not
// claim 22 languages. The scheduled languages are a traineddata file
// away - `eng+hin` becomes `eng+hin+mar+tam` and nothing else changes -
// but claiming a language nobody has run a sample through is the kind
// of thing that falls apart when a judge speaks it.
//
// The worker never touches a blob on disk. It receives a decrypted
// buffer, works in memory, and the plaintext is never written out.
// ---------------------------------------------------------------

const LANGS = process.env.OCR_LANGS || "eng+hin";

// Tesseract initialisation downloads traineddata and takes a few
// seconds, so one worker is created and reused for the whole run.
let workerPromise = null;

function getWorker() {
    if (!workerPromise) {
        workerPromise = createWorker(LANGS, 1, {
            // Cache traineddata next to the app so a restart does not
            // re-download ~15MB per language.
            cachePath: process.env.OCR_CACHE_PATH || "./.tesseract",
            logger: () => {},
        });
    }
    return workerPromise;
}

async function shutdown() {
    if (!workerPromise) return;
    const w = await workerPromise;
    await w.terminate();
    workerPromise = null;
}

// ---------------------------------------------------------------
// Deskew by projection profile.
//
// A page of text, rotated to level, produces horizontal rows that are
// either dense with ink or empty. That alternation is high variance.
// Rotate it off level and the rows smear together and the variance
// drops. So: try a range of angles, keep the one with the sharpest
// profile.
//
// Runs on a downscaled binarised copy because it is O(angles x pixels)
// and the answer does not need the full resolution.
// ---------------------------------------------------------------

const MAX_SKEW = 6;      // degrees either way; scans are rarely worse
const SKEW_STEP = 0.5;

function profileVariance(image) {
    const { width, height, data } = image.bitmap;
    const rows = new Float64Array(height);

    for (let y = 0; y < height; y++) {
        let ink = 0;
        for (let x = 0; x < width; x++) {
            // Red channel is enough - the copy is already greyscale.
            if (data[(y * width + x) << 2] < 128) ink++;
        }
        rows[y] = ink;
    }

    let mean = 0;
    for (let y = 0; y < height; y++) mean += rows[y];
    mean /= height || 1;

    let variance = 0;
    for (let y = 0; y < height; y++) variance += (rows[y] - mean) ** 2;
    return variance / (height || 1);
}

// Angles are searched coarse first, then refined around the winner.
// Sweeping the whole range at the fine step meant 25 rotate-crop-scan
// passes, which measured at 4.5 seconds a page - about seventy per cent
// of the time to read one - while the recognition itself took barely
// one. Coarse-then-fine reaches the same answer in a fraction of that.
const COARSE_STEP = 1.5;
const FINE_STEP = 0.25;
const PROBE_WIDTH = 420;

async function estimateSkew(source) {
    const probe = source.clone().greyscale();

    // Cap the working size; skew is a global property and does not need
    // every pixel to measure. Halving the probe quarters the work.
    if (probe.bitmap.width > PROBE_WIDTH) {
        probe.resize({ w: PROBE_WIDTH });
    }

    // Every candidate is cropped to the SAME central window before it is
    // measured. Rotating expands the canvas and pads the corners, and
    // that padding is what the variance actually ends up measuring -
    // uncropped, the score climbs with the angle and the estimator just
    // returns the largest rotation it is allowed. Comparing a fixed
    // inscribed window compares like with like.
    const cw = Math.floor(probe.bitmap.width * 0.7);
    const ch = Math.floor(probe.bitmap.height * 0.7);

    if (cw < 8 || ch < 8) return 0; // too small to say anything useful

    const score = (angle) => {
        const candidate = probe.clone();
        if (angle !== 0) candidate.rotate(angle);

        candidate.crop({
            x: Math.floor((candidate.bitmap.width - cw) / 2),
            y: Math.floor((candidate.bitmap.height - ch) / 2),
            w: cw,
            h: ch,
        });

        return profileVariance(candidate);
    };

    const search = (from, to, step) => {
        let best = { angle: 0, score: -1 };
        for (let a = from; a <= to + 1e-9; a += step) {
            const s = score(a);
            if (s > best.score) best = { angle: a, score: s };
        }
        return best;
    };

    const coarse = search(-MAX_SKEW, MAX_SKEW, COARSE_STEP);

    // Refine within one coarse step either side of the winner.
    const fine = search(
        Math.max(-MAX_SKEW, coarse.angle - COARSE_STEP),
        Math.min(MAX_SKEW, coarse.angle + COARSE_STEP),
        FINE_STEP
    );

    return Number(fine.angle.toFixed(2));
}

/**
 * Clean an image up for recognition.
 * Returns a PNG buffer - tesseract is happier with lossless input.
 */
async function preprocess(buffer, { deskew = true } = {}) {
    const image = await Jimp.read(buffer);

    // 1. deskew - skipped for pages we rendered ourselves, which are
    //    level by construction. It is the most expensive step here, so
    //    not doing it when it cannot help is most of the speed-up.
    const skew = deskew ? await estimateSkew(image) : 0;
    if (Math.abs(skew) >= FINE_STEP) image.rotate(skew);

    // 2. greyscale + denoise. A mild blur knocks out scanner speckle;
    //    anything stronger starts eating thin Devanagari strokes.
    image.greyscale();
    image.blur(1);

    // 3. contrast. normalize() stretches the histogram, which matters
    //    far more than raw contrast on faded photocopies - and FIRs are
    //    almost always photocopies.
    image.normalize();
    image.contrast(0.3);

    // Small scans recognise better upscaled; tesseract likes ~300dpi.
    if (image.bitmap.width < 1000) {
        image.resize({ w: image.bitmap.width * 2 });
    }

    return { buffer: await image.getBuffer("image/png"), skew };
}

/**
 * Recognise text in an image buffer.
 * Returns { text, confidence, skew, languages }.
 */
async function recognise(buffer, options = {}) {
    const { buffer: cleaned, skew } = await preprocess(buffer, options);

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
 * Read a PDF.
 *
 * The text layer first. A PDF produced by a word processor already
 * carries its text exactly, and running OCR over a rendering of perfect
 * text would only introduce mistakes. A scanned PDF has no text layer,
 * and only then is each page rendered and recognised.
 */
async function recognisePdf(buffer) {
    const pdf = require("./pdf");

    const { text, pageCount } = await pdf.extractText(buffer);

    if (pdf.hasUsefulText(text)) {
        return {
            text,
            confidence: 100, // read, not guessed
            skew: 0,
            languages: "embedded text layer",
            pages: pageCount,
            source: "text-layer",
        };
    }

    // A scan. Render and recognise each page.
    const pages = await pdf.renderPages(buffer, 2);
    const parts = [];
    let confidenceTotal = 0;

    for (const page of pages) {
        // No deskew: we rendered these pages ourselves from the PDF, so
        // they are perfectly level. Measuring their tilt is pure waste,
        // and it was the slowest step in the pipeline.
        const result = await recognise(page.png, { deskew: false });
        parts.push(result.text);
        confidenceTotal += result.confidence ?? 0;
    }

    return {
        text: parts.join("\n\n").trim(),
        confidence: pages.length ? confidenceTotal / pages.length : null,
        skew: 0,
        languages: LANGS,
        pages: pages.length,
        source: "ocr",
    };
}

/** Image types the pipeline can read directly. */
function canRead(mimeType) {
    return (
        typeof mimeType === "string" &&
        ["image/png", "image/jpeg", "image/jpg", "image/bmp", "image/tiff"].includes(
            mimeType.toLowerCase()
        )
    );
}

/** Everything the pipeline can get text out of, images and PDFs alike. */
function canExtract(mimeType) {
    return canRead(mimeType) || mimeType === "application/pdf";
}

module.exports = { recognise, recognisePdf, preprocess, estimateSkew, canRead, canExtract, shutdown, LANGS };
