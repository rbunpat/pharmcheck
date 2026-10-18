import fs from "node:fs";

const env = fs.readFileSync(".env", "utf8");
const get = (name) => {
  const m = env.match(new RegExp(`^${name}="?(.*?)"?$`, "m"));
  return m ? m[1].trim() : null;
};

const baseUrl = get("PHARMCHECK_OPENAI_BASE_URL") ?? get("OPENAI_BASE_URL");
const apiKey = get("PHARMCHECK_OPENAI_API_KEY") ?? get("OPENAI_API_KEY");
const model = get("PHARMCHECK_OPENAI_VISION_MODEL") ?? get("OPENAI_VISION_MODEL");

console.log("URL:", baseUrl);
console.log("KEY prefix:", apiKey ? `${apiKey.slice(0, 12)}...` : "MISSING");
console.log("MODEL:", model);

const res = await fetch(`${baseUrl}/chat/completions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model,
    messages: [
      {
        role: "user",
        content: "Reply with exactly: OK",
      },
    ],
    max_tokens: 10,
  }),
});

console.log("HTTP:", res.status);
const text = await res.text();
console.log("BODY:", text.slice(0, 500));
