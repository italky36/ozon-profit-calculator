import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Store, Trash2, Users as UsersIcon } from "lucide-react";
import { api, type AdminWorkspace } from "../../api";
import { errBox, okBox, td, th } from "./styles";

export default function WorkspacesSection() {
  const [rows, setRows] = useState<AdminWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.admin.listWorkspaces());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const remove = async (w: AdminWorkspace) => {
    if (
      !confirm(
        `Удалить команду «${w.name}»? Это удалит ВСЕ её магазины, товары, финансы и импорты безвозвратно. Действие нельзя отменить.`,
      )
    )
      return;
    if (
      !confirm(
        `Подтвердите ещё раз. ${w.memberCount} участников будут отвязаны, ${w.shopCount} магазинов будут удалены.`,
      )
    )
      return;
    setBusyId(w.id);
    setError(null);
    setNotice(null);
    try {
      await api.admin.deleteWorkspace(w.id);
      setNotice(`Команда «${w.name}» удалена`);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <UsersIcon size={16} /> Команды (workspaces){" "}
          <span className="collapsible-badge" style={{ marginLeft: 4 }}>
            {rows.length}
          </span>
        </h3>
        <button
          type="button"
          className="btn-icon"
          onClick={() => void reload()}
          disabled={loading}
          title="Обновить"
        >
          <RotateCcw size={14} /> Обновить
        </button>
      </div>

      {error && <div style={errBox}>{error}</div>}
      {notice && <div style={okBox}>{notice}</div>}

      {loading ? (
        <p className="muted">Загрузка…</p>
      ) : rows.length === 0 ? (
        <p className="muted">Команд пока нет.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-soft)" }}>
                <th style={th}>Имя</th>
                <th style={th}>Slug</th>
                <th style={th}>Владелец</th>
                <th style={th}>Участников</th>
                <th style={th}>Магазинов</th>
                <th style={th}>Создана</th>
                <th style={{ ...th, textAlign: "right" }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => {
                const busy = busyId === w.id;
                return (
                  <tr
                    key={w.id}
                    style={{
                      borderBottom: "1px solid var(--border-soft)",
                    }}
                  >
                    <td style={td}>
                      <strong>{w.name}</strong>
                    </td>
                    <td style={{ ...td, color: "var(--muted)", fontSize: 12 }}>
                      <code>{w.slug}</code>
                    </td>
                    <td style={td}>
                      {w.ownerEmail ?? (
                        <span className="muted">— (нет owner'а)</span>
                      )}
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          color: "var(--muted)",
                        }}
                      >
                        <UsersIcon size={12} /> {w.memberCount}
                      </span>
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          color: "var(--muted)",
                        }}
                      >
                        <Store size={12} /> {w.shopCount}
                      </span>
                    </td>
                    <td style={{ ...td, color: "var(--muted)", fontSize: 12 }}>
                      {new Date(w.createdAt).toLocaleDateString("ru-RU", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn-icon danger"
                        disabled={busy}
                        onClick={() => void remove(w)}
                        title="Удалить команду (с каскадом всех данных)"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
