
// ─── KPI Cards ────────────────────────────────────────────────────────────────
const KpiCard = ({ label, value, sub, accent, icon }) => {
  return (
    <div style={{
      background: '#fff',
      borderRadius: 16,
      padding: '16px 20px',
      flex: '1 1 160px',
      minWidth: 0,
      boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
      borderTop: `3px solid ${accent}`,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ fontSize: 12, color: '#8B95A8', fontWeight: 500, display:'flex', alignItems:'center', gap:5 }}>
        <span>{icon}</span>{label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#0D1929', letterSpacing: '-0.5px' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#8B95A8' }}>{sub}</div>}
    </div>
  );
};

// ─── Channel Badge ─────────────────────────────────────────────────────────────
const ChannelBadge = ({ channel }) => {
  if (!channel) return <span style={{ color: '#8B95A8' }}>—</span>;
  const c = CHANNEL_COLORS[channel] || {};
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 9px', borderRadius: 20,
      background: c.bg, color: c.text,
      border: `1px solid ${c.border}`,
      fontSize: 12, fontWeight: 600,
    }}>{channel}</span>
  );
};

// ─── Channel Filter Pills ──────────────────────────────────────────────────────
const ChannelFilter = ({ active, onChange }) => {
  const opts = ['Все', ...CHANNELS];
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {opts.map(ch => {
        const isActive = active === ch;
        const col = CHANNEL_COLORS[ch] || {};
        return (
          <button key={ch} onClick={() => onChange(ch)}
            style={{
              padding: '5px 14px', borderRadius: 20, cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
              border: isActive ? `2px solid ${col.text || '#005BFF'}` : '2px solid #E2E8F0',
              background: isActive ? (col.bg || '#EBF2FF') : '#fff',
              color: isActive ? (col.text || '#005BFF') : '#5A6778',
              transition: 'all .15s',
            }}>{ch}</button>
        );
      })}
    </div>
  );
};

// ─── Mini Bar Chart ────────────────────────────────────────────────────────────
const MarginBar = ({ fbo, fbs, real, best }) => {
  const max = Math.max(fbo, fbs, real, 1);
  const bars = [
    { key: 'FBO', val: fbo, color: CHANNEL_COLORS.FBO.text },
    { key: 'FBS', val: fbs, color: CHANNEL_COLORS.FBS.text },
    { key: 'realFBS', val: real, color: CHANNEL_COLORS.realFBS.text },
  ];
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 28 }}>
      {bars.map(b => (
        <div key={b.key} title={`${b.key}: ${fmtRub(b.val)}`}
          style={{
            width: 8, borderRadius: '3px 3px 0 0',
            height: Math.max(3, (b.val / max) * 26),
            background: b.key === best ? b.color : b.color + '55',
            transition: 'height .3s',
          }} />
      ))}
    </div>
  );
};

// ─── Inline Editable Cell ──────────────────────────────────────────────────────
const EditableCell = ({ value, onChange, prefix, suffix, type = 'number', align = 'right' }) => {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const ref = React.useRef();

  React.useEffect(() => { setDraft(value); }, [value]);
  React.useEffect(() => { if (editing && ref.current) ref.current.select(); }, [editing]);

  const commit = () => {
    setEditing(false);
    const parsed = type === 'number' ? (parseFloat(draft) || 0) : draft;
    if (parsed !== value) onChange(parsed);
  };

  if (editing) {
    return (
      <input ref={ref} value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditing(false); setDraft(value); } }}
        style={{
          width: '80px', textAlign: align,
          border: '2px solid #005BFF', borderRadius: 6, outline: 'none',
          padding: '2px 6px', fontSize: 13, fontFamily: 'inherit',
          background: '#F0F5FF',
        }} />
    );
  }

  return (
    <span onClick={() => setEditing(true)}
      title="Нажмите для редактирования"
      style={{
        cursor: 'text', padding: '2px 4px', borderRadius: 4,
        display: 'inline-block', minWidth: 50, textAlign: align,
        borderBottom: '1.5px dashed #B8D0FF',
        transition: 'background .1s',
      }}
      onMouseEnter={e => e.target.style.background = '#EBF2FF'}
      onMouseLeave={e => e.target.style.background = 'transparent'}
    >
      {prefix}{type === 'number' ? fmt(value) : value}{suffix}
    </span>
  );
};

// ─── Collapsible Section ───────────────────────────────────────────────────────
const Collapsible = ({ title, children, defaultOpen = true, badge }) => {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div style={{
      background: '#fff', borderRadius: 16, overflow: 'hidden',
      boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
      border: '1px solid #E9EDF5',
    }}>
      <button onClick={() => setOpen(!open)}
        style={{
          width: '100%', background: 'none', border: 'none',
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '14px 20px', cursor: 'pointer',
          fontFamily: 'inherit',
        }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .2s', flexShrink: 0 }}>
          <path d="M6 4l4 4-4 4" stroke="#8B95A8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span style={{ fontWeight: 700, fontSize: 14, color: '#0D1929' }}>{title}</span>
        {badge && <span style={{
          marginLeft: 4, background: '#EBF2FF', color: '#005BFF',
          borderRadius: 20, padding: '1px 8px', fontSize: 12, fontWeight: 600,
        }}>{badge}</span>}
      </button>
      {open && <div style={{ padding: '0 20px 20px' }}>{children}</div>}
    </div>
  );
};

// ─── Global Settings Panel ─────────────────────────────────────────────────────
const GlobalSettings = ({ settings, onChange }) => {
  const field = (key, label, step = 0.01) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 120 }}>
      <label style={{ fontSize: 11, color: '#8B95A8', fontWeight: 500 }}>{label}</label>
      <input type="number" step={step} value={settings[key]}
        onChange={e => onChange({ ...settings, [key]: parseFloat(e.target.value) || 0 })}
        style={{
          border: '1.5px solid #E2E8F0', borderRadius: 8, padding: '7px 10px',
          fontSize: 13, fontFamily: 'inherit', outline: 'none', background: '#FAFBFD',
          transition: 'border .15s',
        }}
        onFocus={e => e.target.style.borderColor = '#005BFF'}
        onBlur={e => e.target.style.borderColor = '#E2E8F0'}
      />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
          <label style={{ fontSize: 11, color: '#8B95A8', fontWeight: 500 }}>Налоговая система</label>
          <select value={settings.taxSystem}
            onChange={e => onChange({ ...settings, taxSystem: e.target.value })}
            style={{
              border: '1.5px solid #E2E8F0', borderRadius: 8, padding: '7px 10px',
              fontSize: 13, fontFamily: 'inherit', outline: 'none',
              background: '#FAFBFD', cursor: 'pointer',
            }}>
            {TAX_SYSTEMS.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        {field('usnIncome', 'УСН Доходы, ставка')}
        {field('usnDiff', 'УСН Д-Р, ставка')}
        {field('ausnIncome', 'АУСН Доходы, ставка')}
        {field('ausnDiff', 'АУСН Д-Р, ставка')}
        {field('osnoOoo', 'ОСНО ООО, ставка')}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        {field('osnoAnnual', 'ОСНО ИП — год. доход, ₽', 1000)}
        {field('npd', 'НПД, ставка')}
        {field('extraCosts', 'Доп. расходы партии, ₽', 10)}
        {field('spoilage', 'Порча, доля')}
      </div>
    </div>
  );
};

// ─── Product Row ───────────────────────────────────────────────────────────────
const ProductRow = ({ product, onUpdate, onDelete, channelFilter, tweaks }) => {
  const visible = channelFilter === 'Все' || product.bestChannel === channelFilter;
  if (!visible) return null;

  const upd = (key, val) => onUpdate({ ...product, [key]: val });

  // fromOzon = импортированный товар: артикул/название/категория — read-only
  const fromOzon = !!product.fromOzon;

  return (
    <tr style={{ borderBottom: '1px solid #F0F3F8' }}
      onMouseEnter={e => e.currentTarget.style.background = '#F8FAFF'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <td style={{ ...tdStyle, color: '#8B95A8', fontSize: 12 }}>
        {fromOzon
          ? <span title="Данные из Ozon — только чтение" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'default' }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
                <rect width="12" height="12" rx="3" fill="#005BFF" opacity=".15"/>
                <text x="6" y="9" textAnchor="middle" fill="#005BFF" fontFamily="sans-serif" fontWeight="800" fontSize="7">Oz</text>
              </svg>
              {product.sku}
            </span>
          : <EditableCell value={product.sku} onChange={v => upd('sku', v)} type="text" align="left" />
        }
      </td>
      <td style={{ ...tdStyle, fontWeight: 600, color: '#0D1929', maxWidth: 180 }}>
        {fromOzon
          ? <span title="Название из каталога Ozon — только чтение" style={{ display: 'block', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'default' }}>{product.name}</span>
          : <EditableCell value={product.name} onChange={v => upd('name', v)} type="text" align="left" />
        }
      </td>
      <td style={{ ...tdStyle, color: '#5A6778', maxWidth: 160, fontSize: 12 }}>
        {fromOzon
          ? <span title="Категория из справочника Ozon — только чтение" style={{ display: 'block', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'default' }}>{product.category}</span>
          : <EditableCell value={product.category} onChange={v => upd('category', v)} type="text" align="left" />
        }
      </td>
      <td style={{ ...tdStyle, color: '#005BFF', fontWeight: 600 }}>
        <EditableCell value={product.price} onChange={v => upd('price', v)} suffix=" ₽" />
      </td>
      <td style={tdStyle}>
        <EditableCell value={product.cost} onChange={v => upd('cost', v)} suffix=" ₽" />
      </td>
      <td style={{ ...tdStyle, textAlign: 'center' }}>
        <EditableCell value={product.qty} onChange={v => upd('qty', v)} align="center" />
      </td>
      <td style={{ ...tdStyle, color: CHANNEL_COLORS.FBO.text, fontWeight: 600 }}>
        {fmtRub(product.marginFBO)}
      </td>
      <td style={{ ...tdStyle, color: CHANNEL_COLORS.FBS.text, fontWeight: 600 }}>
        {fmtRub(product.marginFBS)}
      </td>
      <td style={{ ...tdStyle, color: CHANNEL_COLORS.realFBS.text, fontWeight: 600 }}>
        {fmtRub(product.marginRealFBS)}
      </td>
      {tweaks.showChart && (
        <td style={{ ...tdStyle, textAlign: 'center', paddingLeft: 8 }}>
          <MarginBar fbo={product.marginFBO} fbs={product.marginFBS} real={product.marginRealFBS} best={product.bestChannel} />
        </td>
      )}
      <td style={{ ...tdStyle, textAlign: 'center' }}>
        <ChannelBadge channel={product.bestChannel} />
      </td>
      <td style={{ ...tdStyle, color: '#8B95A8' }}>{product.soldFBO || '—'}</td>
      <td style={{ ...tdStyle, color: '#8B95A8' }}>{fmtRub(product.factMargin)}</td>
      <td style={{ ...tdStyle }}>
        <button onClick={() => onDelete(product.id)}
          title="Удалить"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#CC3B3B', padding: '4px 6px', borderRadius: 6,
            fontSize: 14, lineHeight: 1,
          }}
          onMouseEnter={e => e.target.style.background = '#FFF0F0'}
          onMouseLeave={e => e.target.style.background = 'none'}>✕</button>
      </td>
    </tr>
  );
};

const tdStyle = {
  padding: '10px 12px', fontSize: 13, color: '#2D3748',
  verticalAlign: 'middle', whiteSpace: 'nowrap',
};
const thStyle = {
  padding: '10px 12px', fontSize: 11, fontWeight: 700, color: '#8B95A8',
  textTransform: 'uppercase', letterSpacing: '0.05em',
  textAlign: 'left', borderBottom: '2px solid #E9EDF5',
  whiteSpace: 'nowrap', background: '#FAFBFD',
};

Object.assign(window, {
  KpiCard, ChannelBadge, ChannelFilter, MarginBar,
  EditableCell, Collapsible, GlobalSettings,
  ProductRow, tdStyle, thStyle,
});
