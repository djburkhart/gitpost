# gitpo.st

A social log where every post is a Git object — subject, body, SHA, history, diffs, forks, and pull requests.

Signup is invite-only. The first account is the super admin `@danny`.

Using the site? Start with the [user guides](docs/README.md).

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

Repo secrets required:

- `CLOUDFLARE_API_TOKEN` — create at https://dash.cloudflare.com/profile/api-tokens using the **Edit Cloudflare Workers** template (must include **Workers Scripts: Edit**). A Pages-only or zone-read token will fail with authentication error 10000.
- `ADMIN_PASSWORD` — Danny's live super-admin password. Pushed to the Worker as a Cloudflare secret on each deploy.

`account_id` is already in `wrangler.jsonc`. Optional secret `CLOUDFLARE_ACCOUNT_ID` overrides it.
