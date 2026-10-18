import { eq } from "drizzle-orm";
import { db, requireDb } from "./db";
import { drugCache } from "./db/schema";
import {
  lookupByRegNo,
  lookupByName,
  normalizeRegNo,
  type FdaDrug,
} from "./fda";
import type { OcrFields } from "./ocr";

export interface MatchResult {
  drug: FdaDrug | null;
  confidence: number;
  candidates: number;
  source: "cache" | "fda" | "none";
}

const CONFUSABLES: Record<string, string[]> = {
  O: ["0"],
  "0": ["O"],
  I: ["1"],
  "1": ["I"],
};

/** Generate variants of a normalized reg no with one confusable char swapped. */
export function confusableVariants(normalized: string): string[] {
  const variants = new Set<string>();
  for (let i = 0; i < normalized.length; i++) {
    const alts = CONFUSABLES[normalized[i]];
    if (!alts) continue;
    for (const alt of alts) {
      variants.add(normalized.slice(0, i) + alt + normalized.slice(i + 1));
    }
  }
  return [...variants];
}

/** Collapse case and whitespace runs for name comparison ("TYLENOL   500" → "TYLENOL 500"). */
function normalizeName(s: string): string {
  return s.toUpperCase().replace(/\s+/g, " ").trim();
}

/**
 * The FDA name search returns 0 rows for mixed Thai/Latin strings, and OCR
 * often emits names like "Tylenol 500 (ไทลินอล 500)". Generate script-
 * homogeneous variants (parenthetical-stripped, Thai-only, Latin-only),
 * most specific first, skipping letterless junk like "500".
 */
export function nameVariants(raw: string): string[] {
  const variants = new Set<string>();
  const push = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    if (t && /[ก-๙A-Za-z]/.test(t)) variants.add(t);
  };
  const name = raw.trim();
  const hasThai = /[ก-๙]/.test(name);
  const hasLatin = /[A-Za-z]/.test(name);
  // A mixed-script name never matches the FDA index — start from the
  // parenthetical-stripped form instead of wasting a lookup on the raw string.
  const bases =
    hasThai && hasLatin ? [name.replace(/[({\[][^)}\]]*[)}\]]/g, " ")] : [name];
  for (const base of bases) {
    push(base);
    push(base.replace(/[^ก-๙0-9\s]/g, " ")); // Thai-only run
    push(base.replace(/[^A-Za-z0-9\s]/g, " ")); // Latin-only run
  }
  return [...variants].sort((a, b) => b.length - a.length);
}

/**
 * Rank multi-row FDA results for a name query. The search is a contains-match
 * ("Tylenol 500" also hits "TYLENOL 500 (TABLETS)"), so prefer a row whose
 * normalized name equals the query exactly; among ties prefer the active
 * registration (คงอยู่). Returns null when still ambiguous.
 */
function pickBestMatch(
  query: string,
  drugs: FdaDrug[],
): { drug: FdaDrug; exactName: boolean } | null {
  const q = normalizeName(query);
  const exact = drugs.filter(
    (d) =>
      (d.nameEn !== null && normalizeName(d.nameEn) === q) ||
      (d.nameTh !== null && normalizeName(d.nameTh) === q),
  );
  if (exact.length === 1) return { drug: exact[0], exactName: true };
  const active = exact.filter((d) => {
    const s = (d.status ?? "").toLowerCase();
    return s.includes("คงอยู่") || s.includes("active");
  });
  return active.length === 1 ? { drug: active[0], exactName: true } : null;
}

async function getFromCache(normalized: string): Promise<FdaDrug | null> {
  if (!db) return null;
  const rows = await requireDb()
    .select()
    .from(drugCache)
    .where(eq(drugCache.registrationNo, normalized))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    registrationNo: row.registrationNo,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    status: row.status,
    manufacturer: row.manufacturer,
    rawXml: row.rawXml,
  };
}

async function saveToCache(drug: FdaDrug): Promise<void> {
  if (!db) return;
  const normalized = normalizeRegNo(drug.registrationNo);
  await requireDb()
    .insert(drugCache)
    .values({
      registrationNo: normalized,
      nameTh: drug.nameTh,
      nameEn: drug.nameEn,
      status: drug.status,
      manufacturer: drug.manufacturer,
      rawXml: drug.rawXml,
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: drugCache.registrationNo,
      set: {
        nameTh: drug.nameTh,
        nameEn: drug.nameEn,
        status: drug.status,
        manufacturer: drug.manufacturer,
        fetchedAt: new Date(),
      },
    });
}

/**
 * Match OCR-extracted fields to a registered drug.
 * Tier 1: exact normalized registration number.
 * Tier 2: one OCR-confusable character (O/0, I/1) resolving to exactly one drug.
 * Tier 3: trade-name lookup with exactly one candidate.
 */
export async function matchDrug(ocr: OcrFields): Promise<MatchResult> {
  const ocrConfidence = ocr.field_confidence;

  // Tier 1 — exact registration number
  if (ocr.registration_no) {
    const normalized = normalizeRegNo(ocr.registration_no);
    const cached = await getFromCache(normalized);
    if (cached) {
      return { drug: cached, confidence: ocrConfidence, candidates: 1, source: "cache" };
    }
    try {
      const results = await lookupByRegNo(ocr.registration_no);
      if (results.length === 1) {
        await saveToCache(results[0]);
        return { drug: results[0], confidence: ocrConfidence, candidates: 1, source: "fda" };
      }
      if (results.length > 1) {
        return { drug: null, confidence: ocrConfidence, candidates: results.length, source: "none" };
      }
    } catch (err) {
      console.error("FDA reg-no lookup failed:", err);
    }

    // Tier 2 — confusable-character variants, exactly one hit
    for (const variant of confusableVariants(normalized)) {
      try {
        const results = await lookupByRegNo(variant);
        if (results.length === 1) {
          await saveToCache(results[0]);
          return {
            drug: results[0],
            confidence: ocrConfidence * 0.9,
            candidates: 1,
            source: "fda",
          };
        }
      } catch {
        // ignore variant failures
      }
    }
  }

  // Tier 3 — trade-name lookup. Try script-homogeneous variants of the OCR
  // name (mixed Thai/Latin strings never match the FDA index), then rank
  // multi-row results by exact-name match and active status.
  if (ocr.trade_name) {
    for (const variant of nameVariants(ocr.trade_name)) {
      try {
        const results = await lookupByName(variant);
        if (results.length === 1) {
          await saveToCache(results[0]);
          return {
            drug: results[0],
            confidence: ocrConfidence * 0.9,
            candidates: 1,
            source: "fda",
          };
        }
        if (results.length > 1) {
          const best = pickBestMatch(variant, results);
          if (best) {
            await saveToCache(best.drug);
            // An exact normalized-name hit is as reliable as a reg-no match —
            // don't apply the fuzzy-match confidence penalty.
            return {
              drug: best.drug,
              confidence: best.exactName ? ocrConfidence : ocrConfidence * 0.9,
              candidates: 1,
              source: "fda",
            };
          }
          // Genuinely ambiguous — report the candidate count.
          return { drug: null, confidence: ocrConfidence, candidates: results.length, source: "none" };
        }
      } catch (err) {
        console.error("FDA name lookup failed:", err);
      }
    }
  }

  return { drug: null, confidence: ocrConfidence, candidates: 0, source: "none" };
}
