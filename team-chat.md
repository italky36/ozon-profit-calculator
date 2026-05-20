# Per-workspace chat with file attachments

## Context

Команды (workspace) хотят общаться внутри приложения: текстовые сообщения и пересылка файлов между участниками. Изоляция между workspace'ами критична (как в `credentials-isolation.test.ts`). Сейчас в проекте нет real-time транспорта и нет записи файлов на диск — решения принимаются с нуля, не блокируя будущий переезд на Postgres + S3-compatible.

## Scope

**В MVP:**
- Несколько каналов на workspace (default `#общий`).
- Текстовые сообщения, URL auto-link.
- Вложения (изображения, документы).
- Real-time доставка через **WebSocket**.
- История с cursor-пагинацией по `created_at DESC`.
- Удаление: автор или owner/manager.
- Cross-workspace изоляция (тесты).

**Не в MVP:** read-receipts, typing, presence, реакции, threads, упоминания, push, поиск, edit (только delete), 1-на-1, WebRTC.

## ADR-1: WebSocket

Выбран против SSE / polling:
- Запас под typing/presence/read-receipts без смены транспорта.
- Один коннект на клиента (приём + отправка).
- Phantom-доставка без сторонних библиотек.

Нужно:
- Зависимости: `@hono/node-ws`, `ws`, `@types/ws`.
- `vite.config.ts:14-16` → добавить `ws: true` в `/api` proxy.
- В `server/index.ts` использовать `serve()` + `injectWebSocket(server)` из `@hono/node-ws`.

Trade-offs:
- WebSocket в браузере **не переподключается сам** → свой `ChatSocket` с reconnect-with-backoff на клиенте.
- Sticky-session: пока single-node неактуально; при scale-out понадобится Redis Pub/Sub или Postgres LISTEN.

## ADR-2: File storage — local FS + S3-готовая абстракция

Хранилище: `data/uploads/{workspaceId}/{yyyy-mm}/{attachmentId}_{safeName}` за интерфейсом `FileStorage`. Workspace-изоляция через путь + authed download endpoint, который сверяет workspaceId.

`.gitignore`: добавить `data/uploads/`.

Лимиты:
- ≤ 25 MB на файл.
- Whitelist MIME: `image/*`, `application/pdf`, `application/zip`, MS Office (.docx/.xlsx/.pptx), `text/plain`, `text/csv`.
- Filename sanitization: random ID prefix + safe basename.

При переходе на Postgres + S3-compatible: новая реализация `FileStorage`, роуты не меняются.

## DB schema

Миграция `server/db/migrations/0028_chat.sql` (после 0027):

```sql
CREATE TABLE chat_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  archived_at INTEGER
);
CREATE INDEX chat_channels_workspace ON chat_channels(workspace_id);

CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  deleted_at INTEGER
);
CREATE INDEX chat_messages_channel_created ON chat_messages(channel_id, created_at DESC);

CREATE TABLE chat_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX chat_attachments_message ON chat_attachments(message_id);
```

Backfill: для каждого существующего workspace создать `#общий` (миграция SQL или идемпотентный seed в `openDb`).

Drizzle модели зеркально в `server/db/schema.ts`.

## Backend

Новые модули:
- `server/storage/fileStorage.ts` — интерфейс + `LocalFileStorage` (root `data/uploads/`). Методы: `put(key, stream, meta)`, `read(key)`, `delete(key)`, `stat(key)`.
- `server/chat/pubsub.ts` — in-memory event bus. `subscribe(workspaceId, cb): unsubscribe`, `publish(workspaceId, event)`. `Map<workspaceId, Set<callback>>`.
- `server/routes/chat.ts` — все роуты `/api/chat/*` + WS upgrade.

Все требуют `requireAuth`. Все проверяют что задействованный `channelId/messageId/attachmentId` принадлежит `user.workspaceId` (паттерн `userCanAccessShop` из `server/middleware/session.ts:154`).

| Метод | Путь | Гейт | Назначение |
|---|---|---|---|
| GET | `/api/chat/channels` | member | Список каналов workspace |
| POST | `/api/chat/channels` | `canManageWorkspace` | Создать канал |
| PATCH | `/api/chat/channels/:id` | owner/manager + чужой workspace → 404 | Переименовать / архивировать |
| GET | `/api/chat/channels/:id/messages?before=<ts>&limit=50` | member канала | История, cursor pagination |
| POST | `/api/chat/channels/:id/messages` | member канала | Отправить JSON `{ body }` |
| POST | `/api/chat/channels/:id/messages/with-attachments` | member канала | multipart: `body?` + `file` × N |
| DELETE | `/api/chat/messages/:id` | автор OR owner/manager | Soft-delete (`deleted_at`) + FS-delete вложений в фоне |
| GET | `/api/chat/attachments/:id` | member workspace сообщения | Стрим файла через `FileStorage.read(key)` |
| GET | `/api/chat/ws` (upgrade) | member | WS-подписка на pub/sub workspace |

### WebSocket-эндпоинт

В `server/index.ts`:

```ts
import { createNodeWebSocket } from "@hono/node-ws";
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
const server = serve({ fetch: app.fetch, port, hostname });
injectWebSocket(server);
```

В `chat.ts`:

```ts
app.get("/ws", requireAuth, upgradeWebSocket((c) => {
  const user = c.get("user");
  let unsub: (() => void) | null = null;
  return {
    onOpen(_, ws) {
      unsub = pubsub.subscribe(user.workspaceId, (evt) =>
        ws.send(JSON.stringify(evt)),
      );
    },
    onMessage(evt, ws) {
      const msg = JSON.parse(String(evt.data));
      if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
    },
    onClose() { unsub?.(); },
    onError() { unsub?.(); },
  };
}));
```

`requireAuth` срабатывает на HTTP-этапе upgrade; `user.workspaceId` фиксируется в замыкании → прыгнуть в чужой workspace в рамках коннекта невозможно.

Sysadmin scope чата не касается.

## Frontend

Новая таб `"chat"` в `src/App.tsx:111`. Условный рендер `<ChatPage />`.

### Компоненты

- `src/components/chat/ChatPage.tsx` — оркестратор.
- `src/components/chat/ChannelList.tsx` — список каналов, кнопка «+» для owner/manager.
- `src/components/chat/MessageStream.tsx` — `overflow:auto` div, подгрузка истории при скролле вверх.
- `src/components/chat/MessageItem.tsx` — автор, время, тело (linkify), кнопка удалить, вложения.
- `src/components/chat/Composer.tsx` — textarea + attach + drop-zone + paste для screenshots. Enter — отправить, Shift+Enter — newline.
- `src/components/chat/Attachment.tsx` — иконка по MIME, размер, ссылка скачать.

### API клиент

`src/api/index.ts`: `api.chat.{ listChannels, createChannel, listMessages, sendMessage, sendMessageWithAttachments, deleteMessage, attachmentUrl }`. Multipart через `apiUpload` (`src/api/index.ts:187`).

### WebSocket клиент

`src/lib/chatSocket.ts` — тонкая обёртка с reconnect-with-backoff (1s → 2s → 5s → 10s + jitter):

```ts
export class ChatSocket {
  private ws: WebSocket | null = null;
  private retry = 0;
  private stopped = false;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  constructor(private onEvent: (e: ChatServerEvent) => void) {}
  start() { /* ... */ }
  stop() { /* ... */ }
}
```

В `ChatPage` mount-effect:
```ts
const sock = new ChatSocket((evt) => { /* update state */ });
sock.start();
return () => sock.stop();
```

`vite.config.ts:14-16`:
```ts
proxy: { "/api": { target, changeOrigin: false, ws: true } },
```

Cookie-auth прокидывается на handshake автоматически.

## Тесты

Новый `__tests__/server/chat.test.ts`:

1. **Изоляция cross-workspace** (зеркало `credentials-isolation.test.ts`):
   - A's user не может прочитать каналы/сообщения/вложения workspace B → 404.
   - WS-стрим A не получает events workspace B.
   - GET `/api/chat/attachments/:id` чужого workspace → 404.

2. **Авторизация:**
   - Member удаляет только своё.
   - Owner/manager удаляет любое в workspace.
   - Создание канала — owner/manager.

3. **Вложения:**
   - >25 MB → 413.
   - Mime вне whitelist → 415.
   - Имя файла санитизируется (тест на `../`).

4. **Лента:**
   - История корректно пагинируется через `before=<ts>`.
   - Soft-deleted сообщение остаётся в ленте с пометкой.

5. **Pub/sub:**
   - unit-тест: `subscribe(ws1, cb1); subscribe(ws2, cb2); publish(ws1); cb1 called, cb2 not`.
   - integration: WS-коннект → POST сообщения в том же workspace → event приходит в стрим.
   - WS без cookie → upgrade отклонён.

## Критические файлы

| Файл | Действие |
|---|---|
| `package.json` | Добавить `@hono/node-ws`, `ws`, `@types/ws` |
| `server/db/migrations/0028_chat.sql` | Новый |
| `server/db/migrations/meta/_journal.json` | +entry 28 |
| `server/db/schema.ts` | `chatChannels`, `chatMessages`, `chatAttachments` |
| `server/storage/fileStorage.ts` | Новый |
| `server/chat/pubsub.ts` | Новый |
| `server/routes/chat.ts` | Новый + WS upgrade |
| `server/index.ts` | `injectWebSocket(server)` + mount `app.route("/api/chat", ...)` |
| `vite.config.ts:14-16` | `ws: true` |
| `src/api/index.ts` | `api.chat.*` |
| `src/lib/chatSocket.ts` | Новый |
| `src/App.tsx:111-138` | Таб `"chat"` |
| `src/components/chat/*` | Все компоненты |
| `.gitignore` | `data/uploads/` |
| `__tests__/server/chat.test.ts` | Новый |

## Reuse

- `canManageWorkspace` (`server/middleware/session.ts:117`).
- Паттерн `userCanAccessShop` (`session.ts:154`) → новый `userCanAccessChannel`.
- `__tests__/server/_helpers.ts`, `credentials-isolation.test.ts` — каркас тестов изоляции.
- `server/routes/refs.ts:251-297` — паттерн multipart (FormData + arrayBuffer).
- `src/api/index.ts:187` `apiUpload` — клиентский multipart helper.

## Verification

1. `npm install` (после правки `package.json`).
2. `npx vitest run __tests__/server/chat.test.ts` — все зелёные. Полный сьют — 0 регрессий.
3. `npm run build` — чистый.
4. `npm run dev`:
   - Две вкладки/два юзера одной команды → сообщение из одной мгновенно в другой (WS frame).
   - DevTools → Network → WS: один открытый коннект к `/api/chat/ws`, frames при отправке.
   - Картинка <5MB → загружается, превью, скачивание.
   - Третий юзер другого workspace → пустой чат, в его WS нет events первой пары.
   - Сеть 5 сек down → `chatSocket` переподключается с backoff.
5. Удалить workspace через sysadmin → `chat_channels/messages/attachments` каскадно зачищены. FS-файлы остаются (technical debt, отдельная задача).
6. >25MB upload → UI ошибка, сервер 413.
