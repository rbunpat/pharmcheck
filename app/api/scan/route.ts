import { NextRequest, NextResponse } from "next/server";
import { runScan } from "@/lib/pipeline";
import { keywordsForAllergen } from "@/lib/allergens";

/**
 * Test-only endpoint: runs the same pipeline as the LINE webhook but returns
 * the result as JSON instead of sending a LINE message. Accepts simulated
 * allergies so the flow can be tested without LIFF.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "image file is required" }, { status: 400 });
  }

  const simulatedAllergies = form
    .getAll("allergy")
    .filter((v): v is string => typeof v === "string")
    .map((name) => ({ allergenName: name, keywords: keywordsForAllergen(name) }));

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const outcome = await runScan(bytes, null, simulatedAllergies);
    return NextResponse.json({
      decision: outcome.decision,
      flags: outcome.flags,
      message: outcome.message,
    });
  } catch (err) {
    console.error("Scan failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "scan failed" },
      { status: 500 },
    );
  }
}
