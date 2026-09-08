import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, User, ShieldCheck } from "lucide-react";

import * as api from "../api/client";
import { useAuth } from "../auth-context";

// ---------------------------------------------------------------
// Screen 1: password, then the MFA challenge.
//
// Two steps, because the backend issues a short-lived mfa_token from
// /auth/login and only exchanges it for a real session at
// /auth/mfa/verify. A password alone gets you nothing.
// ---------------------------------------------------------------

export default function Login() {
    const navigate = useNavigate();
    const { signIn } = useAuth();

    const [stage, setStage] = useState("password");
    const [serviceNumber, setServiceNumber] = useState("");
    const [password, setPassword] = useState("");
    const [code, setCode] = useState("");
    const [mfaToken, setMfaToken] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);

    async function submitPassword(e) {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
            const res = await api.login(serviceNumber.trim(), password);
            setMfaToken(res.mfa_token);
            setStage("mfa");
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }

    async function submitMfa(e) {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
            const res = await api.verifyMfa(mfaToken, code.trim());
            await signIn(res.session_token, res.user);
            navigate("/cases", { replace: true });
        } catch (err) {
            setError(err.message);

            // Only a dead challenge sends you back to the password. A
            // rejected code keeps you here with the field cleared, ready
            // for a fresh one - bouncing back for a code that was merely
            // a few seconds stale made it look as though the password
            // had been wrong, which it never was.
            if (err.code === "challenge_expired") {
                setStage("password");
                setCode("");
                setMfaToken(null);
            } else {
                setCode("");
            }
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="login-page">
            <div className="login-card">
                <div className="login-header">
                    <div className="login-icon">
                        {stage === "password" ? <Lock size={35} /> : <ShieldCheck size={35} />}
                    </div>
                    <h1>SecureDocs</h1>
                    <p>Secure Legal Document Management</p>
                </div>

                {error && <div className="alert alert-error">{error}</div>}

                {stage === "password" ? (
                    <form onSubmit={submitPassword}>
                        <div className="input-group">
                            <label>Service number</label>
                            <div className="input-wrapper">
                                <User size={18} />
                                <input
                                    value={serviceNumber}
                                    onChange={(e) => setServiceNumber(e.target.value)}
                                    placeholder="DL-INS-1001"
                                    autoComplete="username"
                                    required
                                />
                            </div>
                        </div>

                        <div className="input-group">
                            <label>Password</label>
                            <div className="input-wrapper">
                                <Lock size={18} />
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    autoComplete="current-password"
                                    required
                                />
                            </div>
                        </div>

                        <button type="submit" className="login-button" disabled={busy}>
                            {busy ? "Checking..." : "Continue"}
                        </button>
                    </form>
                ) : (
                    <form onSubmit={submitMfa}>
                        <p className="mfa-hint">
                            Enter the 6-digit code from your authenticator app.
                        </p>

                        <div className="input-group">
                            <label>Authentication code</label>
                            <div className="input-wrapper">
                                <ShieldCheck size={18} />
                                <input
                                    value={code}
                                    onChange={(e) => setCode(e.target.value)}
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    maxLength={6}
                                    autoComplete="one-time-code"
                                    autoFocus
                                    required
                                />
                            </div>
                        </div>

                        <button type="submit" className="login-button" disabled={busy}>
                            {busy ? "Verifying..." : "Verify"}
                        </button>
                        <button
                            type="button"
                            className="link-button"
                            onClick={() => {
                                setStage("password");
                                setError(null);
                            }}
                        >
                            Back
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
