import { NextRequest } from "next/server";
import {
  verifySignature,
  reply,
  push,
  getMessageContent,
  type LineEvent,
  type LineMessage,
} from "@/lib/line";
import { runScan } from "@/lib/pipeline";
import { templateWelcome, HELP_TEXT } from "@/lib/templates";
import { db, requireDb } from "@/lib/db";
import { users } from "@/lib/db/schema";

interface WebhookBody {
  events?: LineEvent[];
}

async function upsertUser(lineUserId: string, displayName?: string) {
  if (!db) return;
  await requireDb()
    .insert(users)
    .values({ lineUserId, displayName: displayName ?? null })
    .onConflictDoNothing({ target: users.lineUserId });
}

async function handleEvent(event: LineEvent): Promise<void> {
  const lineUserId = event.source?.userId ?? null;

  switch (event.type) {
    case "follow": {
      if (lineUserId) await upsertUser(lineUserId);
      if (event.replyToken) {
        await reply(event.replyToken, [templateWelcome(process.env.LIFF_ID) as unknown as LineMessage]);
      }
      break;
    }

    case "message": {
      if (event.message?.type === "image" && event.message.id) {
        if (!lineUserId || !event.replyToken) break;
        try {
          const imageBytes = await getMessageContent(event.message.id);
          const outcome = await runScan(imageBytes, lineUserId);
          await reply(event.replyToken, [outcome.message as unknown as LineMessage]);
        } catch (err) {
          console.error("Scan pipeline failed:", err);
          await reply(event.replyToken, [
            {
              type: "text",
              text: "ขออภัย เกิดข้อผิดพลาดในการตรวจสอบ กรุณาลองใหม่อีกครั้ง\n\nข้อมูลนี้ไม่ใช่คำแนะนำทางการแพทย์",
            },
          ]);
        }
      } else if (event.message?.type === "text") {
        if (event.replyToken) {
          await reply(event.replyToken, [{ type: "text", text: HELP_TEXT }]);
        }
      }
      break;
    }

    default:
      // postback etc. — reserved for future use
      break;
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");

  if (!verifySignature(rawBody, signature)) {
    return new Response("Invalid signature", { status: 403 });
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Process events inline (MVP: no queue). Reply tokens expire in ~30s, so we
  // must finish quickly; push() is the fallback if reply fails.
  for (const event of body.events ?? []) {
    try {
      await handleEvent(event);
    } catch (err) {
      console.error("Event handler failed:", err);
      // Best-effort push if reply path threw
      if (event.replyToken && event.source?.userId) {
        try {
          await push(event.source.userId, [
            { type: "text", text: "ขออภัย เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" },
          ]);
        } catch {
          // ignore
        }
      }
    }
  }

  return new Response("OK", { status: 200 });
}
