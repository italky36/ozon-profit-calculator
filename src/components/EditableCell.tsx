import { useEffect, useRef, useState } from "react";
import { fmtRub } from "../format";

interface BaseProps {
  prefix?: string;
  suffix?: string;
  align?: "left" | "right" | "center";
  readOnly?: boolean;
  readOnlyTooltip?: string;
  inputWidth?: number;
}

interface NumberProps extends BaseProps {
  type: "number";
  value: number;
  onChange: (v: number) => void;
  /** Format function for display when not editing. Defaults to Intl with no fraction digits. */
  format?: (v: number) => string;
}

interface TextProps extends BaseProps {
  type: "text";
  value: string;
  onChange: (v: string) => void;
}

export type EditableCellProps = NumberProps | TextProps;

const numberFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

export default function EditableCell(props: EditableCellProps) {
  const { prefix = "", suffix = "", align = "right", readOnly, readOnlyTooltip } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(() => String(props.value));
  const ref = useRef<HTMLInputElement | null>(null);

  // Refocus + select when entering edit mode.
  useEffect(() => {
    if (editing && ref.current) ref.current.select();
  }, [editing]);

  const startEdit = () => {
    setDraft(String(props.value));
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (props.type === "number") {
      const n = parseFloat(draft);
      const next = Number.isFinite(n) ? n : 0;
      if (next !== props.value) props.onChange(next);
    } else {
      const next = draft;
      if (next !== props.value) props.onChange(next);
    }
  };

  const cancel = () => {
    setDraft(String(props.value));
    setEditing(false);
  };

  if (readOnly) {
    return (
      <span
        className="editable locked"
        style={{ textAlign: align, display: "inline-block" }}
        title={readOnlyTooltip}
      >
        {prefix}
        {props.type === "number" ? (props.format ? props.format(props.value) : numberFmt.format(props.value)) : props.value}
        {suffix}
      </span>
    );
  }

  if (editing) {
    return (
      <input
        ref={ref}
        className="editable-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") cancel();
        }}
        style={{ width: props.inputWidth ?? 100, textAlign: align }}
      />
    );
  }

  const display =
    props.type === "number"
      ? props.format
        ? props.format(props.value)
        : props.value > 999
        ? fmtRub(props.value).replace(/\s?₽/, "")
        : numberFmt.format(props.value)
      : props.value;

  return (
    <span
      className="editable"
      style={{ textAlign: align, display: "inline-block" }}
      title="Нажмите, чтобы изменить"
      onClick={(e) => {
        e.stopPropagation();
        startEdit();
      }}
    >
      {prefix}
      {display}
      {suffix}
    </span>
  );
}
