import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Lock,
  Mail,
  Eye,
  EyeOff,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";

function Login() {
  const navigate = useNavigate();

  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const handleLogin = (e) => {
    e.preventDefault();

    // Temporary frontend login
    navigate("/dashboard");
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
            Your documents.
            <br />
            <span>Securely managed.</span>
          </h2>

          <p>
            A secure digital document management platform designed to
            organize, protect, and manage important documents.
          </p>

          <div className="security-features">
            <div>
              <ShieldCheck size={18} />
              <span>Secure Document Storage</span>
            </div>

            <div>
              <Lock size={18} />
              <span>Protected User Access</span>
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
            <p className="login-welcome">WELCOME BACK</p>

            <h1>Sign in to SecureDocs</h1>

            <p>
              Enter your details below to access your secure workspace.
            </p>
          </div>

          <form onSubmit={handleLogin}>
            {/* EMAIL */}
            <div className="input-group">
              <label>Email Address</label>

              <div className="input-wrapper">
                <Mail size={18} />

                <input
                  type="email"
                  placeholder="name@example.com"
                  required
                />
              </div>
            </div>

            {/* PASSWORD */}
            <div className="input-group">
              <label>Password</label>

              <div className="input-wrapper password-wrapper">
                <Lock size={18} />

                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  required
                />

                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff size={18} />
                  ) : (
                    <Eye size={18} />
                  )}
                </button>
              </div>
            </div>

            {/* REMEMBER */}
            <div className="login-options">
              <label className="remember-me">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) =>
                    setRememberMe(e.target.checked)
                  }
                />

                <span>Remember me</span>
              </label>

              <button
                type="button"
                className="forgot-password"
              >
                Forgot password?
              </button>
            </div>

            {/* LOGIN */}
            <button type="submit" className="login-button">
              Sign In
              <ArrowRight size={18} />
            </button>
          </form>

          <div className="login-security-note">
            <ShieldCheck size={16} />
            Your connection is secure and encrypted.
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;