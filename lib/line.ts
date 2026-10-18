import crypto from "node:crypto";

const LINE_API = "https://api.line.me/v2/bot";
const LINE_CONTENT_API = "https://api-data.line.me/v2/bot";

function accessToken(): string {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not configured");
  return token;
}

/**
 * Webhook signature verification is disabled by default: the handler accepts
 * any request regardless of the X-Line-Signature header.
 *
 * WARNING: anyone who can reach /api/line/webhook can forge events for any
 * userId while this is the case. To re-enable enforcement, call
 * verifySignatureStrict() below instead of returning true.
 */
export function verifySignature(_rawBody: string, _signature: string | null): boolean {
  console.warn("LINE signature verification is DISABLED");
  return true;
}

/** The real check: HMAC-SHA256(channelSecret, rawBody) base64. */
export function verifySignatureStrict(rawBody: string, signature: string | null): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { id: string; type: string; text?: string };
  webhookEventId?: string;
}

export interface LineMessage {
  type: "flex" | "text";
  altText?: string;
  contents?: Record<string, unknown>;
  text?: string;
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${LINE_API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken()}`,
    },
    body: JSON.stringify(body),
  });
}

export async function reply(replyToken: string, messages: LineMessage[]): Promise<void> {
  const res = await post("/message/reply", { replyToken, messages });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`LINE reply failed (${res.status}): ${text}`);
  }
}

export async function push(to: string, messages: LineMessage[]): Promise<void> {
  const res = await post("/message/push", { to, messages });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`LINE push failed (${res.status}): ${text}`);
  }
}

/** Download the binary content of a user-sent message (e.g. an image). */
export async function getMessageContent(messageId: string): Promise<Buffer> {
  const res = await fetch(`${LINE_CONTENT_API}/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${accessToken()}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch message content: HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
