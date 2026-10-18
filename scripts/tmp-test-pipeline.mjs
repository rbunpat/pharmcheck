// One-off: run the real Tylenol OCR fields through match + screen end-to-end.
import { matchDrug } from "../lib/matcher.ts";
import { screen } from "../lib/screening.ts";

const ocr = {
  registration_no: null,
  trade_name: "Tylenol 500 (ไทลินอล 500)",
  strength: "500 mg",
  manufacturer: null,
  ingredients: ["paracetamol"],
  field_confidence: 0.9,
};

const match = await matchDrug(ocr);
console.log("match:", match.drug ? `${match.drug.registrationNo} conf=${match.confidence}` : "none", "candidates=", match.candidates);

const result = screen({
  ocr,
  match,
  allergies: [{ allergenName: "พาราเซตามอล", keywords: ["พาราเซตามอล"] }],
});
console.log("screen:", JSON.stringify(result));
