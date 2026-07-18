if (process.env.NODE_ENV !== "test") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("server-only");
}
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle(client, { schema });

// Either the shared db singleton or a transaction handle — write helpers
// accept this so a caller can make them part of a larger transaction.
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
