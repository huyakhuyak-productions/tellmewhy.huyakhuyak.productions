// Deterministic env for tests. Next's env loader intentionally skips
// .env.local under NODE_ENV=test, so integration tests default to the
// docker-compose database instead of whatever an env file points at —
// an explicitly exported DATABASE_URL still wins.
process.env.DATABASE_URL ??= "postgres://tellmewhy:tellmewhy@localhost:5432/tellmewhy";

// 32 zero-bytes base64 as the test-only KEK, and offline mock AI.
process.env.MASTER_KEK = Buffer.alloc(32, 0).toString("base64");
process.env.AI_MOCK = "1";
