import { XMLParser } from "fast-xml-parser";

const SOAP_ENDPOINT =
  process.env.FDA_SOAP_ENDPOINT ??
  "http://porta.fda.moph.go.th/FDA_SEARCH_ALL/WS_LICENSE_SEARCH.asmx";
const SOAP_NS = "http://tempuri.org/";
const TIMEOUT_MS = 10_000;

export interface FdaDrug {
  registrationNo: string;
  nameTh: string | null;
  nameEn: string | null;
  status: string | null;
  manufacturer: string | null;
  rawXml: string | null;
}

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
  parseTagValue: false,
});

/** Normalize a Thai FDA registration number for cache keys / comparison. */
export function normalizeRegNo(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[()]/g, "");
}

function buildSoapEnvelope(operation: string, datas: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${operation} xmlns="${SOAP_NS}">
      <DATAS>${escapeXml(datas)}</DATAS>
    </${operation}>
  </soap:Body>
</soap:Envelope>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function callSoap(operation: string, datas: string): Promise<string> {
  const body = buildSoapEnvelope(operation, datas);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(SOAP_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `"${SOAP_NS}${operation}"`,
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`FDA SOAP ${operation} returned HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The SOAP response is an ADO.NET DataSet. Confirmed live schema:
 * <GET_DATA_DRUGResult><xs:schema/><diffgr:diffgram><NewDataSet><Table1>…rows…</Table1></NewDataSet></diffgr:diffgram>
 * Fields: lcnno = registration number, productha/produceng = product name (th/en),
 * thanm = licensee (manufacturer), cncnm = status (e.g. "ยกเลิก" = cancelled),
 * Newcode = FDA internal code, URLs_NEW = detail page.
 */
function parseDrugRows(xml: string): Record<string, string>[] {
  const parsed = xmlParser.parse(xml) as unknown;
  // Descend: soap:Envelope -> soap:Body -> <Operation>Response -> <Operation>Result
  const envelope = findKey(parsed, "soap:Envelope") ?? parsed;
  const body = findKey(envelope, "soap:Body") ?? envelope;
  const response = findKey(body, "GET_DATA_DRUGResponse") ?? body;
  const result = findKey(response, "GET_DATA_DRUGResult") ?? response;
  const diffgram = findKey(result, "diffgr:diffgram");
  const dataSet = (diffgram && findKey(diffgram, "NewDataSet")) ?? findKey(result, "NewDataSet") ?? result;
  // Rows appear under Table1 (or Table) — match any key starting with "table".
  let rows: unknown;
  if (typeof dataSet === "object" && dataSet !== null) {
    for (const [k, v] of Object.entries(dataSet as Record<string, unknown>)) {
      if (k.toLowerCase().startsWith("table")) {
        rows = v;
        break;
      }
    }
  }
  if (!rows) return [];
  const list = Array.isArray(rows) ? rows : [rows];
  return list.filter(
    (r): r is Record<string, string> => typeof r === "object" && r !== null,
  );
}

/** Find a key case-insensitively at one object level. */
function findKey(obj: unknown, key: string): unknown {
  if (typeof obj !== "object" || obj === null) return undefined;
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function mapRowToDrug(row: Record<string, string>): FdaDrug | null {
  const regNo = str(row["lcnno"]) ?? str(row["licen"]) ?? str(row["Newcode"]);
  if (!regNo) return null;
  return {
    registrationNo: regNo,
    nameTh: str(row["productha"]),
    nameEn: str(row["produceng"]),
    status: str(row["cncnm"]),
    manufacturer: str(row["thanm"]) ?? str(row["frgn_name"]),
    rawXml: null,
  };
}

/** Look up a drug by registration number, e.g. "1F 3/55(B)". */
export async function lookupByRegNo(regNo: string): Promise<FdaDrug[]> {
  // The FDA service requires a space between the letter prefix and the number
  // (e.g. "2C 207/28"); OCR may produce either format, so try both.
  const candidates = new Set<string>([regNo]);
  const spaced = regNo.replace(/^(\d{1,2}[A-Z]{1,2})\s*(\d)/i, "$1 $2");
  candidates.add(spaced);
  for (const candidate of candidates) {
    const xml = await callSoap("GET_DATA_DRUG", candidate);
    const drugs = parseDrugRows(xml)
      .map(mapRowToDrug)
      .filter((d): d is FdaDrug => d !== null);
    if (drugs.length > 0) return drugs;
  }
  return [];
}

/** Look up drugs by (English or Thai) trade name. May return many rows. */
export async function lookupByName(name: string): Promise<FdaDrug[]> {
  // GET_DRUG_INFORMATION is broken server-side (missing XML file); GET_DATA_DRUG
  // accepts product names too and does a contains-style match across rows.
  const xml = await callSoap("GET_DATA_DRUG", name);
  return parseDrugRows(xml)
    .map(mapRowToDrug)
    .filter((d): d is FdaDrug => d !== null);
}
