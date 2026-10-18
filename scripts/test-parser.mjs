// Quick parser verification against the exact live SOAP response structure.
import { XMLParser } from "fast-xml-parser";

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
  parseTagValue: false,
});

function findKey(obj, key) {
  if (typeof obj !== "object" || obj === null) return undefined;
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function parseDrugRows(xml) {
  const parsed = xmlParser.parse(xml);
  const envelope = findKey(parsed, "soap:Envelope") ?? parsed;
  const body = findKey(envelope, "soap:Body") ?? envelope;
  const response = findKey(body, "GET_DATA_DRUGResponse") ?? body;
  const result = findKey(response, "GET_DATA_DRUGResult") ?? response;
  const diffgram = findKey(result, "diffgr:diffgram");
  const dataSet =
    (diffgram && findKey(diffgram, "NewDataSet")) ??
    findKey(result, "NewDataSet") ??
    result;
  let rows;
  if (typeof dataSet === "object" && dataSet !== null) {
    for (const [k, v] of Object.entries(dataSet)) {
      if (k.toLowerCase().startsWith("table")) {
        rows = v;
        break;
      }
    }
  }
  if (!rows) return [];
  const list = Array.isArray(rows) ? rows : [rows];
  return list.filter((r) => typeof r === "object" && r !== null);
}

const envelope = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GET_DATA_DRUGResponse xmlns="http://tempuri.org/"><GET_DATA_DRUGResult><diffgr:diffgram xmlns:diffgr="urn:schemas-microsoft-com:xml-diffgram-v1"><NewDataSet xmlns=""><Table1 diffgr:id="Table11"><IDA>8008569</IDA><lcnno>1A123/45</lcnno><productha>เคลียราซิท</productha><produceng>CLEARASIT</produceng><licen>บริษัท ยูเมด้า จำกัด</licen><thanm>บริษัท ยูเมด้า จำกัด</thanm><cncnm>ยกเลิก</cncnm></Table1></NewDataSet></diffgr:diffgram></GET_DATA_DRUGResult></GET_DATA_DRUGResponse></soap:Body></soap:Envelope>`;

const rows = parseDrugRows(envelope);
console.log("rows:", rows.length);
console.log(JSON.stringify(rows, null, 2));
