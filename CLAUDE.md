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
npm run db:seed           # первый админ + его default shop «Мой магазин (M1)»
npm run db:extract        # Excel → SQLite ref_* таблицы
                          # путь к Excel: EXTRACT_SOURCE=… npm run db:extract

# Таргетные тесты
npx vitest run __tests__/calc.test.ts
npx vitest run -t "matches Excel reference within tolerance"
npx vitest run __tests__/server/         # все backend-тесты
```

## Запуск с нуля

1. `cp .env.example .env`. Настроить SMTP-параметры (или оставить пустыми — письма пойдут в stdout) и `ADMIN_EMAIL`/`ADMIN_PASSWORD` для первого админа.
2. `npm run db:seed` — создаст `data/app.db`, засеет первого админа (если таблица `users` пуста) и его дефолтный магазин «Мой магазин» с кодом `M1`.
3. `npm run db:extract` — наполнит `ref_*` справочники из Excel (требуется `C:/Users/admin/Downloads/Техника — копия2.xlsx` или `EXTRACT_SOURCE=…`).
4. `npm run dev`. Фронт ходит в `/api/*` через Vite-прокси (`SERVER_URL`, по умолчанию `http://localhost:3001`). Войти на `/login` с теми creds, что в `.env`.

## Architecture

### Стек

| Слой | Технология |
|---|---|
| Фронт | React 19 + Vite 8 + TypeScript |
| Бэкенд | Hono 4 + @hono/node-server |
| ORM | Drizzle 0.45 + drizzle-kit 0.31 |
| БД | SQLite через better-sqlite3 12 (файл `data/app.db`) |
| Auth | Session cookies (HTTP-only) + `sessions` таблица; bcrypt-пароли, email-верификация, роли admin/user |
| Тесты | Vitest 4 (calc unit + Hono integration через `app.request()`) |

### Поток данных (frontend)

На монтаже `App.tsx` параллельно запрашивает `GET /api/refs` и `GET /api/shops`, затем `GET /api/products`. Хранит state: `shops: Shop[]`, `activeShopId`, `shopFilter` (null = «Все магазины»). `taxSettings` для каждой строки резолвится через `taxByShop = Map<shopId, TaxSettings>` (вычисляется из `shops`); в calc-loop'е — `calculateRow(row.input, taxByShop.get(row.shopId)!, refs, { ozonCommissions })`. Мутации (`addRow`/`updateRow`/`removeRow`/`bulk*`) делают optimistic update с откатом на ошибке через `api.products.*`. При смене активного магазина — debounced `PUT /api/settings?shopId=…` сохраняет TaxSettings конкретного магазина, и `GET /api/refs?shopId=…` обновляет cluster-tariffs (зависит от выбранного у магазина набора).

**Хранилище**:
- **Бизнес-данные** (магазины, товары, налоги/auto-refresh внутри магазина, Ozon-креды, наборы тарифов, финтранзакции, импорты) — единственный source of truth это SQLite (`data/app.db`).
- **UI-preferences** — в `localStorage`, ключи `ozon-calc.tweaks` (TweaksPanel: цвет акцента, density, unitMode и т.п.), `ozon-calc.actuals` (галка «Сравнить с фактом» + период), `ozon-calc.activeShopId` (последний выбранный магазин для UX). Их сброс не трогает данные. **Не клади бизнес-данные в localStorage** — для них всегда SQLite + миграция.

### Поток данных (backend)

Скрипт `extract-data.mjs` читает Excel и пишет в `ref_commissions`, `ref_storage`, `ref_logistics_tariffs`, `ref_settings`, плюс наполняет таблицу `logistics_cluster_tariffs` через **глобальный набор тарифов** (см. ниже). `seed.mjs` создаёт первого админа и его дефолтный магазин «Мой магазин (M1)». На рантайме Hono читает Drizzle-модели и отдаёт JSON; при импорте Ozon Seller API наполняет `products.*`, `products.ozon_commissions`, `finance_transactions`, `import_runs` — всё в контексте конкретного магазина (`shop_id`). `server/index.ts` — единая точка сборки приложения через `buildApp({ db?, importContext? })`, что позволяет тестам подменять БД на `:memory:` и Ozon-клиент на mock.

### Engine (`src/lib/calc/`)

Точка входа — `calculateRow(input, taxSettings, refs, perSku?)` в `src/lib/calc/index.ts`. Этот файл оркестрирует все шаги расчёта; модули рядом (`pricing`, `commission`, `logistics`, `storage`, `vat`, `tax`) — чистые функции. Все три схемы (FBO / FBS / realFBS) считаются параллельно в одном проходе.

**Выбор источника тарифов** (Фаза 5):
- Если `perSku.ozonCommissions` задан — комиссия и логистика берутся из API-чисел Ozon (`sales_percent_fbo/fbs`, `fbo/fbs_direct_flow_trans_max_amount`, `fbo/fbs_deliv_to_customer_amount`). realFBS использует `sales_percent_fbs` (Ozon не разделяет).
- Иначе — табличный лукап по `category-productType` в `refs.commissions` и `refs.logisticsTariffs`.
- Хранение и acceptance fee всегда из таблиц (Ozon per-SKU не отдаёт).
- realFBS-доставка/возврат всегда из `input.realFbsDeliveryCost/realFbsReturnCost`.
- `CalcResult.usedOzonCommissions: boolean` — флаг, какой путь сработал; UI рендерит бейдж «API» рядом с articleId на основе наличия `ozonCommissions`.

**Изменения формул** всегда начинай с того, что найди соответствующий шаг в `index.ts` (комментарии секций совпадают с нумерацией §3 в `README.md` / ТЗ), потом правь нужный модуль.

### Multi-shop архитектура (миграции 0015 + 0017)

Каждый пользователь ведёт N **магазинов** (`shops` таблица): свой набор товаров, финансов, импортов, налогов, auto-refresh и Ozon-кредов. Магазин принадлежит одному owner'у (`shops.user_id`), но админ может **раздать доступ** другим пользователям через таблицу `shop_access(shop_id, user_id)` (миграция 0017). Назначенный viewer видит магазин как «общий» и работает с ним в своём отдельном namespace — данные товаров/финансов/импортов **per-user**, не пересекаются с owner'ом и другими viewer'ами.

- `products`: `(shop_id, user_id)` оба NOT NULL; `UNIQUE(shop_id, user_id, article_id)` — один артикул в одном shared shop может существовать одновременно у нескольких юзеров.
- `finance_transactions`: PK `(shop_id, user_id, operation_id)` — `operation_id` Ozon-аккаунта повторяется в выписках разных viewer'ов.
- `import_runs.user_id` — у каждого юзера своя история импортов в shared shop.
- `shop_access(shop_id, user_id)` — список viewer'ов. Owner всегда в `shops.user_id` (запись в shop_access ему не нужна).
- `shop_user_settings(shop_id, user_id)` — per-user overrides: `tax_settings` (json), `tariff_set_id`, `auto_refresh_enabled`, `auto_refresh_interval_min`. NULL во всех полях = «наследовать с shops». Это позволяет viewer'у иметь свою СНО и свой выбор тарифного набора, не трогая дефолты, заданные админом.

`shops` содержит inline: `name`, `shortName` (ровно 2 символа, UNIQUE per user), `color` (HEX опц.), `taxSettings` (json), `autoRefreshEnabled/Min`, `ozonClientId/ApiKey`, `tariffSetId`. `user_settings.activeShopId` — выбранный по умолчанию магазин (для импорта/создания товара).

**Видимость и владение** (`server/middleware/session.ts`):
- `visibleShopIds(db, userId)` — union owned ∪ shop_access. Используется во всех scoped reads без явного `?shopId=`.
- `userCanSeeShop(db, userId, shopId)` — видим ли (owned ИЛИ access)? Заменил старую проверку через JOIN.
- `userOwnsShop(db, userId, shopId)` — только owner; гейтит credentials и owner-fields.
- `resolveShopId(c, opts)` теперь валидирует видимость, а не владение.

Все scoped роуты (products/finance/analytics/import/credentials/settings) принимают необязательный `?shopId=`:
- передан → фильтр по магазину (валидация: visible);
- не передан → возвращает данные **всех видимых магазинов** (для UI-фильтра «Все»).

В SQL для products/finance/import_runs всегда добавляется `eq(table.userId, currentUser.id)` — изоляция per-user.

**Эффективные настройки** (`server/settings/shopSettings.ts:resolveShopSettings(db, shopId, userId)`):
- `taxSettings = override.taxSettings ?? shop.taxSettings`
- `tariffSetId = override.tariffSetId ?? shop.tariffSetId` (с дальнейшим fallback на global через `resolveTariffSetId(db, shopId, userId)`)
- `autoRefreshEnabled / IntervalMin` — аналогично

`PUT /api/settings` и `PATCH /api/shops/:id` маршрутизируют запись: owner пишет в `shops.*`, viewer — в `shop_user_settings` через `upsertShopUserSettings`. PATCH owner-fields (`name/shortName/color/ozonClientId/ozonApiKey`) для viewer'а → 403.

**Ozon credentials** (миграция 0018) — только shop-уровень. `server/ozon/client.ts:resolveCredentials(db, shopId)` возвращает `shop.ozonClientId/ozonApiKey` или `null`. Глобальный fallback (бывшая таблица `api_credentials`) и `OZON_CLIENT_ID/API_KEY` env-vars **удалены** — иначе магазин без своих ключей тащил бы каталог чужого Ozon-аккаунта. Магазин без ключей → импорт возвращает 400 `ozon credentials not configured`. Viewer импортирует под ключами owner'а shared shop.

**Auto-refresh** (`src/lib/autoRefresh.ts`) — `Map<shopId, NodeJS.Timeout>`, независимые таймеры на каждый магазин. При смене состава магазинов App вызывает `initAutoRefresh(shopIds)`, который сносит старые таймеры и поднимает новые из effective settings (`shop_user_settings` если задано, иначе `shops`).

**Admin endpoints** (`server/routes/admin.ts`):
- `GET /api/admin/shops` — admin-owned магазины + счётчик viewer'ов.
- `GET /api/admin/shops/:id/access` — список юзеров с доступом.
- `GET /api/admin/shops/:id/access/candidates` — юзеры, которым ещё можно дать доступ.
- `POST /api/admin/shops/:id/access` body `{userId}` — назначить viewer'а.
- `DELETE /api/admin/shops/:id/access/:userId` — отозвать + `cascade-delete` per-user `products`/`finance_transactions`/`import_runs`/`shop_user_settings` этого юзера в shop'е (orphans не остаются).

**При добавлении новой scoped-фичи** — следуй паттерну: в schema FK на `shops.id` ON DELETE CASCADE + колонка `user_id` NOT NULL FK; в роуте используй `resolveShopId` + `visibleShopIds` для reads, `eq(table.userId, currentUser.id)` всегда. В тестах создавай user + дефолтный shop через `loginAs(env, email, password)`; для шаринг-кейсов — `POST /api/admin/shops/:id/access` (см. `__tests__/server/sharing.test.ts`).

### Версионирование тарифов логистики (миграция 0016)

Точная матрица per-cluster-pair (`Москва ↔ Урал` и т.д.) живёт в **именованных наборах** `logistics_cluster_tariff_sets` — несколько версий могут сосуществовать, чтобы считать факт за прошлый период по тарифам, которые тогда действовали.

- `logistics_cluster_tariff_sets`: id, `shop_id` (nullable), `name`, `uploaded_at`, `created_at`. `shop_id IS NULL` → **глобальный** набор (виден всем, грузит только админ). Иначе — **персональный** магазина (виден только владельцу).
- `logistics_cluster_tariffs.set_id` (FK NOT NULL, ON DELETE CASCADE) — каждая строка тарифа принадлежит одному набору.
- `shops.tariff_set_id` (nullable) — какой набор использует магазин. NULL → последний глобальный по `uploaded_at`.

**Helper `resolveTariffSetId(db, shopId)`** в `server/settings/tariffSets.ts`: shop.tariffSetId → последний global → null. Защита: если магазин ссылается на чужой персональный набор (некорректный API-call), резолвер падает на global.

**API:**
- `GET /api/refs/cluster-logistics/sets` — список доступных юзеру наборов (глобальные + свои).
- `POST /api/refs/cluster-logistics/sets` (multipart `file/name/scope/shopId`): `scope=global` требует `role=admin`, `scope=shop` требует владения shopId.
- `DELETE /api/refs/cluster-logistics/sets/:id` — admin для global, owner для personal.
- `GET /api/refs?shopId=…` отдаёт `logisticsClusterTariffs` (тарифы активного набора) + `activeTariffSetId`.
- Legacy `/refs/cluster-logistics/upload` теперь под `requireAdmin` — создаёт **новый** глобальный набор с автоименем «Глобальный набор от YYYY-MM-DD», старые наборы не трогаются.

UI: компонент `src/components/TariffSetsControl.tsx` рендерится внутри секции «Логистика» в `ShopSettings` — селектор активного набора + кнопка «Загрузить новый» (inline-форма с выбором scope: «мой» / «общий» — последнее только для админа) + удаление.

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

- `server/db/schema.ts` — Drizzle-схема (17 таблиц: `ref_commissions`, `ref_storage`, `ref_logistics_tariffs`, `ref_settings`, `logistics_cluster_tariff_sets`, `logistics_cluster_tariffs`, `shops`, `shop_access`, `shop_user_settings`, `products`, `user_settings`, `users`, `sessions`, `email_verification_tokens`, `smtp_settings`, `finance_transactions`, `import_runs`). `api_credentials` удалена в миграции 0018.
- `server/db/client.ts` — `openDb({ dbPath })` с auto-migrate, lazy singleton `getDb()` для прода.
- `server/db/migrations/` — генерится через `drizzle-kit generate`. Применяются при старте сервера и в скриптах через `migrate()` из `drizzle-orm/better-sqlite3/migrator` (единый трекер `__drizzle_migrations` для всех точек входа).
- `server/middleware/session.ts` — `sessionMiddleware(db)` читает cookie + грузит user в context, `requireAuth` / `requireAdmin` — гейты для роутов.
- `server/auth/utils.ts` — bcrypt hash/compare, генерация токенов, CRUD сессий и email-токенов; `server/email/{client,templates}.ts` — nodemailer + dev-fallback в stdout.
- `server/routes/{auth,admin,refs,shops,products,settings,credentials,import,finance,analytics}.ts` — по роуту на тему. `import.ts` экспортирует `runCatalogImport` и `runFinanceImport` для тестов. `shops.ts` — CRUD магазинов (`GET/POST /api/shops`, `PATCH/DELETE /api/shops/:id`, `PUT /api/shops/active` для смены `user_settings.active_shop_id`).
- `server/settings/tariffSets.ts` — `resolveTariffSetId(db, shopId, userId?)`: какой набор тарифов логистики использует пара (shop, user): override → shop.tariffSetId → последний global → null.
- `server/settings/shopSettings.ts` — `resolveShopSettings(db, shopId, userId)` / `upsertShopUserSettings` / `clearShopUserSettings`. Per-user overrides поверх shops.
- `server/ozon/` — клиент Seller API (`client.ts` с throttle 700мс + retry на 429/5xx), обёртки эндпоинтов (`catalog.ts`, `finance.ts`), маппинг (`mapToProduct.ts`), классификация операций (`classifyOperation.ts`), типы (`types.ts`).

### Импорт из Ozon (Фазы 2–3)

- **Каталог** (`POST /api/import/catalog`): пагинирует `/v3/product/list`, батчит `info/list` + `info/prices`, резолвит категории через `description-category/tree` (с наследованием `description_category_id` вниз по дереву). Merge: `articleId` UNIQUE → существующая строка обновляет только catalog-поля (`productName`, `category`, `productType`, `volumeL`, `vatRate`, `isKgt`, `currentPrice`, `regularPrice`, `discountPercent`, `ozonProductId`, `ozonSku`, `ozonCommissions`, опционально `costPrice`); локальные `salesPlan/marketingPercent/redemptionPercent/…` сохраняются. Новые товары без `category` пропускаются (`unmatched++`), чтобы потом не падать в `calculateRow`.
- **Финансы** (`POST /api/import/finance` с `{from, to}`): пагинирует `/v3/finance/transaction/list`, классифицирует `operation_type` через `classifyOperationType` в `sale | refund | commission | logistics | last_mile | storage | other`, пишет с `onConflictDoNothing` (PK = `operation_id` → идемпотентно). `articleId` резолвится по `items[].offer_id`, при отсутствии — fallback на `items[].sku` через `products.ozon_sku` (in-memory map в начале импорта).
- **Прогресс**: оба импорта fire-and-forget; статус читается через `GET /api/import/runs/:id`. UI поллит каждую секунду.

### Маппинг цен / SKU из Ozon (важно — легко перепутать)

Семантика полей `mapToProduct.ts:computeCurrentPriceAndDiscount` и `pickPublicSku`:

- **`currentPrice`** — фактическая цена продажи продавцу. Если `price.marketing_seller_price > 0` (активна акция продавца — бустинг, Hot Sale и т.п.), берём её напрямую и `discountPercent = 0`. Иначе — `price.price` плюс `discountPercent` из `(old_price − price)/old_price`, если `old_price > price`. **По `currentPrice` калькулятор считает экономику**: `promoPrice = currentPrice × (1 − discountPercent)`.
- **`regularPrice`** (миграция `0003`, nullable) — sticker-цена `price.price`, когда промо опустило `currentPrice` ниже неё. Только для UI (зачёркнутая подпись), **в расчётах не участвует**.
- **`costPrice` из `price.net_price`** — себестоимость, которую продавец заполнил в ЛК Ozon. Импорт **перезаписывает локальную `costPrice` только если `net_price > 0`**; иначе локальное значение сохраняется (чтобы не затереть ручной ввод нулём).
- **`ozonProductId`** ≠ **`ozonSku`** (миграция `0004`):
  - `ozonProductId` = `info.id` (внутренний product_id продавца). Используется в URL ЛК `https://seller.ozon.ru/app/products/{id}`.
  - `ozonSku` = `info.sources[].sku` (FBO → FBS → первый ненулевой). Это **публичный** SKU маркетплейса для URL `https://www.ozon.ru/product/{sku}/`. **Не путать с `ozonProductId`** — построение URL по `product_id` ведёт на чужой товар.

### Диагностические / административные эндпоинты импорта

- `POST /api/import/catalog/refresh/:articleId` — точечный refresh одного SKU (info+prices). Использует те же helpers, что и полный импорт; обновляет catalog-поля и `costPrice` (только при `net_price > 0`). 404, если артикул не найден локально или в Ozon.
- `POST /api/import/finance/relink` — backfill `articleId` для строк `finance_transactions WHERE article_id IS NULL` через `raw.items[].sku → products.ozon_sku`. Возвращает `{ scanned, linked }`. Полезно после первого получения `ozon_sku` для исторических транзакций без `offer_id`.
- `GET /api/import/debug/prices/:articleId` — сырой ответ `/v5/product/info/prices` (для UI кнопки «Ozon /v5 raw» в drawer'е). Возвращает `{ endpoint, request, response }`.
- `GET /api/import/debug/finance/:articleId` — агрегаты по локальной `finance_transactions` для одного SKU (без обращения к Ozon). Считает `accruals_for_sale` и `amount` по типам, `period.from/to`, последние 10 операций.
- `GET/PUT /api/settings/auto-refresh?shopId=…` — конфиг авто-импорта каталога (`{ enabled, intervalMin }`) **per-shop** (колонки `shops.auto_refresh_enabled / auto_refresh_interval_min`, миграция `0015`). Клиент использует его в `src/lib/autoRefresh.ts` — `Map<shopId, NodeJS.Timeout>` независимых таймеров; `initAutoRefresh(shopIds)` вызывается из `App.tsx` при изменении состава магазинов.

### Аналитика (Фаза 4)

`GET /api/analytics/realized-margin?from&to` — SQL-агрегат `finance_transactions` группированный по `articleId`, отдаёт `actualRevenue/Refund/Commission/Logistics/LastMile/Storage/Other`, `actualMargin = sum(amount)`, `salesCount`, `txCount`. UI на вкладке «Калькулятор» — чекбокс «Сравнить с фактом за период» — добавляет колонки в `ProductsTable` и подвал с «Прогноз × факт.продажи» по схемам и «Δ факт − прогноз, %».

### Аутентификация и админка

- **Локализация ответов `/api/auth/*`** — все user-facing сообщения на русском (`Неверный email или пароль`, `Email не подтверждён…`, `Учётная запись заблокирована администратором`, и т.п. в `server/routes/auth.ts`). При добавлении новых эндпоинтов держи русский для всего, что попадает в UI; внутренние коды (`unauthorized`, `forbidden` в `middleware/session.ts`) можно оставить английскими — они не показываются.
- **Блокировка пользователей** (миграция `0013`): колонка `users.is_blocked` (boolean, default `false`).
  - `POST /api/auth/login` отклоняет заблокированного юзера с `403` **до** проверки `isVerified` — иначе сообщение «email не подтверждён» сбивало бы с толку.
  - `validateSession` в `server/auth/utils.ts` возвращает `null` для заблокированных юзеров — defence-in-depth, чтобы они не прошли по существующим cookie, если revoke сессий не сработал.
  - `PUT /api/admin/users/:id/blocked` body `{ blocked: boolean }` — при `blocked=true` атомарно удаляет все сессии юзера, его выкидывает со всех устройств. Нельзя заблокировать самого себя (400). Разблокировка сессии не восстанавливает.
  - UI в `src/components/admin/AdminPage.tsx` — колонка «Статус» + кнопка-замок (`Ban` / `CircleCheck` из lucide). Заблокированная строка отрисовывается с `opacity: 0.55`, селект роли отключён.
- **SMTP-настройки админки** (миграция `0011` ввела таблицу `smtp_settings`, `0012` добавила колонку `secure`):
  - `secure: 'auto' | 'ssl' | 'starttls' | 'none'`. В `server/email/client.ts:resolveTlsOptions(mode, port)` маппится в nodemailer-флаги: `ssl` → `{ secure: true }`, `starttls` → `{ secure: false, requireTLS: true }`, `none` → `{ secure: false, ignoreTLS: true }`, `auto` → `{ secure: port === 465 }` (исторический дефолт).
  - Env-переменная `SMTP_SECURE` (опциональная) — поддержана `readSmtpFromEnv`.
  - `POST /api/admin/smtp/test` принимает опциональный `subject` и при `describeEmailSource() === "console"` сразу возвращает 400 с предупреждением «SMTP не настроен — письма пишутся в stdout, а не отправляются» (без попытки отправки), плюс пробрасывает в ответ полные поля nodemailer-ошибки (`code`, `responseCode`, `response`, `command`) — UI показывает их в alert, чтобы не лезть в логи сервера.
  - В UI: автозеркалирование `User → From` (пока `From` пустой или совпадает с предыдущим `User`); placeholder порта подстраивается под выбранный `secure`-режим. Mail.ru/Yandex/Gmail требуют, чтобы email в `From` совпадал с `User` — об этом подсказка прямо в форме.
- **Email-шаблон** `server/email/templates.ts` уже на русском. При добавлении новых писем держи единообразный стиль (Noto-friendly inline CSS, кнопка `var(--accent)`-цвета, fallback ссылка для Plain text).
- **Password reveal toggle** — компонент `Field` в `src/components/auth/AuthShell.tsx` для `type="password"` рендерит иконку-глазик внутри инпута (`Eye` / `EyeOff` из lucide). Каждое поле управляет своим состоянием независимо; кнопка `tabIndex={-1}`, чтобы Tab её пропускал.
- **При добавлении пути в админке**: помни, что `requireAdmin` в `server/middleware/session.ts` уже отсеивает не-админов. Не дублируй проверку в роуте; вместо этого защищай через монтирование (`app.route('/admin', adminRoutes)` уже под `requireAdmin`).

### TypeScript-конфиг

- Три проекта в composite-сборке: `tsconfig.app.json` (фронт, jsx, dom), `tsconfig.node.json` (vite.config.ts), `server/tsconfig.json` (бэк, без dom).
- `verbatimModuleSyntax: true`, `noUnusedLocals/Parameters: true`, `resolveJsonModule: true`, `erasableSyntaxOnly: true`. Импорты типов нужно явно помечать `import type { ... }`. Параметровые свойства (`constructor(public x)`) запрещены — assign-ить вручную.
- `npm run build` запускает `tsc -b` перед `vite build` — сначала проверяй типы, потом продакшн-сборку.

### Соглашения для PR / автоматизации

- При генерации новой миграции обязательно проверь, что и `extract-data.mjs`, и `seed.mjs`, и тестовые сэтап-функции (`__tests__/server/*.test.ts:setupDb`) применяют **все** SQL-файлы из `server/db/migrations/`.
- При расширении `OzonCommissions` (новые поля API) обнови оба места: `src/types/index.ts` и `server/ozon/types.ts:OzonPriceItem.commissions` (последний импортирует из первого).
- При добавлении новой схемы поставки или поля в `ProductInput` — синхронно правь `products` в `server/db/schema.ts`, валидацию в `server/routes/products.ts:validateInput`, маппер `dbToRow`/`inputToColumns` и `seed.mjs`.
- При работе с `MappedCatalogEntry` помни различие: **`patch` — поля, всегда обновляемые из Ozon**; **`costPrice` и `ozonSku` — отдельные опциональные поля рядом** (записываются только при `> 0` / `!= null` через условный спред). Не клади их в `patch`, иначе сломаешь логику «не затирать локальное значение, когда Ozon не отдал данных».
