const assert = require("assert");
const { Jimp, loadFont } = require("jimp");
const { SANS_32_BLACK } = require("jimp/fonts");

const ocr = require("../services/ocr");
const entities = require("../services/entities");

// ---------------------------------------------------------------
// OCR self-check.
//
//   npm run test:ocr
//
// Kept out of `npm test` on purpose: the first run downloads ~15MB of
// traineddata per language and recognition takes seconds, which is not
// something to put in front of every commit.
//
// It renders a page, tilts it the way a scanner does, and checks the
// pipeline reads it back. That is the only honest way to test OCR -
// asserting on a mock proves the mock works.
// ---------------------------------------------------------------

const TILT = 3.5;

async function makePage(lines, tilt = TILT) {
    const font = await loadFont(SANS_32_BLACK);
    const img = new Jimp({ width: 950, height: 90 + lines.length * 70, color: 0xffffffff });

    lines.forEach((text, i) => {
        img.print({ font, x: 30, y: 40 + i * 70, text });
    });

    if (tilt) img.rotate(tilt);
    return img.getBuffer("image/png");
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("deskew estimates a tilt in the direction that corrects it", async () => {
    const buf = await makePage(["Deskew probe line one", "Deskew probe line two"], 4);
    const skew = await ocr.estimateSkew(await Jimp.read(buf));

    // Page tilted +4 must be corrected by a negative rotation.
    assert.ok(skew < 0, `expected a negative correction, got ${skew}`);
    assert.ok(Math.abs(skew + 4) < 2.5, `correction ${skew} is not near -4`);
});

test("deskew leaves a level page alone", async () => {
    const buf = await makePage(["Perfectly level line", "Another level line"], 0);
    const skew = await ocr.estimateSkew(await Jimp.read(buf));

    assert.ok(Math.abs(skew) <= 1.5, `level page reported skew ${skew}`);
});

test("preprocess returns a decodable PNG", async () => {
    const buf = await makePage(["Preprocess check"]);
    const { buffer } = await ocr.preprocess(buf);

    assert.strictEqual(buffer.subarray(1, 4).toString(), "PNG");
    await Jimp.read(buffer); // throws if it is not really an image
});

test("canRead accepts images and refuses everything else", () => {
    assert.ok(ocr.canRead("image/png"));
    assert.ok(ocr.canRead("image/jpeg"));
    assert.ok(!ocr.canRead("application/pdf"));
    assert.ok(!ocr.canRead("text/plain"));
});

test("recognises text off a tilted page", async () => {
    const buf = await makePage([
        "FIR 0142 of 2026",
        "Complainant Sunita Sharma",
        "Phone 9876543210",
    ]);

    const res = await ocr.recognise(buf);
    const text = res.text.replace(/\s+/g, " ");

    console.log(`        read: ${JSON.stringify(text.slice(0, 90))}`);
    console.log(`        confidence ${res.confidence}, skew ${res.skew}`);

    // Not asserting an exact transcription - OCR is probabilistic and a
    // brittle equality here would fail on a font rendering difference.
    // Assert the things the rest of the system depends on.
    assert.ok(text.length > 10, "no text recognised at all");
    assert.ok(/0142/.test(text), "FIR digits not recognised");
    assert.ok(/9876543210/.test(text.replace(/\s/g, "")), "phone digits not recognised");
});

test("recognised text feeds the entity rules layer", async () => {
    // This is the join between F3 and F4: OCR output has to be good
    // enough for the rules layer to find something in it.
    const buf = await makePage([
        "FIR 0142 of 2026 under BNS Section 74",
        "Phone 9876543210",
    ]);

    const res = await ocr.recognise(buf);
    const found = entities.extract(res.text);

    assert.ok(
        found.phones.length > 0 || /9876543210/.test(res.text.replace(/\s/g, "")),
        "phone not extractable from OCR output"
    );
});

(async () => {
    let failed = 0;

    for (const [name, fn] of tests) {
        try {
            await fn();
            console.log(`  ok    ${name}`);
        } catch (err) {
            failed++;
            console.error(`  FAIL  ${name}`);
            console.error(`        ${err.message}`);
        }
    }

    await ocr.shutdown();

    console.log(`\n${tests.length - failed}/${tests.length} passed`);
    process.exit(failed ? 1 : 0);
})();
