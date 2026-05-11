# UI.md

Описание элементов интерфейса калькулятора. Стили — `src/App.css`, компоненты — `src/components/`. CSS-переменные темы заданы в `:root` (`--bg`, `--panel`, `--border`, `--muted`, `--accent`, `--winner`, `--winner-border`, `--error-bg`, `--error-border`).

## Корневой layout

`src/App.tsx` (контейнер `.app`, max-width 1400px):

```
┌─────────────────────────────────────────────────────────────┐
│ <header>                                                     │
│   h1: «Калькулятор прибыли продавца Ozon»                    │
│   p.muted (на calc-табе): подзаголовок                       │
├─────────────────────────────────────────────────────────────┤
│ [actionError panel] — появляется при ошибке мутации, кнопка │
│                       «Закрыть» сбрасывает state             │
├─────────────────────────────────────────────────────────────┤
│ <nav.tabs>                                                   │
│   [Калькулятор] [Финансы]   ← один активный, акцент-цвет     │
├─────────────────────────────────────────────────────────────┤
│ tab-content (calc или finance)                               │
└─────────────────────────────────────────────────────────────┘
```

**Состояния загрузки:**
- `isLoading=true` → шапка + `<p.muted>Загрузка…</p>`. Пока не пришли `refs + products + settings`, рендерим только это.
- `loadError` → красная панель с описанием и подсказкой проверить backend и перелогиниться.
- Ошибки мутаций (`actionError`) — non-blocking-панель сверху, остальной UI работает.

## Tab nav

`.tabs` — flex-контейнер с нижней границей.
`.tab` — кнопка-ссылка без бэкграунда, `border-bottom: 2px solid transparent`, цвет `--muted`.
`.tab.active` — цвет `--accent`, `border-bottom-color: --accent`, `font-weight: 600`.
Состояние `activeTab: "calc" | "finance"` хранится в `App.tsx`.

## Калькулятор (tab=`calc`)

Порядок секций сверху вниз:

### 1. GlobalSettings
`src/components/GlobalSettings.tsx` — панель `.panel` с настройками `taxSettings`. Все изменения идут через debounce 300мс → `PUT /api/settings`. Содержимое:
- Селект `taxSystem` из `lists.taxSystems` (приходит из refs).
- Числовые поля для ставок (`damageRate`, `usnIncomeRate`, `npdRate`, `partyExtraExpenses` и т.д.) с подписями.
- При смене `taxSystem` визуально не скрываем неиспользуемые ставки — пользователь может переключаться без потери ввода.

### 2. Панель «Сравнить с фактом за период» (Phase 4)
`.panel` с одной строкой:

```
[ ] Сравнить с фактом за период   [С даты ___] [По дату ___]   загружаем… / Артикулов с фактом: N
```

Чекбокс `showActuals` управляет всем поведением:
- При включении — `useEffect` дёргает `GET /api/analytics/realized-margin?from&to`, нормализует в `Map<articleId, RealizedMarginRow>`.
- Date-инпуты (тип `date`, `actualsFrom`/`actualsTo`) — по умолчанию last-30-days/today.
- Пока загружается — справа индикатор `загружаем…`. После — счётчик артикулов, для которых пришёл факт.
- Когда чекбокс выключен — `actuals` в `ProductsTable` не передаётся, дополнительные колонки не рендерятся.

### 3. ProductsTable
`src/components/ProductsTable.tsx` — главный экран. Структура секции:

```
.products
  .products-header
    h3: «Товары (N)»
    flex-кнопки (gap 8px):
      [.btn-secondary  Импорт из Ozon ]
      [.btn-primary  + Добавить товар ]
  .products-scroll
    table.products-table  ← всегда горизонтальный скролл при необходимости
```

#### Колонки (по умолчанию)

| # | Заголовок | Содержимое |
|---|---|---|
| 1 | Артикул | `articleId` + опциональный бейдж `.src-badge` «API» (зелёный, tooltip «Комиссии и логистика взяты из Ozon API»), если `row.ozonCommissions !== null` |
| 2 | Название | `productName`, `.ellipsis`, `title` для full-text |
| 3 | Категория | `category`, `.ellipsis` |
| 4 | Цена (`.num`) | `currentPrice` через `fmtRub` |
| 5 | Себест. (`.num`) | `costPrice` |
| 6 | Кол-во (`.num`) | `salesPlan` |
| 7-9 | Маржа FBO/FBS/realFBS (`.num`) | `marginRub` каждой схемы. Победитель помечен классом `.winner` (бледно-зелёный фон) |
| 10 | Лучшая | `.winner-badge` с лейблом схемы (либо `⚠` с tooltip-ошибкой, если `calculateRow` бросил) |
| 11 | actions | `.btn-icon` ⊕ (дублировать) и `.btn-icon.danger` 🗑 (удалить) |

Клик по строке выделяет её (`.selected`) и открывает `ProductDrawer`. Клик по `.actions` останавливает propagation, чтобы не закрывать drawer.

#### Дополнительные колонки (когда `actuals` передан)

После колонки «Лучшая» вставляются три колонки:
- **Продано (факт)** — `salesCount` из realized-margin за период (или `—` если артикул не нашёлся).
- **Факт. маржа, ₽** — `actualMargin` (signed sum всех операций для этого `articleId`), `fmtRub`.
- **Δ к лучшей, %** — относительная разница `(actualMargin - bestSchema.marginRub × salesCount) / |predicted|`, `fmtPct`.

#### Footer (`tfoot`)

Появляется при `rows.length > 0`:

1. **Итого по плану** — `salesPlan`, по схемам — суммы `totalProfit`, лучшая помечена.
2. **Средневзвешенная маржа, %** — `Σ(margin × plan) / Σ(price × plan)` по схеме.
3. **Рентабельность к с/с, %** — то же относительно `costPrice × plan`.
4. (только при `actuals`) **Прогноз × факт.продажи (N шт)** — `Σ(schema.marginRub × salesCount)` по схемам.
5. (только при `actuals`) **Δ факт − прогноз, %** — относительная разница для каждой схемы + ячейка «Факт» с `Σ actualMargin`.

`colSpan` в footer-строках динамически подстраивается под `showActuals`.

#### Пустое состояние
Когда `rows.length === 0` — одна строка `td.empty colSpan=11/14`: «Нет товаров. Нажмите «Добавить товар»».

### 4. ProductDrawer
`src/components/ProductDrawer.tsx` — выезжающая панель справа (или модальная — зависит от верстки `.drawer`). Открывается, когда `selectedId !== null`. Содержит:
- Кнопку закрытия (`onClose`).
- `ProductForm` — все поля `ProductInput` сгруппированные в `<fieldset>`.
- `ResultsPanel` — детальная разбивка `SchemaResult` (commission, acquiring, marketing, logistics, lastMile, storage, acceptance, damage, vatPayable, totalTax, marginRub, marginPercent, profitability, totalProfit) для всех трёх схем.

`ProductForm` использует каскадный селект: при смене `category` → `productType` сбрасывается в первый из `categories[category]`. Для item, пришедшего из Ozon, эти поля редактируемы — но при следующем импорте они обновятся.

### 5. OzonImportModal
`src/components/OzonImportModal.tsx` — модалка через `.modal-backdrop` (`position: fixed; inset: 0; rgba(15,23,42,0.45)`) + `.modal` (`width: min(520px, 90vw)`, max-height 80vh, scroll). Открывается при клике на «Импорт из Ozon», закрывается по фону или ✕ в `.modal-header`.

Шесть состояний (state machine):

| `phase` | Что показано | Переход |
|---|---|---|
| `checking` | «Проверка ключей…» | `GET /api/credentials/status` |
| `need-creds` | Форма Client-Id + Api-Key (password), кнопка «Сохранить» (disabled пока пустые) | `PUT /api/credentials` → `idle` |
| `idle` | Описание; кнопка «Запустить импорт» | `POST /api/import/catalog` → `running` |
| `running` | «Импорт идёт… Обработано: N» | poll `getRun(id)` каждую секунду |
| `done` | «Готово.» + список (Обработано / Добавлено / Обновлено / Без категории), кнопка «Закрыть» | `onImported()` триггерит `refreshProducts()` в App |
| `error` | Красный текст ошибки + «Назад» / «Закрыть» | — |

Отписка от polling — в `useEffect` cleanup и при выходе из `running`.

## Финансы (tab=`finance`)

`src/components/FinanceTab.tsx` — единственный компонент таба. Структура `.panel`:

### 1. Панель управления
Flex-row (gap 12, wrap) с инпутами:
- `[С даты ___]` — `actualsFrom`, по умолчанию last-30-days.
- `[По дату ___]` — `actualsTo`, по умолчанию today.
- `[.btn-primary Импортировать за период]` — disabled во время `importing`.
- `[Тип ▾]` — селект для фильтра `FinanceType` (или «все»).

### 2. RunInfo
Под панелью управления:
- Если `error` — красный `<p>`.
- Если `importing` — «Импорт идёт… Обработано: N» (poll каждую секунду).
- Если `run.status==='ok'` — «Готово. Добавлено: X, пропущено (дубликаты): Y» (из `params`).

### 3. Сводка (только когда `summary.length > 0`)
Маленькая таблица с тремя колонками: «Тип» (label из `TYPE_LABEL`), «Кол-во», «Сумма, ₽». Финальная строка `.totals` — итог по всем типам.

### 4. Операции
Прокручиваемая таблица всех `finance_transactions`, отфильтрованных по периоду + `filterType`. Колонки:

| Дата | Тип | Operation | Артикул | Posting | Сумма, ₽ |
|---|---|---|---|---|---|

- Дата — `toLocaleDateString('ru-RU')`.
- Тип — `TYPE_LABEL[type]` (Продажи / Возвраты / Комиссия / Логистика / Последняя миля / Хранение / Прочее).
- Operation — сырой `operationType` от Ozon, `.ellipsis` с tooltip.
- При `length === 500` показывается `(500+)` — лимит API.

При смене периода или фильтра — повторный fetch (debounce не нужен, инпуты date — discrete events).

## Визуальные конвенции

### Кнопки

| Класс | Когда |
|---|---|
| `.btn-primary` | Главное действие в секции (синий фон, белый текст). `:disabled` — opacity 0.5, no-cursor. |
| `.btn-secondary` | Вторичное действие в той же секции (контурный, акцент-цвет). |
| `.btn-icon` | Action в строке таблицы / закрытие модалки. Border + hover-fill. `.btn-icon.danger` — красная подсветка hover. |

### Бейджи

| Класс | Назначение |
|---|---|
| `.winner-badge` | Лучшая схема в строке/итоге. Зелёный фон (`--winner`), border (`--winner-border`). |
| `.src-badge` | Источник тарифов: «API» если `ozonCommissions` есть. Маленький зелёный outline-бейдж рядом с `articleId`. |

### Таблицы (`.products-table`)
- Нумерик-колонки помечаются классом `.num` (right-align, табличный шрифт).
- `.ellipsis` — однострочный truncate с `title` для tooltip.
- `tr.selected` — выделенная строка (фон-акцент).
- `tr.totals` — итоговая строка футера (жирный, тёмная подложка).
- `tr.totals-sub` — подытог (тоньше, светлее).
- `tr td.empty` — пустое состояние (`text-align: center`, padding).

### Модалки
- `.modal-backdrop` — overlay на весь экран, клик закрывает.
- `.modal` — центрированный контейнер с собственным `onClick` стопом propagation.
- `.modal-header` — flex заголовок + ✕ кнопка.

### Поля формы
- `<fieldset>` с `<legend>` (uppercase, muted) — группирует логически связанные поля.
- Числовые поля, не помещающиеся в одну строку, идут блочно; ставки и проценты — узкими `<input type="number">`.

## Format helpers (`src/format.ts`)

- `fmtRub(n)` → `Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 })`. Возвращает `—` для NaN/Infinity.
- `fmtPct(n)` → `style: 'percent', maximumFractionDigits: 1`. Принимает долю (`0.05`, не `5`).

Округление **только** на этом слое — внутри движка деньги хранятся как полные `number`.

## Реактивность и эффекты

| Событие | Эффект |
|---|---|
| Initial mount | `Promise.all([api.refs.get, api.products.list, api.settings.get])`, спиннер до завершения |
| Любое изменение `rows` или `taxSettings` | `useMemo` пересчёт `Map<rowId, CalcResult>` |
| `taxSettings` change | `setTimeout(300ms)` → `api.settings.put`. Cleanup отменяет пред. таймер. |
| `addRow` / `duplicateRow` | optimistic insert с `temp-` id → `api.products.create` → замена id из ответа. На ошибке — откат. |
| `updateRow` | optimistic replace → `api.products.update`. На ошибке — restore snapshot. |
| `removeRow` | optimistic filter → `api.products.remove`. На ошибке — restore snapshot. |
| `showActuals` toggled / период изменился | fetch `/api/analytics/realized-margin`, нормализация в Map |
| Импорт каталога/финансов | `setInterval(1000ms)` poll `/api/import/runs/:id` пока `status==='running'` |

Все cancel-токены реализованы через локальный `cancelled = false` флаг + cleanup-возврат из `useEffect` — это защищает от race-conditions при быстрой смене зависимостей.

## Расширение UI

При добавлении нового поля в `ProductInput`:
1. `src/types/index.ts` — добавить в `ProductInput`.
2. `src/components/ProductForm.tsx` — добавить элемент управления, обычно в подходящий `<fieldset>`.
3. Если поле должно влиять на `calculateRow` — внести в один из модулей `src/lib/calc/`.
4. Если поле должно отображаться в drawer-результате — расширить `SchemaResult` и `ResultsPanel.tsx`.

При добавлении новой колонки в `ProductsTable`:
1. Добавить `<th>` в `<thead>`.
2. Добавить `<td>` в map по строкам.
3. Если есть `<tfoot>` — обновить `colSpan` для всех footer-строк (учитывая `showActuals`).
4. Обновить empty-state `colSpan`.

При добавлении новой вкладки:
1. Расширить тип `activeTab` в `App.tsx` (`"calc" | "finance" | "newtab"`).
2. Добавить `<button.tab>` в `<nav.tabs>`.
3. Добавить условный блок рендера компонента.
