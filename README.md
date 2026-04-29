# Flare GPT

Chat application with retrieval-augmented document Q&A and tool use, deployed on Cloudflare Workers. The frontend is a React SPA; the backend is a Hono API Worker that stitches together Workers AI, D1, Vectorize, KV, Queues, R2, Redis, and optional OAuth.

## Architecture

```
┌──────────────────────┐   HTTPS API   ┌────────────────────────────────┐
│ Frontend SPA         │────────────►│ Backend Worker (Hono)           │
│ (Vite/React, Worker) │              │ JWT + Google OAuth, chat/agent  │
└──────────────────────┘              │ upload / documents / indexing   │
                                       └────────────────────────────────┘
                                                     │
                         ┌────────────────────────────┼────────────────────┐
                         ▼                            ▼                    ▼
                    Workers AI                    Vectorize                D1
                    (Llama instruct)               (embedding search)
                         │                              │
                         └──────────────────┬───────────┘
                                            ▼
                    R2, Queues, KV, Redis (sessions / indexing / settings)

- **Frontend:** Vite + React Router, deployed as static assets on a Worker (`frontend/wrangler.jsonc`).
- **Backend:** Single Worker entry (`backend/src/index.ts`) handling HTTP routes and **Queue consumption** (`queue` handler) for async document indexing.

## Repository layout

| Path | Role |
|------|------|
| `frontend/` | React UI and auth flows; calls the API via `VITE_API_BASE_URL` |
| `backend/` | Cloudflare Worker: routes, AI agent/tools, indexing, embeddings |
| `backend/migrations/` | D1 SQL migrations (run with Wrangler migrations) |
| `project-presentation/` | Presentation assets |

## Tech stack

- **Runtime:** Cloudflare Workers (`nodejs_compat`)
- **API:** [Hono](https://hono.dev/)
- **Auth:** JWT (email/password signup + login); Google OAuth (redirect flows on backend)
- **Data:** Cloudflare **D1** (users, chats, documents metadata), **R2** (file storage), **Vectorize** (semantic search), **KV** / **Queues** / Workers **AI**, **Upstash Redis** (sessions / rate-related usage per `redis.ts`)

## Prerequisites

- [Node.js](https://nodejs.org/) 20+ recommended
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install` in each package pulls it locally)
- A Cloudflare account with Workers paid features as needed for AI, Queues, Vectorize, etc.
- `npx wrangler login` (for deploy)

## Local development

### Backend (API Worker)

```bash
cd backend
npm install
npm run dev
```

Starts `wrangler dev` on the default dev port (**8787**). OAuth-related vars override production URLs via the `dev` script so Google redirects stay on localhost (adjust if your OAuth client uses another callback).

### Frontend (Vite SPA)

```bash
cd frontend
npm install
npm run dev
```

Runs Vite (default **5173**). Ensure `frontend/.env` sets:

```env
VITE_API_BASE_URL=http://localhost:8787
```

### Type generation (backend)

After changing `backend/wrangler.jsonc`:

```bash
cd backend
npx wrangler types
```

See also `backend/README.md` for the optional `CloudflareBindings` pattern.

## Environment and secrets

**Never commit** real secrets. Use Cloudflare [Secrets Store](https://developers.cloudflare.com/secrets-store/) bindings as wired in `backend/wrangler.jsonc`, or `.dev.vars` locally (gitignored).

| Concern | Notes |
|---------|------|
| `JWT_SECRET` | Signs session JWTs |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `GOOGLE_REDIRECT_URI`, `FRONTEND_URL` | Optional if `PUBLIC_*` vars in Wrangler satisfy production URLs |
| `UPSTASH_REDIS_REST_TOKEN` | Redis access |
| `SEARCHAPI_KEY` | External search provider (web search tool) |

**Public-facing URLs** (oauth redirect + SPA origin defaults) live in Wrangler **`vars`** in `backend/wrangler.jsonc`:

- `PUBLIC_OAUTH_REDIRECT_URI` → must match Google Cloud **Authorized redirect URIs** exactly (production example: `https://<backend-host>/auth/google/callback`).
- `PUBLIC_FRONTEND_ORIGIN` → post-login redirects (no trailing slash).

**Production frontend build:** set `VITE_API_BASE_URL` to your deployed API URL (see `frontend/.env.production` pattern), then:

```bash
cd frontend && npm run build && npm run deploy
```

## Google OAuth checklist

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → OAuth client, add authorized redirect URIs for **backend** URLs (and `http://localhost:8787/auth/google/callback` for local backend).
2. Ensure **JavaScript origins** allows your SPA origin(s) where users start OAuth.
3. Align `PUBLIC_OAUTH_REDIRECT_URI` / secrets with those exact strings.

## Database migrations

Migrations live under `backend/migrations/`. Apply with Wrangler ([D1 migrations](https://developers.cloudflare.com/d1/tutorials/d1-http/)):

```bash
cd backend
npx wrangler d1 migrations apply flare-gpt --remote
```

Use `--local` for local persistence when developing against Wrangler remote/local D1 semantics as appropriate.

## Deploy

Requires Cloudflare bindings and Worker names/database IDs consistent with **your** `wrangler.jsonc` (forks should create their own D1 buckets, KV, Vectorize indexes, queues, and R2 buckets, then update config).

```bash
# Backend
cd backend && npm run deploy

# Frontend (builds then uploads assets Worker)
cd frontend && npm run deploy
```

## License

Specify your license here if the project is public.
