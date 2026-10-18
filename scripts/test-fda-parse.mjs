// One-off script: verify lib/fda.ts parsing against the live SOAP service.
// Usage: npx tsx scripts/test-fda-parse.mjs "1A 123/45"
import { lookupByRegNo, lookupByName, normalizeRegNo } from "../lib/fda";

const input = process.argv[2] ?? "1A 123/45";
console.log("normalized:", normalizeRegNo(input));

const byReg = await lookupByRegNo(input);
console.log(`lookupByRegNo("${input}") -> ${byReg.length} row(s)`);
for (const d of byReg.slice(0, 5)) {
  console.log(" -", d.registrationNo, "|", d.nameTh, "|", d.nameEn, "|", d.status, "|", d.manufacturer);
}

const byName = await lookupByName(input);
console.log(`lookupByName("${input}") -> ${byName.length} row(s)`);
for (const d of byName.slice(0, 5)) {
  console.log(" -", d.registrationNo, "|", d.nameTh, "|", d.nameEn, "|", d.status, "|", d.manufacturer);
}
