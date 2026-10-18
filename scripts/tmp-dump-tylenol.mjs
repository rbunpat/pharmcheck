import { lookupByName } from "../lib/fda.ts";

const r = await lookupByName("Tylenol");
console.log("count", r.length);
for (const d of r) {
  console.log(d.registrationNo, "|", d.nameEn, "|", d.nameTh, "|", d.status);
}
