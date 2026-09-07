import { Link, NavLink, useNavigate } from "react-router-dom";
import { Folder, LogOut, Search as SearchIcon } from "lucide-react";
import { useState } from "react";

import { useAuth } from "../auth-context";
import * as api from "../api/client";

// ---------------------------------------------------------------
// The shell every signed-in screen renders inside.
//
// The sidebar is short on purpose. There is no "all documents" or
// "all users" entry, because neither exists for a normal officer -
// everything is reached through a case you are assigned to.
// ---------------------------------------------------------------

// ts_headline wraps matches in <b> but does NOT escape the surrounding
// text, and that text is OCR of a document someone uploaded. Rendering
// it as HTML would run script out of an evidence file. Strip the markup
// and render plain text - the highlight is not worth an XSS.
function plainSnippet(html) {
    return String(html || "")
        .replace(/<[^>]*>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&");
}

export default function Layout({ children }) {
    const { user, signOut } = useAuth();
    const navigate = useNavigate();

    const [q, setQ] = useState("");
    const [results, setResults] = useState(null);
    const [searching, setSearching] = useState(false);

    async function runSearch(e) {
        e.preventDefault();
        const query = q.trim();
        if (!query) return;

        setSearching(true);
        try {
            setResults(await api.searchDocuments(query));
        } catch {
            setResults({ items: [], total: 0 });
        } finally {
            setSearching(false);
        }
    }

    return (
        <div className="app-layout">
            <aside className="sidebar">
                <div className="logo">
                    <h2>NYAYAKOSH</h2>
                    <p>Secure Legal DMS</p>
                </div>

                <nav className="menu">
                    <NavLink to="/cases" className="menu-item">
                        <Folder size={18} /> My cases
                    </NavLink>
                </nav>

                <div className="sidebar-user">
                    {user && (
                        <>
                            <strong>{user.name}</strong>
                            <span className="muted">
                                {user.rank} · {user.service_number}
                            </span>
                            <span className="muted">{user.station}</span>
                        </>
                    )}
                </div>

                <button
                    className="logout"
                    onClick={async () => {
                        await signOut();
                        navigate("/", { replace: true });
                    }}
                >
                    <LogOut size={18} /> Sign out
                </button>
            </aside>

            <main className="main-content">
                <form className="topbar-search" onSubmit={runSearch}>
                    <SearchIcon size={16} />
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Search documents you have access to"
                    />
                    {results && (
                        <button
                            type="button"
                            className="link-button"
                            onClick={() => {
                                setResults(null);
                                setQ("");
                            }}
                        >
                            clear
                        </button>
                    )}
                </form>

                {results ? (
                    <section className="panel">
                        <h2>
                            {searching
                                ? "Searching..."
                                : `${results.total} result${results.total === 1 ? "" : "s"}`}
                        </h2>
                        <p className="muted">
                            Only documents in cases you are assigned to. Snippets are
                            withheld on protected cases.
                        </p>

                        {results.items.map((r) => (
                            <Link
                                key={`${r.document_id}-${r.version}`}
                                to={`/documents/${r.document_id}`}
                                className="search-hit"
                            >
                                <div className="timeline-head">
                                    <strong>{r.title}</strong>
                                    <span className="muted">{r.case_number}</span>
                                </div>
                                {r.snippet ? (
                                    <p className="snippet">{plainSnippet(r.snippet)}</p>
                                ) : (
                                    <p className="muted">
                                        {r.sensitivity === "protected"
                                            ? "Snippet withheld - protected case"
                                            : "No preview"}
                                    </p>
                                )}
                            </Link>
                        ))}

                        {!searching && results.items.length === 0 && (
                            <p className="muted">
                                Nothing matched. Search reads OCR text, which is only
                                populated once a document has been processed.
                            </p>
                        )}
                    </section>
                ) : (
                    children
                )}
            </main>
        </div>
    );
}
