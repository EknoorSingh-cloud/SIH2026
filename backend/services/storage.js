const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

// ---------------------------------------------------------------
// Envelope encryption.
//
// Every document gets its own random AES-256 key (the DEK). That key
// is itself encrypted with the master key and stored alongside the
// metadata. The master key never touches a file.
//
// Two consequences worth knowing:
//   - Deleting the wrapped key makes the blob permanently unreadable.
//     That is crypto-shredding, and it is how you satisfy a DPDP
//     erasure request without altering the ledger.
//   - GCM authenticates as well as encrypts. If anyone edits the blob
//     on disk, decryption fails outright rather than returning
//     garbage.
// ---------------------------------------------------------------

const BLOB_DIR = path.join(__dirname, "..", "uploads");

function masterKey() {
    const hex = process.env.MASTER_KEY;
    if (!hex || hex.length !== 64) {
        throw new Error(
            "MASTER_KEY must be 64 hex characters. Generate one with: openssl rand -hex 32"
        );
    }
    return Buffer.from(hex, "hex");
}

// Wrapped key layout:  [12-byte iv][16-byte tag][32-byte encrypted DEK]
function wrapKey(dek) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
    const enc = Buffer.concat([cipher.update(dek), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}

function unwrapKey(wrapped) {
    const iv = wrapped.subarray(0, 12);
    const tag = wrapped.subarray(12, 28);
    const enc = wrapped.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]);
}

/**
 * Encrypt a buffer and write it to disk.
 * Returns everything the database row needs.
 */
async function store(plaintext) {
    await fs.mkdir(BLOB_DIR, { recursive: true });

    // Hash the ORIGINAL bytes, before encryption. This is what gets
    // anchored and what verification recomputes.
    const sha256 = crypto.createHash("sha256").update(plaintext).digest("hex");

    const dek = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", dek, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const name = `${crypto.randomUUID()}.enc`;
    await fs.writeFile(path.join(BLOB_DIR, name), ciphertext);

    return {
        sha256,
        storage_path: name,
        size_bytes: plaintext.length,
        wrapped_key: wrapKey(dek),
        iv,
        auth_tag: authTag,
    };
}

/**
 * Read and decrypt.
 * Throws if the blob has been altered on disk - GCM will not return
 * data that fails its authentication tag.
 */
async function retrieve(row) {
    const ciphertext = await fs.readFile(path.join(BLOB_DIR, row.storage_path));

    const dek = unwrapKey(row.wrapped_key);
    const decipher = crypto.createDecipheriv("aes-256-gcm", dek, row.iv);
    decipher.setAuthTag(row.auth_tag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// Destroy the key, not the file. The blob becomes unreadable noise
// while the ledger record stays intact.
function shredPayload() {
    return crypto.randomBytes(60);
}

module.exports = { store, retrieve, shredPayload, BLOB_DIR };