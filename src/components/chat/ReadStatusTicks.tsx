import type { WorkspaceMember } from "../../api";
import { Check } from "lucide-react";

interface Props {
  /** UserIds (без автора) которые пометили сообщение прочитанным. */
  readerUserIds: number[];
  /** Сколько других members в workspace (всего минус автор). 0 — соло
   *  workspace, индикатор не рисуется. */
  otherMembersCount: number;
  /** Полный список members для tooltip'а «прочитано: …». */
  members: WorkspaceMember[];
  /** Автор сообщения — фильтруется из роста при сборке tooltip'а. */
  authorUserId: number;
}

const GREY = "var(--muted, #8a8a8a)";
const GREEN = "#22c55e";

/** WhatsApp-style status ticks under an own message:
 *   ✓        (1 серая) — отправлено, никто другой не прочитал
 *   ✓✓       (2 серых) — прочитал хотя бы один, но не все
 *   ✓✓ green (2 зелёных) — прочитали все другие members команды
 *
 * Решение «по всем members workspace'а» — упрощение для групповых каналов.
 * В DM (Stage 3) это совпадает с классическим WhatsApp; в большой команде
 * «зелёное» будет достигаться редко — это и норма, на фоне «прочитал
 * половина» сразу видно, что сообщение действительно увидели все. */
export default function ReadStatusTicks({
  readerUserIds,
  otherMembersCount,
  members,
  authorUserId,
}: Props) {
  if (otherMembersCount <= 0) return null;

  const readersCount = readerUserIds.length;
  const readByAll = readersCount >= otherMembersCount;
  const delivered = readersCount > 0;

  const color = readByAll ? GREEN : GREY;
  const showSecond = delivered;

  // Tooltip — компактный список имён прочитавших или «никто пока не открыл».
  const roster = new Map(members.map((m) => [m.userId, m]));
  const readers = readerUserIds
    .map((id) => roster.get(id))
    .filter((m): m is WorkspaceMember => m != null);
  const total = otherMembersCount;
  const tooltip = !delivered
    ? "Отправлено · никто ещё не открыл"
    : readByAll
      ? `Прочитано всеми (${readersCount}/${total}): ${readers.map((m) => m.fullName || m.email.split("@")[0]).join(", ")}`
      : `Прочитано ${readersCount} из ${total}: ${readers.map((m) => m.fullName || m.email.split("@")[0]).join(", ")}`;

  // Suppress unused-var lint when authorUserId isn't strictly needed for
  // current rendering — kept in the API for future DM-specific tweaks.
  void authorUserId;

  return (
    <span
      aria-label={tooltip}
      title={tooltip}
      style={{
        display: "inline-flex",
        alignItems: "center",
        position: "relative",
        // Reserve width for two overlapping ticks even when only one is shown
        // — prevents reactions-bar jumping when status advances 1→2 ticks.
        width: 18,
        height: 12,
        flex: "0 0 auto",
        verticalAlign: "middle",
      }}
    >
      <Check
        size={11}
        strokeWidth={2.5}
        color={color}
        style={{ position: "absolute", left: 0, top: 0 }}
      />
      {showSecond && (
        <Check
          size={11}
          strokeWidth={2.5}
          color={color}
          style={{ position: "absolute", left: 6, top: 0 }}
        />
      )}
    </span>
  );
}
