import fs from "node:fs";

const env = fs.readFileSync(".env", "utf8");
const get = (name) => {
  const m = env.match(new RegExp(`^${name}="?(.*?)"?$`, "m"));
  return m ? m[1].trim() : null;
};

const key = get("PHARMCHECK_OPENAI_API_KEY") ?? get("OPENAI_API_KEY");
const url = get("PHARMCHECK_OPENAI_BASE_URL") ?? get("OPENAI_BASE_URL");
const model = get("PHARMCHECK_OPENAI_VISION_MODEL") ?? get("OPENAI_VISION_MODEL");

console.log("KEY:", JSON.stringify(key));
console.log("URL:", JSON.stringify(url));
console.log("MODEL:", JSON.stringify(model));

// Test with the exact same request shape as lib/ocr.ts (with x-bf-vk header)
const res = await fetch(`${url.replace(/\/$/, "")}/chat/completions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
    "x-bf-vk": key,
  },
  body: JSON.stringify({
    model,
    temperature: 0,
    max_tokens: 600,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Say OK" },
          {
            type: "image_url",
            image_url: {
              url: "data:image/jpeg;base64," + Buffer.from("test").toString("base64"),
              detail: "high",
            },
          },
        ],
      },
    ],
  }),
});

console.log("HTTP:", res.status);
console.log("BODY:", (await res.text()).slice(0, 400));
