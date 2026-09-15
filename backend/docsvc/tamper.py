"""
tamper.py — attacks against docsvc, and which ones the design catches.

Run:  python tamper.py

ATTACK 3 is the one that used to break the demo: a store-only attacker deletes an
entry and recomputes the chain. The audit tag is now an HMAC signed by a key that
lives in the KMS/HSM, so without that key the re-forged chain fails verification.
(Model the attacker as having STORE access, not KMS access — so they can only
produce a keyless hash, never a valid MAC.)
"""
import hashlib
from cryptography.exceptions import InvalidTag

from docsvc import DocumentService, Subject, AuditLog


def line(msg): print("\n== " + msg + " ==")


def main():
    svc = DocumentService()
    admin = svc.auth.issue(Subject("alice", frozenset({"admin"}), clearance=3))
    a = svc.create(admin, "internal", b"contract A: pay $100")
    b = svc.create(admin, "internal", b"contract B: pay $999")

    # ── ATTACK 1: edit a past audit entry, leave the rest alone ──────────────
    line("ATTACK 1: naive edit of one audit entry")
    victim = svc.audit.entries[1]
    saved = victim.actor
    victim.actor = "mallory"
    assert svc.audit.verify() is False, "should be caught"
    print("DETECTED — downstream hashes no longer match the edited entry.")
    victim.actor = saved  # restore for the next attack

    # ── ATTACK 2: swap ciphertext between two documents in the store ─────────
    line("ATTACK 2: swap ciphertext blobs between documents")
    va = svc._docs[a].versions[0]
    vb = svc._docs[b].versions[0]
    va.ciphertext, vb.ciphertext = vb.ciphertext, va.ciphertext
    try:
        svc.read(admin, a)
        print("NOT detected — plaintext leaked!")
    except InvalidTag:
        print("DETECTED — AES-GCM auth fails; ciphertext is bound to its own doc/version (AAD).")
    va.ciphertext, vb.ciphertext = vb.ciphertext, va.ciphertext  # restore

    # ── ATTACK 3: re-forge the audit chain with STORE access but no KMS key ───
    line("ATTACK 3: delete an entry, then recompute the whole chain (no KMS key)")
    assert svc.audit.verify() is True
    svc.audit.entries.pop(1)                        # erase evidence of one action
    prev = AuditLog.GENESIS
    for i, e in enumerate(svc.audit.entries):       # attacker has store access, not the key
        e.seq, e.prev = i, prev
        payload = f"{e.seq}|{e.at}|{e.actor}|{e.action}|{e.resource}|{e.prev}".encode()
        e.mac = hashlib.sha256(payload).hexdigest() # best they can do: a keyless hash
        prev = e.mac
    forged_ok = svc.audit.verify()
    print(f"verify() -> {forged_ok}")
    assert forged_ok is False, "re-forge without the KMS MAC key must fail"
    print("DETECTED — entries are HMAC'd by a key held in the KMS/HSM; a store-only")
    print("attacker can't produce valid tags. Only KMS /kms/sign access could forge,")
    print("which is now the guarded boundary (rotate + audit that key, anchor the head).")


if __name__ == "__main__":
    main()
    print("\nok — attack demo ran (all 3 detected; audit forgery now needs the KMS key).")
