# Deploying to Dokku

The app ships as a Dockerfile deploy: a Bun build stage produces Next's
standalone server, and a slim Node runtime stage runs it. Dokku's predeploy
hook (`app.json`) runs the Drizzle migrations before each release, so a deploy
that can't migrate never goes live.

## One-time server setup

Run these on the Dokku server (as a user with dokku access). Replace nothing
unless you renamed the app.

```bash
dokku apps:create tellmewhy

# Postgres 17 on the same box — ciphertext never leaves the server.
sudo dokku plugin:install https://github.com/dokku/dokku-postgres.git postgres || true
dokku postgres:create tellmewhy-db --image-version 17
dokku postgres:link tellmewhy-db tellmewhy    # sets DATABASE_URL

# Secrets. MASTER_KEK wraps every user's data-encryption key — generate it
# once, store it in your password manager, and never rotate it casually:
# losing it is crypto-shredding EVERYONE.
dokku config:set tellmewhy \
  MASTER_KEK="$(openssl rand -base64 32)" \
  BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  BETTER_AUTH_URL="https://tellmewhy.huyakhuyak.productions" \
  OPENROUTER_API_KEY="<your OpenRouter key>"

# Domain + TLS.
dokku domains:set tellmewhy tellmewhy.huyakhuyak.productions
sudo dokku plugin:install https://github.com/dokku/dokku-letsencrypt.git || true
dokku letsencrypt:set tellmewhy email mykola.soloduha@gmail.com
dokku letsencrypt:enable tellmewhy
dokku letsencrypt:cron-job --add

# Route port 80/443 to the container's 3000 (usually auto-detected from EXPOSE).
dokku ports:set tellmewhy http:80:3000 https:443:3000
```

DNS: point `tellmewhy.huyakhuyak.productions` (A/AAAA) at the server before
enabling letsencrypt.

Do NOT set `AI_MOCK` on the server — it swaps the real model for the
deterministic dev mock. Optional model overrides if you ever want them:
`OPENROUTER_MODEL`, `OPENROUTER_CLASSIFIER_MODEL`, `OPENROUTER_DIGEST_MODEL`.

## Deploying (from your laptop, every release)

```bash
git remote add dokku dokku@<server-host>:tellmewhy   # once
git push dokku main
```

The push builds the image on the server, runs `node scripts/migrate.mjs`
(predeploy), health-checks `/` until it answers 200, then flips traffic.

## Post-deploy verification

1. `https://tellmewhy.huyakhuyak.productions/` — landing renders signed-out;
   `/robots.txt` and `/sitemap.xml` answer.
2. Sign up, send a message, watch the reply **stream token-by-token** (if it
   arrives as one block, proxy buffering is on — check that responses carry
   `X-Accel-Buffering: no`).
3. `dokku postgres:connect tellmewhy-db` →
   `select body from messages limit 3;` — bodies must be ciphertext.
4. `dokku logs tellmewhy --tail` while chatting — no errors.

## Before real users (launch checklist)

- **OpenRouter account settings**: verify the account-level data policy
  excludes logging/training providers — the code sends per-request
  `data_collection: "deny"`, but the account policy is the backstop the
  public copy promises.
- **Backups**: `dokku postgres:backup-auth tellmewhy-db …` +
  `dokku postgres:backup-schedule tellmewhy-db "0 4 * * *" <bucket>` (or any
  scheduled `dokku postgres:export`). Backups hold ciphertext only; the KEK in
  your password manager is the piece that must survive separately.
- **Deletion by request**: the public copy promises account deletion on
  request (crypto-shredding) — be ready to honor it until self-serve ships.

## Notes

- The migration runner (`scripts/migrate.mjs`) uses the same `./drizzle`
  journal as `bun run db:migrate` — the two are interchangeable and re-running
  is a no-op.
- Streaming works because the app sends `X-Accel-Buffering: no` on every
  response (`next.config.ts`) and Dokku's nginx honors it — no nginx surgery
  needed.
- Single-instance deploy: Next's default in-memory + on-disk cache is correct
  here; no cache handler or `deploymentId` is needed until there are multiple
  containers.
