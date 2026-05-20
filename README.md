# Калькулятор прибыли продавца Ozon

Full-stack приложение для расчёта маржинальности и налогов продавца на
Ozon: фронт на React + TypeScript + Vite, бэкенд на Node + Hono + Drizzle
поверх **Postgres 16**. Сравнивает три схемы поставки одновременно — **FBO**,
**FBS**, **realFBS** — по марже, рентабельности к себестоимости и плановой
прибыли, импортирует каталог и финансы из Ozon Seller API и считает
«прогноз vs факт» по реальным транзакциям. **SaaS-режим**: регистрация
создаёт команду (workspace), owner/manager раздаёт invites сотрудникам,
внутри команды каждый member работает со своими manual-данными и своими
финансами в shared-магазинах. У каждого участника — профиль (имя,
должность, аватар), команда может задать собственный логотип и
использовать его как иконку приложения (white-label). Платформенная
sysadmin-консоль вынесена в отдельный SPA.

## Стек

- React 19 + TypeScript (фронт)
- Vite 8 (dev server, prod-сборка)
- Hono 4 + @hono/node-server + @hono/node-ws (бэкенд API + WebSocket для чата/звонков)
- Drizzle 0.45 + `drizzle-orm/node-postgres` поверх Postgres 16 (`pg.Pool`)
- bcrypt + сессионные cookie (auth), nodemailer (email), web-push (VAPID)
- Vitest 4 (юнит-тесты движка + integration-тесты бэка через `app.request()`, общий pg.Pool с TRUNCATE между файлами)
- xlsx (только в скрипте извлечения справочников)
- **Прод**: Docker Compose на VPS (Caddy + app + postgres:16), CI/CD через GitHub Actions, ежедневный `pg_dump` в cron

## Структура

```
src/                          фронт (React)
  data/                       JSON-эталоны справочников (только для acceptance-теста — рантайм идёт через API)
    commissions.json          ~9 500 записей: комиссии Ozon по category × productType
    categories.json           { category: [productType, ...] } — для каскадного селекта
    storage.json              ~15 500 записей: сроки бесплатного хранения
    logisticsTariffs.json     43 диапазона объёма с тарифами
    lists.json                значения select-полей (taxSystems, vatRates, ...)
    logisticsSettings.json    глобальные параметры логистики
    defaultTaxSettings.json   дефолтные ставки налогов
  types/index.ts              все типы (ProductInput, CalcResult, References, Shop, ...)
  lib/calc/
    pricing.ts                promoPrice, returnPercent, clamp
    commission.ts             bucket по цене + лукап в commissions
    logistics.ts              тариф (по объёму), доля нелокальных, наценка, last-mile
    storage.ts                freeStorageDays, storageFbo, acceptanceFboFee
    vat.ts                    vatOut, vatIn, vatPayable
    tax.ts                    ndflProgressive (5 ступеней), totalTax
    index.ts                  calculateRow(input, settings, refs, perSku?) → CalcResult
  lib/autoRefresh.ts          Map<shopId, Timeout> — независимые таймеры авто-импорта на каждый магазин
  lib/imageResize.ts          shared client-side resize для аватаров и логотипов (canvas-based, 256px, JPEG/PNG)
  api/index.ts                клиент `/api/*` (products, shops, refs, settings, finance, analytics, admin)
  components/
    ShopSettings.tsx          панель настроек активного магазина (налоги, логистика, TariffSetsControl)
    ProductsTable.tsx         таблица товаров + drawer детализации
    ShopsModal.tsx            CRUD магазинов (имя, shortName, цвет) — viewer-поля read-only
    ShopSelector.tsx          селектор активного магазина (в заголовке «Настройки магазина»)
    ShopMultiSelect.tsx       фильтр по магазинам для таблицы (search + чекбоксы)
    ProductFiltersSheet.tsx   bottom-sheet с фильтрами товаров на мобильном
    TariffSetsControl.tsx     селектор активного набора cluster-тарифов + загрузка нового
    BulkActionsBar.tsx        массовые операции над выбранными строками
    OzonImportModal.tsx       UI запуска импорта каталога/финансов с прогрессом
    FinanceTab.tsx            вкладка «Финансы» — список finance_transactions
    Avatar.tsx                shared аватар (img при наличии avatarDataUrl, иначе инициалы на HSL-hash фоне)
    ProfileEditor.tsx         portal-модалка self/owner-edit профиля (имя, должность, аватар)
    WorkspaceBrandingPopover.tsx  попап настройки бренда команды (цвет/лого/use-as-app-icon)
    AppHeader.tsx             хедер: лого приложения, badge команды, профильная кнопка с avatar
    admin/AdminPage.tsx       (deprecated — переехал в src/sysadmin/)
    auth/AuthShell.tsx        формы login/register/verify с password-reveal
    auth/InvitePage.tsx       публичная страница `/invite/:token` для приглашённых
    auth/RegisterPage.tsx     регистрация: email, имя, должность (опц.), workspaceName, пароль
    TeamPage.tsx              вкладка «Команда» — управление workspace (members, invites, профили)
  sysadmin/                   ОТДЕЛЬНЫЙ SPA для платформенных админов (port 5174 в dev)
    main.tsx + SysadminApp.tsx
    sections/UsersSection, WorkspacesSection, SmtpSection, TestSendSection
  App.tsx                     корень (state магазинов, products, refs, calc-loop через useMemo)
server/                       бэкенд (Hono + Drizzle)
  db/
    schema.ts                 Drizzle-схема под Postgres (workspaces, shop_member, shop_user_settings, chat_*, push_subscriptions, …)
    client.ts                 openDb({ databaseUrl }) + auto-migrate, getDb()/initDb() singleton
    migrations/               .sql миграции из drizzle-kit (PG)
    migrations.sqlite-legacy/ старые SQLite-миграции, не активны — оставлены как исторический след
  lib/pgErrors.ts             isUniqueViolation / isForeignKeyViolation (SQLSTATE 23505/23503)
  routes/                     по роуту на тему: auth, admin, workspace, refs, shops,
                              products, settings, credentials, import, finance, analytics
  middleware/session.ts       sessionMiddleware + requireAuth/requireSysadmin +
                              canManageWorkspace + userCanAccessShop + visibleShopIds
  lib/
    dataUrl.ts                validateImageDataUrl + IMAGE_DATA_URL_MAX_LEN (~200 КБ); shared для аватаров и логотипов
    profile.ts                parseProfilePatch (валидатор PATCH-тела профиля для self + owner-edit)
    appUrl.ts                 resolveAppUrl(c) — APP_URL → Origin (dev only) → localhost; база email-ссылок
  auth/utils.ts               bcrypt, сессии, email-токены; SessionUser несёт fullName/jobTitle/avatarDataUrl
  email/{client,templates}.ts nodemailer + русские шаблоны (verify, invite, reset); шаблоны принимают готовую ссылку
  ozon/                       Seller API клиент (throttle 700мс + retry на 429/5xx),
                              маппинг каталога, классификация финансовых операций
  settings/
    tariffSets.ts             resolveTariffSetId(db, shopId, userId?) — учёт user override
    shopSettings.ts           resolveShopSettings(db, shopId, userId), upsertShopUserSettings, …
    defaults.ts               чтение defaultTaxSettings из ref_settings / JSON-fallback
  index.ts                    buildApp({ db?, importContext? }) — единая точка сборки
__tests__/
  calc.test.ts                acceptance-тест движка (эталон «кофемашина», JSON-справочники)
  server/*.test.ts            integration-тесты бэка (products, finance, import, shops, profile,
                              email-links, credentials-isolation, multitenant, shop-assignment, …)
scripts/
  extract-data.mjs            Excel → Postgres ref_* + cluster-тарифы (через глобальный набор)
  seed.mjs                    первый sysadmin + его workspace + дефолтный shop «Мой магазин (M1)»
  migrate.mts                 CLI для применения миграций (используется в Docker entrypoint)
  backup-db.sh                pg_dump в /var/backups/profitcontrol/ — ставится в cron на прод-сервере
Dockerfile                    multi-stage сборка прод-образа app
docker-compose.yml            прод-стек (caddy + app + postgres:16-alpine)
Caddyfile                     роутинг app.profitcontrol.io / su.profitcontrol.io
docker-entrypoint.sh          wait-postgres → sync статика → migrate → seed → tsx server/index.ts
.github/workflows/deploy.yml  CI/CD на push в main
```

## Что сделано

### 1. Извлечение справочников из Excel

Скрипт `scripts/extract-data.mjs` читает `Техника — копия2.xlsx` и
наполняет Postgres:

- `EXPORT_commissions` → `ref_commissions` со структурой
  `{ key, category, productType, fbo, fbs, realFbs }`, где каждая схема —
  объект с ступенями цены (`upTo100, upTo300, upTo1500, upTo5000,
  upTo10000, over10000`; `realFbs` без двух младших).
- `EXPORT_storage` → `ref_storage`.
- `EXPORT_logisticsTariffs` → `ref_logistics_tariffs` (43 диапазона).
- `EXPORT_settings` (колонка B содержит JSON-строки) → `ref_settings`
  (`lists`, `logisticsSettings`, `defaultTaxSettings`).
- Cluster-матрица — наполняет таблицу `logistics_cluster_tariffs`
  через глобальный набор `logistics_cluster_tariff_sets`.

JSON-эталоны тех же справочников в `src/data/` сохранены **только**
для acceptance-теста (`__tests__/calc.test.ts`) — фронт их больше не
импортирует, рантайм идёт через `GET /api/refs?shopId=…`.

Запуск: `npm run db:extract` (или `EXTRACT_SOURCE=… npm run db:extract`).

### 2. Типы (`src/types/index.ts`)

Все типы из ТЗ: `TaxSystem`, `VatRate`, `IncomingVatRate`,
`AcceptanceTariff`, `LogisticsMode`, `ClustersCount`, `TaxSettings`,
`LogisticsSettings`, `CommissionRow`, `StorageRow`, `LogisticsTariffRow`,
`ProductInput`, `SchemaResult`, `CalcResult`, `References`.

### 3. Движок расчёта (`src/lib/calc/`)

Реализованы все формулы из §3 ТЗ:

- **Базовое**: `promoPrice = currentPrice × (1 − discountPercent)`,
  `returnPercent`, `returnPercentInt`.
- **Бесплатное хранение**: пожароопасный → 60, КГТ →
  `freeStorageDaysKgt`, Казахстан → `freeStorageDaysKz`, иначе →
  `freeStorageDays`.
- **Комиссии**: bucket по `promoPrice` (≤100/300/1500/5000/10000/прочее),
  realFBS — 4 ступени.
- **Эквайринг** = 1.5 %, **маркетинг** — настраиваемая доля.
- **Логистика**: VLOOKUP по объёму; доля нелокальных и markup-доля по
  режиму `Авто` / `По доле локальных`; `markupShare = 0` для
  «Считать без наценки» и для 26 кластеров.
- **Last-mile** = `min(price × 0.01, 25)`.
- **Услуги Ozon при возврате**, **maxLoss** (потери возврата),
  **realFBS-доставка**.
- **Приёмка FBO** — 4 тарифа с потолками; **FBS** — 30 ₽ фикс.
- **Хранение FBO** — `overdueDays × volume × ratePerLPerDay`
  (0.6 / 0.1 / 0.35 / 2.5).
- **Доли услуг Ozon** (для НДС/налоговой базы).
- **НДС**: исходящий (`vatOut`), входящий по схеме (`vatIn`), к уплате
  (`vatPayable`) — с учётом матрицы taxSystem × vatRate.
- **НДФЛ ОСНО ИП** — прогрессивная шкала по 5 ступеням
  (13 / 15 / 18 / 20 / 22 %), масштабирование по
  `(promoPrice − expensesNdfl) / promoPrice`.
- **Сводный налог** для всех 7 систем (УСН Д / УСН Д−Р / АУСН Д /
  АУСН Д−Р / ОСНО ООО / ОСНО ИП / НПД), с правильной базой и
  отдельным учётом НДС к уплате. Отрицательный налог обрезается до 0
  (`Math.max(0, ...)`).
- **Маржа, рентабельность, totalProfit** для каждой из 3 схем.

### 4. UI (`src/components/`, `src/App.tsx`)

- **ShopSettings** — сворачиваемая панель настроек активного магазина:
  налоговая система (select из `lists.taxSystems`), ставки и
  `partyExtraExpenses` / `damageRate`, `TariffSetsControl` внутри секции
  «Логистика».
- **ProductsTable** — табличный список товаров с inline-редактированием,
  колонками по 3 схемам поставки (FBO / FBS / realFBS) с подсветкой
  лучшей по марже, бейджем «API» рядом с articleId при наличии
  `ozonCommissions`, и drawer'ом «Детализация расходов» по статьям
  (комиссия, эквайринг, логистика, last-mile, хранение, приёмка, порча,
  НДС к уплате, налог, итого).
- **BulkActionsBar** — массовые операции над выбранными строками
  (удаление, дублирование, изменение поля).
- **ShopSelector** / **ShopsModal** — выбор активного магазина (или
  «Все магазины») в шапке и CRUD магазинов.
- **OzonImportModal** — UI запуска импорта каталога и финансов с
  индикатором прогресса.
- **App** — держит state магазинов и товаров, мутации через
  `api.products.*` с optimistic update, calc-loop в `useMemo`;
  ошибки лукапа показываются в отдельной error-панели (например, при
  выборе несуществующей пары категория/тип, и только для товаров не из
  Ozon API).

### 5. Acceptance-тест (`__tests__/calc.test.ts`)

Эталон «кофемашина» из §5 ТЗ:

```
category: "Кофеварки и кофемашины", productType: "Автоматическая кофемашина",
volumeL: 209, redemptionPercent: 90, salesPlan: 10,
currentPrice: 337 000, discountPercent: 0.345, vatRate: 0.05,
costPrice: 87 000, taxSystem: "УСН Доходы минус расходы"
```

Результаты сходятся в пределах ~±500 ₽:

| Показатель           | Ожидаемое | Расчётное |
| -------------------- | --------: | --------: |
| `promoPrice`         |   220 735 |   220 735 |
| `fbo.marginRub`      |   ~25 190 |   ~25 089 |
| `fbs.marginRub`      |   ~12 845 |   ~12 744 |
| `realFbs.marginRub`  |   ~13 836 |   ~13 601 |
| `fbo.profitability`  |  ~28.95 % |  ~28.83 % |

Дополнительные тесты: нулевая `costPrice`, граничные цены
100/300/1500/5000/10000, инвариант `totalProfit = marginRub × salesPlan`.

## Отступление от ТЗ

В §3.14 ТЗ для FBO/FBS в `deliveryCost` включены `damageRub` и (для FBS)
дублирующий `+30` (приёмка FBS, который потом ещё раз добавляется в §3.22
`expensesFbs`). Это даёт расхождение с Excel-эталоном на ~2 300 ₽ для
FBO/FBS. После исключения `damageRub` из `deliveryCostFbo` и
`deliveryCostFbs` (порча на FBO/FBS — на стороне Ozon) и удаления
дубля 30 ₽ результаты сходятся в указанный спецификацией допуск
±100 ₽ / ±500 ₽. Для realFBS `damageRub` сохранён в `deliveryCost`.

Кросс-докинг (§3.15) — `crossDocking = 0` с TODO, мини-калькулятор не
реализован в v1.

## SaaS-модель: workspace + per-shop assignment

Приложение работает как multi-tenant SaaS с двухуровневой моделью
доступа (миграции `0019`–`0021`).

### Workspaces (команды)

- Регистрация через `/register` создаёт user + **workspace** + owner-
  membership + дефолтный shop **в одной транзакции**. Один user = один
  workspace (UNIQUE на `workspace_members.user_id`). Форма требует
  `email`, имя, пароль (≥ 8 символов) и `workspaceName` (либо `inviteToken`).
  Должность — опционально.
- Роли в команде: `owner` (создатель, не удаляется автоматически),
  `manager` (раздаёт invites, управляет shops/assignment), `member`
  (работает со своими данными в назначенных shops).
- **Invites**: owner/manager на вкладке «Команда» вводит email + роль →
  бэкенд создаёт токен (TTL 7 дней) и шлёт письмо. Получатель идёт по
  ссылке `/invite/:token`: если не зарегистрирован — `/register?invite=…`
  кладёт его сразу в workspace без создания новой команды; если уже
  залогинен — кнопка «Принять».
- **TeamPage** (вкладка «Команда» в основном SPA) — общий список
  members и pending-invites с поиском (по имени / email / должности с
  подсветкой совпадений), фильтром по роли, drawer'ом «доступ к
  магазинам» и редактором профилей участников (owner-only).
- Endpoints: `GET/PATCH /api/workspace/me`, CRUD `/me/invites`,
  `PATCH/DELETE /me/members/:userId`,
  `PATCH /me/members/:userId/profile` (owner-edit имени/должности/аватара),
  `GET /me/shop-access` (матрица доступов), публичный
  `GET /api/invites/:token`.

### Магазины и assignment

- **Shop принадлежит workspace** (`shops.workspace_id NOT NULL`), не
  user'у. Owner/manager создаёт shop через ShopsModal.
- **Hard-gate ассайнмент**: `shop_member(shop_id, user_id)` — owner
  видит все workspace shops безусловно; manager/member — только те,
  где есть запись в `shop_member`. Раздача через UI «Доступ» в
  ShopsModal или `POST /api/shops/:id/members`. Отзыв cascade-удаляет
  per-user `products`/`finance_transactions`/`import_runs`/
  `shop_user_settings` этого юзера в shop'е.

### Что общее, что персональное

| Уровень | Что хранит | Видно кому |
|---|---|---|
| **Shop** | `name/shortName/color/taxSettings/autoRefresh*/tariffSetId/ozonClient*` (дефолты команды), Ozon-креды | Всем assignee shop'а |
| **Catalog-поля products** (`productName`, `category`, `currentPrice`, `ozonCommissions`, `ozonSku`, …) | Синкаются у всех assignee при импорте каталога | Всем assignee |
| **Manual/financial поля products** (`costPrice`, `salesPlan`, `marketingPercent`, `redemptionPercent`, `whitePurchase`, …) | per-user; PK/UNIQUE `(shop_id, user_id, article_id)` | Только current user |
| **`finance_transactions`** (PK `(shop_id, user_id, operation_id)`) | per-user; каждый импортирует свой период | Только current user |
| **`shop_user_settings`** (override: `tax_settings/tariff_set_id/auto_refresh_*`) | per-user override поверх shop default; NULL = inherit | Только current user |
| **`import_runs.user_id`** | per-user история импортов | Только current user |

`server/settings/shopSettings.ts:resolveShopSettings(db, shopId, userId)`
возвращает effective settings — каждое поле независимо: override →
shop default. `userHasShopOverrides` гейтит кнопку «Сбросить к
дефолтам команды» в `ShopSettings`. Owner/manager пишет в `shops.*`
через `PATCH /api/shops/:id`; member пишет в `shop_user_settings.*`
через `PUT /api/settings`, `PUT /api/settings/auto-refresh`,
`PUT /api/settings/tariff-set` (override очищается, когда совпадает с
shop default).

### Sysadmin

- Платформенная роль (`users.is_sysadmin = true`), **не связана с
  workspace'ами**. Управляет SaaS-сервисом: users (блокировка,
  верификация, sysadmin-флаг), workspaces (список, удаление с cascade),
  SMTP.
- Живёт в **отдельном SPA** — `src/sysadmin/` (port 5174 в dev,
  отдельный `vite.config.sysadmin.ts`, build → `dist/sysadmin/`,
  в prod деплоится на `admin.<domain>`). Основной SPA для sysadmin'а
  показывает redirect-экран.
- Создаётся только через seed (`scripts/seed.mjs`) или promote через
  `PUT /api/admin/users/:id/sysadmin`.

### Ozon credentials

Только shop-уровень (`shops.ozonClientId/ozonApiKey`). Глобальный
fallback и env-vars `OZON_CLIENT_ID/API_KEY` удалены в миграции `0018` —
иначе магазин без своих ключей подтянул бы каталог чужого Ozon-аккаунта.
Owner/manager задаёт ключи через ShopSettings → Ozon API; member видит
read-only баннер «ключи задаёт owner/manager команды».

## Профили пользователей и брендинг команды

Миграции `0026_user_profile` и `0027_workspace_logo_as_app_icon`.

### Профиль (имя, должность, аватар)

- `users.full_name` (NOT NULL DEFAULT ''), `users.job_title` (nullable),
  `users.avatar_data_url` (nullable). Backfill при миграции:
  `full_name = Upper(emailPrefix)` для существующих юзеров.
- В UI справа в шапке — аватар + имя + должность (или роль, если
  должность не задана). Клик открывает `ProfileEditor` —
  редактирование собственного профиля. После сохранения `AuthContext`
  делает `refresh()`, и обновлённые поля сразу подтягиваются во все
  места, где они показаны.
- **Self-edit**: `PATCH /api/auth/me/profile` body
  `{fullName?, jobTitle?, avatarDataUrl?}`. Все поля опциональны;
  `jobTitle: null | ""` очищает; `avatarDataUrl: null` удаляет аватар.
- **Owner-edit**: `PATCH /api/workspace/me/members/:userId/profile` —
  только owner workspace'а может править имя/должность/аватар других
  участников. Open via TeamPage → правое меню в строке участника.
- **Валидация** (`server/lib/profile.ts:parseProfilePatch`): имя
  trimmed, 1–80 символов; должность 0–80 символов; аватар через
  `validateImageDataUrl` (см. ниже). Все user-facing ошибки на русском.

### Аватары и логотипы — общий контракт хранения

- Хранятся как **base64 data URL'ы** прямо в TEXT-колонках
  (`users.avatar_data_url`, `workspaces.logo_data_url`). Поддерживаемые
  форматы: `png | jpeg | gif | webp | svg+xml`.
- Жёсткий лимит — **200 КБ** закодированного размера
  (`IMAGE_DATA_URL_MAX_LEN`); единый валидатор — `server/lib/dataUrl.ts:validateImageDataUrl()`.
- Клиент **обязан** ужать изображение перед отправкой через
  `src/lib/imageResize.ts:resizeImage(file, opts)`:
  - **Аватары**: `mode: "crop-square"`, `outputType: "image/jpeg"`,
    `maxSize: 256px`, `jpegQuality: 0.85` — фотографии хорошо жмутся.
  - **Логотипы**: `mode: "fit"`, `outputType: "image/png"`,
    `maxSize: 256px` — аспект сохраняется (бывают широкие wordmark'и),
    PNG нужен для прозрачности.
  - **SVG проходит насквозь** без растеризации.

### Брендинг команды

- `workspaces.logo_data_url` + `workspaces.color` (HEX) — цвет
  применяется к плашке команды в шапке и кнопке-CTA в письмах.
- `workspaces.use_logo_as_app_icon` (boolean, default `false`). Когда
  `true` AND логотип задан — основной SPA-header заменяет дефолтную
  «Oz»-плитку на логотип команды (white-label). Off by default —
  большинство команд предпочитают продуктовую метку, но white-label
  нужен корпоративным внедрениям.
- Настройка — попап `WorkspaceBrandingPopover` (открывается по клику
  на плашку команды в шапке). Доступно только owner'у. Удаление
  логотипа автоматически снимает `useLogoAsAppIcon` в том же
  PATCH'е — сервер не сторожит orphan-флаг сам.

## Email-ссылки в письмах

`server/lib/appUrl.ts:resolveAppUrl(c)` строит базовый URL для всех
ссылок в выпускных письмах (verify, password reset, invite). Приоритет:

1. `process.env.APP_URL` — явный override для прода.
2. Заголовок `Origin` запроса — **только в non-production**, чтобы dev
   по LAN (`http://192.168.1.50:5173`) работал без env-тюнинга. В
   проде Origin намеренно не доверяется — атакующий мог бы выдать
   phishing-grade ссылку через подменённый заголовок.
3. `http://localhost:5173` — last-ditch fallback.

Шаблоны в `server/email/templates.ts` принимают **готовую ссылку**, а
не raw-токен — построение URL происходит на стороне роута.

## Версионирование тарифов логистики

Cluster-матрица (`Москва ↔ Урал` и т.д.) живёт в **наборах**
(`logistics_cluster_tariff_sets`, миграция `0016`) — несколько версий
могут сосуществовать, чтобы считать факт за прошлый период по тарифам,
которые тогда действовали.

- Набор может быть **глобальным** (`workspace_id IS NULL`, виден всем,
  грузит только sysadmin) или **командным** (виден участникам команды;
  грузит owner/manager). В UI scope-лейблы: «общий» (для всех команд
  платформы) / «команда» (только в текущей команде).
- `shops.tariff_set_id` — какой набор использует магазин по умолчанию
  (NULL → последний глобальный). Member может override per-user через
  `shop_user_settings.tariff_set_id` (`PUT /api/settings/tariff-set`).
- Управление через `GET/POST/DELETE /api/refs/cluster-logistics/sets` и
  UI-компонент `TariffSetsControl` внутри секции «Логистика». В
  `ShopSettings` есть отдельный .xlsx-загрузчик матрицы: создаёт
  командный набор с автоименем `Матрица от YYYY-MM-DD HH:MM` и сразу
  активирует его на текущем магазине.

## Импорт из Ozon Seller API

- **Каталог** (`POST /api/import/catalog?shopId=…`): пагинирует
  `/v3/product/list`, батчит `info/list` + `info/prices`, резолвит
  категории через `description-category/tree`. Merge: существующая
  строка обновляет только catalog-поля; локальные `salesPlan /
  marketingPercent / redemptionPercent / costPrice` сохраняются.
- **Финансы** (`POST /api/import/finance?shopId=…` с `{from, to}`):
  пагинирует `/v3/finance/transaction/list`, классифицирует операции в
  `sale | refund | commission | logistics | last_mile | storage | other`,
  PK = (`shop_id`, `operation_id`) → идемпотентно.
- **Прогресс**: fire-and-forget, статус через `GET /api/import/runs/:id`,
  UI поллит каждую секунду.
- **Авто-импорт** настраивается per-shop (`shops.autoRefreshEnabled`,
  `autoRefreshIntervalMin`); клиент держит `Map<shopId, Timeout>`
  независимых таймеров.

## Аналитика «прогноз vs факт»

`GET /api/analytics/realized-margin?from&to&shopId=…` — SQL-агрегат
`finance_transactions` по `articleId`. Отдаёт `actualRevenue/Refund/
Commission/Logistics/LastMile/Storage/Other`, `actualMargin = sum(amount)`,
`salesCount`, `txCount`. В UI на вкладке «Калькулятор» чекбокс
«Сравнить с фактом за период» добавляет колонки в таблицу и подвал с
«Прогноз × факт.продажи» и «Δ факт − прогноз, %».

## Админка и аутентификация

Двухуровневая система ролей: **sysadmin** (платформенный оператор,
живёт в отдельном SPA `src/sysadmin/`) + **workspace-роли** owner/
manager/member (внутри команды, вкладка «Команда» в основном SPA).
Регистрация через `/register` создаёт workspace и делает юзера его
owner'ом; sysadmin'ы создаются только через `scripts/seed.mjs` или
`PUT /api/admin/users/:id/sysadmin`.

- **Регистрация и логин** — `/register`, `/login`, `/verify-email`. При
  регистрации обязательны `email`, имя, пароль (≥ 8 символов) и
  `workspaceName` (или `inviteToken` из ссылки `/invite/:token` —
  тогда юзер попадает в чужой workspace без создания своего).
  Должность — опционально. Все ошибки и сообщения локализованы на
  русский. В полях паролей — иконка-глазик (`Field` в
  `src/components/auth/AuthShell.tsx`) для переключения видимости.
- **База URL писем** строится через `resolveAppUrl(c)` —
  см. раздел «Email-ссылки в письмах» выше.
- **Блокировка пользователей** (`users.is_blocked`, миграция `0013`):
  sysadmin может временно отключить вход без удаления данных через
  кнопку-замок в Sysadmin Console → Users. При блокировке все активные
  сессии юзера удаляются — его сразу выкидывает со всех устройств.
  `validateSession` дополнительно отвергает заблокированных как
  defence-in-depth.
- **SMTP-настройки** хранятся в БД (`smtp_settings`, миграции `0011`,
  `0012`) и редактируются в Sysadmin Console. Поддерживаются режимы
  шифрования `auto / ssl / starttls / none` (маппятся в nodemailer-флаги
  `secure` / `requireTLS` / `ignoreTLS` в `server/email/client.ts`).
  Приоритет источников: запись в БД → env-переменные
  `SMTP_HOST/PORT/USER/PASS/FROM/SECURE` → fallback в stdout (dev).
  Есть тестовая отправка с настраиваемой темой и подробной диагностикой
  ошибок SMTP-сервера в ответе (`code`, `responseCode`, `response`).
- **Подсказки по провайдерам** — Mail.ru / Yandex / Gmail требуют
  app-specific password и совпадения email в `From` с `User`. Форма
  автозеркалирует `User → From`, пока админ не задал кастомный
  display-name.
- **Sysadmin живёт отдельно** — `localhost:5174` в dev (см. ниже команды),
  отдельный bundle в prod на `admin.<domain>`. Если sysadmin логинится
  в основной SPA — видит redirect-экран с кнопкой на консоль.

## Команды

```bash
# Dev
npm run dev               # vite (5173, workspace SPA) + tsx watch server/index.ts (3001) +
                          # vite --config vite.config.sysadmin.ts (5174, sysadmin SPA)
npm run dev:web           # только основной SPA
npm run dev:api           # только бэк
npm run dev:sysadmin      # только sysadmin SPA

# Сборка и проверки
npm run build             # tsc -b + vite build (web) + vite build (sysadmin)
npm run build:web         # только основной SPA
npm run build:sysadmin    # только sysadmin SPA
npm run lint              # eslint .
npm test                  # vitest run (~400 тестов; нужен запущенный Postgres — см. ниже)
npm run test:watch        # vitest в watch-режиме
npm start                 # tsx server/index.ts (прод-entrypoint, используется в Docker)

# БД
npm run db:generate       # drizzle-kit generate после правок server/db/schema.ts
npm run db:migrate        # drizzle-kit migrate (обычно не нужно — runtime сам мигрирует
                          #   через initDb() / в Docker entrypoint через scripts/migrate.mts)
npm run db:seed           # первый sysadmin + workspace + дефолтный shop «Мой магазин (M1)»
npm run db:extract        # Excel → Postgres ref_* + глобальный набор cluster-тарифов
                          # (EXTRACT_SOURCE=… npm run db:extract — кастомный путь к xlsx)
```

Первый запуск:

1. `cp .env.example .env` — настроить `ADMIN_EMAIL/ADMIN_PASSWORD` для
   первого sysadmin'а. SMTP в `.env` не нужен — настраивается через
   sysadmin UI после первого входа (без SMTP письма уйдут в stdout).
2. Поднять локальный Postgres и тестовую базу:
   ```bash
   docker run -d --name ozon-pg -p 5433:5432 \
     -e POSTGRES_PASSWORD=dev_password_change_me \
     -e POSTGRES_DB=ozon_calc postgres:16-alpine
   docker exec ozon-pg createdb -U postgres ozon_calc_test
   ```
3. `npm run db:seed` (применит миграции внутри `initDb()` + создаст
   первого sysadmin'а если таблица `users` пуста).
4. `npm run db:extract`.
5. `npm run dev` → sysadmin идёт на `http://localhost:5174/`,
   обычные юзеры регистрируются на `http://localhost:5173/register`.

## Деплой и прод

Прод живёт на VPS как Docker Compose стек: `caddy:2-alpine` (TLS автоматом
через Let's Encrypt) + `app` (multi-stage Node-образ из `Dockerfile`) +
`postgres:16-alpine`. Два домена через Caddy: основной SPA + API на
`app.<host>`, sysadmin SPA + API на `su.<host>`. Caddy сам проксирует
`/api/*` на `app:3001` (с поддержкой WebSocket для чата/звонков) и
раздаёт статику обоих SPA из shared volumes.

**Развёртывание с нуля на сервере** (Docker уже стоит):

```bash
git clone <repo-url> /opt/profitcontrol && cd /opt/profitcontrol
cp .env.production.example .env   # и заполнить пароли
docker compose up -d --build
```

`docker-entrypoint.sh` в контейнере app сам делает: ждёт Postgres →
синкает `dist/` в shared volumes → `tsx scripts/migrate.mts` → `node
scripts/seed.mjs` → стартует сервер. Caddy на первом старте получает
сертификаты Let's Encrypt (домены должны указывать на сервер).

**CI/CD** (`.github/workflows/deploy.yml`). На push в `main`:

1. **test**: postgres-service, `npm ci`, `tsx scripts/migrate.mts`,
   `npm run lint`, `npm test`, `npm run build`.
2. **deploy** (если test зелёный): SSH через `appleboy/ssh-action` на
   сервер, `git reset --hard origin/main && docker compose up -d --build`.

Требуются 3 GH secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`.
Миграции автоматически накатываются в entrypoint при перезапуске app.

**Бэкапы** (`scripts/backup-db.sh`). На прод-сервере ставится в cron:

```
0 3 * * * /opt/profitcontrol/scripts/backup-db.sh >> /var/log/profitcontrol-backup.log 2>&1
```

Делает `docker compose exec db pg_dump | gzip -9` в
`/var/backups/profitcontrol/db-YYYYMMDD-HHMMSS.sql.gz`, retention 14
дней. Restore: `gunzip -c <dump> | docker compose exec -T db psql -U
app -d ozon_calc` (после `docker compose stop app`).

## Замечания по форматированию

- Все деньги внутри — `number` (без округления). Округление только в UI
  через `Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB',
  maximumFractionDigits: 0 })`.
- Все ставки/доли — в долях (`0.05`, не `5 %`); на UI отображаются как
  процент через `Intl.NumberFormat({ style: 'percent' })`.
