import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { fetchGoogleUser, storeUser } from "../services/auth";

export default function GoogleCallbackPage({ onSignedIn }) {
  const navigate = useNavigate();

  useEffect(() => {
    async function completeLogin() {
      const hashParams = new URLSearchParams(window.location.hash.replace("#", ""));
      const accessToken = hashParams.get("access_token");

      if (!accessToken) {
        navigate("/login");
        return;
      }

      try {
        const user = await fetchGoogleUser(accessToken);
        storeUser(user);
        onSignedIn?.();
        navigate("/chat");
      } catch {
        navigate("/login");
      }
    }

    completeLogin();
  }, [navigate]);

  return (
    <main className="auth-loading">
      <p>Completing Google sign-in...</p>
    </main>
  );
}
