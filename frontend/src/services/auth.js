const USER_KEY = "flaregpt_user";

export function getStoredUser() {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function storeUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearUser() {
  localStorage.removeItem(USER_KEY);
}

export async function signInWithEmail(email, password) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    throw new Error("Email and password are required.");
  }

  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
  const res = await fetch(`${API_BASE_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: normalizedEmail, password })
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || "Login failed");
  }

  const user = { ...data.user, token: data.token };
  storeUser(user);
  return user;
}

export async function signUpWithEmail(name, email, password) {
  const trimmedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();
  
  if (!trimmedName) throw new Error("Name is required.");
  if (!normalizedEmail || !password) throw new Error("Email and password are required.");

  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
  const res = await fetch(`${API_BASE_URL}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: trimmedName, email: normalizedEmail, password })
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || "Signup failed");
  }

  const user = { ...data.user, token: data.token };
  storeUser(user);
  return user;
}

export function getGoogleAuthUrl() {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
  return `${API_BASE_URL}/auth/google/login`;
}

export async function fetchGoogleUser(accessToken) {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    throw new Error("Failed to fetch Google profile");
  }
  const profile = await response.json();
  return {
    id: profile.sub,
    name: profile.name,
    email: profile.email,
    avatar: profile.picture
  };
}
