interface TypingPerson {
  userId: number;
  fullName: string;
  email: string;
}

interface Props {
  people: TypingPerson[];
}

function nameOf(p: TypingPerson): string {
  return p.fullName || p.email.split("@")[0] || "—";
}

export default function TypingIndicator({ people }: Props) {
  if (people.length === 0) return null;
  const names = people.slice(0, 3).map(nameOf);
  let text: string;
  if (people.length === 1) {
    text = `${names[0]} печатает…`;
  } else if (people.length <= 3) {
    const last = names.pop()!;
    text = `${names.join(", ")} и ${last} печатают…`;
  } else {
    text = `${names.join(", ")} и ещё ${people.length - 3} печатают…`;
  }
  return (
    <div
      style={{
        padding: "4px 16px",
        fontSize: 12,
        color: "var(--muted, #888)",
        fontStyle: "italic",
        minHeight: 20,
      }}
    >
      {text}
    </div>
  );
}
