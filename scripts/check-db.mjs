// One-off script: verify DB tables and recent rows.
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const sql = neon(process.env.DATABASE_URL);

const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`;
console.log("tables:", tables.map((t) => t.table_name).join(", "));

const users = await sql`select line_user_id, display_name, created_at from users order by created_at desc limit 5`;
console.log("users:", JSON.stringify(users, null, 2));

const scans = await sql`select decision, flags, matched_reg_no, created_at from scans order by created_at desc limit 5`;
console.log("scans:", JSON.stringify(scans, null, 2));
