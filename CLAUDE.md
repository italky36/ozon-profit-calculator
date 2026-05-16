# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Калькулятор прибыли продавца Ozon — full-stack приложение: фронт React + TypeScript + Vite, бэкенд Node + Hono + Drizzle поверх SQLite. Сравнивает три схемы поставки (FBO / FBS / realFBS) по марже, рентабельности и налогам, импортирует каталог и финансы из Ozon Seller API, считает «прогноз vs факт» по реальным операциям. Подробные формулы — в `README.md`. Описание UI — в `UI.md`.

## Commands

```bash
# Dev: vite (web) + backend (api) + vite (sysadmin SPA) разом через concurrently
npm run dev               # http://localhost:5173 (web) + 3001 (api) + 5174 (sysadmin)
npm run dev:web           # только основной vite (workspace SPA)
npm run dev:api           # только tsx watch server/index.ts
npm run dev:sysadmin      # только sysadmin vite (отдельный SPA, port 5174)

# Build + проверки
npm run build             # tsc -b → vite build (web) → vite build (sysadmin)
npm run build:web         # только основной SPA
npm run build:sysadmin    # только sysadmin SPA
npm run lint              # eslint .
npm test                  # vitest run (180 тестов)
npm run test:watch        # vitest в watch-режиме

# DB (Drizzle + better-sqlite3, файл data/app.db)
npm run db:generate       # drizzle-kit generate (после правки server/db/schema.ts)
npm run db:migrate        # drizzle-kit migrate (обычно не нужно — runtime сам мигрирует)
npm run db:seed           # первый sysadmin + его workspace + дефолтный shop (M1)
npm run db:extract        # Excel → SQLite ref_* таблицы
                          # путь к Excel: EXTRACT_SOURCE=… npm run db:extract

# Таргетные тесты
npx vitest run __tests__/calc.test.ts
npx vitest run -t "matches Excel reference within tolerance"
npx vitest run __tests__/server/         # все backend-тесты
```

## Запуск с нуля

1. `cp .env.example .env`. Настроить SMTP-параметры (или оставить пустыми — письма пойдут в stdout) и `ADMIN_EMAIL`/`ADMIN_PASSWORD` для первого sysadmin.
2. `npm run db:seed` — создаст `data/app.db`, засеет первого **sysadmin** (если таблица `users` пуста) + его workspace («Admin workspace») + дефолтный shop «Мой магазин (M1)». Sysadmin живёт без рабочей команды; обычные юзеры регистрируются через `/register` и сами создают workspace.
3. `npm run db:extract` — наполнит `ref_*` справочники из Excel (требуется `C:/Users/admin/Downloads/Техника — копия2.xlsx` или `EXTRACT_SOURCE=…`).
4. `npm run dev`. Workspace-SPA на `localhost:5173`, API на `3001`, **sysadmin-консоль на `localhost:5174` отдельно** (sysadmin-юзера в основной SPA не пускает — там redirect-экран). Войти sysadmin'у на `localhost:5174/`, остальным — на `localhost:5173/login`.

## Architecture

### Стек

| Слой | Технология |
|---|---|
| Фронт | React 19 + Vite 8 + TypeScript |
| Бэкенд | Hono 4 + @hono/node-server |
| ORM | Drizzle 0.45 + drizzle-kit 0.31 |
| БД | SQLite через better-sqlite3 12 (файл `data/app.db`) |
| Auth | Session cookies (HTTP-only) + `sessions` таблица; bcrypt-пароли, email-верификация, `users.is_sysadmin` для платформенных операторов + `workspace_members.role` (owner/manager/member) для команд |
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

### Multi-tenant + per-shop assignment (миграции 0019–0021)

Двухуровневая модель: **workspace** (команда) → **shops** + **shop_member** (assignment).

- **Workspace** = команда. Один user → один workspace через `workspace_members` (UNIQUE на `user_id`). Регистрация через `/register` транзакционно создаёт user → workspace → owner-membership → дефолтный shop. Роли в команде: `owner` / `manager` / `member` (`workspace_members.role`).
- **Sysadmin** — платформенная роль, **не часть workspace'ов**. `users.is_sysadmin = true`. Работает только через отдельный SPA в `src/sysadmin/` (port 5174 в dev, `dist/sysadmin/` → admin-домен в prod). Регистрация `/register` sysadmin'ов не создаёт — только seed или promote.
- **Shop** принадлежит workspace (`shops.workspace_id NOT NULL`), а не user'у. Owner/manager создаёт; member работает с уже существующими.
- **`shop_member(shop_id, user_id, created_at, created_by)`** — hard-gate ассайнмент. Owner workspace'а видит **все** shops безусловно; manager/member — только те, где есть запись в `shop_member`. Owner/manager раздаёт через `POST /api/shops/:id/members`.
- **`shop_user_settings(shop_id, user_id, tax_settings, tariff_set_id, auto_refresh_enabled, auto_refresh_interval_min)`** — per-user overrides поверх shop default. NULL в поле = «наследовать с shops». Позволяет member'у иметь свою СНО / свой тарифный набор / свой авто-импорт без изменения дефолтов команды.

**Catalog vs manual поля в `products`** (UNIQUE `(shop_id, user_id, article_id)`):
- **Catalog-поля** (`productName`, `category`, `productType`, `volumeL`, `vatRate`, `isKgt`, `currentPrice`, `regularPrice`, `discountPercent`, `ozonProductId`, `ozonSku`, `ozonCommissions`) — синкаются у **всех assignee** shop'а при импорте каталога.
- **Manual / financial-поля** (`costPrice`, `salesPlan`, `marketingPercent`, `redemptionPercent`, `whitePurchase`, `partyVolume`, ...) — per-user, обновляются только у current user'а.

**`finance_transactions`** — PK `(shop_id, user_id, operation_id)`. `operation_id` Ozon'а одинаковый у всех assignee, но каждый импортирует свой период независимо. **`import_runs.user_id`** — у каждого юзера своя история импортов в shared shop.

**Ozon credentials** — shop-уровень. `shops.ozonClientId/ozonApiKey`. Owner/manager задаёт через `PATCH /api/shops/:id`; member видит read-only баннер «ключи задаёт owner/manager команды». Глобальный fallback и env-vars удалены в миграции 0018 (см. ниже).

**Видимость и владение** (`server/middleware/session.ts`):
- `visibleShopIds(db, user)` — owner workspace'а: все workspace shops; manager/member: только через `shop_member`.
- `userCanAccessShop(db, user, shopId)` — gate для всех scoped reads/mutations.
- `canManageWorkspace(role)` — true для `owner`/`manager`. Гейтит создание/удаление shops, изменение owner-fields (`name/shortName/color/ozonClientId/ozonApiKey/tariffSetId`), assignment `shop_member`, приглашения в команду.
- `requireSysadmin` (отдельно от workspace-ролей) — гейтит `/api/admin/*`.
- `resolveShopId(c, opts)` валидирует доступ через `userCanAccessShop`.

Все scoped роуты (products/finance/analytics/import/credentials/settings/refs) принимают необязательный `?shopId=`:
- передан → фильтр по shop'у (с проверкой visibility);
- не передан → данные **всех visible shops** (для UI «Все»).

В SQL для `products`/`finance_transactions`/`import_runs` всегда добавляется `eq(table.userId, currentUser.id)` — изоляция per-user.

**Эффективные настройки** (`server/settings/shopSettings.ts:resolveShopSettings(db, shopId, userId)`):
- `taxSettings = override.taxSettings ?? shop.taxSettings`
- `tariffSetId = override.tariffSetId ?? shop.tariffSetId` (с дальнейшим fallback на global через `resolveTariffSetId`)
- `autoRefreshEnabled / IntervalMin` — аналогично

`userHasShopOverrides(db, shopId, userId)` → `Shop.hasOverrides` для UI-флага кнопки «Сбросить к дефолтам команды» (вызывает `POST /api/shops/:id/reset-overrides` → `clearShopUserSettings`).

**Маршрутизация записи** (зависит от роли):
- `PATCH /api/shops/:id` — owner/manager only. Пишет в `shops.*` (shop default).
- `PUT /api/settings` (taxSettings) — пишет в `shop_user_settings.tax_settings` (override). Если совпадает с shop default — override обнуляется.
- `PUT /api/settings/auto-refresh` — аналогично для `autoRefreshEnabled/IntervalMin`.
- `PUT /api/settings/tariff-set` — per-user override `tariff_set_id`. Member пользуется этим маршрутом вместо `PATCH /shops/:id` (который ему 403).
- На фронте `TariffSetsControl` принимает `isOwner` prop и сам выбирает endpoint.

**Auto-refresh** (`src/lib/autoRefresh.ts`) — `Map<shopId, NodeJS.Timeout>`, независимые таймеры на каждый shop. При смене состава shops App вызывает `initAutoRefresh(shopIds)`, который сносит старые и поднимает новые из effective settings (override member'а имеет приоритет).

**Assignment endpoints** (`server/routes/shops.ts`, owner/manager only):
- `GET /api/shops/:id/members` — `{ assigned: [...], candidates: [...] }`.
- `POST /api/shops/:id/members` body `{userId}` — назначить.
- `DELETE /api/shops/:id/members/:userId` — отозвать + cascade-delete per-user `products`/`finance_transactions`/`import_runs`/`shop_user_settings` этого юзера в этом shop'е.

**Workspace endpoints** (`server/routes/workspace.ts`):
- `GET /api/workspace/me` — текущая команда + members (любому участнику). Members несут `fullName / jobTitle / avatarDataUrl` для рендеринга в TeamPage.
- `PATCH /api/workspace/me` — name/slug/color/logoDataUrl/`useLogoAsAppIcon` (owner only). Логотип валидируется через `validateImageDataUrl`. При сбросе логотипа (`logoDataUrl: null`) UI отправляет `useLogoAsAppIcon: false` в том же PATCH'е — сервер не сторожит orphan-флаг сам.
- `POST/GET/DELETE /api/workspace/me/invites` — приглашения (owner/manager). Email-токен TTL 7 дней; `inviteEmail` шаблон в `server/email/templates.ts`. Ссылка строится через `resolveAppUrl(c) + /invite/:token`.
- `PATCH /api/workspace/me/members/:userId` — смена роли (owner only для owner-promote/demote).
- `PATCH /api/workspace/me/members/:userId/profile` — owner-edit профиля участника (fullName / jobTitle / avatarDataUrl). Owner-only по идее — редактировать чужую идентичность это привилегия. Self-edit идёт через `PATCH /api/auth/me/profile`. Тело валидирует тот же `parseProfilePatch`.
- `GET /api/workspace/me/shop-access` — матрица «кто к каким shop'ам имеет доступ» для TeamPage. Owner видит все shops команды (canEdit=true для всех). Manager видит свои созданные shops (canEdit=true) + shops где он сам assigned (canEdit=false, только его собственная assignment-строка). Каждый shop несёт `createdByUserId / createdByEmail`, каждый assignment — `grantedByUserId / grantedByEmail`. Для read-only shops UI рендерит «доступ от X», для shops «создан X».
- `DELETE /api/workspace/me/members/:userId` — удалить участника (owner/manager; нельзя удалить последнего owner'а).
- `GET /api/invites/:token` (public) → `{workspaceName, role, email, expiresAt}`. `POST /api/invites/:token/accept` (auth) — присоединение.

**Sysadmin endpoints** (`server/routes/admin.ts`, под `requireSysadmin`):
- `/api/admin/users/*` — CRUD юзеров платформы, блокировка, sysadmin-флаг.
- `/api/admin/workspaces` GET/DELETE — список команд + cascade-удаление.
- `/api/admin/smtp/*` — SMTP-настройки сервиса.

**При добавлении новой scoped-фичи**:
1. В `server/db/schema.ts`: FK `shop_id` ON DELETE CASCADE + колонка `user_id NOT NULL` FK на users.
2. В роуте: `userCanAccessShop` для reads/mutations, `eq(table.userId, currentUser.id)` всегда. Owner-only мутации — `canManageWorkspace(role)`. Sysadmin-only — `requireSysadmin`.
3. В тестах создавай юзера + workspace + дефолтный shop через `loginAs(env, email, password)` (helper в `__tests__/server/_helpers.ts`); для assignment-кейсов — `POST /api/shops/:id/members`. См. `__tests__/server/shop-assignment.test.ts` и `multitenant.test.ts`.

### Профили пользователей и брендинг команды (миграции 0026–0027)

**`users.full_name` (NOT NULL DEFAULT '') + `users.job_title` (nullable) + `users.avatar_data_url` (nullable)** — миграция `0026_user_profile`. Backfill для existing rows: `full_name = Upper(emailPrefix)` (повторяет fallback в `POST /api/auth/register`, чтобы старые и новые юзеры жили под одной идентификационной логикой).

**`workspaces.use_logo_as_app_icon` (boolean, default 0)** — миграция `0027`. Когда `true` AND `logoDataUrl` задан, основной SPA-header заменяет дефолтную «Oz»-плитку на лого команды (white-label). Off by default — большинство команд предпочитают продуктовую метку.

**Регистрация**: форма `/register` обязательно требует `fullName` (плейсхолдер «Имя», `maxLength=80`). `jobTitle` опционален. Если API получает запрос без `fullName` — сервер делает defensive-fallback из email-префикса (то же правило, что в миграции). Пустая строка как `fullName` отклоняется (400).

**Endpoints**:
- `PATCH /api/auth/me/profile` — self-edit (любой залогиненный). Поля `{fullName?, jobTitle?, avatarDataUrl?}` все optional, отсутствие = no-op. `jobTitle: null` или `""` → очистка. `avatarDataUrl: null` → удаление аватара. Возвращает обновлённый `publicUser`.
- `PATCH /api/workspace/me/members/:userId/profile` — owner-only (см. workspace endpoints выше).

**Аватары + логотипы (общий контракт хранения)**:
- Хранятся как **base64 data URL'ы** прямо в TEXT-колонках (`avatar_data_url`, `logo_data_url`). Допустимые форматы: `png | jpeg | gif | webp | svg+xml`.
- Лимит — **200 КБ закодированного размера** (`IMAGE_DATA_URL_MAX_LEN`). Это sanity-cap, не первая линия защиты: клиент **обязан** ужать изображение перед отправкой через `src/lib/imageResize.ts:resizeImage(file, opts)`.
  - Аватары: `mode: "crop-square"`, `outputType: "image/jpeg"`, `maxSize: 256px`, `jpegQuality: 0.85`.
  - Логотипы: `mode: "fit"`, `outputType: "image/png"` (часто прозрачные), `maxSize: 256px` — пропорции сохраняются (некоторые лого — широкие wordmark'и).
  - SVG проходит насквозь без растеризации — `fileToDataUrl` читает текст как есть.
- Бэк-валидация — единственная точка истины `server/lib/dataUrl.ts:validateImageDataUrl(value)`; используется и в `workspace.update`, и в `parseProfilePatch`. Все user-facing ошибки на русском.

**Frontend**:
- `src/components/Avatar.tsx` — единая компонента. При наличии `avatarDataUrl` — `<img>` с `object-fit: cover` и круглым `border-radius`. Иначе — инициалы (1–2 буквы) на детерминированном пастельном фоне (HSL hash от `name || email`). Используется и в основном SPA (`AppHeader`, `TeamPage`), и в sysadmin SPA (`atoms.tsx` теперь реэкспорт).
- `src/components/ProfileEditor.tsx` — portal-модалка для редактирования профиля. `mode: "self"` → `api.auth.updateProfile`, `mode: "member"` → `api.workspace.updateMemberProfile(userId, …)`. Используется из `AppHeader` (self), `TeamPage` (member-edit owner'ом), sysadmin `UsersSection`.
- `AppHeader` справа: avatar + (fullName || email) + (jobTitle || роль). Клик — открывает `ProfileEditor` в `mode="self"`. После сохранения вызывается `refresh()` из `AuthContext`, чтобы `user.avatarDataUrl` и `fullName` в UI обновились.
- `WorkspaceBrandingPopover` — управляет цветом, логотипом и `useLogoAsAppIcon`. Загрузка лого → автоматический resize через `resizeImage` (`fit / 256 / image/png`). Кнопка «Использовать логотип как иконку приложения» появляется только когда логотип уже загружен; снимается автоматически при удалении логотипа (одним PATCH'ем, чтобы сервер не держал orphan-флаг).

**При добавлении новой профильной фичи**:
1. Бэк-валидация — расширяй `parseProfilePatch` в `server/lib/profile.ts`, не дублируй inline в роутах.
2. Если новое поле — изображение, используй `validateImageDataUrl` и `imageResize.ts` на клиенте; не дублируй регулярки/лимиты.
3. `SessionUser` + `publicUser` + `AuthUser` в `src/api/index.ts` — синхронно. Любое новое поле в `SessionUser` должно попасть и в `validateSession` (initial select + finalize), и в `publicUser` (login/register/verify responses).
4. Если поле визуально показывается в TeamPage members — добавь его в `listMembers` selector в `server/routes/workspace.ts` и в `WorkspaceMember` в `src/api/index.ts`.

### Версионирование тарифов логистики (миграция 0016)

Точная матрица per-cluster-pair (`Москва ↔ Урал` и т.д.) живёт в **именованных наборах** `logistics_cluster_tariff_sets` — несколько версий могут сосуществовать, чтобы считать факт за прошлый период по тарифам, которые тогда действовали.

- `logistics_cluster_tariff_sets`: id, `workspace_id` (nullable), `name`, `uploaded_at`, `created_at`. `workspace_id IS NULL` → **глобальный** набор (виден всем, грузит только sysadmin). Иначе — **workspace-owned** (виден участникам этой команды).
- `logistics_cluster_tariffs.set_id` (FK NOT NULL, ON DELETE CASCADE) — каждая строка тарифа принадлежит одному набору.
- `shops.tariff_set_id` (nullable) — какой набор использует магазин по умолчанию. NULL → последний глобальный по `uploaded_at`. Member может override per-user через `shop_user_settings.tariff_set_id`.

**Helper `resolveTariffSetId(db, shopId, userId?)`** в `server/settings/tariffSets.ts`: user override → shop.tariffSetId → последний global → null.

**API:**
- `GET /api/refs/cluster-logistics/sets` — список доступных юзеру наборов (глобальные + workspace-owned).
- `POST /api/refs/cluster-logistics/sets` (multipart `file/name/scope/shopId`): `scope=global` требует sysadmin, `scope=shop` — owner/manager workspace'а.
- `DELETE /api/refs/cluster-logistics/sets/:id` — sysadmin для global, owner/manager для workspace.
- `GET /api/refs?shopId=…` отдаёт `logisticsClusterTariffs` (тарифы активного для пары (shop, user) набора) + `activeTariffSetId`.
- Legacy `/refs/cluster-logistics/upload` под `requireSysadmin` — создаёт **новый** глобальный набор с автоименем «Глобальный набор от YYYY-MM-DD».

UI: `src/components/TariffSetsControl.tsx` рендерится в секции «Логистика» в `ShopSettings` — селектор + загрузка (scope «команда» / «общий» — последнее только для sysadmin) + удаление. **scope=shop в API эквивалентен workspace-scoped набору** (сервер берёт `workspace_id` из `shopId`), поэтому в UI лейбл — «Для команды», а не «Только для меня». «Общий (всем командам платформы)» — только sysadmin. Принимает `isOwner` prop: owner/manager пишет выбор в `shops.tariffSetId` (PATCH /shops/:id), member — через `PUT /api/settings/tariff-set` (override).

`ShopSettings` (секция «Логистика», блок «Матрица тарифов Ozon») умеет создать workspace-scoped набор прямо из .xlsx-загрузчика: автоимя `Матрица от YYYY-MM-DD HH:MM`, после загрузки набор сразу активируется на текущем shop (owner — через `shops.tariffSetId`, member — через per-user override). Стат-карточка («В базе: N тарифов · K кластеров») перечитывается при смене активного набора (`useEffect` зависит от `[shopId, currentTariffSetId]`).

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

- `server/db/schema.ts` — Drizzle-схема. Ключевые таблицы: `workspaces` (с `logo_data_url`, `use_logo_as_app_icon`), `workspace_members`, `workspace_invites`, `users` (с `is_sysadmin`, `is_blocked`, `full_name` NOT NULL DEFAULT '', `job_title`, `avatar_data_url`; без `role`), `sessions`, `email_verification_tokens`, `smtp_settings`, `shops` (со `workspace_id`, без `user_id`), `shop_member`, `shop_user_settings`, `products` (PK/UNIQUE `(shop_id, user_id, article_id)`), `finance_transactions` (PK `(shop_id, user_id, operation_id)`), `import_runs` (с audit `user_id` + scope), `user_settings`, `logistics_cluster_tariff_sets` (со `workspace_id`), `logistics_cluster_tariffs`, `ref_commissions`, `ref_storage`, `ref_logistics_tariffs`, `ref_settings`. Удалены в ходе SaaS-миграций: `shop_access` (0020), `api_credentials` (0018), `users.role` (0019).
- `server/db/client.ts` — `openDb({ dbPath })` с auto-migrate, lazy singleton `getDb()` для прода.
- `server/db/migrations/` — генерится через `drizzle-kit generate`. Применяются при старте сервера и в скриптах через `migrate()` из `drizzle-orm/better-sqlite3/migrator` (единый трекер `__drizzle_migrations`). SaaS-миграции: `0019_workspaces`, `0020_workspace_cutover`, `0021_shop_assignment_and_overrides`. Профиль-миграции: `0026_user_profile` (full_name/job_title/avatar_data_url + backfill full_name из email-префикса), `0027_workspace_logo_as_app_icon`.
- `server/middleware/session.ts` — `sessionMiddleware(db)` читает cookie + грузит user в context, `requireAuth` / `requireSysadmin` — гейты для роутов; `canManageWorkspace(role)` для owner/manager-only мутаций; `userCanAccessShop` / `visibleShopIds` для scoped reads.
- `server/auth/utils.ts` — bcrypt hash/compare, генерация токенов, CRUD сессий и email-токенов; `SessionUser` несёт `fullName / jobTitle / avatarDataUrl`. `server/email/{client,templates}.ts` — nodemailer + dev-fallback в stdout (шаблоны `verifyEmail`, `inviteEmail`, `passwordReset`); шаблоны теперь принимают **готовую ссылку**, а не токен — построение ссылки на стороне роута (см. `server/lib/appUrl.ts`).
- `server/lib/` — переиспользуемые валидаторы / билдеры между роутами:
  - `dataUrl.ts` → `validateImageDataUrl(value)` + константы `IMAGE_DATA_URL_RE`, `IMAGE_DATA_URL_MAX_LEN` (~200 КБ). Используется для аватаров и логотипа workspace.
  - `profile.ts` → `parseProfilePatch(raw)` — единая валидация PATCH-payload'а для self-edit и owner-edit (fullName ≤ 80, jobTitle nullable ≤ 80, avatarDataUrl через `validateImageDataUrl`).
  - `appUrl.ts` → `resolveAppUrl(c)` для построения базовых URL писем: `process.env.APP_URL` → заголовок `Origin` (только в non-production, чтобы phishing-Origin не подменил ссылки) → `http://localhost:5173`. Применяется ко всем письмам (verify, reset, invite).
- `server/routes/{auth,admin,workspace,refs,shops,products,settings,credentials,import,finance,analytics}.ts` — по роуту на тему. `import.ts` экспортирует `runCatalogImport` и `runFinanceImport` для тестов. `shops.ts` — CRUD магазинов + assignment endpoints. `workspace.ts` — управление командой + invite-флоу + owner-edit профилей.
- `server/settings/tariffSets.ts` — `resolveTariffSetId(db, shopId, userId?)`: override → shop default → последний global → null.
- `server/settings/shopSettings.ts` — `resolveShopSettings(db, shopId, userId)` / `upsertShopUserSettings` / `clearShopUserSettings` / `userHasShopOverrides`. Per-user overrides поверх shops.
- `server/settings/defaults.ts` — `readDefaultTaxSettings(db)` для seed/новых shops.
- `server/ozon/` — клиент Seller API (`client.ts` с throttle 700мс + retry на 429/5xx), обёртки эндпоинтов (`catalog.ts`, `finance.ts`), маппинг (`mapToProduct.ts`), классификация операций (`classifyOperation.ts`), типы (`types.ts`). `resolveCredentials(db, shopId)` — только shop-уровень (глобальный fallback удалён в 0018).
- `src/sysadmin/` — отдельный SPA для платформенных админов. Свой `vite.config.sysadmin.ts`, dev-port 5174, build → `dist/sysadmin/`. Не имеет доступа к workspace-функционалу (calc/finance/import); только users, workspaces, SMTP, system. Аватарную / профильную логику переиспользует через `src/components/Avatar.tsx` (sysadmin-локальная копия в `atoms.tsx` удалена — реэкспорт).

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
  - UI в `src/sysadmin/sections/UsersSection.tsx` — колонка «Статус» + кнопка-замок (`Ban` / `CircleCheck` из lucide). Заблокированная строка с `opacity: 0.55`, чекбокс sysadmin отключён.
- **SMTP-настройки админки** (миграция `0011` ввела таблицу `smtp_settings`, `0012` добавила колонку `secure`):
  - `secure: 'auto' | 'ssl' | 'starttls' | 'none'`. В `server/email/client.ts:resolveTlsOptions(mode, port)` маппится в nodemailer-флаги: `ssl` → `{ secure: true }`, `starttls` → `{ secure: false, requireTLS: true }`, `none` → `{ secure: false, ignoreTLS: true }`, `auto` → `{ secure: port === 465 }` (исторический дефолт).
  - Env-переменная `SMTP_SECURE` (опциональная) — поддержана `readSmtpFromEnv`.
  - `POST /api/admin/smtp/test` принимает опциональный `subject` и при `describeEmailSource() === "console"` сразу возвращает 400 с предупреждением «SMTP не настроен — письма пишутся в stdout, а не отправляются» (без попытки отправки), плюс пробрасывает в ответ полные поля nodemailer-ошибки (`code`, `responseCode`, `response`, `command`) — UI показывает их в alert, чтобы не лезть в логи сервера.
  - В UI: автозеркалирование `User → From` (пока `From` пустой или совпадает с предыдущим `User`); placeholder порта подстраивается под выбранный `secure`-режим. Mail.ru/Yandex/Gmail требуют, чтобы email в `From` совпадал с `User` — об этом подсказка прямо в форме.
- **Email-шаблон** `server/email/templates.ts` уже на русском. При добавлении новых писем держи единообразный стиль (Noto-friendly inline CSS, кнопка `var(--accent)`-цвета, fallback ссылка для Plain text). **Шаблоны принимают готовую ссылку**, а не raw-токен — построение базовой URL централизовано в `server/lib/appUrl.ts:resolveAppUrl(c)`.
- **База URL писем** — `resolveAppUrl(c)` строится по приоритету: `process.env.APP_URL` (явный override для прода) → заголовок `Origin` запроса (только в non-production, чтобы dev по LAN — `http://192.168.1.50:5173` — работал без env-тюнинга) → `http://localhost:5173`. В проде Origin **намеренно не доверяется** — иначе атакующий мог бы сгенерировать phishing-grade ссылку через подменённый заголовок. Все три типа писем (verify, password reset, invite) идут через этот резолвер.
- **Self-profile** (`PATCH /api/auth/me/profile`) — см. секцию «Профили пользователей и брендинг команды». Email и пароль через этот endpoint не меняются.
- **Password reveal toggle** — компонент `Field` в `src/components/auth/AuthShell.tsx` для `type="password"` рендерит иконку-глазик внутри инпута (`Eye` / `EyeOff` из lucide). Каждое поле управляет своим состоянием независимо; кнопка `tabIndex={-1}`, чтобы Tab её пропускал.
- **При добавлении пути в sysadmin-консоли**: `requireSysadmin` в `server/middleware/session.ts` уже отсеивает не-sysadmin'ов. Не дублируй проверку в роуте; защищай через монтирование (`app.route('/admin', adminRoutes)` уже под `requireSysadmin`). UI пиши в `src/sysadmin/`, не в основном SPA — у обычных юзеров доступа к админке нет.

### TypeScript-конфиг

- Три проекта в composite-сборке: `tsconfig.app.json` (фронт, jsx, dom), `tsconfig.node.json` (vite.config.ts), `server/tsconfig.json` (бэк, без dom).
- `verbatimModuleSyntax: true`, `noUnusedLocals/Parameters: true`, `resolveJsonModule: true`, `erasableSyntaxOnly: true`. Импорты типов нужно явно помечать `import type { ... }`. Параметровые свойства (`constructor(public x)`) запрещены — assign-ить вручную.
- `npm run build` запускает `tsc -b` перед `vite build` — сначала проверяй типы, потом продакшн-сборку.

### Соглашения для PR / автоматизации

- При генерации новой миграции обязательно проверь, что и `extract-data.mjs`, и `seed.mjs`, и тестовые сэтап-функции (`__tests__/server/*.test.ts:setupDb`) применяют **все** SQL-файлы из `server/db/migrations/`.
- При расширении `OzonCommissions` (новые поля API) обнови оба места: `src/types/index.ts` и `server/ozon/types.ts:OzonPriceItem.commissions` (последний импортирует из первого).
- При добавлении новой схемы поставки или поля в `ProductInput` — синхронно правь `products` в `server/db/schema.ts`, валидацию в `server/routes/products.ts:validateInput`, маппер `dbToRow`/`inputToColumns` и `seed.mjs`. Не забудь про `user_id` колонку в `products` — у каждого assignee свои manual-поля.
- При работе с `MappedCatalogEntry` помни различие: **`patch` — поля, всегда обновляемые из Ozon**; **`costPrice` и `ozonSku` — отдельные опциональные поля рядом** (записываются только при `> 0` / `!= null` через условный спред). Не клади их в `patch`, иначе сломаешь логику «не затирать локальное значение, когда Ozon не отдал данных».
- Для аватаров/логотипов **не сериализуй data URL'ы из бэка в UI как обычные строки в местах, где они не показываются** — они весят до 200 КБ и легко раздуют JSON-ответы. `WorkspaceMember.avatarDataUrl` и `users.avatar_data_url` целенаправленно сюда уже включены (UI их рендерит), не размножай это для эндпоинтов, где аватар не нужен.
- Интеграционные тесты профилей и email-link'ов: `__tests__/server/profile.test.ts` (register с fullName/jobTitle, self-PATCH, owner-PATCH, валидаторы), `__tests__/server/email-links.test.ts` (env → Origin → fallback, Origin блокируется в production), `__tests__/server/credentials-isolation.test.ts` (cross-workspace изоляция Ozon-кредов).
