import { eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  chatMessageMentions,
  users,
  workspaceMembers,
} from "../db/schema";

/** Allowed mention syntax: `@token`, where token is 2..40 chars of
 * latin/cyrillic letters/digits/underscore/dot/dash. Resolves loosely:
 *   - by case-insensitive email prefix,
 *   - by case-insensitive collapsed fullName ("Иван Петров" matches "@иван.петров"
 *     and "@иванпетров" via the same normalization).
 *
 * Unresolved tokens are silently dropped — UI gets only confirmed userIds. */
const MENTION_RE = /@([\p{L}\p{N}_.-]{2,40})/gu;

export function parseMentionTokens(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) {
    seen.add(m[1].toLowerCase());
  }
  return [...seen];
}

/** Normalize: lowercase, strip spaces/dashes/dots/underscores. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s._-]+/g, "");
}

export async function resolveMentions(
  db: DB,
  workspaceId: number,
  body: string,
): Promise<number[]> {
  const tokens = parseMentionTokens(body);
  if (tokens.length === 0) return [];
  // Workspace candidates only — mentions are scoped to the team.
  const candidates = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
    })
    .from(users)
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId));
  const normalizedTokens = new Set(tokens.map(normalize));
  const out = new Set<number>();
  for (const c of candidates) {
    const emailKey = normalize(c.email.split("@")[0] ?? "");
    const nameKey = normalize(c.fullName);
    if (
      (emailKey && normalizedTokens.has(emailKey)) ||
      (nameKey && normalizedTokens.has(nameKey))
    ) {
      out.add(c.id);
    }
  }
  return [...out];
}

/** For MessageOut: get short info per mentioned user (id + display name). */
export async function loadMentionsForMessages(
  db: DB,
  messageIds: number[],
): Promise<
  Map<number, Array<{ userId: number; name: string; email: string }>>
> {
  const out = new Map<
    number,
    Array<{ userId: number; name: string; email: string }>
  >();
  if (messageIds.length === 0) return out;
  const rows = await db
    .select({
      messageId: chatMessageMentions.messageId,
      userId: chatMessageMentions.userId,
      email: users.email,
      fullName: users.fullName,
    })
    .from(chatMessageMentions)
    .innerJoin(users, eq(users.id, chatMessageMentions.userId))
    .where(inArray(chatMessageMentions.messageId, messageIds));
  for (const r of rows) {
    const arr = out.get(r.messageId) ?? [];
    arr.push({
      userId: r.userId,
      name: r.fullName || r.email.split("@")[0] || `user${r.userId}`,
      email: r.email,
    });
    out.set(r.messageId, arr);
  }
  return out;
}
