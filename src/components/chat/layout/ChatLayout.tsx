import { useChatLayout } from "../../../lib/useChatLayout";
import DesktopLayout from "./DesktopLayout";
import TabletLayout from "./TabletLayout";
import MobileLayout from "./MobileLayout";
import type { ChatViewProps } from "./types";

/** Layout dispatcher: picks Desktop / Tablet / Mobile based on viewport
 * width and forwards the same ChatViewProps. The `isTouch` flag is also
 * resolved here and merged into props so children (MessageItem) can switch
 * between hover-icons and long-press menus regardless of size. */
export default function ChatLayout(
  props: Omit<ChatViewProps, "isTouch">,
) {
  const layout = useChatLayout();
  const v: ChatViewProps = { ...props, isTouch: layout.isTouch };
  if (layout.mode === "desktop") return <DesktopLayout {...v} />;
  if (layout.mode === "tablet") return <TabletLayout {...v} />;
  return <MobileLayout {...v} />;
}
