import { NextRequest, NextResponse } from "next/server";
import { lookupByRegNo, lookupByName, type FdaDrug } from "@/lib/fda";

type Mode = "auto" | "regno" | "name";

/** Heuristic: Thai FDA reg numbers look like "1F 3/55(B)" or "2C 207/28". */
function looksLikeRegNo(q: string): boolean {
  return /^\d{1,2}[A-Z]{1,2}\s*\d/i.test(q);
}

async function tryRegNo(q: string): Promise<FdaDrug[]> {
  try {
    return await lookupByRegNo(q);
  } catch {
    return [];
  }
}

async function tryName(q: string): Promise<FdaDrug[]> {
  try {
    return await lookupByName(q);
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const q = params.get("q")?.trim() ?? "";
  const modeParam = params.get("mode") ?? "auto";
  const mode: Mode =
    modeParam === "regno" || modeParam === "name" ? modeParam : "auto";
  const limitParam = Number.parseInt(params.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, 200)
    : 50;

  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }

  try {
    let drugs: FdaDrug[];
    if (mode === "regno") {
      drugs = await lookupByRegNo(q);
    } else if (mode === "name") {
      drugs = await lookupByName(q);
    } else {
      // auto: try the mode the query looks like first, fall back to the other.
      drugs = looksLikeRegNo(q)
        ? (await tryRegNo(q)) || (await tryName(q))
        : (await tryName(q)) || (await tryRegNo(q));
    }
    return NextResponse.json({
      query: q,
      mode,
      total: drugs.length,
      count: Math.min(drugs.length, limit),
      drugs: drugs.slice(0, limit),
    });
  } catch (err) {
    console.error("FDA search failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "FDA search failed" },
      { status: 502 },
    );
  }
}
