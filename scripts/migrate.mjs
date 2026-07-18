// Production migration runner for the Docker image, where drizzle-kit (a
// devDependency) is absent. Runs the same ./drizzle journal drizzle-kit
// maintains, so the two runners are interchangeable and idempotent.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = postgres(url, { max: 1, onnotice: () => {} });

try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("migrations up to date");
} finally {
  await client.end();
}
