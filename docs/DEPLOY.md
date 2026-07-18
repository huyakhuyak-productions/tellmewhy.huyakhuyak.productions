# Deploying to Dokku

The app ships as a Dockerfile deploy: a Bun build stage produces Next's
standalone server, and a slim Node runtime stage runs it. Dokku's predeploy
hook (`app.json`) runs the Drizzle migrations before each release, so a deploy
that can't migrate never goes live.

Three phases, in order: one-time setup → first deploy → TLS. TLS must come
last: Let's Encrypt's challenge is served through the app's own vhost, which
doesn't exist until the first deploy has succeeded.

## 1. One-time server setup

Run these on the Dokku server (as a user with dokku access). The only value
you must substitute is `<your OpenRouter key>`; everything else pastes as-is
unless you renamed the app.

```bash
# Ignore an "already installed" error if the plugin is present.
sudo dokku plugin:install https://github.com/dokku/dokku-postgres.git

dokku apps:create tellmewhy

# Postgres 17 on the same box — ciphertext never leaves the server.
dokku postgres:create tellmewhy-db --image-version 17
dokku postgres:link tellmewhy-db tellmewhy    # sets DATABASE_URL

# Secrets. MASTER_KEK wraps every user's data-encryption key. Never rotate it
# casually: losing it is crypto-shredding EVERYONE.
dokku config:set tellmewhy \
  MASTER_KEK="$(openssl rand -base64 32)" \
  BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  BETTER_AUTH_URL="https://tellmewhy.huyakhuyak.productions" \
  OPENROUTER_API_KEY="<your OpenRouter key>"

# The key was generated inline and exists ONLY in Dokku's config store so far.
# Print it and copy it into your password manager NOW — if this server dies,
# the copy in your password manager is the only thing that isn't shredded.
dokku config:get tellmewhy MASTER_KEK

# Domain + port routing (80/443 → the container's 3000).
dokku domains:set tellmewhy tellmewhy.huyakhuyak.productions
dokku ports:set tellmewhy http:80:3000
```

DNS: point `tellmewhy.huyakhuyak.productions` (A/AAAA) at the server now —
TLS issuance in phase 3 needs it resolving.

Do NOT set `AI_MOCK` on the server — it swaps the real model for the
deterministic dev mock. Optional model overrides if you ever want them:
`OPENROUTER_MODEL`, `OPENROUTER_CLASSIFIER_MODEL`, `OPENROUTER_DIGEST_MODEL`.

## 2. First deploy (from your laptop)

```bash
git remote add dokku dokku@<server-host>:tellmewhy   # once
git push dokku main
```

The push builds the image on the server, runs `node scripts/migrate.mjs`
(predeploy), health-checks `/` until it answers 200, then flips traffic.
Confirm `http://tellmewhy.huyakhuyak.productions/` renders the landing page
over plain HTTP before moving on. Every later release is just another
`git push dokku main` — one at a time; don't run two pushes concurrently
(the migration runner takes no lock).

## 3. TLS (after the first deploy answers over HTTP)

```bash
# Ignore an "already installed" error if the plugin is present.
sudo dokku plugin:install https://github.com/dokku/dokku-letsencrypt.git

dokku letsencrypt:set tellmewhy email mykola.soloduha@gmail.com
dokku letsencrypt:enable tellmewhy
dokku letsencrypt:cron-job --add
dokku ports:set tellmewhy http:80:3000 https:443:3000
```

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
- **Backups** (schematic — fill in your S3-compatible bucket and credentials):

  ```bash
  dokku postgres:backup-auth tellmewhy-db <AWS_ACCESS_KEY_ID> <AWS_SECRET_ACCESS_KEY> <region>
  dokku postgres:backup-schedule tellmewhy-db "0 4 * * *" <bucket-name>
  dokku postgres:backup tellmewhy-db <bucket-name>   # run one now to test
  ```

  Without a bucket, a nightly `dokku postgres:export tellmewhy-db > dump.sql`
  in cron plus off-server copy also works. Backups hold ciphertext only; the
  KEK in your password manager is the piece that must survive separately.
- **Deletion by request**: the public copy promises account deletion on
  request (crypto-shredding) — be ready to honor it until self-serve ships.

## Notes

- The migration runner (`scripts/migrate.mjs`) uses the same `./drizzle`
  journal table as `bun run db:migrate` (verified: `drizzle.__drizzle_migrations`,
  applied in a single transaction) — the two are interchangeable, re-running
  is a no-op, and a failed predeploy rolls back whole and keeps the old
  release serving.
- Streaming works because the app sends `X-Accel-Buffering: no` on every
  response (`next.config.ts`) and Dokku's nginx honors it — no nginx surgery
  needed.
- A deploy's traffic flip drops any chat reply that is mid-stream at that
  moment — prefer quiet hours for releases.
- Single-instance deploy: Next's default in-memory + on-disk cache is correct
  here; no cache handler or `deploymentId` is needed until there are multiple
  containers.
