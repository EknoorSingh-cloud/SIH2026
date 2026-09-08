import { Routes, Route, Navigate } from "react-router-dom";

import { AuthProvider, RequireAuth } from "./auth";
import Layout from "./components/Layout";

import Login from "./pages/Login";
import MFA from "./pages/MFA";

// Existing pages
import Dashboard from "./pages/Dashboard";
import Documents from "./pages/Documents";
import Upload from "./pages/Upload";
import Search from "./pages/Search";
import Users from "./pages/Users";

// New Case Management pages
import CaseList from "./pages/CaseList";
import CaseDetail from "./pages/CaseDetail";
import DocumentView from "./pages/DocumentView";
import Verify from "./pages/Verify";
import AuditTimeline from "./pages/AuditTimeline";


// ---------------------------------------------------------------
// PROTECTED APPLICATION SHELL
// ---------------------------------------------------------------

function Shell({ children }) {
    return (
        <RequireAuth>
            <Layout>
                {children}
            </Layout>
        </RequireAuth>
    );
}


// ---------------------------------------------------------------
// APP
// ---------------------------------------------------------------

export default function App() {

    return (

        <AuthProvider>

            <Routes>

                {/* ------------------------------------------------ */}
                {/* PUBLIC ROUTES */}
                {/* ------------------------------------------------ */}

                <Route
                    path="/"
                    element={<Login />}
                />

                <Route
                    path="/mfa"
                    element={<MFA />}
                />


                {/* ------------------------------------------------ */}
                {/* EXISTING APPLICATION ROUTES */}
                {/* ------------------------------------------------ */}

                <Route
                    path="/dashboard"
                    element={
                        <Shell>
                            <Dashboard />
                        </Shell>
                    }
                />

                <Route
                    path="/documents"
                    element={
                        <Shell>
                            <Documents />
                        </Shell>
                    }
                />

                <Route
                    path="/upload"
                    element={
                        <Shell>
                            <Upload />
                        </Shell>
                    }
                />

                <Route
                    path="/search"
                    element={
                        <Shell>
                            <Search />
                        </Shell>
                    }
                />

                <Route
                    path="/users"
                    element={
                        <Shell>
                            <Users />
                        </Shell>
                    }
                />


                {/* ------------------------------------------------ */}
                {/* CASE MANAGEMENT ROUTES */}
                {/* ------------------------------------------------ */}

                <Route
                    path="/cases"
                    element={
                        <Shell>
                            <CaseList />
                        </Shell>
                    }
                />

                <Route
                    path="/cases/:caseId"
                    element={
                        <Shell>
                            <CaseDetail />
                        </Shell>
                    }
                />


                {/* ------------------------------------------------ */}
                {/* DOCUMENT MANAGEMENT ROUTES */}
                {/* ------------------------------------------------ */}

                <Route
                    path="/documents/:documentId"
                    element={
                        <Shell>
                            <DocumentView />
                        </Shell>
                    }
                />

                <Route
                    path="/documents/:documentId/verify"
                    element={
                        <Shell>
                            <Verify />
                        </Shell>
                    }
                />

                <Route
                    path="/documents/:documentId/audit"
                    element={
                        <Shell>
                            <AuditTimeline />
                        </Shell>
                    }
                />


                {/* ------------------------------------------------ */}
                {/* FALLBACK */}
                {/* ------------------------------------------------ */}

                <Route
                    path="*"
                    element={
                        <Navigate
                            to="/dashboard"
                            replace
                        />
                    }
                />

            </Routes>

        </AuthProvider>

    );

}