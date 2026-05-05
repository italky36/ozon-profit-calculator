import type { OzonClient } from "./client";
import type {
  OzonCategoryNode,
  OzonCategoryTreeResp,
  OzonPriceItem,
  OzonProductInfo,
  OzonProductInfoListResp,
  OzonProductListResp,
  OzonProductPricesResp,
} from "./types";

const PRODUCT_LIST_BATCH = 1000;
const INFO_BATCH = 1000;
const PRICES_BATCH = 1000;

export interface CatalogPage {
  productIds: number[];
  offerIds: string[];
  total: number;
}

/** Iterate /v3/product/list pages; yields each page so callers can stream into the merge. */
export async function* iterateProductList(
  client: OzonClient,
): AsyncGenerator<CatalogPage> {
  let lastId = "";
  while (true) {
    const resp = await client.post<OzonProductListResp>("/v3/product/list", {
      limit: PRODUCT_LIST_BATCH,
      last_id: lastId,
      filter: { visibility: "ALL" },
    });
    const items = resp.result.items ?? [];
    if (items.length === 0) return;
    yield {
      productIds: items.map((i) => i.product_id),
      offerIds: items.map((i) => i.offer_id),
      total: resp.result.total ?? 0,
    };
    if (!resp.result.last_id || items.length < PRODUCT_LIST_BATCH) return;
    lastId = resp.result.last_id;
  }
}

/** Batch /v3/product/info/list (chunks of 1000). */
export async function getProductsInfo(
  client: OzonClient,
  productIds: number[],
): Promise<OzonProductInfo[]> {
  const out: OzonProductInfo[] = [];
  for (let i = 0; i < productIds.length; i += INFO_BATCH) {
    const chunk = productIds.slice(i, i + INFO_BATCH);
    const resp = await client.post<OzonProductInfoListResp>(
      "/v3/product/info/list",
      { product_id: chunk.map(String) },
    );
    out.push(...(resp.items ?? []));
  }
  return out;
}

/** Batch /v5/product/info/prices via cursor pagination, filtered to known product_ids. */
export async function getPrices(
  client: OzonClient,
  productIds: number[],
): Promise<Map<number, OzonPriceItem>> {
  const want = new Set(productIds);
  const out = new Map<number, OzonPriceItem>();
  let cursor = "";
  while (true) {
    const resp = await client.post<OzonProductPricesResp>(
      "/v5/product/info/prices",
      {
        cursor,
        limit: PRICES_BATCH,
        filter: { visibility: "ALL" },
      },
    );
    const items = resp.items ?? [];
    for (const it of items) {
      if (want.has(it.product_id)) out.set(it.product_id, it);
    }
    if (!resp.cursor || items.length < PRICES_BATCH) return out;
    cursor = resp.cursor;
    if (out.size >= want.size) return out;
  }
}

export interface CategoryLookup {
  /** Resolve `(description_category_id, type_id)` → user-facing names. */
  resolve: (
    descCategoryId: number,
    typeId: number,
  ) => { categoryName: string; typeName: string } | null;
}

/** Fetch full category/type tree once and build a flat lookup map. */
export async function getCategoryLookup(
  client: OzonClient,
): Promise<CategoryLookup> {
  const resp = await client.post<OzonCategoryTreeResp>(
    "/v1/description-category/tree",
    { language: "DEFAULT" },
  );
  const map = new Map<string, { categoryName: string; typeName: string }>();

  const walk = (
    node: OzonCategoryNode,
    inheritedCategoryName: string | null,
    inheritedDescCategoryId: number | null,
  ): void => {
    const categoryName =
      !node.type_name && node.category_name
        ? node.category_name
        : inheritedCategoryName;
    const descCategoryId =
      node.description_category_id ?? inheritedDescCategoryId;

    if (descCategoryId && node.type_id && node.type_name && categoryName) {
      map.set(`${descCategoryId}-${node.type_id}`, {
        categoryName,
        typeName: node.type_name,
      });
    }

    if (node.children) {
      for (const child of node.children) {
        walk(child, categoryName, descCategoryId);
      }
    }
  };

  for (const root of resp.result ?? [])
    walk(root, root.category_name ?? null, root.description_category_id ?? null);

  return {
    resolve: (descCategoryId, typeId) =>
      map.get(`${descCategoryId}-${typeId}`) ?? null,
  };
}
