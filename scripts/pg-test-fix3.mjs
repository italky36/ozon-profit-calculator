import fs from "node:fs";
import path from "node:path";
const TESTS_DIR = "__tests__/server";
const files = fs.readdirSync(TESTS_DIR).filter((f) => f.endsWith(".test.ts"));
let changed = 0;
for (const f of files) {
  const p = path.join(TESTS_DIR, f);
  let s = fs.readFileSync(p, "utf8");
  const before = s;
  // expect(env.db…all()) → expect(await env.db…)
  s = s.replace(
    /expect\(\s*(env\.db\b[^;]*?)\.all\(\)\s*\)/gs,
    "expect(await $1)",
  );
  // expect(env.db…get()) → expect((await env.db…)[0])
  s = s.replace(
    /expect\(\s*(env\.db\b[^;]*?)\.get\(\)\s*\)/gs,
    "expect((await $1)[0])",
  );
  if (s !== before) {
    fs.writeFileSync(p, s, "utf8");
    changed++;
    console.log(`  ${f}: ok`);
  }
}
console.log(`${changed} files`);
