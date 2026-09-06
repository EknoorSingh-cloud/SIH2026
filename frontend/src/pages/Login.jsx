// import { useState } from "react";
// import { useNavigate } from "react-router-dom";
// import {
//   Lock,
//   Mail,
//   Eye,
//   EyeOff,
//   ShieldCheck,
//   ArrowRight,
// } from "lucide-react";

// function Login() {
//   const navigate = useNavigate();

//   const [showPassword, setShowPassword] = useState(false);
//   const [rememberMe, setRememberMe] = useState(false);

//   const handleLogin = (e) => {
//     e.preventDefault();

//     // Temporary frontend login
//     navigate("/dashboard");
//   };

//   return (
//     <div className="login-page">
//       {/* LEFT SIDE */}
//       <div className="login-brand-section">
//         <div className="brand-content">
//           <div className="brand-logo">
//             <ShieldCheck size={32} />
//           </div>

//           <h1>SecureDocs</h1>

//           <h2>
//             Your documents.
//             <br />
//             <span>Securely managed.</span>
//           </h2>

//           <p>
//             A secure digital document management platform designed to
//             organize, protect, and manage important documents.
//           </p>

//           <div className="security-features">
//             <div>
//               <ShieldCheck size={18} />
//               <span>Secure Document Storage</span>
//             </div>

//             <div>
//               <Lock size={18} />
//               <span>Protected User Access</span>
//             </div>
//           </div>
//         </div>

//         <div className="login-brand-footer">
//           © 2026 SecureDocs
//         </div>
//       </div>

//       {/* RIGHT SIDE */}
//       <div className="login-form-section">
//         <div className="login-card premium-login-card">
//           <div className="login-header">
//             <p className="login-welcome">WELCOME BACK</p>

//             <h1>Sign in to SecureDocs</h1>

//             <p>
//               Enter your details below to access your secure workspace.
//             </p>
//           </div>

//           <form onSubmit={handleLogin}>
//             {/* EMAIL */}
//             <div className="input-group">
//               <label>Email Address</label>

//               <div className="input-wrapper">
//                 <Mail size={18} />

//                 <input
//                   type="email"
//                   placeholder="name@example.com"
//                   required
//                 />
//               </div>
//             </div>

//             {/* PASSWORD */}
//             <div className="input-group">
//               <label>Password</label>

//               <div className="input-wrapper password-wrapper">
//                 <Lock size={18} />

//                 <input
//                   type={showPassword ? "text" : "password"}
//                   placeholder="Enter your password"
//                   required
//                 />

//                 <button
//                   type="button"
//                   className="password-toggle"
//                   onClick={() => setShowPassword(!showPassword)}
//                 >
//                   {showPassword ? (
//                     <EyeOff size={18} />
//                   ) : (
//                     <Eye size={18} />
//                   )}
//                 </button>
//               </div>
//             </div>

//             {/* REMEMBER */}
//             <div className="login-options">
//               <label className="remember-me">
//                 <input
//                   type="checkbox"
//                   checked={rememberMe}
//                   onChange={(e) =>
//                     setRememberMe(e.target.checked)
//                   }
//                 />

//                 <span>Remember me</span>
//               </label>

//               <button
//                 type="button"
//                 className="forgot-password"
//               >
//                 Forgot password?
//               </button>
//             </div>

//             {/* LOGIN */}
//             <button type="submit" className="login-button">
//               Sign In
//               <ArrowRight size={18} />
//             </button>
//           </form>

//           <div className="login-security-note">
//             <ShieldCheck size={16} />
//             Your connection is secure and encrypted.
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// }

// export default Login;
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Lock,
  Eye,
  EyeOff,
  ShieldCheck,
  ArrowRight,
  User,
  AlertCircle,
} from "lucide-react";

function Login() {
  const navigate = useNavigate();

  const [serviceNumber, setServiceNumber] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();

    setError("");
    setLoading(true);

    try {
      const response = await fetch(
        "http://localhost:5000/api/v1/auth/login",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            service_number: serviceNumber,
            password: password,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Login failed.");
      }

      /*
        Backend returns an MFA token.

        We temporarily store it so the MFA page
        can verify the authentication code.
      */

      if (rememberMe) {
        localStorage.setItem("mfa_token", data.mfa_token);
      } else {
        sessionStorage.setItem("mfa_token", data.mfa_token);
      }

      navigate("/mfa");
    } catch (err) {
      setError(err.message || "Unable to connect to the server.");
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

            <p className="login-welcome">
              WELCOME BACK
            </p>

            <h1>Sign in to SecureDocs</h1>

            <p>
              Enter your credentials below to access your secure workspace.
            </p>

          </div>


          {/* ERROR MESSAGE */}

          {error && (
            <div className="login-error">

              <AlertCircle size={18} />

              <span>{error}</span>

            </div>
          )}


          <form onSubmit={handleLogin}>


            {/* SERVICE NUMBER */}

            <div className="input-group">

              <label>Service Number</label>

              <div className="input-wrapper">

                <User size={18} />

                <input
                  type="text"
                  placeholder="Enter your service number"
                  value={serviceNumber}
                  onChange={(e) =>
                    setServiceNumber(e.target.value)
                  }
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
                  value={password}
                  onChange={(e) =>
                    setPassword(e.target.value)
                  }
                  required
                />

                <button
                  type="button"
                  className="password-toggle"
                  onClick={() =>
                    setShowPassword(!showPassword)
                  }
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


            {/* LOGIN BUTTON */}

            <button
              type="submit"
              className="login-button"
              disabled={loading}
            >

              {loading ? (
                <>
                  Signing In...
                </>
              ) : (
                <>
                  Sign In
                  <ArrowRight size={18} />
                </>
              )}

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