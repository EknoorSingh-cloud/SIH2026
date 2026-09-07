const crypto = require("crypto");
const db = require("../db");

// ---------------------------------------------------------------
// STUB. This is the seam for whoever owns Hyperledger Fabric.
//
// Everything above this file already works: hashes are computed and
// stored, anchor_status is tracked, verification compares against
// whatever this returns. Replacing the two functions below with real
// chaincode calls should not require changing anything else.
//
// What goes on the ledger: the hash, who signed it, when. Never the
// document.
// ---------------------------------------------------------------

const anchored = new Map(); // in-memory stand-in for the chain

/**
 * Write a hash to the ledger.
 * Real version: submit a chaincode transaction, return its tx id.
 */
async function anchor({ versionId, documentId, sha256, signedBy }) {
    const txId = "stub-" + crypto.randomBytes(16).toString("hex");

    anchored.set(versionId, {
        txId,
        documentId,
        sha256,
        signedBy,
        anchoredAt: new Date().toISOString(),
    });

    await db.query(
        `UPDATE document_versions
        SET anchor_status = 'anchored',
            ledger_tx_id  = $1,
            anchored_at   = now()
      WHERE id = $2`,
        [txId, versionId]
    );

    return txId;
}

/**
 * Read back what the ledger says about a version.
 * Real version: query chaincode by tx id.
 *
 * Returning the hash from a separate store is the entire point. If we
 * read it from the same row we are checking, we would be asking the
 * suspect to vouch for themselves.
 */
async function lookup(versionId) {
    return anchored.get(versionId) || null;
}

/**
 * Called on startup so anchors survive a restart during development.
 * Delete this when the real ledger lands - it exists only because the
 * stub is in memory.
 */
async function rehydrate() {
    const { rows } = await db.query(
        `SELECT id, document_id, sha256, ledger_tx_id, uploaded_by, anchored_at
       FROM document_versions
      WHERE anchor_status = 'anchored'`
    );
    for (const r of rows) {
        anchored.set(r.id, {
            txId: r.ledger_tx_id,
            documentId: r.document_id,
            sha256: r.sha256,
            signedBy: r.uploaded_by,
            anchoredAt: r.anchored_at,
        });
    }
    return rows.length;
}

module.exports = { anchor, lookup, rehydrate };