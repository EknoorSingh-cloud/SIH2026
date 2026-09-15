# docsvc — threat model

Scope: the code in this repo (`docsvc.py`, `kms_service.py`, `index.html`). This is a
**starter**; the residual risks below are the work between here and production, and each
maps to a `ponytail:` seam in the code.

## Assets
- **Document plaintext** — the thing being protected.
- **KEK (master key)** — lives only in `kms_service`; compromise = every document.
- **Audit log** — evidence of who did what; its value is that it can't be silently rewritten.
- **Tokens** — bearer credentials; holding one *is* being that subject.

## Trust boundaries
```
browser (index.html) ──HTTP──> api (docsvc) ──HTTP──> kms/hsm (KEK) 
        untrusted             enforces authz         KEK never crosses back
                                    │
                                    └── store (in-memory now; DB later) = data at rest
```
The store is treated as **semi-trusted**: an attacker may read/write it (stolen DB dump,
insider) but does **not** hold the KEK. Envelope encryption is what makes that survivable.

## STRIDE by component

| Threat | Vector | Status in this code |
|---|---|---|
| **Spoofing** | Forge identity | Bearer token → `Subject`. ✅ shape is right; ⚠️ dev tokens are random strings in memory — **swap `Auth.resolve` for OIDC/JWT signature verification**. |
| **Tampering (data)** | Edit ciphertext in store | ✅ AES-GCM AEAD + doc/version AAD → any edit or cross-doc swap fails auth (`tamper.py` ATTACK 2). |
| **Tampering (audit)** | Rewrite history | ⚠️ **partial** edit caught (ATTACK 1); **full re-forge NOT caught** (ATTACK 3) — keyless hash. See Residual #1. |
| **Repudiation** | "I never did that" | ✅ every allow *and* deny is logged with actor; ⚠️ only as strong as the audit integrity fix. |
| **Information disclosure** | Read a doc you shouldn't; AI leak | ✅ authz runs *before* decrypt; ✅ `/ask` routes through `read()`, so the model only sees what the caller may read. ⚠️ no encryption in transit between services (add TLS/mTLS). |
| **Elevation of privilege** | Do an action above your role | ✅ RBAC ∩ ABAC, both must allow; deny logged. ⚠️ policy is code — review `ROLE_PERMS`/`abac_allows` as real rules land. |
| **DoS** | Flood, huge uploads | ❌ no rate limit, no body-size cap. Add at the gateway. |

## Residual risks (the honest ceilings)

1. **Audit chain is keyless — forgeable by anyone who can write the store.**
   `hash = SHA-256(...)` proves *internal consistency*, not *authenticity*. `tamper.py`
   ATTACK 3 deletes an entry, recomputes every hash, and `verify()` returns `True`.
   **Fix:** HMAC each entry with a key held in the KMS/HSM (not in the app), and/or
   anchor the head hash to an append-only/WORM store or external transparency log so
   truncation and re-forge are detectable. *This is the single most important upgrade.*

2. **No transport security between api ↔ kms.** DEKs cross that hop in plaintext JSON.
   Fine inside a private compose network; **add mTLS before it crosses a real network.**

3. **Dev auth & CORS `*`.** `/auth/login` mints tokens for hardcoded users; CORS allows
   all origins. Both are marked dev-only — replace with your IdP and a pinned origin.

4. **KEK availability.** Ephemeral dev KEK means a `kms` restart makes all ciphertext
   unrecoverable. Set `KMS_KEK` (or use real KMS with key rotation + backups) for anything
   you care about.

5. **In-memory store.** No persistence, no per-record access control beyond the policy
   engine, no soft-delete/tombstones. Swap for a DB (marked seam on `_docs`).

## What's already right (don't undo it)
- Envelope encryption with per-version DEKs; KEK isolated in a separate service.
- Authorization is an intersection (defense in depth) and runs before any decrypt.
- The AI endpoint inherits the caller's permissions — no second access path to keep in sync.
- Every access decision, including denials, is recorded.
