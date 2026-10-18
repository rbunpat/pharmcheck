// One-off: verify the matcher resolves the OCR fields from the failed scans.
import { matchDrug } from "../lib/matcher.ts";

const cases = [
  {
    label: "Tylenol scan (mixed-script name, no reg no)",
    ocr: {
      registration_no: null,
      trade_name: "Tylenol 500 (ไทลินอล 500)",
      strength: "500 mg",
      manufacturer: null,
      ingredients: ["paracetamol"],
      field_confidence: 0.9,
    },
  },
  {
    label: "Paracetamol scan (mixed-script name)",
    ocr: {
      registration_no: null,
      trade_name: "PARACETAMOL พาราเซตามอล",
      strength: null,
      manufacturer: "Asian Union Laboratories Co., Ltd.",
      ingredients: ["Paracetamol"],
      field_confidence: 0.85,
    },
  },
];

for (const c of cases) {
  const r = await matchDrug(c.ocr);
  console.log(`${c.label}:`);
  console.log(
    "  ->",
    r.drug
      ? `${r.drug.registrationNo} | ${r.drug.nameEn} | ${r.drug.status} (source=${r.source}, candidates=${r.candidates})`
      : `no match (candidates=${r.candidates}, source=${r.source})`,
  );
}
