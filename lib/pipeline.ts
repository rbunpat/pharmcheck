import { eq } from "drizzle-orm";
import { db, requireDb } from "./db";
import { allergies, scans, users } from "./db/schema";
import { extractFields } from "./ocr";
import { matchDrug } from "./matcher";
import { screen, type UserAllergy } from "./screening";
import {
  templateNormal,
  templateRisk,
  templateNotFound,
  templateRetake,
  type FlexMessage,
} from "./templates";

export interface ScanOutcome {
  decision: string;
  flags: string[];
  message: FlexMessage;
}

/** Load a user's registered allergies as screening input. */
export async function getAllergies(lineUserId: string): Promise<UserAllergy[]> {
  if (!db) return [];
  const rows = await requireDb()
    .select({
      allergenName: allergies.allergenName,
      keywords: allergies.keywords,
    })
    .from(allergies)
    .innerJoin(users, eq(users.id, allergies.userId))
    .where(eq(users.lineUserId, lineUserId));
  return rows;
}

/** Persist a scan result for auditing/debugging. */
export async function recordScan(params: {
  lineUserId: string | null;
  ocrFields: unknown;
  confidence: number;
  matchedRegNo: string | null;
  flags: string[];
  decision: string;
}): Promise<void> {
  if (!db) return;
  await requireDb().insert(scans).values({
    lineUserId: params.lineUserId,
    ocrFields: params.ocrFields as never,
    confidence: params.confidence.toFixed(3),
    matchedRegNo: params.matchedRegNo,
    flags: params.flags,
    decision: params.decision,
  });
}

/**
 * Full scan pipeline: image bytes → OCR → FDA match → screening → message.
 * Pure pipeline logic, no LINE I/O — callers decide how to deliver the message.
 */
export async function runScan(
  imageBytes: Buffer,
  lineUserId: string | null,
  allergiesOverride?: UserAllergy[],
): Promise<ScanOutcome> {
  const ocr = await extractFields(imageBytes.toString("base64"));
  const match = await matchDrug(ocr.fields);
  const userAllergies = allergiesOverride ?? (lineUserId ? await getAllergies(lineUserId) : []);
  const result = screen({ ocr: ocr.fields, match, allergies: userAllergies });

  await recordScan({
    lineUserId,
    ocrFields: ocr.fields,
    confidence: ocr.fields.field_confidence,
    matchedRegNo: match.drug?.registrationNo ?? null,
    flags: result.flags,
    decision: result.decision,
  });

  let message: FlexMessage;
  if (result.decision === "RETAKE") {
    message = templateRetake();
  } else if (!match.drug) {
    message = templateNotFound(ocr.fields);
  } else if (result.decision === "REFER") {
    message = templateRisk(match.drug, ocr.fields, result);
  } else {
    message = templateNormal(match.drug, ocr.fields);
  }

  return { decision: result.decision, flags: result.flags, message };
}
