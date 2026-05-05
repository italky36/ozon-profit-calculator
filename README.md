# Калькулятор прибыли продавца Ozon

React + TypeScript + Vite приложение для расчёта маржинальности и налогов
продавца на Ozon. Сравнивает три схемы поставки одновременно: **FBO**,
**FBS**, **realFBS** — по марже, рентабельности к себестоимости и плановой
прибыли.

## Стек

- React 19 + TypeScript
- Vite 8 (dev server, prod-сборка)
- Vitest (юнит-тесты + acceptance-тест)
- xlsx (только в скрипте извлечения справочников)

## Структура

```
src/
  data/                     справочники (JSON, выгруженные из Excel)
    commissions.json        9 515 записей: комиссии Ozon по category × productType
    categories.json         { category: [productType, ...] } — для каскадного селекта
    storage.json            15 456 записей: сроки бесплатного хранения
    logisticsTariffs.json   43 диапазона объёма с тарифами
    lists.json              значения select-полей (taxSystems, vatRates, ...)
    logisticsSettings.json  глобальные параметры логистики
    defaultTaxSettings.json дефолтные ставки налогов
  types/index.ts            все типы (ProductInput, CalcResult, References, ...)
  lib/calc/
    pricing.ts              promoPrice, returnPercent, clamp
    commission.ts           bucket по цене + лукап в commissions
    logistics.ts            тариф (по объёму), доля нелокальных, наценка, last-mile
    storage.ts              freeStorageDays, storageFbo, acceptanceFboFee
    vat.ts                  vatOut, vatIn, vatPayable
    tax.ts                  ndflProgressive (5 ступеней), totalTax
    index.ts                calculateRow(input, settings, refs) → CalcResult
  components/
    GlobalSettings.tsx      сворачиваемая панель: налоговая система, ставки, damageRate
    ProductForm.tsx         форма товара (товар, цена, логистика, хранение, realFBS, закупка, маркетинг)
    ResultsPanel.tsx        таблица сравнения 3 схем + раскрывающаяся детализация
  App.tsx                   корневой компонент (useState + useMemo)
  format.ts                 Intl-форматтеры для ₽ и %
  App.css                   стили
__tests__/calc.test.ts      acceptance-тест (эталон «кофемашина» из ТЗ)
scripts/extract-data.mjs    одноразовый скрипт: xlsx → src/data/*.json
```

## Что сделано

### 1. Извлечение справочников из Excel

Скрипт `scripts/extract-data.mjs` читает `Техника — копия2.xlsx` и
выгружает в `src/data/`:

- `EXPORT_commissions` → `commissions.json` — преобразован в структуру
  `{ key, category, productType, fbo, fbs, realFbs }`, где каждая схема —
  объект с ступенями цены (`upTo100, upTo300, upTo1500, upTo5000,
  upTo10000, over10000`; `realFbs` без двух младших).
- `EXPORT_storage` → `storage.json` — 1-в-1.
- `EXPORT_logisticsTariffs` → `logisticsTariffs.json` — 43 диапазона.
- `EXPORT_settings` (колонка B содержит JSON-строки) → `lists.json`,
  `logisticsSettings.json`, `defaultTaxSettings.json`.
- Дополнительно сгенерирован `categories.json` для каскадного селекта.

Запуск: `node scripts/extract-data.mjs`.

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

- **GlobalSettings** — сворачиваемая панель: налоговая система (select из
  `lists.taxSystems`), редактирование всех ставок и
  `partyExtraExpenses` / `damageRate`.
- **ProductForm** — секции: Товар (с каскадным селектом
  category → productType), Цена и продажи, Логистика (Авто / По доле
  локальных, переключение поля доля/кластеры), Хранение, realFBS,
  Закупка (белая / входящий НДС), Маркетинг.
- **ResultsPanel** — сравнительная таблица FBO / FBS / realFBS с подсветкой
  лучшей схемы по марже (зелёный фон) и раскрывающаяся «Детализация
  расходов» по статьям (комиссия, эквайринг, логистика, last-mile,
  хранение, приёмка, порча, НДС к уплате, налог, итого).
- **App** — `useState` для входа и настроек, `useMemo` для
  пересчёта; ошибки лукапа показываются в отдельной error-панели
  (например, при выборе несуществующей пары категория/тип).

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

## Команды

```bash
npm run dev         # vite dev server
npm run build       # tsc -b && vite build
npm test            # vitest run (один прогон)
npm run test:watch  # vitest в watch-режиме

node scripts/extract-data.mjs   # перегенерация src/data/*.json из xlsx
```

## Замечания по форматированию

- Все деньги внутри — `number` (без округления). Округление только в UI
  через `Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB',
  maximumFractionDigits: 0 })`.
- Все ставки/доли — в долях (`0.05`, не `5 %`); на UI отображаются как
  процент через `Intl.NumberFormat({ style: 'percent' })`.
