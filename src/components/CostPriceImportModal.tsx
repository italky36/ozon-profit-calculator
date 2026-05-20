import { useRef, useState } from "react";
import { Check, FileSpreadsheet, Upload, X } from "lucide-react";
import { api, type CostImportReport } from "../api";

interface Props {
  onClose: () => void;
  onImported: () => void;
}

type Phase = "idle" | "uploading" | "preview" | "applying" | "done";

const RUBLES = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

const matchedByLabel = (
  by: "articleId" | "ozonSku" | "ozonProductId",
): string => {
  if (by === "articleId") return "артикул";
  if (by === "ozonSku") return "SKU";
  return "Ozon ID";
};

export default function CostPriceImportModal({ onClose, onImported }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<CostImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [showNotFound, setShowNotFound] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setFile(null);
    setReport(null);
    setError(null);
    setShowUnchanged(false);
    setShowNotFound(false);
    setPhase("idle");
  };

  const handleFile = async (f: File) => {
    setFile(f);
    setError(null);
    setPhase("uploading");
    try {
      const r = await api.products.importCostPrice(f, true);
      setReport(r);
      setPhase("preview");
    } catch (e) {
      setError((e as Error).message);
      setPhase("idle");
    }
  };

  const handleApply = async () => {
    if (!file) return;
    setPhase("applying");
    setError(null);
    try {
      const r = await api.products.importCostPrice(file, false);
      setReport(r);
      setPhase("done");
      onImported();
    } catch (e) {
      setError((e as Error).message);
      setPhase("preview");
    }
  };

  const handleClose = () => {
    if (phase === "uploading" || phase === "applying") return;
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={handleClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 720, maxHeight: "90vh", display: "flex", flexDirection: "column" }}
      >
        <div className="modal-header">
          <h3 style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <FileSpreadsheet size={18} />
            Импорт себестоимости из xlsx
          </h3>
          <button className="btn-icon" onClick={handleClose} aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {error && (
            <div
              style={{
                background: "color-mix(in srgb, var(--err) 10%, transparent)",
                color: "var(--err)",
                padding: "10px 12px",
                borderRadius: 8,
                marginBottom: 12,
                fontSize: 13,
                wordBreak: "break-word",
              }}
            >
              {error}
            </div>
          )}

          {phase === "idle" && (
            <IdleState
              fileInputRef={fileInputRef}
              onPick={handleFile}
            />
          )}

          {phase === "uploading" && <p className="muted">Загрузка и анализ файла…</p>}

          {(phase === "preview" || phase === "applying") && report && (
            <PreviewState
              report={report}
              applying={phase === "applying"}
              showUnchanged={showUnchanged}
              setShowUnchanged={setShowUnchanged}
              showNotFound={showNotFound}
              setShowNotFound={setShowNotFound}
              onReset={reset}
              onApply={handleApply}
            />
          )}

          {phase === "done" && report && (
            <DoneState report={report} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}

function IdleState({
  fileInputRef,
  onPick,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (f: File) => void;
}) {
  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        Файл должен содержать колонки:{" "}
        <b>«Артикул продавца»</b>, <b>«SKU»</b>, <b>«Артикул OZON»</b>{" "}
        (хотя бы одна) и <b>«Себестоимость»</b>. Колонки можно расположить в
        любом порядке, заголовки — в первой строке.
      </p>
      <p className="muted">
        Матчинг идёт каскадом: сначала по артикулу продавца, потом по SKU,
        потом по Артикулу Ozon. Себестоимость существующих товаров
        перезаписывается — перед записью увидишь превью.
      </p>
      <div
        style={{
          marginTop: 12,
          padding: "28px 16px",
          border: "2px dashed var(--border)",
          borderRadius: 12,
          textAlign: "center",
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) onPick(f);
        }}
      >
        <Upload
          size={32}
          style={{ color: "var(--muted)", marginBottom: 8 }}
        />
        <div style={{ marginBottom: 12 }}>Перетащите xlsx-файл сюда</div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => fileInputRef.current?.click()}
        >
          Выбрать файл
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
            e.target.value = ""; // permit re-pick того же файла
          }}
        />
      </div>
    </div>
  );
}

function PreviewState({
  report,
  applying,
  showUnchanged,
  setShowUnchanged,
  showNotFound,
  setShowNotFound,
  onReset,
  onApply,
}: {
  report: CostImportReport;
  applying: boolean;
  showUnchanged: boolean;
  setShowUnchanged: (v: boolean) => void;
  showNotFound: boolean;
  setShowNotFound: (v: boolean) => void;
  onReset: () => void;
  onApply: () => void;
}) {
  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 12,
          fontSize: 13,
        }}
      >
        <StatPill
          tone="ok"
          label="Обновится"
          value={report.matched.length}
        />
        <StatPill
          tone="muted"
          label="Без изменений"
          value={report.unchanged.length}
        />
        <StatPill
          tone={report.notFound.length > 0 ? "warn" : "muted"}
          label="Не найдено"
          value={report.notFound.length}
        />
        <StatPill
          tone="muted"
          label="Всего строк"
          value={report.totalRows}
        />
      </div>

      {report.warnings.length > 0 && (
        <div
          style={{
            background: "color-mix(in srgb, #f59e0b 10%, transparent)",
            color: "#a16207",
            padding: 10,
            borderRadius: 8,
            marginBottom: 12,
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          {report.warnings.slice(0, 5).map((w, i) => (
            <div key={i}>{w}</div>
          ))}
          {report.warnings.length > 5 && (
            <div>… и ещё {report.warnings.length - 5} строк</div>
          )}
        </div>
      )}

      {report.matched.length > 0 && (
        <RowsTable rows={report.matched} title="Будет обновлено" />
      )}

      {report.unchanged.length > 0 && (
        <Collapsible
          title={`Без изменений (${report.unchanged.length})`}
          open={showUnchanged}
          onToggle={() => setShowUnchanged(!showUnchanged)}
        >
          <RowsTable rows={report.unchanged} title={null} />
        </Collapsible>
      )}

      {report.notFound.length > 0 && (
        <Collapsible
          title={`Не найдено (${report.notFound.length})`}
          open={showNotFound}
          onToggle={() => setShowNotFound(!showNotFound)}
        >
          <NotFoundTable rows={report.notFound} />
        </Collapsible>
      )}

      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 16,
          flexWrap: "wrap",
          justifyContent: "flex-end",
        }}
      >
        <button type="button" className="btn-secondary" onClick={onReset}>
          Выбрать другой файл
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={onApply}
          disabled={applying || report.matched.length === 0}
        >
          {applying
            ? "Применение…"
            : `Применить ${report.matched.length} изм.`}
        </button>
      </div>
    </>
  );
}

function DoneState({
  report,
  onClose,
}: {
  report: CostImportReport;
  onClose: () => void;
}) {
  return (
    <div style={{ textAlign: "center", padding: "24px 0" }}>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 48,
          height: 48,
          borderRadius: 999,
          background: "color-mix(in srgb, #16a34a 18%, transparent)",
          color: "#15803d",
          marginBottom: 12,
        }}
      >
        <Check size={24} />
      </div>
      <h4 style={{ margin: "0 0 6px" }}>
        Обновлено {report.didUpdate} {pluralize(report.didUpdate, "товар", "товара", "товаров")}
      </h4>
      {report.notFound.length > 0 && (
        <p className="muted" style={{ margin: "4px 0" }}>
          {report.notFound.length}{" "}
          {pluralize(report.notFound.length, "строка", "строки", "строк")} из
          файла не сматчилось — проверь артикулы/SKU.
        </p>
      )}
      <button
        type="button"
        className="btn-primary"
        onClick={onClose}
        style={{ marginTop: 12 }}
      >
        Закрыть
      </button>
    </div>
  );
}

function StatPill({
  tone,
  label,
  value,
}: {
  tone: "ok" | "warn" | "muted";
  label: string;
  value: number;
}) {
  const palette =
    tone === "ok"
      ? { bg: "color-mix(in srgb, #16a34a 12%, transparent)", fg: "#15803d" }
      : tone === "warn"
        ? { bg: "color-mix(in srgb, #f59e0b 14%, transparent)", fg: "#a16207" }
        : { bg: "var(--surface-muted, #f1f5f9)", fg: "var(--muted)" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        background: palette.bg,
        color: palette.fg,
        fontSize: 12.5,
      }}
    >
      <b style={{ fontSize: 14 }}>{value}</b>
      {label}
    </span>
  );
}

function RowsTable({
  rows,
  title,
}: {
  rows: Array<{
    sourceRow: number;
    articleId: string;
    productName: string;
    shopShortName: string;
    oldCostPrice: number;
    newCostPrice: number;
    matchedBy: "articleId" | "ozonSku" | "ozonProductId";
  }>;
  title: string | null;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      {title && (
        <div
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: 0.4,
            margin: "4px 0 6px",
          }}
        >
          {title}
        </div>
      )}
      <div
        style={{
          maxHeight: 260,
          overflowY: "auto",
          border: "1px solid var(--border)",
          borderRadius: 8,
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead style={{ background: "var(--surface-muted, #f8fafc)" }}>
            <tr>
              <Th>#</Th>
              <Th>Магазин</Th>
              <Th>Артикул</Th>
              <Th>Название</Th>
              <Th align="right">Было</Th>
              <Th align="right">Станет</Th>
              <Th>Матч</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.sourceRow}-${i}`}>
                <Td>{r.sourceRow + 1}</Td>
                <Td>{r.shopShortName}</Td>
                <Td>
                  <code style={{ fontSize: 11.5 }}>{r.articleId}</code>
                </Td>
                <Td>{r.productName}</Td>
                <Td align="right">{RUBLES.format(r.oldCostPrice)}</Td>
                <Td align="right">
                  <b>{RUBLES.format(r.newCostPrice)}</b>
                </Td>
                <Td>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    {matchedByLabel(r.matchedBy)}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NotFoundTable({
  rows,
}: {
  rows: Array<{
    sourceRow: number;
    articleId: string | null;
    ozonSku: number | null;
    ozonProductId: number | null;
    productName: string | null;
    newCostPrice: number;
  }>;
}) {
  return (
    <div
      style={{
        maxHeight: 220,
        overflowY: "auto",
        border: "1px solid var(--border)",
        borderRadius: 8,
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead style={{ background: "var(--surface-muted, #f8fafc)" }}>
          <tr>
            <Th>#</Th>
            <Th>Артикул</Th>
            <Th>SKU</Th>
            <Th>Ozon ID</Th>
            <Th>Название</Th>
            <Th align="right">Себестоимость</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.sourceRow}-${i}`}>
              <Td>{r.sourceRow + 1}</Td>
              <Td>
                <code style={{ fontSize: 11.5 }}>{r.articleId ?? "—"}</code>
              </Td>
              <Td>{r.ozonSku ?? "—"}</Td>
              <Td>{r.ozonProductId ?? "—"}</Td>
              <Td>{r.productName ?? "—"}</Td>
              <Td align="right">{RUBLES.format(r.newCostPrice)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      style={{
        padding: "6px 10px",
        textAlign: align,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        color: "var(--muted)",
        borderBottom: "1px solid var(--border)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      style={{
        padding: "6px 10px",
        textAlign: align,
        borderBottom: "1px solid var(--border-soft, #f1f5f9)",
        verticalAlign: "middle",
      }}
    >
      {children}
    </td>
  );
}

function Collapsible({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          background: "transparent",
          border: 0,
          padding: "4px 0",
          color: "var(--muted)",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          fontWeight: 600,
        }}
      >
        {open ? "▾ " : "▸ "}
        {title}
      </button>
      {open && children}
    </div>
  );
}

function pluralize(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
