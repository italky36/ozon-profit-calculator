import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { chatChannels } from "../db/schema";

const DEFAULT_CHANNEL_NAME = "общий";

/** Idempotent: ensure the workspace has a default («общий») channel.
 * Migration 0028 backfills this for existing workspaces; this helper handles
 * workspaces created at runtime (registration, admin-created teams). */
export async function ensureDefaultChannel(
  db: DB,
  workspaceId: number,
  createdBy: number,
  now: Date = new Date(),
): Promise<void> {
  const [existing] = await db
    .select({ id: chatChannels.id })
    .from(chatChannels)
    .where(
      and(
        eq(chatChannels.workspaceId, workspaceId),
        eq(chatChannels.isDefault, true),
      ),
    );
  if (existing) return;
  await db.insert(chatChannels).values({
    workspaceId,
    name: DEFAULT_CHANNEL_NAME,
    isDefault: true,
    createdBy,
    createdAt: now,
  });
}
