import { useEffect, useState } from "react";
import ChannelList from "../ChannelList";
import Drawer from "../../Drawer";
import ThreadPanel from "../ThreadPanel";
import {
  ChannelHeader,
  ComposerRow,
  ErrorBanner,
  FeedRegion,
  HamburgerButton,
  SearchRow,
  TypingRow,
} from "./ChatParts";
import type { ChatViewProps } from "./types";

/** Single-view: only the active channel is visible. ChannelList opens via
 * the hamburger as a left drawer, ThreadPanel as a bottom-sheet drawer
 * (~85vh). After selecting a channel the drawer auto-closes. */
export default function MobileLayout(v: ChatViewProps) {
  const [channelsOpen, setChannelsOpen] = useState(false);

  // Auto-close the channels drawer when the active channel changes (i.e.
  // the user picked something). Without this, the drawer would sit on top
  // of the new channel until they tap the backdrop.
  useEffect(() => {
    if (channelsOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChannelsOpen(false);
    }
    // We intentionally only react to activeChannelId; channelsOpen in deps
    // would create a loop when user closes manually.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.activeChannelId]);

  return (
    <div
      className="card"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 160px)",
        minHeight: 400,
        padding: 0,
        overflow: "hidden",
      }}
    >
      <ChannelHeader
        v={v}
        leftSlot={<HamburgerButton onClick={() => setChannelsOpen(true)} />}
      />
      <SearchRow v={v} />
      <ErrorBanner v={v} />
      <FeedRegion v={v} />
      <TypingRow v={v} />
      <ComposerRow v={v} hideHints />

      <Drawer
        open={channelsOpen}
        onClose={() => setChannelsOpen(false)}
        side="left"
        size={280}
        title="Каналы"
      >
        <ChannelList
          channels={v.channels}
          activeChannelId={v.activeChannelId}
          canManage={v.canManage}
          currentUserId={v.currentUserId}
          workspaceMembers={v.members}
          onlineUsers={v.onlineUsers}
          onSelect={(id) => {
            v.onSelectChannel(id);
            setChannelsOpen(false);
          }}
          onCreate={v.onCreateChannel}
          onOpenDm={v.onOpenDm}
        />
      </Drawer>

      <Drawer
        open={v.threadParentId != null}
        onClose={v.onCloseThread}
        side="bottom"
        size="85vh"
        showDragHandle
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
