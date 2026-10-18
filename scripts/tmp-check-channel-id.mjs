import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const resolved =
  env.LIFF_ID?.split("-")[0] ||
  env.NEXT_PUBLIC_LIFF_ID?.split("-")[0] ||
  env.LINE_CHANNEL_ID;

console.log("LIFF_ID            =", env.LIFF_ID);
console.log("NEXT_PUBLIC_LIFF_ID=", env.NEXT_PUBLIC_LIFF_ID);
console.log("LINE_CHANNEL_ID    =", env.LINE_CHANNEL_ID);
console.log("resolved client_id =", resolved);
console.log(
  "consistent         =",
  resolved === env.LIFF_ID?.split("-")[0] && resolved === env.LINE_CHANNEL_ID,
);
