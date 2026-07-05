if (process.env.NODE_ENV !== "test") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("server-only");
}
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle(client, { schema });
