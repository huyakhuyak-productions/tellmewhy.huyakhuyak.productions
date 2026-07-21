// Tests ALWAYS run against the compose DB. An exported DATABASE_URL must
// never win here (that's how the dev DB accumulated orphaned test-… rows).
// TEST_DATABASE_URL is the one deliberate escape hatch (CI).
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://tellmewhy:tellmewhy@localhost:5432/tellmewhy";

// 32 zero-bytes base64 as the test-only KEK, and offline mock AI.
process.env.MASTER_KEK = Buffer.alloc(32, 0).toString("base64");
process.env.AI_MOCK = "1";
