import ChannelList from "../ChannelList";
import {
  ChannelHeader,
  ComposerRow,
  ErrorBanner,
  FeedRegion,
  InlineThreadPanel,
  SearchRow,
  TypingRow,
} from "./ChatParts";
import type { ChatViewProps } from "./types";

/** Three inline columns: channels (220px) — main feed — thread (360px,
 * conditional). The original ChatPage layout, preserved for desktop. */
export default function DesktopLayout(v: ChatViewProps) {
  return (
    <div
      className="card"
      style={{
        display: "flex",
        gap: 0,
        height: "calc(100vh - 200px)",
        minHeight: 400,
        padding: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          borderRight: "1px solid var(--border, #e2e2e2)",
          background: "var(--bg-soft, #fafafa)",
          // Fixed width — prevents the channel column from growing when
          // the create-form picker opens with long member rows. Inner
          // content gets `min-width: 0` so it ellipses instead of pushing
          // the panel wider.
          width: 240,
          flex: "0 0 240px",
          overflow: "hidden",
        }}
      >
        <ChannelList
          channels={v.channels}
          activeChannelId={v.activeChannelId}
          canManage={v.canManage}
          currentUserId={v.currentUserId}
          workspaceMembers={v.members}
          onlineUsers={v.onlineUsers}
          onSelect={v.onSelectChannel}
          onCreate={v.onCreateChannel}
          onOpenDm={v.onOpenDm}
        />
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <ChannelHeader v={v} />
        <SearchRow v={v} />
        <ErrorBanner v={v} />
        <FeedRegion v={v} />
        <TypingRow v={v} />
        <ComposerRow v={v} />
      </div>
      <InlineThreadPanel v={v} />
    </div>
  );
}
