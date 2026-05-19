-- Workspace chat: каналы, сообщения, вложения. Изоляция между workspace'ами
-- — на уровне FK от chat_channels.workspace_id → workspaces.id (ON DELETE
-- CASCADE). Сообщения и вложения наследуют изоляцию через channel_id.
CREATE TABLE `chat_channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` integer NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT 0 NOT NULL,
	-- created_by nullable so deleting the creating user (через sysadmin
	-- delete-account) не блокирует FK. История сохраняется без автора.
	`created_by` integer,
	`created_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chat_channels_workspace` ON `chat_channels` (`workspace_id`);
--> statement-breakpoint

-- Сообщения: body может быть пустым, когда сообщение состоит из одних
-- вложений (`body = ''`). edited_at и deleted_at — soft-edit/soft-delete.
CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` integer NOT NULL,
	-- author_user_id nullable: keeps message history readable после удаления
	-- автора (UI рендерит «удалённый пользователь»). Без этого FK блокирует
	-- sysadmin'у удаление аккаунта.
	`author_user_id` integer,
	`body` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`channel_id`) REFERENCES `chat_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chat_messages_channel_created` ON `chat_messages` (`channel_id`, `created_at` DESC);
--> statement-breakpoint

-- Вложения. storage_key — путь внутри FileStorage (для LocalFileStorage:
-- "{workspaceId}/{yyyy-mm}/{attachmentId}_{safeName}"). При DELETE CASCADE
-- здесь удаляется только метаданные — физические файлы чистит роут.
CREATE TABLE `chat_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` integer NOT NULL,
	`storage_key` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_attachments_message` ON `chat_attachments` (`message_id`);
--> statement-breakpoint

-- Backfill: для каждого существующего workspace создаём дефолтный канал
-- «общий». created_by — первый owner команды (он гарантированно есть после
-- миграции 0019). Идемпотентность не нужна — миграция выполняется один раз.
INSERT INTO `chat_channels` (`workspace_id`, `name`, `is_default`, `created_by`, `created_at`)
SELECT
	w.id,
	'общий',
	1,
	(SELECT user_id FROM workspace_members WHERE workspace_id = w.id AND role = 'owner' ORDER BY created_at LIMIT 1),
	(unixepoch() * 1000)
FROM `workspaces` w
WHERE EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = w.id AND role = 'owner');
