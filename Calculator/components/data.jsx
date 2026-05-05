
// Shared data, constants and helpers

const CHANNELS = ['FBO', 'FBS', 'realFBS'];

const CHANNEL_COLORS = {
  FBO:     { bg: '#EBF2FF', text: '#005BFF', border: '#B8D0FF' },
  FBS:     { bg: '#E6F9EF', text: '#00A859', border: '#A3E6C3' },
  realFBS: { bg: '#FFF3E6', text: '#FF6A00', border: '#FFD0A3' },
};

const TAX_SYSTEMS = [
  'УСН Доходы минус расходы',
  'УСН Доходы',
  'ОСНО ИП',
  'ОСНО ООО',
  'АУСН Доходы',
  'АУСН Д-Р',
  'НПД',
];

const INITIAL_GLOBAL = {
  taxSystem: 'УСН Доходы минус расходы',
  usnIncome: 0.06,
  usnDiff: 0.07,
  ausnIncome: 0.08,
  ausnDiff: 0.20,
  osnoOoo: 0.25,
  osnoAnnual: 2400000,
  npd: 0.04,
  extraCosts: 100,
  spoilage: 0.01,
};

const INITIAL_PRODUCTS = [
  {
    id: 1,
    sku: 'TEST-001',
    name: 'Кофемашина (пример)',
    category: 'Кофеварки и кофемашины',
    price: 337000,
    cost: 87000,
    qty: 10,
    soldFBO: 8, soldFBS: 3, soldRealFBS: 4,
    marginFBO: 25089,
    marginFBS: 12744,
    marginRealFBS: 13601,
    bestChannel: 'FBO',
    factMargin: null,
    deltaToFact: null,
    fromOzon: true,
  },
  {
    id: 2,
    sku: 'TEST-002',
    name: 'Кофемолка Pro',
    category: 'Кофеварки и кофемашины',
    price: 18500,
    cost: 6200,
    qty: 25,
    soldFBO: 15, soldFBS: 7, soldRealFBS: 3,
    marginFBO: 4120,
    marginFBS: 2890,
    marginRealFBS: 3210,
    bestChannel: 'FBO',
    factMargin: null,
    deltaToFact: null,
    fromOzon: true,
  },
  {
    id: 3,
    sku: 'TEST-003',
    name: 'Термос 500мл',
    category: 'Термосы',
    price: 2900,
    cost: 680,
    qty: 100,
    soldFBO: 60, soldFBS: 30, soldRealFBS: 10,
    marginFBO: 890,
    marginFBS: 620,
    marginRealFBS: 710,
    bestChannel: 'FBO',
    factMargin: null,
    deltaToFact: null,
    fromOzon: true,
  },
];

const FINANCE_OPS = [
  { id: 1, date: '2026-04-28', type: 'Продажа', operation: 'MarketplaceSellerRefilledAmount', sku: 'TEST-001', posting: 'POST-001-001', amount: 337000 },
  { id: 2, date: '2026-04-25', type: 'Комиссия', operation: 'MarketplaceSellerFee', sku: 'TEST-001', posting: 'POST-001-001', amount: -42125 },
  { id: 3, date: '2026-04-25', type: 'Логистика', operation: 'MarketplaceServiceStorageFBO', sku: 'TEST-001', posting: 'POST-001-001', amount: -1200 },
  { id: 4, date: '2026-04-20', type: 'Продажа', operation: 'MarketplaceSellerRefilledAmount', sku: 'TEST-002', posting: 'POST-002-001', amount: 18500 },
  { id: 5, date: '2026-04-20', type: 'Комиссия', operation: 'MarketplaceSellerFee', sku: 'TEST-002', posting: 'POST-002-001', amount: -2312 },
  { id: 6, date: '2026-04-15', type: 'Продажа', operation: 'MarketplaceSellerRefilledAmount', sku: 'TEST-003', posting: 'POST-003-001', amount: 2900 },
  { id: 7, date: '2026-04-10', type: 'Возврат', operation: 'MarketplaceReturnStorageFBO', sku: 'TEST-001', posting: 'POST-001-002', amount: -337000 },
];

const fmt = (n, opts = {}) => {
  if (n == null || n === '') return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0, ...opts }).format(n);
};

const fmtPct = (n) => {
  if (n == null) return '—';
  return (n * 100).toFixed(1) + '\u00a0%';
};

const fmtRub = (n) => {
  if (n == null) return '—';
  return fmt(n) + '\u00a0₽';
};

const formatDate = (d) => {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
};

Object.assign(window, {
  CHANNELS, CHANNEL_COLORS, TAX_SYSTEMS,
  INITIAL_GLOBAL, INITIAL_PRODUCTS, FINANCE_OPS,
  fmt, fmtPct, fmtRub, formatDate,
});
