# gitpo.st

A social log where every post is a Git object — subject, body, SHA, history, diffs, forks, and pull requests.

## Live (Cloudflare Worker)

Frontend: Nuxt (Vite) static assets  
API: Cloudflare Worker + Durable Object SQLite  
Local backend: Go + real `git` (optional)

## Deploy to Cloudflare

```bash
# 1. Build the frontend
cd web && pnpm install && pnpm generate && cd ..

# 2a. First publish (temporary account, 60 minutes — then claim it)
npx wrangler deploy --temporary

# 2b. After you claim the account (or with CLOUDFLARE_API_TOKEN set)
npx wrangler deploy
```

GitHub Actions deploys `main` when these repo secrets exist:

- `CLOUDFLARE_API_TOKEN` (Edit Cloudflare Workers)
- `CLOUDFLARE_ACCOUNT_ID`

### Custom domain `gitpo.st`

1. Claim the temporary Worker (or deploy into your account).
2. Cloudflare dashboard → **Workers & Pages** → `gitpost` → **Settings** → **Domains**.
3. Add `gitpo.st` and `www.gitpo.st`.
4. At your registrar, point DNS as Cloudflare instructs (usually a CNAME to the workers.dev hostname, or nameservers to Cloudflare).

## Local

```bash
# API (Go + git)
cd backend && go run .
# Frontend
cd web && pnpm install && pnpm dev
```

Demo logins: `ada` / `linus` / `maya` / `guest` — password `demo`.
