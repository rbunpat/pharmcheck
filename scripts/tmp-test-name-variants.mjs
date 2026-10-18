// One-off: test how the FDA name lookup handles OCR-style trade names.
import { lookupByName } from "../lib/fda.ts";

const variants = [
  "Tylenol 500 (ไทลินอล 500)",
  "Tylenol 500",
  "Tylenol",
  "PARACETAMOL พาราเซตามอล",
  "PARACETAMOL",
];

for (const v of variants) {
  try {
    const r = await lookupByName(v);
    console.log(`"${v}" -> ${r.length} rows`);
    for (const d of r.slice(0, 5)) {
      console.log("   ", d.registrationNo, "|", JSON.stringify(d.nameEn), "|", d.status?.slice(0, 20));
    }
  } catch (err) {
    console.log(`"${v}" -> ERROR:`, err instanceof Error ? err.message : err);
  }
}
