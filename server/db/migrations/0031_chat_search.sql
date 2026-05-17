-- FTS5 виртуальная таблица для полнотекстового поиска по chat_messages.body.
-- content='chat_messages' + content_rowid='id' — internal storage всё ещё в
-- chat_messages, FTS только индексирует. Триггеры держат индекс в синке.
CREATE VIRTUAL TABLE `chat_messages_fts` USING fts5(
	body,
	content='chat_messages',
	content_rowid='id',
	tokenize='unicode61 remove_diacritics 1'
);
--> statement-breakpoint

-- Backfill индексa из существующих сообщений (для апгрейда existing DB).
INSERT INTO `chat_messages_fts`(`rowid`, `body`)
SELECT `id`, `body` FROM `chat_messages` WHERE `deleted_at` IS NULL;
--> statement-breakpoint

CREATE TRIGGER `chat_messages_ai` AFTER INSERT ON `chat_messages` BEGIN
	INSERT INTO `chat_messages_fts`(`rowid`, `body`) VALUES (new.`id`, new.`body`);
END;
--> statement-breakpoint

CREATE TRIGGER `chat_messages_ad` AFTER DELETE ON `chat_messages` BEGIN
	INSERT INTO `chat_messages_fts`(`chat_messages_fts`, `rowid`, `body`) VALUES('delete', old.`id`, old.`body`);
END;
--> statement-breakpoint

CREATE TRIGGER `chat_messages_au` AFTER UPDATE ON `chat_messages` BEGIN
	INSERT INTO `chat_messages_fts`(`chat_messages_fts`, `rowid`, `body`) VALUES('delete', old.`id`, old.`body`);
	INSERT INTO `chat_messages_fts`(`rowid`, `body`) VALUES (new.`id`, new.`body`);
END;
