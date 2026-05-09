/**
 * Ozon delivery clusters as exposed by the official online calculator
 * (`seller.ozon.ru` → "Параметры доставки") и Excel-эталон Ozon
 * (`Тарифы_с_6_апреля`). Используется и для UI, и для лукапа в матрице
 * `ref_logistics_cluster_tariffs`.
 *
 * Аппроксимация: same cluster on both ends ≈ "local" sale → `_min_amount`,
 * different clusters → `_max_amount`. Excel-матрица даёт точные значения для
 * каждой пары — с включённой `useClusterLogistics` калькулятор использует её.
 */
export const OZON_CLUSTERS = [
  "Москва, МО и Дальние регионы",
  "Санкт-Петербург и СЗО",
  "Воронеж",
  "Дальний Восток",
  "Екатеринбург",
  "Казань",
  "Калининград",
  "Краснодар",
  "Красноярск",
  "Махачкала",
  "Невинномысск",
  "Новосибирск",
  "Омск",
  "Оренбург",
  "Пермь",
  "Ростов",
  "Самара",
  "Саратов",
  "Тверь",
  "Тюмень",
  "Уфа",
  "Ярославль",
  "Алматы",
  "Армения",
  "Астана",
  "Беларусь",
  "Кыргызстан",
  "Грузия",
  "Азербайджан",
] as const;

export type OzonCluster = (typeof OZON_CLUSTERS)[number];

export const DEFAULT_CLUSTER: OzonCluster = "Москва, МО и Дальние регионы";
