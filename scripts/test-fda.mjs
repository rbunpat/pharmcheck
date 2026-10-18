// One-off script: live-test the Thai FDA SOAP service to pin the response schema.
// Usage: node scripts/test-fda.mjs "1F 3/55(B)"
const endpoint =
  process.env.FDA_SOAP_ENDPOINT ??
  "http://porta.fda.moph.go.th/FDA_SEARCH_ALL/WS_LICENSE_SEARCH.asmx";
const regNo = process.argv[2] ?? "1F 3/55(B)";

const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GET_DATA_DRUG xmlns="http://tempuri.org/">
      <DATAS>${regNo}</DATAS>
    </GET_DATA_DRUG>
  </soap:Body>
</soap:Envelope>`;

const res = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "text/xml; charset=utf-8",
    SOAPAction: '"http://tempuri.org/GET_DATA_DRUG"',
  },
  body: envelope,
});
console.log("HTTP", res.status);
const text = await res.text();
console.log(text.slice(0, 4000));
