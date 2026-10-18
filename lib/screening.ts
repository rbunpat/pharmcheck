import type { OcrFields } from "./ocr";
import type { MatchResult } from "./matcher";

export type Decision = "INFO" | "REFER" | "RETAKE";
export type Flag =
  | "LOW_CONFIDENCE"
  | "NOT_FOUND"
  | "ALLERGY"
  | "REG_INACTIVE";

export interface UserAllergy {
  allergenName: string;
  keywords: string[];
}

export interface ScreeningInput {
  ocr: OcrFields;
  match: MatchResult;
  allergies: UserAllergy[];
  threshold?: number;
}

export interface ScreeningResult {
  flags: Flag[];
  decision: Decision;
  /** Allergens that triggered the ALLERGY flag */
  matchedAllergens: string[];
}

/** Case-insensitive keyword intersection between allergen keywords and text. */
export function allergyMatches(
  allergies: UserAllergy[],
  texts: (string | null | undefined)[],
): string[] {
  const haystack = texts
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .join(" ")
    .toLowerCase();
  if (!haystack) return [];
  const matched: string[] = [];
  for (const allergy of allergies) {
    const terms = [allergy.allergenName, ...allergy.keywords]
      .map((k) => k.toLowerCase().trim())
      .filter((k) => k.length > 0);
    if (terms.some((term) => haystack.includes(term))) {
      matched.push(allergy.allergenName);
    }
  }
  return matched;
}

/**
 * Pure screening function. No I/O, no randomness.
 * R00: confidence below threshold or ambiguous match → RETAKE
 * R01: no matching drug → REFER (NOT_FOUND)
 * R02: registration inactive → REFER
 * R04: allergy matches → REFER
 * R99: otherwise → INFO
 */
export function screen(input: ScreeningInput): ScreeningResult {
  const threshold = input.threshold ?? Number(process.env.CONFIDENCE_THRESHOLD ?? 0.85);
  const flags: Flag[] = [];
  const { ocr, match } = input;

  if (ocr.field_confidence < threshold || match.candidates > 1) {
    flags.push("LOW_CONFIDENCE");
    return { flags, decision: "RETAKE", matchedAllergens: [] };
  }

  if (!match.drug) {
    flags.push("NOT_FOUND");
    return { flags, decision: "REFER", matchedAllergens: [] };
  }

  const status = (match.drug.status ?? "").toLowerCase();
  const inactive =
    status.includes("ยกเลิก") ||
    status.includes("ระงับ") ||
    status.includes("หมดอายุ") ||
    status.includes("cancel") ||
    status.includes("suspend") ||
    status.includes("expire");
  if (inactive) flags.push("REG_INACTIVE");

  const matchedAllergens = allergyMatches(input.allergies, [
    match.drug.nameTh,
    match.drug.nameEn,
    ...ocr.ingredients,
  ]);
  if (matchedAllergens.length > 0) flags.push("ALLERGY");

  if (flags.length > 0) {
    return { flags, decision: "REFER", matchedAllergens };
  }
  return { flags: [], decision: "INFO", matchedAllergens: [] };
}
