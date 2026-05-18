/** Helpers for post-call housekeeping: human-readable text for the system
 * chat message and the missed-call push payload. The actual DB-insert /
 * publish flow lives in the route (server/routes/chat.ts) so it can reuse
 * the route's loadMessageOut helper. */

import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { users } from "../db/schema";
import { sendPushToUsers, type PushPayload } from "../lib/webPush";
import type { CallType, EndReason } from "./calls";

export interface CallEndSummary {
  callId: number;
  channelId: number;
  workspaceId: number;
  callType: CallType;
  initiatorUserId: number;
  inviteeUserIds: number[];
  startedAt: Date;
  endedAt: Date;
  reason: EndReason;
}

function formatDuration(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return `${secs} с`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m} мин ${s} с` : `${m} мин`;
}

export function callSystemMessageBody(s: CallEndSummary): string {
  const kind = s.callType === "video" ? "Видеозвонок" : "Аудиозвонок";
  switch (s.reason) {
    case "missed":
      return `${kind}: пропущенный`;
    case "declined":
      return `${kind}: отклонён`;
    case "failed":
      return `${kind}: ошибка соединения`;
    case "completed":
      return `${kind}: ${formatDuration(s.endedAt.getTime() - s.startedAt.getTime())}`;
  }
}

/** Send a missed-call push to the invitees who never picked up. Audience =
 * invitees minus initiator. Each gets one push with a deep-link to the
 * call's channel. */
export async function pushMissedCall(
  db: DB,
  summary: CallEndSummary,
  appUrl: string,
): Promise<void> {
  const targets = summary.inviteeUserIds.filter(
    (u) => u !== summary.initiatorUserId,
  );
  if (targets.length === 0) return;
  const initiator = db
    .select({ fullName: users.fullName, email: users.email })
    .from(users)
    .where(eq(users.id, summary.initiatorUserId))
    .get();
  const initiatorName =
    initiator?.fullName || initiator?.email.split("@")[0] || "—";
  const kind = summary.callType === "video" ? "видеозвонок" : "аудиозвонок";
  const payload: PushPayload = {
    title: `Пропущенный ${kind}`,
    body: `${initiatorName} звонил${summary.callType === "video" ? " (видео)" : ""}`,
    url: `${appUrl}/?chat=1&channel=${summary.channelId}`,
    tag: `call-missed-${summary.channelId}`,
    data: {
      type: "missed-call",
      channelId: summary.channelId,
      callId: summary.callId,
    },
  };
  await sendPushToUsers(db, targets, payload);
}
