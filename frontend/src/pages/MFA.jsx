import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ShieldCheck,
  LockKeyhole,
  ArrowRight,
  AlertCircle,
} from "lucide-react";

function MFA() {
  const navigate = useNavigate();

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleVerify = async (e) => {
    e.preventDefault();

    setError("");

    if (!code.trim()) {
      setError("Please enter your verification code.");
      return;
    }

    // Get MFA token from storage
    const mfaToken =
      localStorage.getItem("mfa_token") ||
      sessionStorage.getItem("mfa_token");

    if (!mfaToken) {
      setError("Login session expired. Please sign in again.");

      setTimeout(() => {
        navigate("/");
      }, 1500);

      return;
    }

    setLoading(true);

    try {
      const response = await fetch(
        "http://localhost:5000/api/v1/auth/mfa/verify",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          credentials: "include",

          body: JSON.stringify({
            mfa_token: mfaToken,
            code: code,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "Verification failed."
        );
      }

      // Save session token
      const rememberMe =
        localStorage.getItem("mfa_token") !== null;

      if (rememberMe) {
        localStorage.setItem(
          "session_token",
          data.session_token
        );
      } else {
        sessionStorage.setItem(
          "session_token",
          data.session_token
        );
      }

      // Save user information
      localStorage.setItem(
        "user",
        JSON.stringify(data.user)
      );

      // Remove temporary MFA token
      localStorage.removeItem("mfa_token");
      sessionStorage.removeItem("mfa_token");

      navigate("/dashboard");

    } catch (err) {
      setError(
        err.message || "Unable to verify the code."
      );

    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">

      {/* LEFT SIDE */}
      <div className="login-brand-section">

        <div className="brand-content">

          <div className="brand-logo">
            <ShieldCheck size={32} />
          </div>

          <h1>SecureDocs</h1>

          <h2>
            Extra security.
            <br />

            <span>Verify your identity.</span>
          </h2>

          <p>
            Your account is protected with multi-factor
            authentication for additional security.
          </p>

          <div className="security-features">

            <div>
              <ShieldCheck size={18} />

              <span>
                Multi-Factor Authentication
              </span>
            </div>

            <div>
              <LockKeyhole size={18} />

              <span>
                Protected Secure Access
              </span>
            </div>

          </div>

        </div>

        <div className="login-brand-footer">
          © 2026 SecureDocs
        </div>

      </div>


      {/* RIGHT SIDE */}

      <div className="login-form-section">

        <div className="login-card premium-login-card">

          <div className="login-header">

            <p className="login-welcome">
              SECURITY VERIFICATION
            </p>

            <h1>Verify your identity</h1>

            <p>
              Enter the authentication code from your
              authenticator application.
            </p>

          </div>


          {/* ERROR */}

          {error && (

            <div className="login-error">

              <AlertCircle size={18} />

              <span>{error}</span>

            </div>

          )}


          <form onSubmit={handleVerify}>

            <div className="input-group">

              <label>
                Authentication Code
              </label>


              <div className="input-wrapper">

                <LockKeyhole size={18} />

                <input
                  type="text"
                  placeholder="Enter 6-digit code"
                  value={code}
                  maxLength={6}

                  onChange={(e) =>
                    setCode(
                      e.target.value.replace(/\D/g, "")
                    )
                  }

                  required
                />

              </div>

            </div>


            <button
              type="submit"
              className="login-button"
              disabled={loading}
            >

              {loading ? (
                <>
                  Verifying...
                </>
              ) : (
                <>
                  Verify & Continue

                  <ArrowRight size={18} />
                </>
              )}

            </button>

          </form>


          <div className="login-security-note">

            <ShieldCheck size={16} />

            Multi-factor authentication protects your account.

          </div>

        </div>

      </div>

    </div>
  );
}

export default MFA;