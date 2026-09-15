"""
docsvc — minimal secure document service.

One module, one process, in-memory store. Implements the real domain logic
teams code against; infra is stubbed at clearly-marked seams.

  - Auth            resolve a bearer token -> Subject (identity + attributes)
  - Authorization   RBAC ∩ ABAC — BOTH must allow (defense in depth)
  - Documents       create / read / update
  - Versioning      append-only, immutable versions; old versions stay readable
  - Encryption      envelope encryption (per-version data key wrapped by a KEK)
  - Audit           hash-chained, tamper-evident log of every access decision

Run:  python docsvc.py         # runs the self-check
API:  uvicorn docsvc:app       # FastAPI layer, live OpenAPI at /docs (optional dep)
"""
from __future__ import annotations
import os, hashlib, hmac, base64, json, urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─────────────────────────────── domain types ───────────────────────────────
CLEARANCE = {"public": 0, "internal": 1, "confidential": 2, "secret": 3}


@dataclass(frozen=True)
class Subject:
    id: str
    roles: frozenset[str]
    clearance: int = 0                       # ABAC attribute: 0 public .. 3 secret


@dataclass
class Version:
    version_no: int
    wrapped_dek: bytes                       # data key encrypted by the KEK (KMS)
    nonce: bytes
    ciphertext: bytes
    created_by: str
    created_at: str


@dataclass
class Document:
    id: str
    owner: str
    classification: str                      # key into CLEARANCE
    versions: list[Version] = field(default_factory=list)


class Forbidden(Exception):
    pass


# ─────────────────────────────── KMS (envelope) ─────────────────────────────
class LocalKMS:
    """Same shape as AWS KMS GenerateDataKey / Decrypt.
    ponytail: in-process KEK + MAC key. Swap for AWS/GCP KMS in prod — these methods
    are the entire seam; the KEK and the audit MAC key never leave the HSM there."""
    def __init__(self, kek: bytes | None = None):
        self._kek = AESGCM(kek or os.urandom(32))
        self._mac = os.urandom(32)                 # audit signing key — never exposed

    def generate_data_key(self) -> tuple[bytes, bytes]:
        dek = os.urandom(32)
        nonce = os.urandom(12)
        return dek, nonce + self._kek.encrypt(nonce, dek, b"dek")   # plaintext + wrapped

    def decrypt_data_key(self, wrapped: bytes) -> bytes:
        return self._kek.decrypt(wrapped[:12], wrapped[12:], b"dek")

    def sign(self, payload: bytes) -> str:
        return hmac.new(self._mac, payload, hashlib.sha256).hexdigest()

    def verify_mac(self, payload: bytes, mac: str) -> bool:
        return hmac.compare_digest(self.sign(payload), mac)


class RemoteKMS:
    """Talks to the KMS/HSM service over HTTP. Same two-method contract as LocalKMS;
    the KEK lives only in that service and never crosses this wire — only DEKs do."""
    def __init__(self, url: str):
        self.url = url.rstrip("/")

    def _post(self, path: str, payload: dict) -> dict:
        req = urllib.request.Request(self.url + path, method="POST",
                                     data=json.dumps(payload).encode(),
                                     headers={"content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as r:      # ponytail: no retry/mTLS yet
            return json.load(r)

    def generate_data_key(self) -> tuple[bytes, bytes]:
        d = self._post("/kms/generate-data-key", {})
        return base64.b64decode(d["plaintext"]), base64.b64decode(d["wrapped"])

    def decrypt_data_key(self, wrapped: bytes) -> bytes:
        d = self._post("/kms/decrypt-data-key", {"wrapped": base64.b64encode(wrapped).decode()})
        return base64.b64decode(d["plaintext"])

    def sign(self, payload: bytes) -> str:
        return self._post("/kms/sign", {"payload": base64.b64encode(payload).decode()})["mac"]

    def verify_mac(self, payload: bytes, mac: str) -> bool:
        return self._post("/kms/verify",
                          {"payload": base64.b64encode(payload).decode(), "mac": mac})["valid"]


def make_kms():
    url = os.environ.get("KMS_URL")
    return RemoteKMS(url) if url else LocalKMS()   # LocalKMS keeps the self-check zero-setup


def _aad(doc_id: str, version_no: int) -> bytes:
    # binds ciphertext to its slot: a version can't be swapped into another doc/version
    return f"{doc_id}:{version_no}".encode()


def seal(kms: LocalKMS, doc_id: str, version_no: int, plaintext: bytes):
    dek, wrapped = kms.generate_data_key()
    nonce = os.urandom(12)
    ct = AESGCM(dek).encrypt(nonce, plaintext, _aad(doc_id, version_no))
    return wrapped, nonce, ct                # dek goes out of scope — never persisted


def unseal(kms: LocalKMS, doc_id: str, v: Version) -> bytes:
    dek = kms.decrypt_data_key(v.wrapped_dek)
    return AESGCM(dek).decrypt(v.nonce, v.ciphertext, _aad(doc_id, v.version_no))


# ─────────────────────────────── audit chain ────────────────────────────────
@dataclass
class AuditEntry:
    seq: int
    at: str
    actor: str
    action: str
    resource: str
    prev: str
    mac: str                                 # HMAC(payload) — key held in the KMS/HSM


def _payload(seq, at, actor, action, resource, prev) -> bytes:
    return f"{seq}|{at}|{actor}|{action}|{resource}|{prev}".encode()


class AuditLog:
    """Hash-chained AND keyed: each entry's tag is an HMAC signed by the KMS/HSM, so a
    store-only attacker who rewrites history can't produce valid tags (see tamper.py)."""
    GENESIS = "0" * 64

    def __init__(self, signer):              # signer = a KMS with sign()/verify_mac()
        self.signer = signer
        self.entries: list[AuditEntry] = []

    def record(self, actor: str, action: str, resource: str) -> None:
        prev = self.entries[-1].mac if self.entries else self.GENESIS
        seq = len(self.entries)
        at = _now()
        mac = self.signer.sign(_payload(seq, at, actor, action, resource, prev))
        self.entries.append(AuditEntry(seq, at, actor, action, resource, prev, mac))

    def verify(self) -> bool:                # ponytail: 1 KMS call/entry; add batch verify if logs get big
        prev = self.GENESIS
        for i, e in enumerate(self.entries):
            if e.seq != i or e.prev != prev:
                return False
            if not self.signer.verify_mac(
                    _payload(e.seq, e.at, e.actor, e.action, e.resource, e.prev), e.mac):
                return False
            prev = e.mac
        return True


# ─────────────────────────── policy engine (RBAC ∩ ABAC) ─────────────────────
ROLE_PERMS = {
    "admin":  {"*"},
    "editor": {"doc:create", "doc:read", "doc:write"},
    "viewer": {"doc:read"},
}


def rbac_allows(subject: Subject, action: str) -> bool:
    perms = set().union(*(ROLE_PERMS.get(r, set()) for r in subject.roles))
    return "*" in perms or action in perms


def abac_allows(subject: Subject, action: str, doc: Document | None) -> bool:
    if doc is None:                          # create: no resource to constrain yet
        return True
    if subject.clearance < CLEARANCE[doc.classification]:
        return False                         # must be cleared to the doc's level
    if action == "doc:write" and doc.owner != subject.id and "admin" not in subject.roles:
        return False                         # only owner (or admin) may overwrite
    return True


def authorize(subject: Subject, action: str, doc: Document | None = None) -> bool:
    return rbac_allows(subject, action) and abac_allows(subject, action, doc)   # intersection


# ─────────────────────────────── auth (tokens) ──────────────────────────────
class Auth:
    """ponytail: in-memory token->Subject. Swap for OIDC/JWT verification in prod;
    resolve() is the seam — verify signature, map claims to Subject."""
    def __init__(self):
        self._tokens: dict[str, Subject] = {}

    def issue(self, subject: Subject) -> str:
        tok = os.urandom(16).hex()
        self._tokens[tok] = subject
        return tok

    def resolve(self, token: str) -> Subject:
        s = self._tokens.get(token)
        if not s:
            raise Forbidden("invalid token")
        return s


# ─────────────────────────────── the service ────────────────────────────────
class DocumentService:
    def __init__(self, kms=None, auth: Auth | None = None):
        self.kms = kms or make_kms()             # RemoteKMS if KMS_URL set, else LocalKMS
        self.auth = auth or Auth()
        self.audit = AuditLog(self.kms)          # audit entries signed by the KMS/HSM key
        self._docs: dict[str, Document] = {}     # ponytail: swap for Postgres

    def _require(self, s: Subject, action: str, doc: Document | None = None) -> None:
        if not authorize(s, action, doc):
            self.audit.record(s.id, action + ":DENY", doc.id if doc else "-")
            raise Forbidden(f"{s.id} may not {action}")

    def _add_version(self, doc: Document, s: Subject, plaintext: bytes) -> int:
        n = len(doc.versions) + 1
        wrapped, nonce, ct = seal(self.kms, doc.id, n, plaintext)
        doc.versions.append(Version(n, wrapped, nonce, ct, s.id, _now()))
        return n

    def create(self, token: str, classification: str, plaintext: bytes) -> str:
        s = self.auth.resolve(token)
        self._require(s, "doc:create")
        if classification not in CLEARANCE:
            raise ValueError(f"unknown classification {classification!r}")
        doc = Document(os.urandom(8).hex(), owner=s.id, classification=classification)
        self._docs[doc.id] = doc
        self._add_version(doc, s, plaintext)
        self.audit.record(s.id, "doc:create", doc.id)
        return doc.id

    def update(self, token: str, doc_id: str, plaintext: bytes) -> int:
        s = self.auth.resolve(token)
        doc = self._docs[doc_id]
        self._require(s, "doc:write", doc)
        v = self._add_version(doc, s, plaintext)
        self.audit.record(s.id, "doc:write", f"{doc_id}@{v}")
        return v

    def read(self, token: str, doc_id: str, version_no: int | None = None) -> bytes:
        s = self.auth.resolve(token)
        doc = self._docs[doc_id]
        self._require(s, "doc:read", doc)            # deny BEFORE any decrypt
        v = doc.versions[-1] if version_no is None else doc.versions[version_no - 1]
        self.audit.record(s.id, "doc:read", f"{doc_id}@{v.version_no}")
        return unseal(self.kms, doc_id, v)

    def list_versions(self, token: str, doc_id: str):
        s = self.auth.resolve(token)
        doc = self._docs[doc_id]
        self._require(s, "doc:read", doc)
        return [{"version": v.version_no, "created_by": v.created_by,
                 "created_at": v.created_at} for v in doc.versions]

    def ask(self, token: str, doc_id: str, question: str, version_no: int | None = None) -> str:
        # read() enforces authz + decrypt + audit — the AI only sees what the caller may read
        plaintext = self.read(token, doc_id, version_no)
        return ask_claude(plaintext, question)


# ─────────────────────────────── AI integration ─────────────────────────────
def ask_claude(context: bytes, question: str) -> str:
    """Answer a question grounded in one document via Claude.
    ponytail: default model/effort; tune per workload if answers need more depth."""
    try:
        import anthropic
    except ImportError:
        raise RuntimeError("AI unavailable — pip install anthropic")
    client = anthropic.Anthropic()          # resolves ANTHROPIC_API_KEY or `ant auth login`
    msg = client.messages.create(
        model="claude-opus-5",
        max_tokens=4096,
        output_config={"effort": "low"},    # grounded Q&A over one doc — cheap is enough
        system=("Answer using ONLY the document. If the answer isn't in it, "
                'reply exactly "not in the document".'),
        messages=[{"role": "user",
                   "content": f"<document>\n{context.decode(errors='replace')}\n</document>\n\n"
                              f"Question: {question}"}],
    )
    return "".join(b.text for b in msg.content if b.type == "text").strip()


# ─────────────────────── API contract (FastAPI -> OpenAPI) ───────────────────
def build_app(svc: DocumentService):
    from fastapi import FastAPI, Header, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel

    app = FastAPI(title="docsvc", version="0.1.0")
    # ponytail: allow_origins=["*"] for local dev; pin to your frontend origin in prod
    app.add_middleware(CORSMiddleware, allow_origins=["*"],
                       allow_methods=["*"], allow_headers=["*"])

    # ponytail: dev login only — replace /auth/login with your IdP (OIDC/JWT) before prod
    DEV_USERS = {
        "alice": Subject("alice", frozenset({"admin"}),  clearance=3),
        "bob":   Subject("bob",   frozenset({"editor"}), clearance=1),
        "carol": Subject("carol", frozenset({"viewer"}), clearance=1),
    }

    class DocIn(BaseModel):
        content: str
        classification: str = "internal"

    class LoginIn(BaseModel):
        username: str

    class AskIn(BaseModel):
        question: str
        version: int | None = None

    def tok(authorization: str) -> str:
        return authorization.removeprefix("Bearer ").strip()

    def guard(fn):
        try:
            return fn()
        except Forbidden as e:
            raise HTTPException(403, str(e))
        except (KeyError, IndexError):
            raise HTTPException(404, "not found")

    @app.post("/auth/login")
    def login(body: LoginIn):
        s = DEV_USERS.get(body.username)
        if not s:
            raise HTTPException(401, "unknown dev user")
        return {"token": svc.auth.issue(s), "user": s.id, "roles": sorted(s.roles)}

    @app.post("/documents", status_code=201)
    def create(body: DocIn, authorization: str = Header(...)):
        return {"id": guard(lambda: svc.create(tok(authorization),
                body.classification, body.content.encode())), "version": 1}

    @app.get("/documents/{doc_id}")
    def read(doc_id: str, version: int | None = None, authorization: str = Header(...)):
        pt = guard(lambda: svc.read(tok(authorization), doc_id, version))
        return {"id": doc_id, "content": pt.decode()}

    @app.put("/documents/{doc_id}")
    def update(doc_id: str, body: DocIn, authorization: str = Header(...)):
        return {"id": doc_id,
                "version": guard(lambda: svc.update(tok(authorization),
                                 doc_id, body.content.encode()))}

    @app.get("/documents/{doc_id}/versions")
    def versions(doc_id: str, authorization: str = Header(...)):
        return guard(lambda: svc.list_versions(tok(authorization), doc_id))

    @app.post("/documents/{doc_id}/ask")   # AI answers grounded in the doc, caller's perms
    def ask(doc_id: str, body: AskIn, authorization: str = Header(...)):
        try:
            return {"answer": guard(lambda: svc.ask(
                tok(authorization), doc_id, body.question, body.version))}
        except RuntimeError as e:           # anthropic not installed / no credentials
            raise HTTPException(503, str(e))

    @app.get("/audit")   # ponytail: open for the start; gate to admin before prod
    def audit():
        return {"verified": svc.audit.verify(), "entries": [vars(e) for e in svc.audit.entries]}

    return app


try:
    app = build_app(DocumentService())       # `uvicorn docsvc:app`
except ImportError:
    app = None                               # FastAPI absent; core + self-check still run


# ─────────────────────────────── self-check ─────────────────────────────────
def demo():
    svc = DocumentService()
    admin  = svc.auth.issue(Subject("alice", frozenset({"admin"}),  clearance=3))
    editor = svc.auth.issue(Subject("bob",   frozenset({"editor"}), clearance=1))
    viewer = svc.auth.issue(Subject("carol", frozenset({"viewer"}), clearance=1))

    # create + read round-trips through envelope encryption
    doc = svc.create(editor, "internal", b"hello world")
    assert svc.read(viewer, doc) == b"hello world"

    # versioning: update makes v2; v1 stays readable and unchanged
    assert svc.update(editor, doc, b"hello world v2") == 2
    assert svc.read(viewer, doc) == b"hello world v2"
    assert svc.read(viewer, doc, version_no=1) == b"hello world"

    # actually encrypted at rest — plaintext not present in stored bytes
    assert b"hello world" not in svc._docs[doc].versions[0].ciphertext

    # RBAC: viewer lacks doc:write
    try: svc.update(viewer, doc, b"nope"); assert False
    except Forbidden: pass

    # ABAC ownership: editor may not overwrite a doc they don't own
    admin_doc = svc.create(admin, "internal", b"admin notes")
    try: svc.update(editor, admin_doc, b"tamper"); assert False
    except Forbidden: pass

    # ABAC clearance: viewer (1) may not read a secret (3), even with doc:read
    top = svc.create(admin, "secret", b"nuclear codes")
    try: svc.read(viewer, top); assert False
    except Forbidden: pass
    assert svc.read(admin, top) == b"nuclear codes"

    # audit chain: intact, then a single tamper breaks verification
    assert svc.audit.verify()
    svc.audit.entries[1].actor = "mallory"
    assert not svc.audit.verify()

    print("ok — all self-checks passed")


if __name__ == "__main__":
    demo()
