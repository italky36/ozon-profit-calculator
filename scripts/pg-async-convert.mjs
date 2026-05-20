#!/usr/bin/env node
/** One-shot codemod: converts sync drizzle-sqlite query builders to
 *  drizzle-pg async patterns. Mechanical refactor — run once during the
 *  Postgres cutover, then delete. */
import fs from "node:fs";

const FILES = [
  "server/routes/admin.ts",
  "server/routes/auth.ts",
  "server/routes/chat.ts",
  "server/routes/import.ts",
  "server/routes/workspace.ts",
];

/** Helpers that became async (return Promise). All callers must `await` them. */
const ASYNC_HELPERS = [
  "createSession",
  "validateSession",
  "deleteSession",
  "createVerificationToken",
  "consumeVerificationToken",
  "createPasswordResetToken",
  "checkPasswordResetToken",
  "consumePasswordResetToken",
  "readDefaultTaxSettings",
  "getEmailClient",
  "describeEmailSource",
  "getVapidConfig",
  "getVapidPublicKey",
  "isPushConfigured",
  "ensureDefaultChannel",
  "ensurePersonalWorkspace",
];

const DB_RE = "(?:db|tx|input\\.db|env\\.db|opts\\.db)";

function convert(src) {
  let s = src;

  // Pattern A: `const NAME = db.select(...).get();`
  //   →       `const [NAME] = await db.select(...);`
  s = s.replace(
    new RegExp(
      `const (\\w+) = (${DB_RE}\\b(?:[^;]|\\n)*?)\\.get\\(\\);`,
      "g",
    ),
    "const [$1] = await $2;",
  );

  // Pattern A-await: `const NAME = await db.select(...).get();`
  //   →            `const [NAME] = await db.select(...);`
  s = s.replace(
    new RegExp(
      `const (\\w+) = await (${DB_RE}\\b(?:[^;]|\\n)*?)\\.get\\(\\);`,
      "g",
    ),
    "const [$1] = await $2;",
  );

  // Pattern A2: `let NAME = db.select(...).get();`
  s = s.replace(
    new RegExp(
      `let (\\w+) = (${DB_RE}\\b(?:[^;]|\\n)*?)\\.get\\(\\);`,
      "g",
    ),
    "let [$1] = await $2;",
  );
  s = s.replace(
    new RegExp(
      `let (\\w+) = await (${DB_RE}\\b(?:[^;]|\\n)*?)\\.get\\(\\);`,
      "g",
    ),
    "let [$1] = await $2;",
  );

  // Pattern B: `const NAME = db.select(...).all();`  (multi-row select)
  //   →       `const NAME = await db.select(...);`
  s = s.replace(
    new RegExp(
      `const (\\w+) = (${DB_RE}\\b(?:[^;]|\\n)*?)\\.all\\(\\);`,
      "g",
    ),
    "const $1 = await $2;",
  );
  s = s.replace(
    new RegExp(
      `const (\\w+) = await (${DB_RE}\\b(?:[^;]|\\n)*?)\\.all\\(\\);`,
      "g",
    ),
    "const $1 = await $2;",
  );
  s = s.replace(
    new RegExp(
      `let (\\w+) = (${DB_RE}\\b(?:[^;]|\\n)*?)\\.all\\(\\);`,
      "g",
    ),
    "let $1 = await $2;",
  );
  s = s.replace(
    new RegExp(
      `let (\\w+) = await (${DB_RE}\\b(?:[^;]|\\n)*?)\\.all\\(\\);`,
      "g",
    ),
    "let $1 = await $2;",
  );

  // Pattern C: `db.insert/update/delete(...).run();` (statement, no assignment)
  //   →       `await db.insert/update/delete(...);`
  // Includes multi-line chains.
  s = s.replace(
    new RegExp(
      `(^|\\n)(\\s*)(${DB_RE}\\.(?:insert|update|delete)\\b(?:[^;]|\\n)*?)\\.run\\(\\);`,
      "g",
    ),
    "$1$2await $3;",
  );

  // Pattern D: `.returning({...}).get()` mid-chain isn't covered by A because
  // A's lazy match might end at the first `;`. Handle the standalone case
  // `const N = db.insert(...).returning(...).get();` — already covered by A.

  // Edge: inserts with `.run()` after `.onConflictDoNothing()` etc are caught
  // by C because `.run();` is the terminator.

  // Pattern E: prefix `await ` to calls of helpers that became async.
  // Negative lookbehinds skip: existing `await ` prefix, function declarations
  // (`function FN(` or `async function FN(`), and member access (`.FN(`).
  for (const fn of ASYNC_HELPERS) {
    s = s.replace(
      new RegExp(
        `(^|[^\\w.])(?<!await )(?<!function )(?<!async function )${fn}\\(`,
        "g",
      ),
      `$1await ${fn}(`,
    );
  }

  // Pattern F: hono handlers `(c) => {` containing `await` inside become
  // `async (c) => {`. Only target exact `(c)` arrow signatures (hono handler
  // convention). Extra `async` on a sync handler is harmless — it just makes
  // the handler return a Promise, which Hono handles fine.
  s = s.replace(
    /(?<!async )\(c\) =>/g,
    "async (c) =>",
  );

  return s;
}

let changed = 0;
for (const file of FILES) {
  const before = fs.readFileSync(file, "utf8");
  const after = convert(before);
  if (after !== before) {
    fs.writeFileSync(file, after, "utf8");
    const diff = countDiffLines(before, after);
    console.log(`  ${file}: ${diff} lines changed`);
    changed += 1;
  } else {
    console.log(`  ${file}: no changes`);
  }
}
console.log(`\n${changed} files updated.`);

function countDiffLines(a, b) {
  const al = a.split("\n");
  const bl = b.split("\n");
  let diff = 0;
  const max = Math.max(al.length, bl.length);
  for (let i = 0; i < max; i++) {
    if (al[i] !== bl[i]) diff += 1;
  }
  return diff;
}
