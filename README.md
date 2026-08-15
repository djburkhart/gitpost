# gitpo.st

A social log where every post is a Git object — subject, body, SHA, history, diffs, forks, and pull requests.

Signup is invite-only. The first account is the super admin `@danny`.

## Stack

- Frontend: Nuxt (Vite) static SPA
- Local API: Go + real `git`
- Cloudflare: Worker + Durable Object SQLite (optional)

## Local

```bash
# API
cd backend && go run .

# Frontend
cd web && pnpm install && pnpm dev
```

Admin password is written to `data/.admin-password` on first seed (or set `GITPOST_ADMIN_PASSWORD`). Change it after first login.

## Cloudflare

```bash
cd web && pnpm install && pnpm generate && cd ..
npx wrangler deploy
```

Do not commit `.dev.vars` or `data/.admin-password`.

## GitHub Actions

Required repository secrets:

- `CLOUDFLARE_API_TOKEN` — token with Workers edit
- `CLOUDFLARE_ACCOUNT_ID` — from the Cloudflare dashboard (Workers overview)

If the account ID secret is missing, the workflow tries to resolve it from the token.
