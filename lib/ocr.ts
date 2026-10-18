export interface OcrFields {
  registration_no: string | null;
  trade_name: string | null;
  strength: string | null;
  manufacturer: string | null;
  ingredients: string[];
  field_confidence: number;
}

export interface OcrResult {
  fields: OcrFields;
  modelVersion: string;
}

const OCR_TIMEOUT_MS = 20_000;

const PROMPT = `You are reading a photo of a Thai medicine package (box, blister, bottle, or sachet).
Extract ONLY the following fields from the label. If a field is not visible, use null.
Return STRICT JSON only, no markdown, no explanation:
{
  "registration_no": string | null,   // Thai FDA registration number, e.g. "1A 123/45", "1F 3/55(B)", "2A 12/2560 (NG)". Usually printed near "เลขทะเบียนตำรับยา" or a format like digit+letter space digits/digits
  "trade_name": string | null,        // the product/trade name (Thai or English). If the name is printed in both Thai and English, output only the English/Latin form, e.g. "Tylenol 500" not "Tylenol 500 (ไทลินอล 500)"
  "strength": string | null,          // e.g. "500 mg"
  "manufacturer": string | null,      // manufacturer or licensee name
  "ingredients": string[],            // active ingredient names (Thai or English), empty if none visible
  "field_confidence": number          // your overall confidence 0..1 that the registration_no and trade_name were read correctly
}`;

/** Registration-number formats per the Thai FDA: e.g. 1A 123/45, 1F 3/55(B), 2A 12/2560 (NG) */
const REG_NO_PATTERNS = [
  /^\d{1,2}[A-Z]{1,2}\s?\d+\/\d{2,4}(\s*\((?:NG|G|NG-?G)\))?$/i,
  /^\d{1,2}\s?[A-Z]\s?\d+\/\d{2,4}$/i,
];

const STRENGTH_PATTERN = /^\d+(\.\d+)?\s?(mg|g|ml|mcg|%)$/i;

export function isValidRegNo(value: string | null): value is string {
  if (!value) return false;
  return REG_NO_PATTERNS.some((p) => p.test(value.trim()));
}

export function isValidStrength(value: string | null): value is string {
  if (!value) return false;
  return STRENGTH_PATTERN.test(value.trim());
}

interface RawOcrResponse {
  registration_no?: string | null;
  trade_name?: string | null;
  strength?: string | null;
  manufacturer?: string | null;
  ingredients?: unknown;
  field_confidence?: unknown;
}

function extractJson(content: string): RawOcrResponse {
  // Strip markdown fences if the model adds them despite instructions.
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("OCR response contained no JSON object");
  }
  return JSON.parse(cleaned.slice(start, end + 1)) as RawOcrResponse;
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Extract label fields from a drug-package photo using an OpenAI-compatible
 * vision model. temperature=0, JSON-only output, deterministic validation.
 */
export async function extractFields(imageBase64: string): Promise<OcrResult> {
  // Namespaced vars take precedence so a globally-set OPENAI_API_KEY (e.g. from
  // another tool) can't shadow this project's credentials. Next.js gives real OS
  // environment variables precedence over .env, so the plain names are only a fallback.
  const baseUrl =
    process.env.PHARMCHECK_OPENAI_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    "https://api.openai.com/v1";
  const apiKey =
    process.env.PHARMCHECK_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  const model =
    process.env.PHARMCHECK_OPENAI_VISION_MODEL ??
    process.env.OPENAI_VISION_MODEL ??
    "gpt-4o";
  if (!apiKey) throw new Error("PHARMCHECK_OPENAI_API_KEY is not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Standard OpenAI convention: Bearer token in the Authorization header.
        Authorization: `Bearer ${apiKey}`,
        // Some OpenAI-compatible gateways (e.g. aigw.rachatat.com) authenticate
        // via a custom header instead of Authorization. Sending both keeps this
        // working across providers; gateways ignore the header they don't use.
        "x-bf-vk": apiKey,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 600,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${imageBase64}`,
                  detail: "high",
                },
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OCR API returned HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("OCR API returned no content");

    const raw = extractJson(content);
    const regNo = raw.registration_no?.trim() || null;
    const strength = raw.strength?.trim() || null;

    const fields: OcrFields = {
      // Discard values that fail deterministic validation.
      registration_no: isValidRegNo(regNo) ? regNo : null,
      trade_name: raw.trade_name?.trim() || null,
      strength: isValidStrength(strength) ? strength : null,
      manufacturer: raw.manufacturer?.trim() || null,
      ingredients: toStringArray(raw.ingredients),
      field_confidence:
        typeof raw.field_confidence === "number" &&
        raw.field_confidence >= 0 &&
        raw.field_confidence <= 1
          ? raw.field_confidence
          : 0.5,
    };

    return { fields, modelVersion: model };
  } finally {
    clearTimeout(timer);
  }
}
