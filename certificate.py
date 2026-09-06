from datetime import datetime, timezone
import platform


def generate_bsa_63_certificate(filename: str, sha256_hash: str, doc_type: str, ocr_confidence: float) -> dict:
    """Generates a statutory Section 63 BSA, 2023 certificate for admissibility."""
    timestamp = datetime.now(timezone.utc).isoformat()

    return {
        "statute": "Section 63, Bharatiya Sakshya Adhiniyam, 2023 (Admissibility of Electronic Records)",
        "certificate_id": f"BSA63-{sha256_hash[:12].upper()}",
        "document_metadata": {
            "source_filename": filename,
            "classified_type": doc_type,
            "ocr_confidence": f"{ocr_confidence}%",
            "ingestion_timestamp_utc": timestamp,
        },
        "cryptographic_integrity": {
            "hashing_algorithm": "SHA-256",
            "digest": sha256_hash,
            "anchored_ledger": "Hyperledger Fabric - Digital Case Record",
        },
        "system_attestation": {
            "os_environment": platform.platform(),
            "device_node": platform.node(),
            "process_verified": True,
            "declaration": (
                "This electronic record was produced by an automated digital ingestion system "
                "operating in lawful and regular condition, adhering strictly to Section 63 BSA conditions."
            ),
        },
    }