// Deterministic env for unit tests. 32 zero-bytes base64 — test-only KEK.
process.env.MASTER_KEK = Buffer.alloc(32, 0).toString("base64");
process.env.AI_MOCK = "1";
