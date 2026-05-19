import fs from "node:fs";
const FILES = [
  "server/routes/admin.ts",
  "server/routes/auth.ts",
  "server/routes/chat.ts",
  "server/routes/credentials.ts",
  "server/routes/finance.ts",
  "server/routes/import.ts",
  "server/routes/products.ts",
  "server/routes/shops.ts",
  "server/routes/workspace.ts",
];
for (const f of FILES) {
  let s = fs.readFileSync(f, "utf8");
  const before = s;
  // (await getEmailClient()).send  — fix double-await property access
  s = s.replace(/await getEmailClient\(\)\./g, "(await getEmailClient()).");
  // .changes → .rowCount ?? 0
  s = s.replace(/\.changes\b/g, ".rowCount ?? 0");
  if (s !== before) {
    fs.writeFileSync(f, s, "utf8");
    console.log(`  ${f}: updated`);
  } else {
    console.log(`  ${f}: no changes`);
  }
}
