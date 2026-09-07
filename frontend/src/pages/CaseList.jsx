import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Folder, ShieldAlert } from "lucide-react";

import * as api from "../api/client";

// ---------------------------------------------------------------
// Screen 2: the cases this officer is assigned to.
//
// There is no "all cases" view and there is not meant to be. The
// backend joins through case_assignments, so an unassigned case is not
// hidden here - it is genuinely absent from the response.
// ---------------------------------------------------------------

export default function CaseList() {
    const [cases, setCases] = useState([]);
    const [total, setTotal] = useState(0);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.listCases()
            .then((res) => {
                setCases(res.items || []);
                setTotal(res.total || 0);
            })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, []);

    return (
        <div>
            <div className="page-header">
                <h1>My cases</h1>
                <p>
                    {loading
                        ? "Loading..."
                        : `${total} case${total === 1 ? "" : "s"} assigned to you`}
                </p>
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            {!loading && cases.length === 0 && !error && (
                <div className="empty-state">
                    <Folder size={32} />
                    <h3>No cases assigned</h3>
                    <p>
                        You are not assigned to any case. Rank alone does not grant
                        access - an inspector must assign you.
                    </p>
                </div>
            )}

            <div className="card-grid">
                {cases.map((c) => (
                    <Link key={c.id} to={`/cases/${c.id}`} className="case-card">
                        <div className="case-card-head">
                            <span className="case-number">{c.case_number}</span>
                            {c.sensitivity === "protected" && (
                                <span className="badge badge-protected">
                                    <ShieldAlert size={13} /> Protected
                                </span>
                            )}
                            {c.sensitivity === "restricted" && (
                                <span className="badge badge-restricted">Restricted</span>
                            )}
                        </div>

                        <h3>{c.title}</h3>

                        <div className="case-card-foot">
                            <span className={`status status-${c.status}`}>
                                {String(c.status).replace(/_/g, " ")}
                            </span>
                            <span className="muted">
                                {new Date(c.created_at).toLocaleDateString()}
                            </span>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
}
