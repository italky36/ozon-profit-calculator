-- Full-text search для chat_messages на Postgres tsvector + GIN.
-- Заменяет SQLite FTS5-virtual-table из 0031_chat_search.sql (legacy SQLite).
--
-- `search_vector` — STORED generated column: Postgres сам пересчитывает её
-- при INSERT/UPDATE.body, никаких триггеров и приложение-кода. Конфиг
-- `russian` — стандартный pg_catalog dictionary; для лучшей токенизации
-- кириллицы в продакшне можно подключить `russian_morphology` (плагин).
ALTER TABLE chat_messages
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('russian', coalesce(body, ''))) STORED;
--> statement-breakpoint
CREATE INDEX chat_messages_search_vector_idx
  ON chat_messages USING GIN (search_vector);
