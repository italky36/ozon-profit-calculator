import { calculateRow } from "../src/lib/calc/index.ts";
import commissions from "../src/data/commissions.json" with { type: "json" };
import storage from "../src/data/storage.json" with { type: "json" };
import logisticsTariffs from "../src/data/logisticsTariffs.json" with { type: "json" };
import logisticsSettings from "../src/data/logisticsSettings.json" with { type: "json" };
import defaultTaxSettings from "../src/data/defaultTaxSettings.json" with { type: "json" };

const refs = { commissions, storage, logisticsTariffs, logisticsSettings };

const input = {
  articleId: "T",
  productName: "n",
  category: "Кофеварки и кофемашины",
  productType: "Автоматическая кофемашина",
  volumeL: 209,
  isKgt: false,
  isKazakhstan: false,
  isFireHazard: false,
  plannedStorageDays: 30,
  vatRate: 0.05,
  redemptionPercent: 90,
  salesPlan: 10,
  logisticsMode: "Авто",
  clustersCount: "Считать без наценки",
  localShare: 0.5,
  currentPrice: 337000,
  discountPercent: 0.345,
  marketingPercent: 0,
  realFbsDeliveryCost: 500,
  realFbsReturnCost: 250,
  acceptanceTariff: "Доверительная приемка",
  costPrice: 87000,
  extraExpensesPerUnit: 0,
  whitePurchase: true,
  incomingVatPurchase: false,
  incomingVatRate: 0,
};

const r = calculateRow(input, defaultTaxSettings, refs);
console.log(JSON.stringify(r, null, 2));

const cRow = commissions.find(c => c.key === "Кофеварки и кофемашины-Автоматическая кофемашина");
console.log("Commission row:", cRow);

const sRow = storage.find(s => s.key === "Кофеварки и кофемашины-Автоматическая кофемашина");
console.log("Storage row:", sRow);
