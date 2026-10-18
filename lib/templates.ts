import type { ScreeningResult } from "./screening";
import type { FdaDrug } from "./fda";
import type { OcrFields } from "./ocr";

const DISCLAIMER = "ข้อมูลนี้ไม่ใช่คำแนะนำทางการแพทย์";

export interface FlexMessage {
  type: "flex";
  altText: string;
  contents: Record<string, unknown>;
}

interface FlexBubble {
  type: "flex";
  altText: string;
  contents: Record<string, unknown>;
}

function footer(): Record<string, unknown> {
  return {
    type: "box",
    layout: "vertical",
    contents: [
      {
        type: "text",
        text: DISCLAIMER,
        size: "sm",
        color: "#999999",
        wrap: true,
      },
    ],
  };
}

function drugInfoRows(drug: FdaDrug): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const add = (label: string, value: string | null) => {
    if (!value) return;
    rows.push({
      type: "box",
      layout: "baseline",
      contents: [
        { type: "text", text: label, size: "sm", color: "#666666", flex: 4 },
        { type: "text", text: value, size: "md", wrap: true, flex: 6 },
      ],
    });
  };
  add("เลขทะเบียน", drug.registrationNo);
  add("ชื่อการค้า", drug.nameTh ?? drug.nameEn);
  add("ผู้ผลิต/ผู้นำเข้า", drug.manufacturer);
  add("สถานะทะเบียน", drug.status);
  return rows;
}

function bubble(altText: string, header: string, headerColor: string, body: Record<string, unknown>[]): FlexBubble {
  return {
    type: "flex",
    altText,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: header,
            size: "lg",
            weight: "bold",
            color: headerColor,
            wrap: true,
          },
        ],
      },
      body: { type: "box", layout: "vertical", contents: body },
      footer: footer(),
    },
  };
}

function infoBody(drug: FdaDrug, ocr: OcrFields): Record<string, unknown>[] {
  const body: Record<string, unknown>[] = [...drugInfoRows(drug)];
  if (ocr.ingredients.length > 0) {
    body.push({
      type: "box",
      layout: "vertical",
      margin: "md",
      contents: [
        { type: "text", text: "สารสำคัญ", size: "sm", color: "#666666" },
        {
          type: "text",
          text: ocr.ingredients.join(", "),
          size: "md",
          wrap: true,
        },
      ],
    });
  }
  return body;
}

/** NORMAL / INFO: drug found, registered, no allergy flags. */
export function templateNormal(drug: FdaDrug, ocr: OcrFields): FlexBubble {
  return bubble(
    "ตรวจสอบยาเรียบร้อย",
    "พบข้อมูลยา",
    "#1DB954",
    [
      ...infoBody(drug, ocr),
      {
        type: "text",
        text: "ยานี้มีทะเบียน อย. และไม่พบข้อมูลที่ขัดแย้งกับประวัติการแพ้ของคุณ",
        size: "sm",
        margin: "md",
        wrap: true,
        color: "#555555",
      },
    ],
  );
}

/** ALLERGY / REG_INACTIVE → REFER with reason. */
export function templateRisk(
  drug: FdaDrug,
  ocr: OcrFields,
  result: ScreeningResult,
): FlexBubble {
  const reasons: string[] = [];
  if (result.flags.includes("ALLERGY")) {
    reasons.push(`ข้อมูลการแพ้ยา (${result.matchedAllergens.join(", ")})`);
  }
  if (result.flags.includes("REG_INACTIVE")) reasons.push("สถานะทะเบียนยา");
  return bubble(
    "พบข้อมูลที่ควรปรึกษาเภสัชกร",
    "พบข้อมูลที่ควรปรึกษาเภสัชกร",
    "#E53935",
    [
      ...infoBody(drug, ocr),
      {
        type: "text",
        text: `พบข้อมูลที่ควรให้เภสัชกรดูก่อนใช้ เนื่องจาก ${reasons.join(" และ ")}`,
        size: "md",
        margin: "md",
        wrap: true,
        color: "#B71C1C",
      },
    ],
  );
}

/** NOT_FOUND → REFER. */
export function templateNotFound(ocr: OcrFields): FlexBubble {
  const name = ocr.trade_name ?? "ผลิตภัณฑ์นี้";
  return bubble(
    "ไม่พบข้อมูลในทะเบียน อย.",
    "ไม่พบข้อมูลในทะเบียน อย.",
    "#E53935",
    [
      {
        type: "text",
        text: `ไม่พบข้อมูลของ ${name} ในฐานข้อมูลทะเบียนยาของ อย. โปรดปรึกษาเภสัชกรหรือตรวจสอบที่ portal.fda.moph.go.th`,
        size: "md",
        wrap: true,
      },
    ],
  );
}

/** LOW_CONFIDENCE → RETAKE. */
export function templateRetake(): FlexBubble {
  return bubble(
    "กรุณาถ่ายรูปใหม่",
    "อ่านภาพไม่ชัด",
    "#F9A825",
    [
      {
        type: "text",
        text: "ไม่สามารถอ่านข้อมูลบนบรรจุภัณฑ์ได้ชัดเจน กรุณาถ่ายภาพใหม่ในที่ที่มีแสงสว่าง โดยให้เลขทะเบียนตำรับยาและชื่อยาเห็นชัดเต็มภาพ",
        size: "md",
        wrap: true,
      },
    ],
  );
}

/** Welcome message on follow. */
export function templateWelcome(liffId: string | undefined): {
  type: "flex";
  altText: string;
  contents: Record<string, unknown>;
} {
  const liffUrl = liffId ? `https://liff.line.me/${liffId}` : null;
  const body: Record<string, unknown>[] = [
    {
      type: "text",
      text: "สวัสดีค่ะ/ครับ ส่งรูปบรรจุภัณฑ์ยาเพื่อตรวจสอบทะเบียน อย. และข้อมูลยา",
      size: "md",
      wrap: true,
    },
    {
      type: "text",
      text: "แนะนำให้ลงทะเบียนข้อมูลการแพ้ยาก่อน เพื่อให้ระบบตรวจสอบได้ครบถ้วน",
      size: "sm",
      margin: "md",
      wrap: true,
      color: "#555555",
    },
  ];
  if (liffUrl) {
    body.push({
      type: "button",
      action: { type: "uri", label: "ลงทะเบียนข้อมูลการแพ้ยา", uri: liffUrl },
      style: "primary",
      color: "#1DB954",
    });
  }
  return bubble("ยินดีต้อนรับ", "ยินดีต้อนรับสู่ PharmCheck", "#1DB954", body);
}

/** Help text for text messages. */
export const HELP_TEXT = `วิธีใช้งาน:
1. ส่งรูปบรรจุภัณฑ์ยา (กล่อง/ฟอยล์) ที่เห็นเลขทะเบียนตำรับยาชัดเจน
2. ระบบจะตรวจสอบทะเบียน อย. และข้อมูลยาให้
3. ลงทะเบียนข้อมูลการแพ้ยาได้จากเมนูด้านล่าง

${DISCLAIMER}`;
