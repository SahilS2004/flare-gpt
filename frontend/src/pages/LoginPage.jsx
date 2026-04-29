import { useState } from "react";
import { Link } from "react-router-dom";
import { FiLock, FiMail } from "react-icons/fi";
import { FcGoogle } from "react-icons/fc";
import logo from "../assest/flare_gpt_logo.png";
import { getGoogleAuthUrl, signInWithEmail } from "../services/auth";

export default function LoginPage({ onEmailSignedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function handleGoogleSignIn() {
    const authUrl = getGoogleAuthUrl();
    if (!authUrl) {
      window.alert("Set VITE_GOOGLE_CLIENT_ID in your .env file to enable Google Sign-In.");
      return;
    }
    window.location.assign(authUrl);
  }

  async function handleEmailLogin(event) {
    event.preventDefault();
    try {
      setError("");
      await signInWithEmail(email, password);
      onEmailSignedIn?.();
    } catch (authError) {
      setError(authError.message || "Unable to sign in.");
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-main">
          <img src={logo} alt="FlareGPT logo" className="login-logo" />
          <h1>Welcome to FlareGPT</h1>
          <p>Sign in to continue your conversations.</p>
          <form className="email-login-form" onSubmit={handleEmailLogin}>
            <label htmlFor="email" className="sr-only">
              Email
            </label>
            <div className="input-wrap">
              <FiMail size={16} />
              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email address"
                autoComplete="email"
                required
              />
            </div>
            <label htmlFor="password" className="sr-only">
              Password
            </label>
            <div className="input-wrap">
              <FiLock size={16} />
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                required
              />
            </div>
            {error ? <p className="login-error">{error}</p> : null}
            <button type="submit" className="email-btn">
              Sign in with Email
            </button>
          </form>
          <div className="divider">
            <span>or</span>
          </div>
          <button type="button" className="google-btn" onClick={handleGoogleSignIn}>
            <FcGoogle size={20} />
            Continue with Google
          </button>
        </div>
        <p className="auth-switch">
          New to FlareGPT? <Link to="/signup">Create account</Link>
        </p>
      </section>
    </main>
  );
}
