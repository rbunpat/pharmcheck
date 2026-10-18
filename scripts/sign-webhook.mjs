// One-off script: send a correctly-signed webhook request to the local dev server.
// Usage: node scripts/sign-webhook.mjs [text]
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

// Minimal .env loader (no dotenv dependency needed).
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const secret = process.env.LINE_CHANNEL_SECRET;
if (!secret) {
  console.error("LINE_CHANNEL_SECRET not set");
  process.exit(1);
}

const text = process.argv[2] ?? "help";
const body = JSON.stringify({
  destination: "U0000000000000000000000000000000",
  events: [
    {
      type: "message",
      replyToken: "test-reply-token",
      source: { type: "user", userId: "Utest00000000000000000000000000" },
      timestamp: Date.now(),
      message: { type: "text", id: "test-msg-id", text },
    },
  ],
});

const signature = createHmac("sha256", secret).update(body).digest("base64");

const res = await fetch("http://localhost:3000/api/line/webhook", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Line-Signature": signature,
  },
  body,
});
console.log("HTTP", res.status);
console.log(await res.text());
