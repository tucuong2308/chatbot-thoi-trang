import { embedText } from "./gemini";
import type { Catalog, Env, Product, SearchIntent } from "./types";

export interface Hit {
  product: Product;
  score: number;
  sizesConHang: string[];
}

const FILTER_FIELDS = [
  "danh_muc", "kieu_sp", "kieu_co", "tay_ao", "do_dai", "dang", "mau_chinh", "chat_lieu", "phong_cach",
] as const;

/** Lớp 1: lọc cứng theo thuộc tính + giá + tồn kho. */
function hardFilter(catalog: Catalog, intent: SearchIntent): Product[] {
  const inStock = new Map<string, string[]>();
  for (const v of catalog.variants) {
    if (v.ton_kho <= 0) continue;
    if (intent.size && v.size !== intent.size && v.size !== "Freesize") continue;
    inStock.set(v.ma_sp, [...(inStock.get(v.ma_sp) ?? []), v.size]);
  }

  return catalog.products.filter((p) => {
    if (p.trang_thai && p.trang_thai !== "đang bán") return false;
    if (!inStock.has(p.ma_sp)) return false;
    for (const f of FILTER_FIELDS) {
      const want = intent[f];
      if (want && p[f] !== want) return false;
    }
    if (intent.dip && !p.dip.includes(intent.dip)) return false;
    if (intent.gia_max && p.gia_ban > intent.gia_max) return false;
    if (intent.gia_min && p.gia_ban < intent.gia_min) return false;
    return true;
  });
}

/** Lớp 2: xếp hạng theo nghĩa bằng Vectorize, chỉ trong nhóm đã lọc. */
export async function searchProducts(env: Env, catalog: Catalog, intent: SearchIntent, k = 5): Promise<Hit[]> {
  let candidates = hardFilter(catalog, intent);

  // Lọc quá chặt thì nới dần: bỏ các thuộc tính phụ, giữ loại hàng và giá.
  if (candidates.length === 0) {
    const relaxed: SearchIntent = {
      muc_dich: intent.muc_dich, cau_tim_kiem: intent.cau_tim_kiem,
      danh_muc: intent.danh_muc, gia_max: intent.gia_max, size: intent.size,
    };
    candidates = hardFilter(catalog, relaxed);
  }
  if (candidates.length === 0) return [];

  const sizesOf = (ma: string) =>
    catalog.variants.filter((v) => v.ma_sp === ma && v.ton_kho > 0).map((v) => v.size);

  const ids = new Set(candidates.map((p) => p.ma_sp));
  let scores = new Map<string, number>();
  try {
    const vector = await embedText(env, intent.cau_tim_kiem);
    const res = await env.VECTORS.query(vector, { topK: 50 });
    scores = new Map(res.matches.filter((m) => ids.has(m.id)).map((m) => [m.id, m.score]));
  } catch (err) {
    console.error("Vector search lỗi, dùng thứ tự mặc định", err);
  }

  return candidates
    .map((product) => ({ product, score: scores.get(product.ma_sp) ?? 0, sizesConHang: sizesOf(product.ma_sp) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
