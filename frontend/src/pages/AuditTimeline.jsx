import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ShieldCheck, ShieldX, Link2 } from "lucide-react";

import * as api from "../api/client";

// ---------------------------------------------------------------
// Screen 6: every event on this document, oldest first, with the
// chain-intact indicator.
//
// Each entry carries the hash of the one before it. Alter or delete a
// row and every hash after it stops matching, which is what the
// indicator is reporting. The database also refuses UPDATE and DELETE
// on the audit table outright.
//
// The ledger's own chain of custody is shown underneath when the
// Fabric backend is live.
// ---------------------------------------------------------------

const ACTION_LABEL = {
    upload: "Uploaded",
    view: "Viewed metadata",
    download: "Downloaded",
    export_redacted: "Exported (redacted)",
    new_version: "New version",
    verify: "Verified",
    search: "Searched",
    share: "Shared",
    access_denied: "Access denied",
};

export default function AuditTimeline() {
    const { documentId } = useParams();

    const [audit, setAudit] = useState(null);
    const [custody, setCustody] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.getAudit(documentId)
            .then(setAudit)
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));

        // Custody is best effort - the stub backend has none, and that
        // is not an error worth showing.
        api.getCustody(documentId).then(setCustody).catch(() => {});
    }, [documentId]);

    if (loading) return <div className="page-loading">Loading audit trail...</div>;
    if (!audit) return <div className="alert alert-error">{error || "Not found."}</div>;

    return (
        <div>
            <div className="page-header">
                <h1>Audit trail</h1>
                <p>
                    <Link to={`/documents/${documentId}`}>back to document</Link>
                </p>
            </div>

            <div
                className={`chain-banner ${audit.chain_intact ? "chain-ok" : "chain-bad"}`}
            >
                {audit.chain_intact ? <ShieldCheck size={22} /> : <ShieldX size={22} />}
                <span>
                    {audit.chain_intact
                        ? "Hash chain intact - no entry has been altered or removed"
                        : `Hash chain BROKEN at entry ${audit.broken_at}`}
                </span>
            </div>

            <section className="panel">
                <ol className="timeline">
                    {audit.entries.map((e) => (
                        <li key={e.id} className={e.action === "access_denied" ? "denied" : ""}>
                            <div className="timeline-head">
                                <strong>{ACTION_LABEL[e.action] || e.action}</strong>
                                <span className="muted">
                                    {new Date(e.occurred_at).toLocaleString()}
                                </span>
                            </div>

                            <div className="muted">
                                {e.name
                                    ? `${e.name} (${e.service_number}, ${e.rank})`
                                    : "unauthenticated"}
                                {e.version ? ` · v${e.version}` : ""}
                            </div>

                            {e.detail && (
                                <pre className="detail-json">
                                    {JSON.stringify(e.detail)}
                                </pre>
                            )}

                            <code className="hash" title={e.entry_hash}>
                                {e.entry_hash.slice(0, 16)}...
                            </code>
                        </li>
                    ))}
                </ol>

                {audit.entries.length === 0 && (
                    <p className="muted">No events recorded for this document.</p>
                )}
            </section>

            {custody && (
                <section className="panel">
                    <h2>
                        <Link2 size={16} /> Ledger chain of custody
                    </h2>
                    <p className="muted">
                        Backend: <strong>{custody.ledger_backend}</strong>
                        {custody.ledger_backend === "stub" &&
                            " - in-memory, not an independent record"}
                    </p>

                    {custody.entries.length === 0 ? (
                        <p className="muted">No ledger history for this version.</p>
                    ) : (
                        <ol className="timeline">
                            {custody.entries.map((e, i) => (
                                <li key={e.txId || i}>
                                    <div className="timeline-head">
                                        <strong>{e.value ? e.value.action : "write"}</strong>
                                        <span className="muted">
                                            {new Date(e.timestamp).toLocaleString()}
                                        </span>
                                    </div>
                                    <code className="hash">{e.txId}</code>
                                </li>
                            ))}
                        </ol>
                    )}
                </section>
            )}
        </div>
    );
}
