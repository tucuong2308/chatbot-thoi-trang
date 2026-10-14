import attrSchema from "../data/gemini-schema-thuoc-tinh.json";
import { parseCsv } from "./csv";
import type { Env } from "./types";

type Row = Record<string, string>;

const props = (attrSchema as any).properties as Record<string, any>;

/** Cột chọn một giá trị trong danh sách cố định của schema. */
export const ENUM_VALUES: Record<string, string[]> = Object.fromEntries(
  Object.entries(props).filter(([, p]) => p.enum).map(([k, p]) => [k, p.enum as string[]]),
);
/** Cột nhận nhiều giá trị (cách nhau dấu phẩy trong Sheets). */
export const MULTI_VALUES: Record<string, string[]> = Object.fromEntries(
  Object.entries(props).filter(([, p]) => p.items?.enum).map(([k, p]) => [k, p.items.enum as string[]]),
);
export const TRANG_THAI = ["đang bán", "hết hàng", "ngừng bán"];

const PRODUCT_COLS = [
  "ma_sp", "ten_sp", "anh_chinh_url", "gia_ban", "gia_goc", ...Object.keys(ENUM_VALUES),
  ...Object.keys(MULTI_VALUES), "mo_ta_tu_do", "trang_thai",
];
const VARIANT_COLS = ["ma_bien_the", "ma_sp", "mau", "size", "ton_kho"];
const SIZE_COLS = ["size", "can_nang_kg", "chieu_cao_cm", "vong_1_cm", "vong_2_cm", "vong_3_cm"];

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const toInt = (s: string | undefined) => {
  const n = Number(clean(s).replace(/[^\d-]/g, ""));
  return Number.isFinite(n) && clean(s) !== "" ? n : null;
};
const splitList = (s: string | undefined) => clean(s).split(",").map((x) => x.trim()).filter(Boolean);

/**
 * Đưa giá trị chủ shop gõ tay về đúng giá trị trong danh sách ("Trễ Vai " -> "trễ vai").
 * Giá trị lạ vẫn giữ nhưng ghi cảnh báo, để sản phẩm không âm thầm biến mất khỏi kết quả lọc.
 */
function normalize(allowed: string[], raw: string, where: string, warnings: string[]): string {
  const v = clean(raw);
  if (!v) return "";
  const hit = allowed.find((a) => a.toLowerCase() === v.toLowerCase());
  if (!hit) warnings.push(`${where}: "${v}" không có trong danh sách`);
  return hit ?? v;
}

export interface ImportResult {
  san_pham: number;
  bien_the: number;
  bang_size: number;
  canh_bao: string[];
}

/** Ghi đè toàn bộ bản sao trong D1 từ 3 bảng CSV (cùng cột như file mẫu data/bo-cot-thuoc-tinh-thoi-trang.xlsx). */
export async function importCatalog(
  env: Env, csv: { san_pham: string; bien_the?: string; bang_size?: string },
): Promise<ImportResult> {
  const warnings: string[] = [];
  const seen = new Set<string>();

  const products: Row[] = [];
  const dips: Row[] = [];
  const details: Row[] = [];
  for (const r of parseCsv(csv.san_pham)) {
    const ma = clean(r.ma_sp);
    if (!ma.startsWith("SP")) continue; // bỏ dòng ghi chú, dòng trống
    if (seen.has(ma)) { warnings.push(`${ma}: trùng mã, bỏ dòng sau`); continue; }
    const gia = toInt(r.gia_ban);
    if (gia === null) { warnings.push(`${ma}: thiếu gia_ban, bỏ qua`); continue; }
    seen.add(ma);

    const p: Row = { ma_sp: ma, ten_sp: clean(r.ten_sp), anh_chinh_url: clean(r.anh_chinh_url) };
    for (const [col, allowed] of Object.entries(ENUM_VALUES)) p[col] = normalize(allowed, r[col], `${ma}.${col}`, warnings);
    for (const [col, allowed] of Object.entries(MULTI_VALUES)) {
      const vals = [...new Set(splitList(r[col]).map((v) => normalize(allowed, v, `${ma}.${col}`, warnings)))];
      p[col] = vals.join(", ");
      for (const v of vals) (col === "dip" ? dips : details).push({ ma_sp: ma, [col]: v });
    }
    p.mo_ta_tu_do = clean(r.mo_ta_tu_do);
    p.trang_thai = normalize(TRANG_THAI, r.trang_thai || "đang bán", `${ma}.trang_thai`, warnings);
    products.push({ ...p, gia_ban: gia as any, gia_goc: toInt(r.gia_goc) as any });
  }

  if (!products.length) throw new Error("Không có sản phẩm hợp lệ nào, giữ nguyên dữ liệu cũ");

  const variants = parseCsv(csv.bien_the ?? "")
    .filter((r) => seen.has(clean(r.ma_sp)))
    .map((r) => ({
      ma_bien_the: clean(r.ma_bien_the), ma_sp: clean(r.ma_sp), mau: clean(r.mau),
      size: clean(r.size), ton_kho: (toInt(r.ton_kho) ?? 0) as any,
    }));
  const sizes = parseCsv(csv.bang_size ?? "")
    .filter((r) => clean(r.size))
    .map((r) => Object.fromEntries(SIZE_COLS.map((c) => [c, clean(r[c])])));

  // Một batch D1 là một transaction: lỗi giữa chừng thì dữ liệu cũ vẫn còn nguyên.
  const stmts: D1PreparedStatement[] = ["san_pham", "san_pham_dip", "san_pham_chi_tiet", "bien_the", "bang_size"]
    .map((t) => env.DB.prepare(`DELETE FROM ${t}`));
  stmts.push(
    ...insertJson(env, "san_pham", PRODUCT_COLS, products),
    ...insertJson(env, "san_pham_dip", ["ma_sp", "dip"], dips),
    ...insertJson(env, "san_pham_chi_tiet", ["ma_sp", "chi_tiet"], details),
    ...insertJson(env, "bien_the", VARIANT_COLS, variants),
    ...insertJson(env, "bang_size", SIZE_COLS, sizes),
    env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('cap_nhat_luc', ?)").bind(new Date().toISOString()),
  );
  await env.DB.batch(stmts);

  return { san_pham: products.length, bien_the: variants.length, bang_size: sizes.length, canh_bao: warnings.slice(0, 100) };
}

/**
 * Nạp nhiều dòng bằng một tham số JSON (json_each) thay vì mỗi dòng một câu lệnh:
 * D1 giới hạn số câu lệnh mỗi lần gọi Worker và 100 tham số mỗi câu.
 */
export function insertJson(env: Env, table: string, cols: string[], rows: object[], verb = "INSERT"): D1PreparedStatement[] {
  const sql = `${verb} INTO ${table} (${cols.join(", ")}) SELECT ${cols.map((c) => `json_extract(value, '$.${c}')`).join(", ")} FROM json_each(?)`;
  const out: D1PreparedStatement[] = [];
  let chunk: object[] = [];
  let size = 0;
  for (const r of rows) {
    const len = JSON.stringify(r).length;
    if (chunk.length && size + len > 500_000) { out.push(env.DB.prepare(sql).bind(JSON.stringify(chunk))); chunk = []; size = 0; }
    chunk.push(r);
    size += len;
  }
  if (chunk.length) out.push(env.DB.prepare(sql).bind(JSON.stringify(chunk)));
  return out;
}

async function fetchText(url: string): Promise<string> {
  if (!url) return "";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Không đọc được sheet: ${res.status} ${url}`);
  return res.text();
}

/** Đọc Google Sheets (bản gốc) và ghi đè bản sao trong D1. Chưa có link sheet thì giữ nguyên dữ liệu. */
export async function syncCatalog(env: Env): Promise<ImportResult | { bo_qua: string }> {
  if (!env.SHEET_CSV_SANPHAM) return { bo_qua: "chưa đặt SHEET_CSV_SANPHAM, giữ nguyên dữ liệu hiện có" };
  const [san_pham, bien_the, bang_size] = await Promise.all([
    fetchText(env.SHEET_CSV_SANPHAM), fetchText(env.SHEET_CSV_BIENTHE), fetchText(env.SHEET_CSV_BANGSIZE),
  ]);
  return importCatalog(env, { san_pham, bien_the, bang_size });
}
