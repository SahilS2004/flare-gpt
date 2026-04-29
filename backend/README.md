# Flare GPT — backend (Cloudflare Worker)

API for [Flare GPT](../README.md). Prefer the **repository root README** for setup, env vars, OAuth, migrations, and deploy.

## Scripts

```bash
npm install
npm run dev    # Wrangler dev; see root README for LOCAL OAuth overrides
npm run deploy
npm run cf-typegen   # optional: env interface helper
```

Generate TypeScript bindings after changing `wrangler.jsonc`:

```bash
npx wrangler types
```

When using typed Hono bindings, pass your generated Env type as generics (see [Wrangler types](https://developers.cloudflare.com/workers/wrangler/commands/#types)).
