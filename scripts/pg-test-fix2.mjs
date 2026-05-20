import fs from "node:fs";
import { glob } from "node:fs/promises";
const files = ["__tests__/server/password-reset.test.ts", "__tests__/server/shop-access-matrix.test.ts", "__tests__/server/workspace-suspend.test.ts"];
for (const f of files) {
  let s = fs.readFileSync(f, "utf8");
  // const X = db…get()!.PROP → const X = (await db…)[0]!.PROP
  s = s.replace(
    /const (\w+) = (env\.db\b[^;]*?)\.get\(\)!\.(\w+);/gs,
    "const $1 = (await $2)[0]!.$3;",
  );
  // multiline .get()!.X (no `const X = ` prefix)
  s = s.replace(
    /(env\.db\b[\s\S]*?)\n\s*\.get\(\)!\.(\w+);/g,
    "(await $1)[0]!.$2;",
  );
  fs.writeFileSync(f, s, "utf8");
  console.log(`  ${f}: ok`);
}
