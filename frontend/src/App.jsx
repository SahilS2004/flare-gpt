import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import GoogleCallbackPage from "./pages/GoogleCallbackPage";
import ChatPage from "./pages/ChatPage";
import { clearUser, getStoredUser, storeUser } from "./services/auth";
import { Toaster } from "react-hot-toast";

export default function App() {
  const navigate = useNavigate();
  const [user, setUser] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const userParam = params.get("user");
    if (token && userParam) {
      try {
        const parsedUser = JSON.parse(decodeURIComponent(userParam));
        parsedUser.token = token;
        storeUser(parsedUser);
        // Clean up the URL
        window.history.replaceState({}, document.title, window.location.pathname);
        return parsedUser;
      } catch (e) {
        return getStoredUser();
      }
    }
    return getStoredUser();
  });
  const [theme, setTheme] = useState(() => localStorage.getItem("flaregpt_theme") || "dark");

  useEffect(() => {
    document.body.setAttribute("data-theme", theme);
    localStorage.setItem("flaregpt_theme", theme);
  }, [theme]);

  useEffect(() => {
    const syncAuth = () => setUser(getStoredUser());
    window.addEventListener("storage", syncAuth);
    return () => window.removeEventListener("storage", syncAuth);
  }, []);

  const isAuthed = useMemo(() => Boolean(user), [user]);

  function onLogout() {
    clearUser();
    setUser(null);
    navigate("/login");
  }

  function onSetTheme(nextTheme) {
    setTheme(nextTheme === "light" ? "light" : "dark");
  }

  function refreshUserFromStorage() {
    setUser(getStoredUser());
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          isAuthed ? <Navigate to="/chat" replace /> : (
            <>
              <LoginPage onEmailSignedIn={refreshUserFromStorage} />
              <Toaster position="top-center" />
            </>
          )
        }
      />
      <Route
        path="/signup"
        element={isAuthed ? <Navigate to="/chat" replace /> : (
          <>
            <SignupPage onSignedUp={refreshUserFromStorage} />
            <Toaster position="top-center" />
          </>
        )}
      />
      <Route
        path="/auth/google/callback"
        element={
          <>
            <GoogleCallbackPage onSignedIn={refreshUserFromStorage} />
            <Toaster position="top-center" />
          </>
        }
      />
      <Route
        path="/chat"
        element={
          isAuthed ? (
            <>
              <ChatPage
                user={user}
                onLogout={onLogout}
                theme={theme}
                onSetTheme={onSetTheme}
              />
              <Toaster position="top-center" />
            </>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/chat/:id"
        element={
          isAuthed ? (
            <>
              <ChatPage
                user={user}
                onLogout={onLogout}
                theme={theme}
                onSetTheme={onSetTheme}
              />
              <Toaster position="top-center" />
            </>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to={isAuthed ? "/chat" : "/login"} replace />} />
    </Routes>
  );
}
