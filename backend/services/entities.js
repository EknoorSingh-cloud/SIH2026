// ---------------------------------------------------------------
// Rules-based entity extraction.
//
// This is the regex half of F4. It ships ahead of the model half on
// purpose: for structured fields - FIR numbers, statute references,
// phone numbers - rules beat any NER model and are auditable, which
// matters when a judge asks why something was or was not redacted.
//
// Two groups, and the difference is the whole point:
//
//   REDACT  things that identify a victim (phone, Aadhaar, email)
//   KEEP    things a court needs (FIR number, sections, dates)
//
// A redactor that eats the FIR number and the statute references has
// destroyed the document's evidentiary value. Keeping them is as much
// a requirement as removing the identity.
// ---------------------------------------------------------------

// ---- identifying, must be removed ----

// Indian mobile numbers, with or without a +91 country code.
const PHONE = /(?:\+?91[-\s]?)?\b[6-9]\d{9}\b/g;

// Aadhaar is 12 digits, usually grouped 4-4-4.
const AADHAAR = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// ---- evidentiary, must be preserved ----

const FIR_NUMBER = /\b(?:FIR[\/\s-]?)?\d{1,5}\/\d{4}\b/gi;

// BNS / BNSS / BSA / IPC / CrPC references, and bare "Section 115(2)".
const SECTION =
    /\b(?:BNS|BNSS|BSA|IPC|CrPC)\s*(?:S(?:ec)?\.?|Section)?\s*\d+[A-Z]?(?:\(\d+\))?|\bSection\s+\d+[A-Z]?(?:\(\d+\))?/gi;

const DATE =
    /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g;

function matchAll(text, re) {
    // Fresh lastIndex each time - these are module-level /g regexes and
    // reusing them statefully across calls silently skips matches.
    const out = [];
    const rx = new RegExp(re.source, re.flags);
    let m;
    while ((m = rx.exec(text)) !== null) {
        if (m[0]) out.push({ value: m[0], start: m.index, end: m.index + m[0].length });
        if (m.index === rx.lastIndex) rx.lastIndex++;
    }
    return out;
}

const uniq = (spans) => [...new Set(spans.map((s) => s.value))];

/**
 * Pull every rules-detectable entity out of a block of text.
 * Returns the shape described in migration 002 so F4's model layer can
 * merge into the same object.
 */
function extract(text) {
    const src = String(text || "");

    return {
        phones: uniq(matchAll(src, PHONE)),
        emails: uniq(matchAll(src, EMAIL)),
        aadhaar: uniq(matchAll(src, AADHAAR)),

        fir_numbers: uniq(matchAll(src, FIR_NUMBER)),
        sections: uniq(matchAll(src, SECTION)),
        dates: uniq(matchAll(src, DATE)),
    };
}

/** Spans that identify someone and must be removed on a protected export. */
function identifyingSpans(text) {
    return [
        ...matchAll(text, PHONE),
        ...matchAll(text, EMAIL),
        ...matchAll(text, AADHAAR),
    ];
}

/** Spans a court needs, which redaction must never eat. */
function preservedSpans(text) {
    return [
        ...matchAll(text, FIR_NUMBER),
        ...matchAll(text, SECTION),
        ...matchAll(text, DATE),
    ];
}

module.exports = {
    extract,
    identifyingSpans,
    preservedSpans,
    matchAll,
    patterns: { PHONE, AADHAAR, EMAIL, FIR_NUMBER, SECTION, DATE },
};
