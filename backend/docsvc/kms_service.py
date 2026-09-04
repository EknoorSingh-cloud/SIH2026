"""
kms_service — KMS / HSM simulation.

The whole point: the master key (KEK) is born here and NEVER leaves. Callers get
data keys (DEKs) — a fresh plaintext DEK plus its wrapped form — exactly like AWS
KMS GenerateDataKey / Decrypt. An attacker who owns the document store holds only
wrapped DEKs and ciphertext; without this service (this KEK) none of it decrypts.

ponytail: in-process AES-GCM stands in for a PKCS#11 HSM / AWS KMS. Swap this
service for the real thing — the two routes below are the entire contract.

Run:  uvicorn kms_service:app --port 9000
"""
import os, base64, hmac, hashlib
from fastapi import FastAPI
from pydantic import BaseModel
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# KEK + audit MAC key: from env (stable across restarts) or ephemeral (dev).
# base64 of 32 raw bytes each. Both keys are born here and NEVER returned.
_KEK = AESGCM(base64.b64decode(os.environ["KMS_KEK"]) if os.environ.get("KMS_KEK")
              else os.urandom(32))
_MAC = (base64.b64decode(os.environ["KMS_MAC_KEY"]) if os.environ.get("KMS_MAC_KEY")
        else os.urandom(32))

app = FastAPI(title="kms-sim", version="0.1.0")


def _b64(x: bytes) -> str:
    return base64.b64encode(x).decode()


def _sign(payload: bytes) -> str:
    return hmac.new(_MAC, payload, hashlib.sha256).hexdigest()


class Wrapped(BaseModel):
    wrapped: str


class SignIn(BaseModel):
    payload: str            # base64


class VerifyIn(BaseModel):
    payload: str            # base64
    mac: str


@app.post("/kms/generate-data-key")
def generate_data_key():
    dek = os.urandom(32)
    nonce = os.urandom(12)
    return {"plaintext": _b64(dek), "wrapped": _b64(nonce + _KEK.encrypt(nonce, dek, b"dek"))}


@app.post("/kms/decrypt-data-key")
def decrypt_data_key(w: Wrapped):
    raw = base64.b64decode(w.wrapped)
    return {"plaintext": _b64(_KEK.decrypt(raw[:12], raw[12:], b"dek"))}


@app.post("/kms/sign")                       # audit MAC — key stays here
def sign(b: SignIn):
    return {"mac": _sign(base64.b64decode(b.payload))}


@app.post("/kms/verify")
def verify(b: VerifyIn):
    return {"valid": hmac.compare_digest(_sign(base64.b64decode(b.payload)), b.mac)}


@app.get("/healthz")
def healthz():
    return {"ok": True}
