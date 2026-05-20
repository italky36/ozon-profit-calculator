#!/usr/bin/env node
/** Codemod #2: конвертирует __tests__/server/*.ts из sync sqlite-стиля
 *  в async PG-стиль. После прогона ожидаем зелёный tsc.
 *
 *  Что делается:
 *  1. const X = db…get(); → const [X] = await db…;
 *  2. const X = db…all(); → const X = await db…;
 *  3. db.insert/update/delete(…).run(); → await db.insert/update/delete(…);
 *  4. setupTestEnv() (без await) → await setupTestEnv()
 *  5. teardownTestEnv(env) → await teardownTestEnv(env)
 *  6. createUserDirect/createShopFor/workspaceIdOf/adminSessionCookie — await
 *  7. (с учётом, что эти вызовы внутри async-функций vitest — beforeEach/it). */
import fs from "node:fs";
import path from "node:path";

const TESTS_DIR = "__tests__/server";

const DB_RE = "(?:db|tx|env\\.db|opts\\.db|sqlite|s)";

const ASYNC_HELPERS_TEST = [
  "setupTestEnv",
  "teardownTestEnv",
  "createUserDirect",
  "createShopFor",
  "workspaceIdOf",
  "adminSessionCookie",
];

function convert(src) {
  let s = src;

  // Pattern A: const NAME = db…get();  (single-statement assignment)
  s = s.replace(
    new RegExp(
      `const (\\w+) = (${DB_RE}\\b[^;]*?)\\.get\\(\\)(?:!)?;`,
      "gs",
    ),
    "const [$1] = await $2;",
  );
  s = s.replace(
    new RegExp(
      `const (\\w+) = await (${DB_RE}\\b(?:[^;]|\\n)*?)\\.get\\(\\);`,
      "g",
    ),
    "const [$1] = await $2;",
  );
  s = s.replace(
    new RegExp(
      `let (\\w+) = (${DB_RE}\\b(?:[^;]|\\n)*?)\\.get\\(\\);`,
      "g",
    ),
    "let [$1] = await $2;",
  );

  // Pattern B: const NAME = db…all();
  s = s.replace(
    new RegExp(`const (\\w+) = (${DB_RE}\\b[^;]*?)\\.all\\(\\);`, "gs"),
    "const $1 = await $2;",
  );
  s = s.replace(
    new RegExp(
      `const (\\w+) = await (${DB_RE}\\b(?:[^;]|\\n)*?)\\.all\\(\\);`,
      "g",
    ),
    "const $1 = await $2;",
  );

  // Pattern C: db.insert/update/delete(…).run();
  // Allow whitespace/newline between DB ref and the method (Drizzle chains
  // often look like `env.db\n  .insert(...)\n  .run();`).
  s = s.replace(
    new RegExp(
      `(^|\\n)(\\s*)(${DB_RE}\\s*\\.(?:insert|update|delete)\\b(?:[^;]|\\n)*?)\\.run\\(\\);`,
      "g",
    ),
    "$1$2await $3;",
  );

  // Pattern D: await on async helpers (no double-await, no function decls)
  for (const fn of ASYNC_HELPERS_TEST) {
    s = s.replace(
      new RegExp(
        `(^|[^\\w.])(?<!await )(?<!function )(?<!async function )${fn}\\(`,
        "g",
      ),
      `$1await ${fn}(`,
    );
  }

  // Pattern E: vitest lifecycle callbacks `(beforeEach|afterEach|beforeAll|
  // afterAll)\(() => …)`. Convert sync arrow to async.
  s = s.replace(
    /(beforeEach|afterEach|beforeAll|afterAll)\((\s*)\(\)\s*=>/g,
    "$1($2async () =>",
  );

  // Pattern F: `it("name", () => { … await … })` — make the callback async.
  // Match arrow with optional whitespace; don't double-async.
  s = s.replace(
    /(\b(?:it|test)\([^,]+,\s*)\(\)\s*=>/g,
    "$1async () =>",
  );

  // Pattern G: `() => { ... await ... }` inside test code blocks remains.
  // Best-effort: scan each `() => {` block; if it contains `await`, prepend
  // `async`. Two-pass: split by `() => {` markers and inspect each.
  // For simplicity here, we skip this pass — manual fixup is OK for the few
  // helper functions that use arrow syntax.

  return s;
}

const files = fs.readdirSync(TESTS_DIR).filter((f) => f.endsWith(".test.ts"));
let changed = 0;
for (const f of files) {
  const p = path.join(TESTS_DIR, f);
  const before = fs.readFileSync(p, "utf8");
  const after = convert(before);
  if (after !== before) {
    fs.writeFileSync(p, after, "utf8");
    changed += 1;
    console.log(`  ${p}: updated`);
  }
}
console.log(`\n${changed} test files updated.`);
