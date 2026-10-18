import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./db/schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  // Allow build-time import without a DB configured; runtime usage will throw.
  console.warn("DATABASE_URL is not set — database features are disabled.");
}

const sql = connectionString ? neon(connectionString) : undefined;

export const db = sql
  ? drizzle(sql, { schema })
  : (undefined as unknown as typeof drizzle extends never
      ? never
      : ReturnType<typeof drizzle<typeof schema>>);

export function requireDb() {
  if (!db) throw new Error("DATABASE_URL is not configured");
  return db;
}
