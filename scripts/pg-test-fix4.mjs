import fs from "node:fs";
import path from "node:path";
const FILES = [
  "__tests__/server/import.test.ts",
  "__tests__/server/finance-import.test.ts",
];
for (const p of FILES) {
  let s = fs.readFileSync(p, "utf8");
  // env.sqlite.close() → teardownTestEnv(env)
  s = s.replace(
    /env\.sqlite\.close\(\)/g,
    "await teardownTestEnv(env)",
  );
  // afterEach(() => env.sqlite.close()) → afterEach(async () => await teardownTestEnv(env))
  s = s.replace(
    /afterEach\(\(\) => env\.sqlite\.close\(\)\)/g,
    "afterEach(async () => { await teardownTestEnv(env); })",
  );
  // buildApp({ db: env.db }) → env.app
  s = s.replace(/buildApp\(\{\s*db:\s*env\.db\s*\}\)/g, "env.app");
  fs.writeFileSync(p, s, "utf8");
  console.log(`  ${p}: ok`);
}
