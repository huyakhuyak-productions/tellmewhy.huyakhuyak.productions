# Build stage: Bun installs and builds; the app never runs here.
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# Throwaway values so module-scope env validation can't trip during prerender.
# The real values come from Dokku config at runtime — never from the image.
ENV DATABASE_URL="postgres://build:build@localhost:5432/build" \
    MASTER_KEK="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" \
    BETTER_AUTH_SECRET="build-time-placeholder-secret"
RUN bun run build

# Runtime stage: the traced standalone server on plain Node.
FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Dokku reads app.json from the image to run the predeploy migration step.
COPY --from=build /app/app.json ./app.json
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/migrate.mjs ./scripts/migrate.mjs
# The migrator's submodules aren't part of the app's traced imports — ship the
# full (pure-JS) packages so scripts/migrate.mjs resolves everything it needs.
COPY --from=build /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=build /app/node_modules/postgres ./node_modules/postgres

EXPOSE 3000
CMD ["node", "server.js"]
