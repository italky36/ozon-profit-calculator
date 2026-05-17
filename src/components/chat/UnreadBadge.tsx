interface Props {
  count: number;
}

export default function UnreadBadge({ count }: Props) {
  if (count <= 0) return null;
  const label = count > 99 ? "99+" : String(count);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 18,
        height: 18,
        padding: "0 5px",
        borderRadius: 9,
        background: "var(--accent)",
        color: "#fff",
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
      }}
      title={`${count} непрочитан${count === 1 ? "ное" : count < 5 ? "ных" : "ных"} сообщ.`}
    >
      {label}
    </span>
  );
}
