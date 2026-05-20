import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CalcMode, TaxSettings, TaxSystem, VatRate } from "../types";
import PercentInput from "./PercentInput";
import { api, type CredentialsStatus, type Shop } from "../api";
import TariffSetsControl from "./TariffSetsControl";
import ShopSelector from "./ShopSelector";

/** Inline "?" button — click to toggle a popover with hint text. Replaces
 * always-visible gray `.gs-help` blurbs to reduce visual noise. */
function HelpTip({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span ref={ref} className="gs-help-tip">
      <button
        type="button"
        className="gs-help-tip-btn"
        aria-label="Подсказка"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ?
      </button>
      {open && (
        <span className="gs-help-tip-pop" role="tooltip">
          {children}
        </span>
      )}
    </span>
  );
}

interface Props {
  value: TaxSettings;
  onChange: (next: TaxSettings) => void;
  onProductsRefresh?: () => void | Promise<void>;
  onRefsRefresh?: () => void | Promise<void>;
  /** Active shop info — required for cluster-tariff-set selector. */
  shopId?: number | null;
  /** Display name of the active shop — shown in panel title. */
  shopName?: string | null;
  /** Shop accent color (HEX). null → fall back to global --accent. */
  shopColor?: string | null;
  currentTariffSetId?: number | null;
  currentKgtTariffSetId?: number | null;
  userIsAdmin?: boolean;
  /** Called when tariff selection / list changes — App refetches refs+shops. */
  onTariffChanged?: () => void | Promise<void>;
  /** True when the current user can manage shop defaults (workspace
   * owner/manager). Member sees Ozon credentials read-only and writes
   * tax/tariff settings as per-user overrides. */
  shopIsOwner?: boolean;
  /** True when shop_user_settings has any override for current user. */
  shopHasOverrides?: boolean;
  /** Called after a successful "reset overrides" — refetches shops. */
  onResetOverrides?: () => void | Promise<void>;
  /** Full list of shops visible to the user — used for the inline selector
   * in the section header (active-shop picker now lives here, not in AppHeader). */
  allShops?: Shop[];
  /** Switch the active shop (id from `allShops`). */
  onActiveShopChange?: (shopId: number) => void;
  /** Opens the «Управлять магазинами» modal. */
  onManageShops?: () => void;
}

type RateField =
  | "usnIncomeRate"
  | "usnIncomeMinusRate"
  | "ausnIncomeRate"
  | "ausnIncomeMinusRate"
  | "osnoOooRate"
  | "osnoIpAnnualIncome"
  | "npdRate";

interface SystemMeta {
  short: string;
  field: RateField;
  unit: "percent" | "rub";
  rateLabel: string;
}

const SYSTEMS: Record<TaxSystem, SystemMeta> = {
  "УСН Доходы": {
    short: "УСН Доходы",
    field: "usnIncomeRate",
    unit: "percent",
    rateLabel: "Ставка налога",
  },
  "УСН Доходы минус расходы": {
    short: "УСН Д−Р",
    field: "usnIncomeMinusRate",
    unit: "percent",
    rateLabel: "Ставка налога",
  },
  "АУСН Доходы": {
    short: "АУСН Д",
    field: "ausnIncomeRate",
    unit: "percent",
    rateLabel: "Ставка налога",
  },
  "АУСН Доходы минус расходы": {
    short: "АУСН Д−Р",
    field: "ausnIncomeMinusRate",
    unit: "percent",
    rateLabel: "Ставка налога",
  },
  "ОСНО ООО": {
    short: "ОСНО ООО",
    field: "osnoOooRate",
    unit: "percent",
    rateLabel: "Ставка налога на прибыль",
  },
  "ОСНО ИП": {
    short: "ОСНО ИП",
    field: "osnoIpAnnualIncome",
    unit: "rub",
    rateLabel: "Годовой доход, ₽",
  },
  "НПД": {
    short: "НПД",
    field: "npdRate",
    unit: "percent",
    rateLabel: "Ставка налога",
  },
};

const TAX_SYSTEM_ORDER: TaxSystem[] = [
  "УСН Доходы",
  "УСН Доходы минус расходы",
  "АУСН Доходы",
  "АУСН Доходы минус расходы",
  "ОСНО ООО",
  "ОСНО ИП",
  "НПД",
];

const VAT_OPTIONS: { value: string; label: string }[] = [
  { value: "Не облагается", label: "Не облагается (0%) — <60 млн" },
  { value: "0.05", label: "5% — 60–250 млн" },
  { value: "0.07", label: "7% — 250–450 млн" },
  { value: "0.22", label: "22% — >450 млн" },
];

const VAT_SHORT: Record<string, string> = {
  "Не облагается": "без НДС",
  "0.05": "НДС 5%",
  "0.07": "НДС 7%",
  "0.1": "НДС 10%",
  "0.22": "НДС 22%",
};

function useIsMobile(bp = 768): boolean {
  const [m, setM] = useState(
    () => typeof window !== "undefined" && window.innerWidth < bp,
  );
  useEffect(() => {
    const onResize = () => setM(window.innerWidth < bp);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [bp]);
  return m;
}

function formatRub(n: number): string {
  return n.toLocaleString("ru-RU") + " ₽";
}

function isUsn(s: TaxSystem): boolean {
  return s === "УСН Доходы" || s === "УСН Доходы минус расходы";
}

function isOsno(s: TaxSystem): boolean {
  return s === "ОСНО ООО" || s === "ОСНО ИП";
}

// ── icons ──────────────────────────────────────────────────────────────
function Chevron({
  dir = "down",
  size = 14,
}: {
  dir?: "down" | "up" | "right" | "left";
  size?: number;
}) {
  const r =
    dir === "down" ? 0 : dir === "up" ? 180 : dir === "right" ? -90 : 90;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      style={{ transform: `rotate(${r}deg)`, transition: "transform .15s" }}
    >
      <path
        d="M4 6.5l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const IconTax = () => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none">
    <rect
      x="2.5"
      y="2.5"
      width="11"
      height="11"
      rx="2"
      stroke="currentColor"
      strokeWidth="1.4"
    />
    <path
      d="M5.5 5.5l5 5M6 6h.01M10 10h.01"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

const IconTruck = () => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none">
    <path
      d="M1.5 11V4h8v7M9.5 6.5h3l2 2.5V11h-5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    <circle cx="4.5" cy="12" r="1.2" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="11.5" cy="12" r="1.2" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

const IconSliders = () => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none">
    <path
      d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
    <circle
      cx="6"
      cy="4.5"
      r="1.6"
      fill="white"
      stroke="currentColor"
      strokeWidth="1.4"
    />
    <circle
      cx="10"
      cy="8"
      r="1.6"
      fill="white"
      stroke="currentColor"
      strokeWidth="1.4"
    />
    <circle
      cx="5"
      cy="11.5"
      r="1.6"
      fill="white"
      stroke="currentColor"
      strokeWidth="1.4"
    />
  </svg>
);

const IconUpload = () => (
  <svg width={14} height={14} viewBox="0 0 16 16" fill="none">
    <path
      d="M8 10V2.5M5 5.5L8 2.5l3 3M3 11v1.5A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V11"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconClose = () => (
  <svg width={14} height={14} viewBox="0 0 16 16" fill="none">
    <path
      d="M4 4l8 8M12 4l-8 8"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

const IconCog = () => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

// ── helpers ────────────────────────────────────────────────────────────
function buildSummary(value: TaxSettings): string {
  const meta = SYSTEMS[value.taxSystem];
  const rateRaw = value[meta.field];
  const rate =
    meta.unit === "percent"
      ? Number((rateRaw * 100).toFixed(2)) + " %"
      : formatRub(rateRaw);
  if (isUsn(value.taxSystem)) {
    const vat = VAT_SHORT[String(value.usnVatRate ?? "Не облагается")] ?? "";
    return `${meta.short} · ${rate} · ${vat}`;
  }
  return `${meta.short} · ${rate}`;
}

// ── form sections (shared between desktop and mobile) ──────────────────
interface SectionsCtx {
  value: TaxSettings;
  set: <K extends keyof TaxSettings>(key: K, v: TaxSettings[K]) => void;
  clusterStats: { count: number; fromCount: number; toCount: number } | null;
  uploading: boolean;
  uploadMsg: string | null;
  onUploadCluster: (file: File) => void;
  resetting: boolean;
  resetMsg: string | null;
  onResetWhitePurchase: () => void;
  /** Active shop + tariff-set state — required to render the cluster-tariff
   * versioning UI. When `shopId` is null (no active shop), the tariff-set
   * control is hidden. */
  shopId: number | null;
  currentTariffSetId: number | null;
  currentKgtTariffSetId: number | null;
  userIsAdmin: boolean;
  shopIsOwner: boolean;
  onTariffChanged: () => void | Promise<void>;
}

function TaxSection({ value, set }: Pick<SectionsCtx, "value" | "set">) {
  const meta = SYSTEMS[value.taxSystem];
  const rateValue = value[meta.field];
  return (
    <div className="gs-section">
      <div className="gs-section-h">
        <span className="gs-section-icon">
          <IconTax />
        </span>
        <span className="gs-section-title">Налогообложение</span>
      </div>

      <label className="gs-field">
        <span className="gs-label">Система</span>
        <select
          value={value.taxSystem}
          onChange={(e) => set("taxSystem", e.target.value as TaxSystem)}
        >
          {TAX_SYSTEM_ORDER.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <div className="gs-field-pair">
        <label className="gs-field">
          <span className="gs-label">{meta.rateLabel}</span>
          {meta.unit === "percent" ? (
            <PercentInput
              value={rateValue}
              onChange={(v) => set(meta.field, v)}
              step={0.1}
            />
          ) : (
            <div className="gs-num-wrap">
              <input
                type="number"
                step="100000"
                value={rateValue}
                onChange={(e) =>
                  set(meta.field, Number(e.target.value) || 0)
                }
              />
              <span className="gs-suffix">₽</span>
            </div>
          )}
        </label>

        {isUsn(value.taxSystem) ? (
          <label
            className="gs-field"
            title="Зависит от дохода предыдущего года: <60 млн → не платим, 60–250 → 5%, 250–450 → 7%, >450 → 22%."
          >
            <span className="gs-label">Ставка НДС на УСН</span>
            <select
              value={String(value.usnVatRate ?? "Не облагается")}
              onChange={(e) => {
                const v = e.target.value;
                const next: VatRate =
                  v === "Не облагается"
                    ? "Не облагается"
                    : (Number(v) as VatRate);
                set("usnVatRate", next);
              }}
            >
              {VAT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : isOsno(value.taxSystem) ? (
          <div className="gs-hint gs-hint-pair">
            НДС задаётся в карточке каждого товара (per-product).
          </div>
        ) : (
          <div className="gs-hint gs-hint-pair">
            Для выбранной системы НДС не применяется.
          </div>
        )}
      </div>
    </div>
  );
}

function LogisticsSection({
  value,
  set,
  clusterStats,
  uploading,
  uploadMsg,
  onUploadCluster,
  shopId,
  currentTariffSetId,
  currentKgtTariffSetId,
  userIsAdmin,
  shopIsOwner,
  onTariffChanged,
}: SectionsCtx) {
  const hasMatrix = !!clusterStats && clusterStats.count > 0;
  return (
    <div className="gs-section">
      <div className="gs-section-h">
        <span className="gs-section-icon">
          <IconTruck />
        </span>
        <span className="gs-section-title">Логистика и комиссии Ozon</span>
      </div>

      <div className="gs-toggle-row">
        <button
          type="button"
          className={`gs-toggle${value.useClusterLogistics ? " on" : ""}`}
          disabled={!hasMatrix}
          onClick={() =>
            set("useClusterLogistics", !value.useClusterLogistics)
          }
          aria-label="Использовать точную матрицу"
        />
        <div className="gs-toggle-text">
          <div className="gs-toggle-title">Использовать точную матрицу</div>
          <div className="gs-help">
            {hasMatrix
              ? `В базе: ${clusterStats!.count.toLocaleString("ru-RU")} тарифов · ${clusterStats!.fromCount} кластеров`
              : shopId !== null
                ? "Матрица не загружена — загрузите .xlsx ниже"
                : "Выберите магазин, чтобы загрузить матрицу"}
          </div>
        </div>
        {shopId !== null && (
          <label
            className={`gs-btn${uploading ? " gs-btn-disabled" : ""}`}
            title="Загрузить таблицу Ozon (.xlsx) — создаст набор тарифов вашей команды"
          >
            <input
              type="file"
              accept=".xlsx"
              style={{ display: "none" }}
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUploadCluster(f);
                e.target.value = "";
              }}
            />
            <IconUpload />
            <span>{uploading ? "Загружаем…" : "Загрузить .xlsx"}</span>
          </label>
        )}
      </div>
      {uploadMsg && <div className="gs-help gs-help-msg">{uploadMsg}</div>}

      <div className="gs-divider" />

      {shopId !== null && (
        <>
          <span className="gs-label">
            Набор тарифов{" "}
            <HelpTip>
              Несколько наборов можно держать одновременно — пригодится для
              расчёта по старым тарифам.
            </HelpTip>
          </span>
          <TariffSetsControl
            shopId={shopId}
            currentTariffSetId={currentTariffSetId}
            userIsAdmin={userIsAdmin}
            isOwner={shopIsOwner}
            onChanged={onTariffChanged}
            kind="regular"
          />

          <span className="gs-label" style={{ marginTop: 12 }}>
            Сетка тарифов для КГТ{" "}
            <HelpTip>
              Применяется к товарам с признаком «КГТ» (приходит из Ozon
              API). Отдельная тарифная сетка от Ozon — без неё для КГТ-
              товаров используется обычный табличный расчёт.
            </HelpTip>
          </span>
          <TariffSetsControl
            shopId={shopId}
            currentTariffSetId={currentKgtTariffSetId}
            userIsAdmin={userIsAdmin}
            isOwner={shopIsOwner}
            onChanged={onTariffChanged}
            kind="kgt"
          />
          <div className="gs-divider" />
        </>
      )}

      <span
        className="gs-label"
        title="Влияет только на товары с импортированными данными Ozon (бейдж API)."
      >
        Расчёт возвратов и first-mile
      </span>
      <div className="gs-seg">
        <button
          type="button"
          className={`gs-seg-btn${(value.calcMode ?? "tz") === "tz" ? " on" : ""}`}
          onClick={() => set("calcMode", "tz" as CalcMode)}
        >
          Формулы из ТЗ
        </button>
        <button
          type="button"
          className={`gs-seg-btn${value.calcMode === "ozon" ? " on" : ""}`}
          onClick={() => set("calcMode", "ozon" as CalcMode)}
        >
          Формулы Ozon (API)
        </button>
      </div>
    </div>
  );
}

function ParamsSection({
  value,
  set,
  resetting,
  resetMsg,
  onResetWhitePurchase,
}: SectionsCtx) {
  return (
    <div className="gs-section">
      <div className="gs-section-h">
        <span className="gs-section-icon">
          <IconSliders />
        </span>
        <span className="gs-section-title">Параметры расчёта</span>
      </div>

      <label className="gs-field">
        <span className="gs-label">
          Порча, % от стоимости{" "}
          <HelpTip>Применяется ко всем товарам.</HelpTip>
        </span>
        <PercentInput
          value={value.damageRate}
          onChange={(v) => set("damageRate", v)}
          step={0.1}
        />
      </label>

      <div className="gs-field" style={{ marginTop: 12 }}>
        <span className="gs-label">Закупка по умолчанию</span>
        <div className="gs-white-row">
          <label className="gs-check">
            <input
              type="checkbox"
              checked={value.defaultWhitePurchase ?? false}
              onChange={(e) => set("defaultWhitePurchase", e.target.checked)}
            />
            <span>Белая закупка</span>
          </label>
          <button
            type="button"
            className="gs-btn gs-btn-ghost"
            onClick={onResetWhitePurchase}
            disabled={resetting}
            title="Уберёт явное значение «Белая/Не белая» во всех товарах — они будут наследовать значение из этой галки."
          >
            {resetting ? "Сбрасываем…" : "Сбросить во всех товарах"}
          </button>
        </div>
        {resetMsg && <span className="gs-help gs-help-msg">{resetMsg}</span>}
      </div>
    </div>
  );
}

function OzonCredsSection({
  isOwner = true,
}: {
  isOwner?: boolean;
}) {
  const [status, setStatus] = useState<CredentialsStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = async () => {
    try {
      setStatus(await api.credentials.status());
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    let cancelled = false;
    api.credentials
      .status()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((e: Error) => {
        if (!cancelled) setErr(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.credentials.put({
        clientId: clientId.trim(),
        apiKey: apiKey.trim(),
      });
      setClientId("");
      setApiKey("");
      setMsg("Ключи сохранены.");
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeMine = async () => {
    if (!window.confirm("Удалить ключи Ozon API этого магазина?")) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.credentials.remove();
      setMsg("Ключи магазина удалены.");
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  type ActiveSource = NonNullable<CredentialsStatus["activeSource"]>;
  const sourceVariant: Record<
    ActiveSource | "none" | "loading",
    { label: string; hint: string | null; tone: "ok" | "warn" | "err" | "info" }
  > = {
    shop: {
      label: "Подключены ключи этого магазина",
      hint: null,
      tone: "ok",
    },
    none: {
      label: "Ozon не подключён — импорт недоступен",
      hint: "Введите Client-Id и Api-Key кабинета Ozon Seller этого магазина.",
      tone: "err",
    },
    loading: { label: "Загрузка…", hint: null, tone: "info" },
  };
  const key: ActiveSource | "none" | "loading" =
    status === null
      ? "loading"
      : status.activeSource ?? "none";
  const variant = sourceVariant[key];

  return (
    <div className="gs-section">
      <div className="gs-section-h">
        <span className="gs-section-icon">
          <IconSliders />
        </span>
        <span className="gs-section-title">Ozon API</span>
      </div>

      <div className="gs-field">
        <span className="gs-label">Статус подключения</span>
        <div className={`gs-creds-badge gs-creds-badge-${variant.tone}`}>
          <span className="gs-creds-badge-dot" aria-hidden="true" />
          <span>{variant.label}</span>
          {variant.hint && <HelpTip>{variant.hint}</HelpTip>}
        </div>
      </div>

      {isOwner ? (
        <>
          <label className="gs-field" style={{ marginTop: 12 }}>
            <span className="gs-label">Client-Id</span>
            <input
              type="text"
              className="gs-input"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="Введите Client-Id магазина"
            />
          </label>

          <label className="gs-field" style={{ marginTop: 8 }}>
            <span className="gs-label">
              Api-Key{" "}
              <HelpTip>Найти в Ozon Seller → Настройки → Seller API.</HelpTip>
            </span>
            <input
              type="password"
              className="gs-input"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="Введите Api-Key магазина"
            />
          </label>

          <div
            style={{
              marginTop: 12,
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className="gs-btn gs-btn-primary"
              disabled={busy || !clientId.trim() || !apiKey.trim()}
              onClick={() => void save()}
            >
              {busy ? "Сохраняем…" : "Сохранить ключи магазина"}
            </button>
            {status?.shop.hasCredentials && (
              <button
                type="button"
                className="gs-btn gs-btn-ghost"
                disabled={busy}
                onClick={() => void removeMine()}
                title="После удаления — fallback на админские/env"
              >
                Удалить ключи магазина
              </button>
            )}
          </div>

          {msg && <span className="gs-help gs-help-msg">{msg}</span>}
          {err && (
            <span className="gs-help" style={{ color: "var(--err)" }}>
              {err}
            </span>
          )}
        </>
      ) : (
        <div
          className="gs-help"
          style={{ marginTop: 12, lineHeight: 1.5 }}
        >
          Ключи Ozon API задают owner или manager команды. Импорт и расчёт
          работают под этими ключами; ваши товары и финансы хранятся в вашем
          личном пространстве и не пересекаются с данными других участников
          команды.
        </div>
      )}
    </div>
  );
}

type TabId = "tax" | "log" | "params" | "api";

const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: "tax", label: "Налогообложение", icon: <IconTax /> },
  { id: "log", label: "Логистика", icon: <IconTruck /> },
  { id: "params", label: "Параметры расчёта", icon: <IconSliders /> },
  { id: "api", label: "Ozon API", icon: <IconCog /> },
];

function AccordionItem({
  label,
  icon,
  open,
  onToggle,
  children,
}: {
  label: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`gs-acc${open ? " open" : ""}`}>
      <button
        type="button"
        className="gs-acc-trigger"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="gs-acc-icon">{icon}</span>
        <span className="gs-acc-title">{label}</span>
        <span className="gs-acc-chev">
          <Chevron dir={open ? "up" : "down"} />
        </span>
      </button>
      {open && <div className="gs-acc-body">{children}</div>}
    </div>
  );
}

// ── component ──────────────────────────────────────────────────────────
export default function ShopSettings({
  value,
  onChange,
  onProductsRefresh,
  onRefsRefresh,
  shopId = null,
  shopName = null,
  shopColor = null,
  currentTariffSetId = null,
  currentKgtTariffSetId = null,
  userIsAdmin = false,
  onTariffChanged,
  shopIsOwner = true,
  shopHasOverrides = false,
  onResetOverrides,
  allShops,
  onActiveShopChange,
  onManageShops,
}: Props) {
  const titleColor = shopColor ?? "var(--accent)";
  const baseTitle = "Настройки магазина";
  const canPickShop =
    !!allShops && allShops.length > 0 && !!onActiveShopChange;
  // Stop the outer header-button toggle when interacting with the embedded
  // ShopSelector dropdown — clicking it shouldn't collapse the section.
  const stopHeaderToggle = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
  };
  const plainTitleNode = shopName ? (
    <>
      {baseTitle}{" "}
      <span style={{ color: titleColor, fontWeight: 700 }}>«{shopName}»</span>
    </>
  ) : (
    baseTitle
  );
  const titleNode = canPickShop ? (
    <>
      {baseTitle}:{" "}
      <span
        onClick={stopHeaderToggle}
        onMouseDown={stopHeaderToggle}
        onKeyDown={stopHeaderToggle}
        style={{ display: "inline-flex" }}
      >
        <ShopSelector
          shops={allShops!}
          activeShopId={shopId ?? null}
          onSelect={onActiveShopChange!}
          onManage={onManageShops ?? (() => {})}
        />
      </span>
    </>
  ) : (
    plainTitleNode
  );
  const isMobile = useIsMobile(768);
  const [open, setOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("tax");
  const [openSection, setOpenSection] = useState<TabId | null>("tax");
  const toggleSection = (id: TabId) =>
    setOpenSection((cur) => (cur === id ? null : id));

  const [clusterStats, setClusterStats] = useState<{
    count: number;
    fromCount: number;
    toCount: number;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  const set = <K extends keyof TaxSettings>(key: K, v: TaxSettings[K]) =>
    onChange({ ...value, [key]: v });

  useEffect(() => {
    if (shopId == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setClusterStats(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const s = await api.refs.clusterLogisticsStats(shopId);
        if (cancelled) return;
        setClusterStats({
          count: s.count,
          fromCount: s.fromClusters.length,
          toCount: s.toClusters.length,
        });
      } catch {
        /* ignore — keep prior stats so the UI doesn't flicker */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-runs when the active tariff set changes so the «matrix loaded»
    // indicator reflects the currently-selected set, not the one at mount.
  }, [shopId, currentTariffSetId]);

  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheetOpen]);

  const onUploadCluster = async (file: File) => {
    if (shopId == null) {
      setUploadMsg("Ошибка: выберите магазин перед загрузкой матрицы");
      return;
    }
    setUploading(true);
    setUploadMsg(null);
    try {
      // Auto-named workspace-scoped tariff set. The set lives at workspace
      // level (server treats scope="shop" as "workspace, identified via
      // shopId") and stays isolated from other workspaces. Timestamp in the
      // name prevents collisions when multiple files are uploaded the same day.
      const now = new Date();
      const stamp =
        now.toISOString().slice(0, 10) +
        " " +
        String(now.getHours()).padStart(2, "0") +
        ":" +
        String(now.getMinutes()).padStart(2, "0");
      const created = await api.refs.tariffSets.upload({
        file,
        name: `Матрица от ${stamp}`,
        scope: "shop",
        shopId,
      });
      // Activate the new set on this shop. Owner/manager writes the shop
      // default; everyone else gets a per-user override.
      if (shopIsOwner) {
        await api.shops.update(shopId, { tariffSetId: created.id });
      } else {
        await api.settings.putTariffSet(created.id, shopId);
      }
      setUploadMsg(
        `Загружено ${created.rowCount} тарифов · ${created.fromClusters.length} кластеров отправки.`,
      );
      setClusterStats({
        count: created.rowCount,
        fromCount: created.fromClusters.length,
        toCount: created.toClusters.length,
      });
      await onRefsRefresh?.();
      await onTariffChanged?.();
    } catch (e) {
      setUploadMsg(`Ошибка: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const onResetWhitePurchase = async () => {
    if (
      !window.confirm(
        "Сбросить «Белая закупка» во ВСЕХ товарах к «По умолчанию»? " +
          "Это уберёт явные значения в каждой карточке — товары начнут наследовать значение из глобальной галки выше.",
      )
    )
      return;
    setResetting(true);
    setResetMsg(null);
    try {
      const { updated } = await api.products.bulkResetWhitePurchase();
      setResetMsg(`Обновлено ${updated} товаров.`);
      await onProductsRefresh?.();
    } catch (e) {
      setResetMsg(`Ошибка: ${(e as Error).message}`);
    } finally {
      setResetting(false);
    }
  };

  const ctx: SectionsCtx = {
    value,
    set,
    clusterStats,
    uploading,
    uploadMsg,
    onUploadCluster,
    resetting,
    resetMsg,
    onResetWhitePurchase,
    shopId,
    currentTariffSetId,
    currentKgtTariffSetId,
    userIsAdmin,
    shopIsOwner,
    onTariffChanged: onTariffChanged ?? (() => {}),
  };

  if (isMobile) {
    return (
      <div className="gs">
        <button
          type="button"
          className="gs-mobile-trigger"
          onClick={() => setSheetOpen(true)}
        >
          <span className="gs-mobile-trigger-icon">
            <IconCog />
          </span>
          <div className="gs-mobile-trigger-body">
            <div className="gs-mobile-trigger-title">{plainTitleNode}</div>
            <div className="gs-mobile-trigger-sub">{buildSummary(value)}</div>
          </div>
          <span className="gs-mobile-trigger-chev">
            <Chevron dir="right" />
          </span>
        </button>

        <div
          className={`gs-backdrop${sheetOpen ? " open" : ""}`}
          onClick={() => setSheetOpen(false)}
        />
        <div className={`gs-sheet${sheetOpen ? " open" : ""}`} role="dialog">
          <div className="gs-sheet-handle-wrap">
            <div className="gs-sheet-handle" />
          </div>
          <div className="gs-sheet-header">
            <div className="gs-sheet-title">{titleNode}</div>
            <button
              type="button"
              className="gs-iconbtn"
              onClick={() => setSheetOpen(false)}
              aria-label="Закрыть"
            >
              <IconClose />
            </button>
          </div>
          <div className="gs-sheet-body">
            <AccordionItem
              label="Налогообложение"
              icon={<IconTax />}
              open={openSection === "tax"}
              onToggle={() => toggleSection("tax")}
            >
              <TaxSection value={ctx.value} set={ctx.set} />
            </AccordionItem>
            <AccordionItem
              label="Логистика"
              icon={<IconTruck />}
              open={openSection === "log"}
              onToggle={() => toggleSection("log")}
            >
              <LogisticsSection {...ctx} />
            </AccordionItem>
            <AccordionItem
              label="Параметры расчёта"
              icon={<IconSliders />}
              open={openSection === "params"}
              onToggle={() => toggleSection("params")}
            >
              <ParamsSection {...ctx} />
            </AccordionItem>
            <AccordionItem
              label="Ozon API"
              icon={<IconCog />}
              open={openSection === "api"}
              onToggle={() => toggleSection("api")}
            >
              <OzonCredsSection
              isOwner={shopIsOwner}
            />
            </AccordionItem>
          </div>
          <div className="gs-sheet-footer">
            <button
              type="button"
              className="gs-btn"
              onClick={() => setSheetOpen(false)}
            >
              Закрыть
            </button>
            <button
              type="button"
              className="gs-btn gs-btn-primary"
              onClick={() => setSheetOpen(false)}
            >
              Готово
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="gs gs-card">
      <div
        role="button"
        tabIndex={0}
        className="gs-header"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <span className="gs-header-chev">
          <Chevron dir={open ? "down" : "right"} />
        </span>
        <span className="gs-header-title">{titleNode}</span>
        {!shopIsOwner && (
          <span
            className="gs-pill"
            title="Общий магазин команды — настройки задаёт owner или manager"
          >
            общий
          </span>
        )}
        <span className="gs-pill">{value.taxSystem}</span>
      </div>
      {!shopIsOwner && shopHasOverrides && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: "4px 12px 8px",
          }}
        >
          <button
            type="button"
            className="gs-btn gs-btn-ghost"
            onClick={async () => {
              if (
                !window.confirm(
                  "Сбросить ваши персональные настройки этого магазина (СНО, набор тарифов, авто-импорт) к дефолтам команды?",
                )
              )
                return;
              if (shopId == null) return;
              try {
                await api.shops.resetOverrides(shopId);
                await onResetOverrides?.();
              } catch (e) {
                window.alert((e as Error).message);
              }
            }}
            title="Вернуть СНО и тарифы к дефолтам, заданным owner/manager"
          >
            Сбросить к дефолтам команды
          </button>
        </div>
      )}
      {open && (
        <>
          <div className="gs-tabbar">
            <div className="gs-tabs" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === t.id}
                  className={`gs-tab${activeTab === t.id ? " active" : ""}`}
                  onClick={() => setActiveTab(t.id)}
                >
                  <span className="gs-tab-ico">{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="gs-tabpanel" role="tabpanel">
            {activeTab === "tax" && (
              <TaxSection value={ctx.value} set={ctx.set} />
            )}
            {activeTab === "log" && <LogisticsSection {...ctx} />}
            {activeTab === "params" && <ParamsSection {...ctx} />}
            {activeTab === "api" && <OzonCredsSection
              isOwner={shopIsOwner}
            />}
          </div>
        </>
      )}
    </div>
  );
}
