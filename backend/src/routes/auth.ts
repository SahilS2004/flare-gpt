import { Hono } from "hono";
import { sign } from "hono/jwt";
import bcrypt from "bcryptjs";
import { setSessionStatus } from "../services/redis";
import { getSecret, getSecrets } from "../services/secrets";

/** Strip trailing slashes (browser origins must not include them for redirects). */
function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

/** wrangler PUBLIC_* first (production defaults in jsonc); `npm run dev` overrides vars for localhost */
function resolveFrontendOrigin(c: any, frontendUrlSecret: string): string {
  const fromVar =
    typeof c.env.PUBLIC_FRONTEND_ORIGIN === "string" ? c.env.PUBLIC_FRONTEND_ORIGIN.trim() : "";
  if (fromVar) return normalizeOrigin(fromVar);

  const fromSecret = frontendUrlSecret.trim();
  if (fromSecret) return normalizeOrigin(fromSecret);

  return "http://localhost:5173";
}

/** Same order — must match Authorized redirect URIs + token POST */
function resolveGoogleRedirectUri(c: any, secretValue: string): string | null {
  const fromVar =
    typeof c.env.PUBLIC_OAUTH_REDIRECT_URI === "string"
      ? c.env.PUBLIC_OAUTH_REDIRECT_URI.trim()
      : "";
  if (fromVar) return fromVar;

  const fromSecret = secretValue.trim();
  return fromSecret || null;
}

export const authRoute = (app: Hono) => {
  app.post("/signup", async (c: any) => {
    const { name, email, password } = await c.req.json();

    if (!name || !email || !password) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const id = crypto.randomUUID();
    const hashedPassword = bcrypt.hashSync(password, 10);

    try {
      await c.env.flare_gpt
        .prepare("INSERT INTO users (id, name, email, password, provider) VALUES (?, ?, ?, ?, 'email')")
        .bind(id, name, email, hashedPassword)
        .run();

      const payload = {
        id,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24
      };
      const secret = (await getSecret(c.env, "JWT_SECRET")) || "fallback-secret";
      const token = await sign(payload, secret);
      await setSessionStatus(c.env, id, "active");

      return c.json({
        status: "success",
        message: "User created successfully",
        user: { id, name, email },
        token
      });
    } catch (e: any) {
      if (e.message.includes("UNIQUE constraint failed")) {
        return c.json({ error: "Email already exists" }, 409);
      }
      return c.json({ error: "Database error occurred" }, 500);
    }
  });

  app.post("/login", async (c: any) => {
    const { email, password } = await c.req.json();

    if (!email || !password) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const user = await c.env.flare_gpt.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();

    if (!user) {
      return c.json({ error: "Invalid email or password" }, 401);
    }

    if (!user.password || user.provider === "google") {
      return c.json({ error: "Please sign in with Google" }, 401);
    }

    const isValidPassword = bcrypt.compareSync(password, user.password as string);
    if (!isValidPassword) {
      return c.json({ error: "Invalid email or password" }, 401);
    }

    const payload = {
      id: user.id,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24
    };
    const secret = (await getSecret(c.env, "JWT_SECRET")) || "fallback-secret";
    const token = await sign(payload, secret);
    await setSessionStatus(c.env, user.id as string, "active");

    return c.json({
      status: "success",
      message: "Login successful",
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      },
      token
    });
  });

  app.get("/auth/google/login", async (c: any) => {
    const { GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI } = await getSecrets(c.env, [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_REDIRECT_URI"
    ] as const);

    const redirectUri = resolveGoogleRedirectUri(c, GOOGLE_REDIRECT_URI);

    if (!GOOGLE_CLIENT_ID || !redirectUri) {
      return c.json({ error: "Google OAuth is not configured on the backend" }, 500);
    }

    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&response_type=code&scope=openid%20email%20profile&access_type=offline`;
    return c.redirect(url);
  });

  app.get("/auth/google/callback", async (c: any) => {
    const code = c.req.query("code");
    const {
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI,
      FRONTEND_URL,
      JWT_SECRET
    } = await getSecrets(c.env, [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REDIRECT_URI",
      "FRONTEND_URL",
      "JWT_SECRET"
    ] as const);

    const redirectUri = resolveGoogleRedirectUri(c, GOOGLE_REDIRECT_URI);
    if (!redirectUri) {
      return c.json({ error: "OAuth redirect URI is not configured" }, 500);
    }

    const frontendOrigin = resolveFrontendOrigin(c, FRONTEND_URL);
    const frontendUrl = `${frontendOrigin}/chat`;

    if (!code) {
      return c.redirect(`${frontendUrl}?error=missing_code`);
    }

    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri
        }).toString()
      });
      const tokenData = (await tokenRes.json()) as { access_token?: string };

      if (!tokenData.access_token) {
        return c.redirect(`${frontendUrl}?error=token_exchange_failed`);
      }

      const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const userData = (await userRes.json()) as { email?: string; name?: string };

      if (!userData.email) {
        return c.redirect(`${frontendUrl}?error=missing_email`);
      }

      let user = await c.env.flare_gpt.prepare("SELECT * FROM users WHERE email = ?").bind(userData.email).first();
      let userId = user?.id;

      if (!user) {
        userId = crypto.randomUUID();
        await c.env.flare_gpt
          .prepare("INSERT INTO users (id, name, email, password, provider) VALUES (?, ?, ?, NULL, 'google')")
          .bind(userId, userData.name || userData.email.split("@")[0], userData.email)
          .run();

        user = {
          id: userId,
          name: userData.name || userData.email.split("@")[0],
          email: userData.email
        };
      }

      const payload = {
        id: userId,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24
      };
      const secret = JWT_SECRET || "fallback-secret";
      const jwtToken = await sign(payload, secret);
      await setSessionStatus(c.env, userId as string, "active");

      const encodedUser = encodeURIComponent(
        JSON.stringify({ id: user.id, name: user.name, email: user.email })
      );
      return c.redirect(`${frontendUrl}?token=${jwtToken}&user=${encodedUser}`);
    } catch (e: any) {
      console.error("OAuth error:", e);
      return c.redirect(`${frontendUrl}?error=oauth_error`);
    }
  });
};
