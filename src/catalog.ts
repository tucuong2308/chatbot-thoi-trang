import { parseCsv } from "./csv";
import type { Catalog, Env, Product, SizeRow, Variant } from "./types";

const CATALOG_KEY = "catalog:v1";

const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const toNumber = (s: string) => Number(s.replace(/[^\d.-]/g, "")) || 0;

async function fetchCsv(url: string): Promise<Record<string, string>[]> {
  if (!url) return [];
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Không đọc được sheet: ${res.status} ${url}`);
  return parseCsv(await res.text());
}

/** Đọc Google Sheets (bản gốc) và ghi đè bản sao trong KV. */
export async function syncCatalog(env: Env): Promise<Catalog> {
  const [sp, bt, bs] = await Promise.all([
    fetchCsv(env.SHEET_CSV_SANPHAM),
    fetchCsv(env.SHEET_CSV_BIENTHE),
    fetchCsv(env.SHEET_CSV_BANGSIZE),
  ]);

  const products: Product[] = sp
    .filter((r) => r.ma_sp && r.ma_sp.startsWith("SP"))
    .map((r) => ({
      ...r,
      ma_sp: r.ma_sp,
      ten_sp: r.ten_sp,
      anh_chinh_url: r.anh_chinh_url,
      gia_ban: toNumber(r.gia_ban),
      gia_goc: r.gia_goc ? toNumber(r.gia_goc) : undefined,
      dip: splitList(r.dip ?? ""),
      chi_tiet: splitList(r.chi_tiet ?? ""),
    }));

  const variants: Variant[] = bt
    .filter((r) => r.ma_sp && r.ma_sp.startsWith("SP"))
    .map((r) => ({
      ma_bien_the: r.ma_bien_the,
      ma_sp: r.ma_sp,
      mau: r.mau,
      size: r.size,
      ton_kho: toNumber(r.ton_kho),
    }));

  const sizes = bs.filter((r) => r.size && r.can_nang_kg) as unknown as SizeRow[];

  const catalog: Catalog = { updatedAt: new Date().toISOString(), products, variants, sizes };
  await env.SHOP_KV.put(CATALOG_KEY, JSON.stringify(catalog));
  return catalog;
}

let memo: { at: number; data: Catalog } | null = null;

/** Đọc bản sao; giữ trong bộ nhớ của isolate 60 giây để khỏi đọc KV liên tục. */
export async function getCatalog(env: Env): Promise<Catalog> {
  if (memo && Date.now() - memo.at < 60_000) return memo.data;
  const data = await env.SHOP_KV.get<Catalog>(CATALOG_KEY, "json");
  if (!data) return { updatedAt: "", products: [], variants: [], sizes: [] };
  memo = { at: Date.now(), data };
  return data;
}
