import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireDb } from "@/lib/db";
import { allergies, users } from "@/lib/db/schema";
import { PRESET_ALLERGIES } from "@/lib/allergens";

/**
 * The LINE Login channel that owns the LIFF app. A LIFF ID is
 * `{channelId}-{suffix}`, so its prefix is the authoritative channel ID for
 * verifying ID tokens issued to the LIFF app. `LINE_CHANNEL_ID` is only a
 * fallback for setups where the LIFF ID isn't available at runtime.
 */
function loginChannelId(): string | undefined {
  return (
    process.env.LIFF_ID?.split("-")[0] ||
    process.env.NEXT_PUBLIC_LIFF_ID?.split("-")[0] ||
    process.env.LINE_CHANNEL_ID
  );
}

async function verifyIdToken(idToken: string): Promise<string | null> {
  const channelId = loginChannelId();
  if (!idToken || !channelId) {
    console.error("verifyIdToken: missing ID token or LINE Login channel ID");
    return null;
  }
  try {
    const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    });
    if (!res.ok) {
      console.error(
        `verifyIdToken: LINE verify failed (${res.status}): ${await res
          .text()
          .catch(() => "")}`,
      );
      return null;
    }
    const data = (await res.json()) as { sub?: string; aud?: string };
    if (data.aud !== channelId || !data.sub) {
      console.error(
        `verifyIdToken: audience mismatch (aud=${data.aud}, expected=${channelId})`,
      );
      return null;
    }
    return data.sub;
  } catch (err) {
    console.error("verifyIdToken: request failed", err);
    return null;
  }
}

async function ensureUser(lineUserId: string): Promise<string> {
  const dbh = requireDb();
  const existing = await dbh
    .select({ id: users.id })
    .from(users)
    .where(eq(users.lineUserId, lineUserId))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const inserted = await dbh
    .insert(users)
    .values({ lineUserId })
    .onConflictDoNothing({ target: users.lineUserId })
    .returning({ id: users.id });
  if (inserted[0]) return inserted[0].id;
  const retry = await dbh
    .select({ id: users.id })
    .from(users)
    .where(eq(users.lineUserId, lineUserId))
    .limit(1);
  return retry[0].id;
}

export async function GET(request: NextRequest) {
  const idToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const lineUserId = await verifyIdToken(idToken ?? "");
  if (!lineUserId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = await ensureUser(lineUserId);
  const rows = await requireDb()
    .select()
    .from(allergies)
    .where(eq(allergies.userId, userId));
  return NextResponse.json({ allergies: rows, presets: PRESET_ALLERGIES });
}

export async function POST(request: NextRequest) {
  const idToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const lineUserId = await verifyIdToken(idToken ?? "");
  if (!lineUserId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    allergens?: { name: string; keywords?: string[]; source?: string }[];
  } | null;
  if (!body || !Array.isArray(body.allergens)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const userId = await ensureUser(lineUserId);
  const dbh = requireDb();

  // Replace the full set (simplest correct semantics for a picker UI).
  await dbh.delete(allergies).where(eq(allergies.userId, userId));
  if (body.allergens.length > 0) {
    await dbh.insert(allergies).values(
      body.allergens.map((a) => ({
        userId,
        allergenName: a.name,
        keywords: a.keywords && a.keywords.length > 0 ? a.keywords : [a.name],
        source: a.source ?? "preset",
      })),
    );
  }
  return NextResponse.json({ ok: true });
}
