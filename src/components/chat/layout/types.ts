import type {
  ChatChannel,
  ChatMessage,
  WorkspaceMember,
} from "../../../api";


/** Typing presence per-channel per-user. Identity carries the typing
 *  person's display fields for the indicator strip. */
export type TypingByChannel = Map<
  number,
  Map<number, { userId: number; fullName: string; email: string }>
>;

export type ConnectionState = "connecting" | "open" | "closed";

/** Props passed to every concrete layout (Desktop/Tablet/Mobile). Owned by
 * ChatPage which holds the actual state + effects; layouts are pure
 * presentation that arrange the same parts on different breakpoints. */
export interface ChatViewProps {
  currentUserId: number;
  canManage: boolean;
  /** True when this device is touch-first (`(hover: none) or (pointer: coarse)`).
   *  Drives long-press / swipe behavior in MessageItem. */
  isTouch: boolean;

  channels: ChatChannel[];
  activeChannelId: number | null;
  activeChannel: ChatChannel | null;

  messages: ChatMessage[];
  loadingMessages: boolean;
  loadingOlder: boolean;
  hasMore: boolean;
  onlineUsers: Set<number>;
  members: WorkspaceMember[];
  typingByChannel: TypingByChannel;
  connectionState: ConnectionState;

  /** Open thread parent (null = panel closed). */
  threadParentId: number | null;
  /** Recent WS events to merge inside ThreadPanel — see ChatPage. */
  threadUpdates: ChatMessage[];

  searchOpen: boolean;
  error: string | null;

  // — actions —
  onSelectChannel: (id: number) => void;
  onCreateChannel: (
    name: string,
    opts: { isPrivate: boolean; memberIds: number[] },
  ) => Promise<void>;
  onSendText: (text: string) => Promise<void>;
  onSendWithAttachments: (text: string, files: File[]) => Promise<void>;
  onDelete: (id: number) => void;
  onEdit: (id: number, body: string) => Promise<void>;
  onToggleReaction: (messageId: number, emoji: string, mine: boolean) => void;
  onMarkRead: (channelId: number, messageId: number) => void;
  onOpenThread: (messageId: number) => void;
  onCloseThread: () => void;
  onLoadOlder: () => void;
  onTypingStart: () => void;
  onTypingStop: () => void;
  onToggleSearch: () => void;
  onCloseSearch: () => void;
  onClearError: () => void;
  /** Find-or-create a DM with a workspace member and switch the active
   *  channel to it. Triggered from avatar / mention popovers inside
   *  MessageItem. */
  onOpenDm: (userId: number) => void;
  /** Place a call from the channel header. Null when calls are not
   *  available right now (active call already in progress, incoming
   *  banner, archived channel) — ChannelHeader hides the buttons in that
   *  case. */
  onStartCall: ((channelId: number, callType: "audio" | "video") => void) | null;

  /** Currently-staged quote target (Telegram/WhatsApp-style reply). NULL =
   *  no quote, composer shows no banner. */
  quoting: ChatMessage | null;
  /** Stage a message as the inline-quote target. Forwarded to MessageItem
   *  via MessageStream to drive the «Цитировать» action. */
  onQuoteMessage: (message: ChatMessage) => void;
  /** Clear the staged quote. Called from the composer banner's «×». */
  onCancelQuote: () => void;
  /** Monotonic counter — ChatPage bumps after every successful send so the
   *  feed scrolls to the bottom even when the user was up in history (e.g.
   *  scrolled to quote an old message). */
  scrollToBottomToken: number;
}
