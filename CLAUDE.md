# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Калькулятор прибыли продавца Ozon — full-stack приложение: фронт React + TypeScript + Vite, бэкенд Node + Hono + Drizzle поверх SQLite. Сравнивает три схемы поставки (FBO / FBS / realFBS) по марже, рентабельности и налогам, импортирует каталог и финансы из Ozon Seller API, считает «прогноз vs факт» по реальным операциям. Подробные формулы — в `README.md`. Описание UI — в `UI.md`.

## Commands

```bash
# Dev: vite + backend разом через concurrently
npm run dev               # http://localhost:5173 (vite) + http://localhost:3001 (api)
npm run dev:web           # только vite
npm run dev:api           # только tsx watch server/index.ts

# Build + проверки
npm run build             # tsc -b (3 проекта: app/node/server) → vite build
npm run lint              # eslint .
npm test                  # vitest run (один прогон, 64+ тестов)
npm run test:watch        # vitest в watch-режиме

# DB (Drizzle + better-sqlite3, файл data/app.db)
npm run db:generate       # drizzle-kit generate (после правки server/db/schema.ts)
npm run db:migrate        # drizzle-kit migrate (обычно не нужно — runtime сам мигрирует)
npm run db:seed           # default tax settings + эталон-кофемашина (если БД пустая)
npm run db:extract        # Excel → SQLite ref_* таблицы
                          # путь к Excel: EXTRACT_SOURCE=… npm run db:extract

# Таргетные тесты
npx vitest run __tests__/calc.test.ts
npx vitest run -t "matches Excel reference within tolerance"
npx vitest run __tests__/server/         # все backend-тесты
```

## Запуск с нуля

1. `cp .env.example .env`, прописать `AUTH_TOKEN` (генератор: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`) — то же значение в `VITE_AUTH_TOKEN`.
2. `npm run db:seed` — создаст `data/app.db` и засеет начальные данные.
3. `npm run db:extract` — наполнит `ref_*` справочники из Excel (требуется `C:/Users/admin/Downloads/Техника — копия2.xlsx` или `EXTRACT_SOURCE=…`).
4. `npm run dev`. Фронт ходит в `/api/*` через Vite-прокси (`SERVER_URL`, по умолчанию `http://localhost:3001`).

## Architecture

### Стек

| Слой | Технология |
|---|---|
| Фронт | React 19 + Vite 8 + TypeScript |
| Бэкенд | Hono 4 + @hono/node-server |
| ORM | Drizzle 0.45 + drizzle-kit 0.31 |
| БД | SQLite через better-sqlite3 12 (файл `data/app.db`) |
| Auth | Shared secret `X-Auth-Token` (single-tenant) |
| Тесты | Vitest 4 (calc unit + Hono integration через `app.request()`) |

### Поток данных (frontend)

На монтаже `App.tsx` запрашивает три эндпоинта параллельно: `GET /api/refs`, `GET /api/products`, `GET /api/settings`. Полученные `References + ProductRow[] + TaxSettings` идут в `useMemo`, который для каждой строки прогоняет `calculateRow(row.input, taxSettings, refs, { ozonCommissions: row.ozonCommissions })`. Мутации (`addRow`/`duplicateRow`/`removeRow`/`updateRow`) делают optimistic update с откатом на ошибке через `api.products.*`. `setTaxSettings` дебаунсится 300мс перед `PUT /api/settings`. localStorage **не используется** — единственный source of truth это SQLite.

### Поток данных (backend)

Скрипт `extract-data.mjs` читает Excel и пишет в `ref_commissions`, `ref_storage`, `ref_logistics_tariffs`, `ref_settings` (через Drizzle-runtime-migrator). `seed.mjs` инициализирует `user_settings` и кладёт эталон-кофемашину в `products`. На рантайме Hono читает Drizzle-модели и отдаёт JSON; при импорте Ozon Seller API наполняет `products.*`, `products.ozon_commissions`, `finance_transactions`, `import_runs`. `server/index.ts` — единая точка сборки приложения через `buildApp({ authToken, db?, importContext? })`, что позволяет тестам подменять БД на `:memory:` и Ozon-клиент на mock.

### Engine (`src/lib/calc/`)

Точка входа — `calculateRow(input, taxSettings, refs, perSku?)` в `src/lib/calc/index.ts`. Этот файл оркестрирует все шаги расчёта; модули рядом (`pricing`, `commission`, `logistics`, `storage`, `vat`, `tax`) — чистые функции. Все три схемы (FBO / FBS / realFBS) считаются параллельно в одном проходе.

**Выбор источника тарифов** (Фаза 5):
- Если `perSku.ozonCommissions` задан — комиссия и логистика берутся из API-чисел Ozon (`sales_percent_fbo/fbs`, `fbo/fbs_direct_flow_trans_max_amount`, `fbo/fbs_deliv_to_customer_amount`). realFBS использует `sales_percent_fbs` (Ozon не разделяет).
- Иначе — табличный лукап по `category-productType` в `refs.commissions` и `refs.logisticsTariffs`.
- Хранение и acceptance fee всегда из таблиц (Ozon per-SKU не отдаёт).
- realFBS-доставка/возврат всегда из `input.realFbsDeliveryCost/realFbsReturnCost`.
- `CalcResult.usedOzonCommissions: boolean` — флаг, какой путь сработал; UI рендерит бейдж «API» рядом с articleId на основе наличия `ozonCommissions`.

**Изменения формул** всегда начинай с того, что найди соответствующий шаг в `index.ts` (комментарии секций совпадают с нумерацией §3 в `README.md` / ТЗ), потом правь нужный модуль.

### Конвенции значений

- Все деньги — `number`, без округления внутри. Округление только в UI через `src/format.ts` (`Intl.NumberFormat` с `RUB`).
- Все ставки и доли — в долях (`0.05`, не `5%`). На UI выводятся через `Intl.NumberFormat({ style: 'percent' })`.
- `redemptionPercent` хранится как целое (0–100), `returnPercentInt = 100 − redemptionPercent`. Несколько формул (`maxLoss`, `ozonReturnServices`, realFBS-доставка) используют именно `returnPercentInt / 100`, не `returnPercent` как долю — следи за этим при правках.
- Отрицательный налог в УСН Д−Р обрезается до 0 через `Math.max(0, ...)` в `tax.ts`.
- `vatRate` и `clustersCount` хранятся в SQLite как `text` (так как union типы `"Не облагается" | 0.05 | … ` и `number | "Считать без наценки"` не ложатся в один SQL-тип). Маппинг — в `server/routes/products.ts:dbToRow`.

### Справочники и каскадные селекты

- Лукапы в `refs.commissions` и `refs.storage` идут по составному ключу `` `${category}-${productType}` ``. Если записи нет — `findCommission` возвращает `undefined`, и `calculateRow` выбрасывает ошибку, которую UI показывает в error-панели **только когда товар не пришёл из Ozon** (с API-блоком лукап обходится).
- `categories` (Record<categoryName, productTypes[]>) собирается на бэке из `ref_commissions` в `refs`-роуте и питает каскадный селект в `ProductForm`.
- Тариф логистики ищется по диапазону `volumeFrom ≤ volumeL ≤ volumeTo` в `refs.logisticsTariffs`. Над/под границами таблицы — фолбэк на крайнюю запись в `findTariff`.

### Известное отступление от спецификации

Реализация **сознательно** отличается от §3.14 ТЗ:

- `damageRub` исключён из `deliveryCostFboRub` и `deliveryCostFbsRub` (но оставлен в `deliveryCostRealFbsRub`).
- Дублирующий `+30` (приёмка FBS) убран из `deliveryCostFbsRub` — фигурирует только в `expensesFbs`.

Без этих правок acceptance-тест расходится с Excel-эталоном на ~2 300 ₽. Если будешь править формулы FBO/FBS — не возвращай damage и duplicate-30 обратно «по букве ТЗ»; вместо этого обнови acceptance-тест и обоснуй изменение.

`crossDocking = 0` (константа в `src/lib/calc/index.ts`) — мини-калькулятор кросс-докинга в v1 не реализован, есть TODO.

### Acceptance-тест как контракт

`__tests__/calc.test.ts` импортирует JSON-справочники из `src/data/*.json` напрямую (минуя SQLite) и прогоняет эталон «кофемашина» с допуском ±500 ₽. Любые изменения формул проверяй именно этим тестом — он соответствует Excel-расчёту, который пользователь считает источником истины. Если поменялась структура `commissions.json` / `storage.json` / `logisticsTariffs.json` (например, после повторного запуска `extract-data.mjs` поверх обновлённого Excel), тест упадёт первым. JSON-файлы в `src/data/` живут в репо именно ради этого теста — фронт их больше не импортирует.

### Backend-структура

- `server/db/schema.ts` — Drizzle-схема (9 таблиц: ref_*, products, user_settings, api_credentials, finance_transactions, import_runs).
- `server/db/client.ts` — `openDb({ dbPath })` с auto-migrate, lazy singleton `getDb()` для прода.
- `server/db/migrations/` — генерится через `drizzle-kit generate`. Текущие: `0000_init.sql`, `0001_ozon_commissions.sql`. Применяются при старте сервера и в скриптах через `migrate()` из `drizzle-orm/better-sqlite3/migrator` (единый трекер `__drizzle_migrations` для всех точек входа).
- `server/middleware/auth.ts` — проверка `X-Auth-Token`.
- `server/routes/{refs,products,settings,credentials,import,finance,analytics}.ts` — по роуту на тему. `import.ts` экспортирует `runCatalogImport` и `runFinanceImport` для тестов.
- `server/ozon/` — клиент Seller API (`client.ts` с throttle 700мс + retry на 429/5xx), обёртки эндпоинтов (`catalog.ts`, `finance.ts`), маппинг (`mapToProduct.ts`), классификация операций (`classifyOperation.ts`), типы (`types.ts`).

### Импорт из Ozon (Фазы 2–3)

- **Каталог** (`POST /api/import/catalog`): пагинирует `/v3/product/list`, батчит `info/list` + `info/prices`, резолвит категории через `description-category/tree` (с наследованием `description_category_id` вниз по дереву). Merge: `articleId` UNIQUE → существующая строка обновляет только catalog-поля (`productName`, `category`, `productType`, `volumeL`, `vatRate`, `isKgt`, `currentPrice`, `discountPercent`, `ozonProductId`, `ozonCommissions`); локальные `costPrice/salesPlan/marketingPercent/…` сохраняются. Новые товары без `category` пропускаются (`unmatched++`), чтобы потом не падать в `calculateRow`.
- **Финансы** (`POST /api/import/finance` с `{from, to}`): пагинирует `/v3/finance/transaction/list`, классифицирует `operation_type` через `classifyOperationType` в `sale | refund | commission | logistics | last_mile | storage | other`, пишет с `onConflictDoNothing` (PK = `operation_id` → идемпотентно).
- **Прогресс**: оба импорта fire-and-forget; статус читается через `GET /api/import/runs/:id`. UI поллит каждую секунду.

### Аналитика (Фаза 4)

`GET /api/analytics/realized-margin?from&to` — SQL-агрегат `finance_transactions` группированный по `articleId`, отдаёт `actualRevenue/Refund/Commission/Logistics/LastMile/Storage/Other`, `actualMargin = sum(amount)`, `salesCount`, `txCount`. UI на вкладке «Калькулятор» — чекбокс «Сравнить с фактом за период» — добавляет колонки в `ProductsTable` и подвал с «Прогноз × факт.продажи» по схемам и «Δ факт − прогноз, %».

### TypeScript-конфиг

- Три проекта в composite-сборке: `tsconfig.app.json` (фронт, jsx, dom), `tsconfig.node.json` (vite.config.ts), `server/tsconfig.json` (бэк, без dom).
- `verbatimModuleSyntax: true`, `noUnusedLocals/Parameters: true`, `resolveJsonModule: true`, `erasableSyntaxOnly: true`. Импорты типов нужно явно помечать `import type { ... }`. Параметровые свойства (`constructor(public x)`) запрещены — assign-ить вручную.
- `npm run build` запускает `tsc -b` перед `vite build` — сначала проверяй типы, потом продакшн-сборку.

### Соглашения для PR / автоматизации

- При генерации новой миграции обязательно проверь, что и `extract-data.mjs`, и `seed.mjs`, и тестовые сэтап-функции (`__tests__/server/*.test.ts:setupDb`) применяют **все** SQL-файлы из `server/db/migrations/`.
- При расширении `OzonCommissions` (новые поля API) обнови оба места: `src/types/index.ts` и `server/ozon/types.ts:OzonPriceItem.commissions` (последний импортирует из первого).
- При добавлении новой схемы поставки или поля в `ProductInput` — синхронно правь `products` в `server/db/schema.ts`, валидацию в `server/routes/products.ts:validateInput`, маппер `dbToRow`/`inputToColumns` и `seed.mjs`.
