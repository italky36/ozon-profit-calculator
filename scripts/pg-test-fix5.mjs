import fs from "node:fs";
const FILES = [
  "__tests__/server/import.test.ts",
  "__tests__/server/finance-import.test.ts",
];
for (const p of FILES) {
  let s = fs.readFileSync(p, "utf8");
  s = s.replace(/env = setupDb\(\);/g, "env = await setupDb();");
  s = s.replace(/env = setup\(\);/g, "env = await setup();");
  fs.writeFileSync(p, s, "utf8");
  console.log(`  ${p}: ok`);
}
