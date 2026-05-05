
// ─── Products Tab ──────────────────────────────────────────────────────────────
const ProductsTab = ({ products, setProducts, globalSettings, setGlobalSettings, tweaks }) => {
  const [channelFilter, setChannelFilter] = React.useState('Все');
  const [dateFrom, setDateFrom] = React.useState('2026-04-03');
  const [dateTo, setDateTo] = React.useState('2026-05-03');
  const [compareFactual, setCompareFactual] = React.useState(true);
  const [showKpi, setShowKpi] = React.useState(true);

  const updateProduct = (updated) => {
    setProducts(prev => prev.map(p => p.id === updated.id ? updated : p));
  };
  const deleteProduct = (id) => setProducts(prev => prev.filter(p => p.id !== id));
  const addProduct = () => {
    const newId = Date.now();
    setProducts(prev => [...prev, {
      id: newId, sku: 'NEW-00' + (prev.length + 1),
      name: 'Новый товар', category: 'Категория',
      price: 0, cost: 0, qty: 1,
      soldFBO: 0, soldFBS: 0, soldRealFBS: 0,
      marginFBO: 0, marginFBS: 0, marginRealFBS: 0,
      bestChannel: 'FBO', factMargin: null, deltaToFact: null,
      fromOzon: false,
    }]);
  };

  const visible = products.filter(p => channelFilter === 'Все' || p.bestChannel === channelFilter);

  // Summary totals
  const totQty = visible.reduce((s, p) => s + (p.qty || 0), 0);
  const totFBO = visible.reduce((s, p) => s + (p.marginFBO || 0) * (p.qty || 0), 0);
  const totFBS = visible.reduce((s, p) => s + (p.marginFBS || 0) * (p.qty || 0), 0);
  const totReal = visible.reduce((s, p) => s + (p.marginRealFBS || 0) * (p.qty || 0), 0);

  const avgRevFBO = visible.reduce((s, p) => s + (p.price || 0) * (p.qty || 0), 0);
  const avgMarginPctFBO = avgRevFBO > 0 ? totFBO / avgRevFBO : 0;
  const avgCostTotal = visible.reduce((s, p) => s + (p.cost || 0) * (p.qty || 0), 0);
  const roiFBO = avgCostTotal > 0 ? totFBO / avgCostTotal : 0;

  // KPI: best single channel
  const chTotals = { FBO: totFBO, FBS: totFBS, realFBS: totReal };
  const bestCh = Object.entries(chTotals).sort((a, b) => b[1] - a[1])[0]?.[0] || 'FBO';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* KPI Strip with toggle */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: '#8B95A8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Сводка по плану
          </span>
          <button onClick={() => setShowKpi(v => !v)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'none', border: '1.5px solid #E2E8F0', borderRadius: 20,
            padding: '4px 12px', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 12, fontWeight: 600, color: showKpi ? '#005BFF' : '#8B95A8',
            transition: 'all .15s',
          }}
            onMouseEnter={e => e.currentTarget.style.borderColor = '#005BFF'}
            onMouseLeave={e => e.currentTarget.style.borderColor = '#E2E8F0'}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              {showKpi
                ? <path d="M2 7h10M7 2l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                : <path d="M2 7h10M7 2l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity=".4"/>
              }
            </svg>
            {showKpi ? 'Скрыть' : 'Показать сводку'}
          </button>
        </div>

        {showKpi && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <KpiCard label="Маржа FBO (сумма)" value={fmtRub(totFBO)} sub={`${(avgMarginPctFBO*100).toFixed(1)}% от выручки · ${totQty} шт`} accent="#005BFF" icon="📦" />
            <KpiCard label="Маржа FBS (сумма)" value={fmtRub(totFBS)} sub={`${visible.length} товаров`} accent="#00A859" icon="🚚" />
            <KpiCard label="Маржа realFBS (сумма)" value={fmtRub(totReal)} sub="Со своего склада" accent="#FF6A00" icon="🏭" />
            <KpiCard label="Лучший канал" value={<ChannelBadge channel={bestCh} />} sub="По суммарной марже" accent="#8B5CF6" icon="🏆" />
            <KpiCard label="Рентабельность FBO" value={`${(roiFBO*100).toFixed(1)}%`} sub="к себестоимости" accent="#F59E0B" icon="📈" />
          </div>
        )}
      </div>

      {/* Global Settings */}
      <Collapsible title="Глобальные настройки" defaultOpen={false}>
        <GlobalSettings settings={globalSettings} onChange={setGlobalSettings} />
      </Collapsible>

      {/* Date range + factual compare */}
      <div style={{
        background: '#fff', borderRadius: 16, padding: '14px 20px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.07)', border: '1px solid #E9EDF5',
        display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center',
      }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={compareFactual} onChange={e => setCompareFactual(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: '#005BFF' }} />
          <span style={{ fontSize: 13, color: '#2D3748', fontWeight: 500 }}>Сравнить с фактом за период</span>
        </label>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: 11, color: '#8B95A8', fontWeight: 500 }}>С даты</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ border: '1.5px solid #E2E8F0', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: 11, color: '#8B95A8', fontWeight: 500 }}>По дату</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{ border: '1.5px solid #E2E8F0', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
          </div>
          <div style={{ fontSize: 13, color: '#8B95A8', paddingTop: 16 }}>
            Артикулов с фактом: <strong style={{ color: '#005BFF' }}>0</strong>
          </div>
        </div>
      </div>

      {/* Products Table */}
      <Collapsible title="Товары" badge={products.length}>
        {/* Toolbar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <ChannelFilter active={channelFilter} onChange={setChannelFilter} />
            <span style={{ fontSize: 11, color: '#A0AABB', display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
                <rect width="12" height="12" rx="3" fill="#005BFF" opacity=".15"/>
                <text x="6" y="9" textAnchor="middle" fill="#005BFF" fontFamily="sans-serif" fontWeight="800" fontSize="7">Oz</text>
              </svg>
              — данные из Ozon, только чтение
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{
              padding: '8px 16px', borderRadius: 10, border: '1.5px solid #E2E8F0',
              background: '#fff', color: '#005BFF', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
              onMouseEnter={e => e.currentTarget.style.background = '#EBF2FF'}
              onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
              ↓ Импорт из Ozon
            </button>
            <button onClick={addProduct} style={{
              padding: '8px 16px', borderRadius: 10, border: 'none',
              background: '#005BFF', color: '#fff', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
              onMouseEnter={e => e.currentTarget.style.background = '#0050E6'}
              onMouseLeave={e => e.currentTarget.style.background = '#005BFF'}>
              + Добавить товар
            </button>
          </div>
        </div>

        {/* Table wrapper with horizontal scroll */}
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', borderRadius: 12, border: '1px solid #E9EDF5' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                <th style={thStyle}>Артикул</th>
                <th style={thStyle}>Название</th>
                <th style={thStyle}>Категория</th>
                <th style={{ ...thStyle, color: '#005BFF' }}>Цена</th>
                <th style={thStyle}>Себест.</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Кол-во</th>
                <th style={{ ...thStyle, color: CHANNEL_COLORS.FBO.text }}>Маржа FBO</th>
                <th style={{ ...thStyle, color: CHANNEL_COLORS.FBS.text }}>Маржа FBS</th>
                <th style={{ ...thStyle, color: CHANNEL_COLORS.realFBS.text }}>Маржа realFBS</th>
                {tweaks.showChart && <th style={{ ...thStyle, textAlign: 'center' }}>График</th>}
                <th style={{ ...thStyle, textAlign: 'center' }}>Лучшая</th>
                <th style={thStyle}>Продано</th>
                <th style={thStyle}>Факт. маржа</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => (
                <ProductRow key={p.id} product={p}
                  onUpdate={updateProduct} onDelete={deleteProduct}
                  channelFilter={channelFilter} tweaks={tweaks} />
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: '#F8FAFF', borderTop: '2px solid #E9EDF5' }}>
                <td colSpan={5} style={{ ...tdStyle, fontWeight: 700, color: '#0D1929' }}>Итого по плану</td>
                <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700 }}>{totQty}</td>
                <td style={{ ...tdStyle, color: CHANNEL_COLORS.FBO.text, fontWeight: 800 }}>{fmtRub(totFBO)}</td>
                <td style={{ ...tdStyle, color: CHANNEL_COLORS.FBS.text, fontWeight: 800 }}>{fmtRub(totFBS)}</td>
                <td style={{ ...tdStyle, color: CHANNEL_COLORS.realFBS.text, fontWeight: 800 }}>{fmtRub(totReal)}</td>
                {tweaks.showChart && <td />}
                <td style={{ ...tdStyle, textAlign: 'center' }}><ChannelBadge channel={bestCh} /></td>
                <td colSpan={3} />
              </tr>
              <tr style={{ background: '#FAFBFD' }}>
                <td colSpan={6} style={{ ...tdStyle, color: '#8B95A8', fontSize: 12 }}>Средневзвешенная маржа, %</td>
                <td style={{ ...tdStyle, color: CHANNEL_COLORS.FBO.text, fontSize: 12 }}>{fmtPct(avgMarginPctFBO)}</td>
                <td style={{ ...tdStyle, color: CHANNEL_COLORS.FBS.text, fontSize: 12 }}>
                  {fmtPct(avgRevFBO > 0 ? totFBS / avgRevFBO : 0)}
                </td>
                <td style={{ ...tdStyle, color: CHANNEL_COLORS.realFBS.text, fontSize: 12 }}>
                  {fmtPct(avgRevFBO > 0 ? totReal / avgRevFBO : 0)}
                </td>
                {tweaks.showChart && <td />}
                <td colSpan={4} />
              </tr>
              <tr style={{ background: '#FAFBFD' }}>
                <td colSpan={6} style={{ ...tdStyle, color: '#8B95A8', fontSize: 12 }}>Рентабельность к с/с, %</td>
                <td style={{ ...tdStyle, color: CHANNEL_COLORS.FBO.text, fontSize: 12 }}>{fmtPct(avgCostTotal > 0 ? totFBO / avgCostTotal : 0)}</td>
                <td style={{ ...tdStyle, color: CHANNEL_COLORS.FBS.text, fontSize: 12 }}>{fmtPct(avgCostTotal > 0 ? totFBS / avgCostTotal : 0)}</td>
                <td style={{ ...tdStyle, color: CHANNEL_COLORS.realFBS.text, fontSize: 12 }}>{fmtPct(avgCostTotal > 0 ? totReal / avgCostTotal : 0)}</td>
                {tweaks.showChart && <td />}
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>
      </Collapsible>
    </div>
  );
};

// ─── Finance Tab ───────────────────────────────────────────────────────────────
const FinanceTab = () => {
  const [dateFrom, setDateFrom] = React.useState('2026-04-03');
  const [dateTo, setDateTo] = React.useState('2026-05-03');
  const [typeFilter, setTypeFilter] = React.useState('все');
  const [ops, setOps] = React.useState(FINANCE_OPS);

  const types = ['все', ...Array.from(new Set(FINANCE_OPS.map(o => o.type)))];

  const filtered = ops.filter(o =>
    typeFilter === 'все' || o.type === typeFilter
  );

  const totalIncome = filtered.filter(o => o.amount > 0).reduce((s, o) => s + o.amount, 0);
  const totalExpense = filtered.filter(o => o.amount < 0).reduce((s, o) => s + o.amount, 0);
  const netTotal = filtered.reduce((s, o) => s + o.amount, 0);

  const typeColors = {
    'Продажа': '#00A859', 'Комиссия': '#CC3B3B', 'Логистика': '#FF6A00',
    'Возврат': '#8B5CF6', 'Хранение': '#F59E0B',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KpiCard label="Доходы" value={fmtRub(totalIncome)} sub="За выбранный период" accent="#00A859" icon="↑" />
        <KpiCard label="Расходы" value={fmtRub(Math.abs(totalExpense))} sub="Комиссии + логистика" accent="#CC3B3B" icon="↓" />
        <KpiCard label="Чистый доход" value={fmtRub(netTotal)}
          sub={netTotal >= 0 ? 'Прибыль' : 'Убыток'}
          accent={netTotal >= 0 ? '#005BFF' : '#CC3B3B'} icon="=" />
        <KpiCard label="Операций" value={filtered.length} sub="Всего записей" accent="#8B5CF6" icon="📋" />
      </div>

      <div style={{
        background: '#fff', borderRadius: 16, padding: '20px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.07)', border: '1px solid #E9EDF5',
      }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: '#0D1929', marginBottom: 16 }}>Финансы Ozon</div>

        {/* Filters */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: 11, color: '#8B95A8', fontWeight: 500 }}>С даты</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ border: '1.5px solid #E2E8F0', borderRadius: 8, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: 11, color: '#8B95A8', fontWeight: 500 }}>По дату</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{ border: '1.5px solid #E2E8F0', borderRadius: 8, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
          </div>
          <button style={{
            padding: '8px 18px', borderRadius: 10, border: 'none',
            background: '#005BFF', color: '#fff', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit', alignSelf: 'flex-end',
          }}>Импортировать за период</button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignSelf: 'flex-end' }}>
            <label style={{ fontSize: 11, color: '#8B95A8', fontWeight: 500 }}>Тип</label>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
              style={{ border: '1.5px solid #E2E8F0', borderRadius: 8, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', outline: 'none', background: '#FAFBFD' }}>
              {types.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {/* Table */}
        <div style={{ fontWeight: 700, fontSize: 14, color: '#0D1929', marginBottom: 12 }}>
          Операции ({filtered.length})
        </div>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', borderRadius: 12, border: '1px solid #E9EDF5' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead>
              <tr>
                {['Дата', 'Тип', 'Operation', 'Артикул', 'Posting', 'Сумма, ₽'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...tdStyle, textAlign: 'center', padding: '32px', color: '#8B95A8' }}>
                    Нет операций за выбранный период.
                  </td>
                </tr>
              ) : filtered.map(op => (
                <tr key={op.id} style={{ borderBottom: '1px solid #F0F3F8' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#F8FAFF'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={tdStyle}>{formatDate(op.date)}</td>
                  <td style={tdStyle}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 12,
                      background: (typeColors[op.type] || '#8B95A8') + '20',
                      color: typeColors[op.type] || '#8B95A8',
                      fontSize: 12, fontWeight: 600,
                    }}>{op.type}</span>
                  </td>
                  <td style={{ ...tdStyle, color: '#5A6778', fontSize: 12 }}>{op.operation}</td>
                  <td style={{ ...tdStyle, color: '#005BFF', fontWeight: 600 }}>{op.sku}</td>
                  <td style={{ ...tdStyle, color: '#5A6778', fontSize: 12 }}>{op.posting}</td>
                  <td style={{
                    ...tdStyle, fontWeight: 700, textAlign: 'right',
                    color: op.amount >= 0 ? '#00A859' : '#CC3B3B',
                  }}>
                    {op.amount >= 0 ? '+' : ''}{fmtRub(op.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr style={{ background: '#F8FAFF', borderTop: '2px solid #E9EDF5' }}>
                  <td colSpan={5} style={{ ...tdStyle, fontWeight: 700, color: '#0D1929' }}>Итого</td>
                  <td style={{
                    ...tdStyle, fontWeight: 800, textAlign: 'right',
                    color: netTotal >= 0 ? '#00A859' : '#CC3B3B',
                  }}>{netTotal >= 0 ? '+' : ''}{fmtRub(netTotal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { ProductsTab, FinanceTab });
