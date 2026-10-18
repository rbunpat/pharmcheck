// One-off: dump ocr_fields from recent scans.
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const sql = neon(process.env.DATABASE_URL);
const rows = await sql`select ocr_fields, confidence, decision, flags from scans order by created_at desc limit 3`;
for (const r of rows) {
  console.log("---", r.created_at ?? "", r.decision, r.flags);
  console.log(JSON.stringify(r.ocr_fields, null, 2));
}
