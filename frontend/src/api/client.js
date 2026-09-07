// ---------------------------------------------------------------
// The only place in the frontend that talks to the backend.
//
// One function per endpoint, one base URL, one place the Authorization
// header is attached. Do not call fetch() from a component - when the
// contract changes you want exactly one file to edit, and when a judge
// asks how the token is handled you want one place to point at.
//
// Built against openapi.yaml. To work without a running backend:
//   npx @stoplight/prism mock openapi.yaml
//   VITE_API_URL=http://127.0.0.1:4010 npm run dev
// ---------------------------------------------------------------

const BASE =
    import.meta.env.VITE_API_URL || "http://localhost:5000/api/v1";

const TOKEN_KEY = "nyayakosh.session";

// sessionStorage, not localStorage: the token dies with the tab. On a
// shared station machine that difference matters.
export const tokenStore = {
    get: () => sessionStorage.getItem(TOKEN_KEY),
    set: (t) => sessionStorage.setItem(TOKEN_KEY, t),
    clear: () => sessionStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
    constructor(status, body) {
        super(
            (body && body.message) ||
            (body && body.error) ||
            `Request failed (${status})`
        );
        this.status = status;
        this.code = body && body.error;
        this.body = body;
    }
}

// A 401 means the session is gone - expired, revoked, or the account
// was disabled. Drop the token so the router sends us back to login
// rather than looping on a dead session.
let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
    onUnauthorized = fn;
}

async function parse(res) {
    const text = await res.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return { message: text };
    }
}

async function request(path, { method = "GET", body, headers = {}, raw } = {}) {
    const token = tokenStore.get();

    let res;
    try {
        res = await fetch(BASE + path, {
            method,
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(body && !(body instanceof FormData)
                    ? { "Content-Type": "application/json" }
                    : {}),
                ...headers,
            },
            body:
                body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
        });
    } catch {
        // fetch only rejects when the request never landed - server down,
        // DNS, or CORS. "Failed to fetch" tells an officer nothing, so
        // say what actually needs doing.
        throw new ApiError(0, {
            error: "network_error",
            message: `Cannot reach the server at ${BASE}. Check that the backend is running.`,
        });
    }

    if (res.status === 401) {
        tokenStore.clear();
        onUnauthorized();
        throw new ApiError(401, await parse(res));
    }

    if (!res.ok) throw new ApiError(res.status, await parse(res));

    return raw ? res : parse(res);
}

// Binary responses need the auth header, so they cannot be a plain
// <a href>. Fetch, then hand the browser a blob.
async function downloadFile(path, fallbackName) {
    const res = await request(path, { raw: true });

    const disposition = res.headers.get("content-disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const name = match ? match[1] : fallbackName;

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    return { name, releasedTo: res.headers.get("x-released-to") };
}

// ---- auth ----

export const login = (service_number, password) =>
    request("/auth/login", { method: "POST", body: { service_number, password } });

export const verifyMfa = (mfa_token, code) =>
    request("/auth/mfa/verify", { method: "POST", body: { mfa_token, code } });

export const logout = () => request("/auth/logout", { method: "POST" });

export const me = () => request("/me");

// ---- cases ----

export const listCases = (page = 1, per_page = 25) =>
    request(`/cases?page=${page}&per_page=${per_page}`);

export const getCase = (caseId) => request(`/cases/${caseId}`);

export const listCaseDocuments = (caseId) =>
    request(`/cases/${caseId}/documents`);

export const listProtectedIdentities = (caseId) =>
    request(`/cases/${caseId}/protected-identities`);

export const addProtectedIdentity = (caseId, value, kind = "name") =>
    request(`/cases/${caseId}/protected-identities`, {
        method: "POST",
        body: { value, kind },
    });

// ---- documents ----

export function uploadDocument({ caseId, title, docType, file }) {
    const form = new FormData();
    form.append("case_id", caseId);
    form.append("title", title);
    form.append("doc_type", docType);
    form.append("file", file);

    return request("/documents", { method: "POST", body: form });
}

export const getDocument = (documentId) => request(`/documents/${documentId}`);

export const listVersions = (documentId) =>
    request(`/documents/${documentId}/versions`);

export const verifyDocument = (documentId, version) =>
    request(`/documents/${documentId}/verify`, {
        method: "POST",
        body: version ? { version } : {},
    });

export const getAudit = (documentId) => request(`/documents/${documentId}/audit`);

// OCR output and the entities extracted from it. Redacted server-side
// on a protected case, and 503s there when redaction is unavailable.
export const getText = (documentId, version) =>
    request(
        `/documents/${documentId}/text${version ? `?version=${version}` : ""}`
    );

export const getCustody = (documentId) =>
    request(`/documents/${documentId}/custody`);

export const searchDocuments = (q, page = 1) =>
    request(`/documents/search?q=${encodeURIComponent(q)}&page=${page}`);

export const downloadDocument = (documentId, title) =>
    downloadFile(`/documents/${documentId}/content`, title || "document");

export const downloadCertificate = (documentId) =>
    downloadFile(`/documents/${documentId}/certificate`, "bsa63-certificate.pdf");

// ---- icjs (mock) ----

export const icjsFir = (firNumber) =>
    request(`/icjs/fir?fir_number=${encodeURIComponent(firNumber)}`);

export const icjsPayload = (documentId) =>
    request(`/icjs/documents/${documentId}/payload`);
