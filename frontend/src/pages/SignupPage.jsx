import { useState } from "react";
import { Link } from "react-router-dom";
import { FiLock, FiMail, FiUser } from "react-icons/fi";
import { FcGoogle } from "react-icons/fc";
import logo from "../assest/flare_gpt_logo.png";
import { getGoogleAuthUrl, signUpWithEmail } from "../services/auth";

export default function SignupPage({ onSignedUp }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    try {
      setError("");
      await signUpWithEmail(name, email, password);
      onSignedUp?.();
    } catch (signupError) {
      setError(signupError.message || "Unable to sign up.");
    }
  }

  function handleGoogleSignUp() {
    const authUrl = getGoogleAuthUrl();
    if (!authUrl) {
      window.alert("Set VITE_GOOGLE_CLIENT_ID in your .env file to enable Google Sign-Up.");
      return;
    }
    window.location.assign(authUrl);
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-main">
          <img src={logo} alt="FlareGPT logo" className="login-logo" />
          <h1>Create your FlareGPT account</h1>
          <p>Sign up to start chatting.</p>
          <form className="email-login-form" onSubmit={handleSubmit}>
            <div className="input-wrap">
              <FiUser size={16} />
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Full name"
                autoComplete="name"
                required
              />
            </div>
            <div className="input-wrap">
              <FiMail size={16} />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email address"
                autoComplete="email"
                required
              />
            </div>
            <div className="input-wrap">
              <FiLock size={16} />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                autoComplete="new-password"
                required
              />
            </div>
            {error ? <p className="login-error">{error}</p> : null}
            <button type="submit" className="email-btn">
              Create account
            </button>
          </form>
          <div className="divider">
            <span>or</span>
          </div>
          <button type="button" className="google-btn" onClick={handleGoogleSignUp}>
            <FcGoogle size={20} />
            Sign up with Google
          </button>
        </div>
        <p className="auth-switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
