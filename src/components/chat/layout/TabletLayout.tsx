import ChannelList from "../ChannelList";
import Drawer from "../../Drawer";
import ThreadPanel from "../ThreadPanel";
import {
  ChannelHeader,
  ComposerRow,
  ErrorBanner,
  FeedRegion,
  SearchRow,
  TypingRow,
} from "./ChatParts";
import type { ChatViewProps } from "./types";

/** Two inline columns (channels + main); thread becomes a right-side drawer
 * overlay. ChannelList stays at 200px to leave more room for the feed. */
export default function TabletLayout(v: ChatViewProps) {
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
          width: 200,
          flex: "0 0 auto",
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
        <ComposerRow v={v} hideHints={v.isTouch} />
      </div>
      <Drawer
        open={v.threadParentId != null}
        onClose={v.onCloseThread}
        side="right"
        size={Math.min(420, Math.round(window.innerWidth * 0.6))}
      >
        {v.threadParentId != null && v.activeChannel && (
          <ThreadPanel
            parentMessageId={v.threadParentId}
            channelName={v.activeChannel.name}
            currentUserId={v.currentUserId}
            canModerate={v.canManage}
            onlineUsers={v.onlineUsers}
            members={v.members}
            externalUpdates={v.threadUpdates}
            onOpenDm={v.onOpenDm}
            onClose={v.onCloseThread}
          />
        )}
      </Drawer>
    </div>
  );
}
