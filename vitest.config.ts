import { defineConfig } from "vitest/config";

/** Vitest config. The Postgres test setup shares a single connection pool
 *  via `ozon_calc_test` (созданный однократно с применёнными миграциями).
 *  Тесты сериализованы через singleFork — между файлами нет параллельности,
 *  чтобы TRUNCATE из beforeEach не конфликтовал. Внутри файла vitest всё
 *  ещё прогоняет тесты последовательно по умолчанию. */
export default defineConfig({
  test: {
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    // Файлы строго последовательно — между файлами TRUNCATE из beforeEach
    // не должен пересекаться с активными транзакциями другого файла. Внутри
    // одного файла vitest по умолчанию выполняет тесты последовательно (без
    // `.concurrent`), что нас устраивает.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
