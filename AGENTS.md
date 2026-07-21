<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Environment & tooling quirks (learned the hard way)

- **Env:** the Next runtime loads `.env.local`; drizzle-kit does too via `@next/env` in `drizzle.config.ts`; **Vitest deliberately doesn't** — tests default to the docker-compose DB (`src/test/setup.ts`). Agents' tools are **blocked from any `.env*` path** (even in echoed strings or commit messages — rephrase).
- **e2e:** `E2E_PORT=3101 bun run test:e2e` — but Next 16 refuses a second dev server from the same directory, so when a dev server is running, use a **throwaway git worktree at HEAD** (`bun install` inside, pre-warm one run for cold-compile, then trust the second). Never let Playwright reuse a real-env `:3000` server (`AI_MOCK=0` breaks every mock assertion). The expect-timeout is 15s for parallel-load reasons — specs passing in isolation but failing in parallel = contention, not regression (verify with `--workers=1`).
- **Dev DB:** contains orphaned synthetic `test-…` user ids (that's why `conversations.user_id` has an index but **no FK** — documented in the schema; add the FK only after test-data isolation).
- **IDE diagnostics in this harness are routinely stale** (RED-phase snapshots, worktree files). Trust `bunx tsc --noEmit` and `bun run lint`, not the squiggles. Accepted-debt hints: `generateObject`/`simulateReadableStream` deprecations, React `FormEvent`, bun.lock's `scaffold-tmp` name.
- **ai SDK is pinned to the v6 line** (`ai@6.x`) because `@openrouter/ai-sdk-provider` peers on it. Mock shapes: `MockLanguageModelV3`, nested finishReason/usage — fixtures in `src/test/ai-fixtures.ts`.
- **Browser-automation validation:** synthetic clicks/typing flake against hydrating React forms — sign in via a `POST /api/auth/sign-in/email` fetch instead; never navigate in the same batch as an in-flight mutation (it cancels the fetch).
