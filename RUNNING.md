# Running NYAYAKOSH

Everything needed to get the demo up, and an honest note on which parts
are real.

## 1. Database

```bash
createdb sih_dms

cd backend
psql -U postgres -d sih_dms -f db/schema.sql
psql -U postgres -d sih_dms -f db/migrations/001_search_audit_action.sql
psql -U postgres -d sih_dms -f db/migrations/002_redaction.sql
```

`schema.sql` already contains everything in the migrations, so a fresh
database only needs the schema. Run the migrations on a database created
before those features landed. Both are idempotent.

```bash
node scripts/seed.js      # demo users and cases
```

## 2. Backend

`backend/.env`:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/sih_dms

# 64 hex characters. Generate: openssl rand -hex 32
# Lose this and every stored document is unreadable - that is the point.
MASTER_KEY=<64 hex chars>

PORT=5000
CORS_ORIGIN=http://localhost:5173

# stub = in-memory, runs anywhere, proves nothing
# fabric = the real ledger, see fabric/README.md
LEDGER_BACKEND=stub

# Leave false until you have looked at real redacted output.
REDACTION_ENABLED=false
```

```bash
cd backend
npm install
npm test        # 32 checks, no database needed
npm run dev
```

The startup log prints which ledger backend is live. Check it before
demoing.

## 3. Frontend

```bash
cd frontend
npm install
npm run dev     # http://localhost:5173
```

Set `VITE_API_URL` if the backend is not on `localhost:5000/api/v1`. To
work without a backend at all:

```bash
npx @stoplight/prism mock openapi.yaml
VITE_API_URL=http://127.0.0.1:4010 npm run dev
```

## 4. The demo

```bash
cd backend && ./demo.sh
```

Uploads a document, verifies it, issues the S.63 certificate, searches,
shows the ICJS payload, corrupts the blob on disk, verifies again
(TAMPERED), and shows the certificate now refusing with 409.

The ninety-second story, in the UI:

1. Log in as an inspector — password, then MFA
2. Open a case, upload an FIR
3. Document view — the hash and its ledger transaction id
4. Download — watermarked; on a protected case, redacted
5. Corrupt the stored blob directly on disk
6. Verify — **TAMPERED**, full width, both hashes side by side
7. Audit trail — every action, hash-linked, chain intact
8. Log in as an unassigned constable — the case is not there at all

Step 8 is the strongest and the one most teams forget. Correct rank,
valid login, still nothing.

## What is real, and what is not

| Area | State |
|---|---|
| Auth, MFA, sessions, RBAC∩ABAC | Real |
| Envelope encryption, tamper detection | Real |
| Hash-linked audit log | Real, append-only enforced in Postgres |
| Versioning, integrity verification | Real |
| BSA S.63 certificate | Real |
| Export watermarking | Real, PDF only, visible (not steganographic) |
| Search | Real, but returns nothing until OCR populates `extracted_text` |
| Ledger | Real chaincode; **runs on the in-memory stub unless `LEDGER_BACKEND=fabric`** |
| Redaction | Real for `text/*`; **refuses PDFs and images rather than half-redacting** |
| ICJS | **Mock.** Fixtures. Every response says `"mock": true` |
| DSC / eSign | **Stub.** Correct interface, throwaway ECDSA key, not a legal signature |
| OCR (F3), entity extraction (F4) | **Not built** |
| MinIO (F6), PWA (F12) | **Not built.** Storage is local disk |

Say these out loud when demonstrating. Every one of them is defensible
as an engineering decision; none of them survives being oversold.

## Known limits worth stating before someone finds them

- **Redaction covers text files only.** Truly redacting a PDF means
  removing text operators from its content streams, not drawing a box
  over them — a black rectangle with selectable text underneath is the
  classic failure, and a judge will test it by copy-pasting. Images need
  per-entity bounding boxes that OCR does not yet emit. Both refuse with
  503 rather than release something half-redacted.
- **Search needs F3.** The index and the query are in place; there is
  simply no OCR text to match yet.
- **Anchoring is fire-and-forget.** A ledger outage marks the version
  `anchor_status='failed'` instead of failing the upload, and nothing
  retries it yet.
- **The DSC keypair is per-process**, so signatures do not survive a
  restart.
