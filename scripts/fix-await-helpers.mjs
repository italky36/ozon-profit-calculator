import fs from "node:fs";
const FILES = [
  "__tests__/server/chat-dms.test.ts",
  "__tests__/server/chat-private-channels.test.ts",
];
for (const p of FILES) {
  let s = fs.readFileSync(p, "utf8");
  s = s.replace(
    /^(\s*)joinSameWorkspace\(env, /gm,
    "$1await joinSameWorkspace(env, ",
  );
  // Don't double-add `await await`
  s = s.replace(/await await /g, "await ");
  fs.writeFileSync(p, s, "utf8");
  console.log(`${p}: ok`);
}
