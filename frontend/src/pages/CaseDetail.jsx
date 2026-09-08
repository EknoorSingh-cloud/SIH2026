import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { FileText, Upload as UploadIcon, ShieldAlert, Plus } from "lucide-react";

import * as api from "../api/client";

// ---------------------------------------------------------------
// Screen 3: one case, its documents, and the upload control.
//
// On a protected case this also shows the identities redaction will
// strip from every export. That list is only visible to officers on
// the case, and it is never included in an export.
// ---------------------------------------------------------------

const DOC_TYPES = [
    "fir",
    "statement",
    "forensic_report",
    "charge_sheet",
    "court_filing",
    "notice",
    "other",
];

export default function CaseDetail() {
    const { caseId } = useParams();

    const [kase, setKase] = useState(null);
    const [documents, setDocuments] = useState([]);
    const [identities, setIdentities] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);

    const [title, setTitle] = useState("");
    const [docType, setDocType] = useState("fir");
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [notice, setNotice] = useState(null);

    const [newIdentity, setNewIdentity] = useState("");

    // shouldApply lets the caller abandon a response it no longer wants:
    // navigating to another case mid-load must not paint the old one's
    // documents over the new screen.
    const load = useCallback(
        async (shouldApply = () => true) => {
            try {
                const [c, docs] = await Promise.all([
                    api.getCase(caseId),
                    api.listCaseDocuments(caseId),
                ]);
                if (!shouldApply()) return;

                setKase(c);
                setDocuments(docs || []);

                if (c.sensitivity === "protected") {
                    // Only inspectors and above can add to this list, but
                    // anyone on the case can see what is being protected.
                    const ids = await api
                        .listProtectedIdentities(caseId)
                        .catch(() => []);
                    if (shouldApply()) setIdentities(ids);
                }
            } catch (err) {
                if (shouldApply()) setError(err.message);
            } finally {
                if (shouldApply()) setLoading(false);
            }
        },
        [caseId]
    );

    useEffect(() => {
        let cancelled = false;
        (async () => {
            await load(() => !cancelled);
        })();
        return () => {
            cancelled = true;
        };
    }, [load]);

    async function submitUpload(e) {
        e.preventDefault();
        if (!file || !title.trim()) return;

        setUploading(true);
        setError(null);
        setNotice(null);
        try {
            await api.uploadDocument({
                caseId,
                title: title.trim(),
                docType,
                file,
            });
            setTitle("");
            setFile(null);
            e.target.reset();
            setNotice("Uploaded. The hash is being anchored to the ledger.");
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setUploading(false);
        }
    }

    async function addIdentity(e) {
        e.preventDefault();
        const value = newIdentity.trim();
        if (value.length < 2) return;

        try {
            await api.addProtectedIdentity(caseId, value);
            setNewIdentity("");
            setIdentities(await api.listProtectedIdentities(caseId));
        } catch (err) {
            setError(err.message);
        }
    }

    if (loading) return <div className="page-loading">Loading case...</div>;
    if (!kase) return <div className="alert alert-error">{error || "Not found."}</div>;

    return (
        <div>
            <div className="page-header">
                <div className="case-card-head">
                    <h1>{kase.case_number}</h1>
                    {kase.sensitivity === "protected" && (
                        <span className="badge badge-protected">
                            <ShieldAlert size={13} /> Protected
                        </span>
                    )}
                </div>
                <p>{kase.title}</p>
            </div>

            {error && <div className="alert alert-error">{error}</div>}
            {notice && <div className="alert alert-ok">{notice}</div>}

            {kase.sensitivity === "protected" && (
                <section className="panel panel-warn">
                    <h2>
                        <ShieldAlert size={16} /> Protected identities
                    </h2>
                    <p className="muted">
                        Removed from every export of this case under BNS S.72. This
                        list is never exported.
                    </p>

                    <ul className="identity-list">
                        {identities.map((i) => (
                            <li key={i.id}>
                                <span>{i.value}</span>
                                <span className="muted">{i.kind}</span>
                            </li>
                        ))}
                        {identities.length === 0 && (
                            <li className="muted">
                                Nothing registered yet - exports will only have
                                pattern-matched data removed.
                            </li>
                        )}
                    </ul>

                    <form onSubmit={addIdentity} className="inline-form">
                        <input
                            value={newIdentity}
                            onChange={(e) => setNewIdentity(e.target.value)}
                            placeholder="Name, address or number to protect"
                        />
                        <button type="submit" className="btn btn-small">
                            <Plus size={14} /> Add
                        </button>
                    </form>
                </section>
            )}

            <section className="panel">
                <h2>
                    <UploadIcon size={16} /> Upload a document
                </h2>

                <form onSubmit={submitUpload} className="upload-form">
                    <div className="input-group">
                        <label>Title</label>
                        <input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            required
                        />
                    </div>

                    <div className="input-group">
                        <label>Type</label>
                        <select value={docType} onChange={(e) => setDocType(e.target.value)}>
                            {DOC_TYPES.map((t) => (
                                <option key={t} value={t}>
                                    {t.replace(/_/g, " ")}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="input-group">
                        <label>File</label>
                        <input
                            type="file"
                            onChange={(e) => setFile(e.target.files[0] || null)}
                            required
                        />
                    </div>

                    <button type="submit" className="btn" disabled={uploading || !file}>
                        {uploading ? "Uploading..." : "Upload"}
                    </button>
                </form>
            </section>

            <section className="panel">
                <h2>Documents</h2>

                {documents.length === 0 ? (
                    <p className="muted">No documents in this case yet.</p>
                ) : (
                    <div className="document-list">
                        {documents.map((d) => (
                            <Link
                                key={d.id}
                                to={`/documents/${d.id}`}
                                className="document-item"
                            >
                                <FileText size={20} />
                                <div>
                                    <h4>{d.title}</h4>
                                    <p>
                                        {String(d.doc_type).replace(/_/g, " ")} · v
                                        {d.current_version} ·{" "}
                                        {new Date(d.created_at).toLocaleDateString()}
                                    </p>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
