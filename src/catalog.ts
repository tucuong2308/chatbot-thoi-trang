import attrSchema from "../data/gemini-schema-thuoc-tinh.json";
import { parseCsv } from "./csv";
import { loadDongBo, planJobs, servedImage } from "./dongbo";
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

/** Một lỗi gắn với một ô trong Sheets, để Apps Script tô đỏ đúng ô (xem apps-script/Bot.gs). */
export interface CellIssue {
  trang: "SanPham" | "BienThe";
  ma: string;
  cot: string;
  gia_tri: string;
  loi: string;
}

/**
 * Đưa giá trị chủ shop gõ tay về đúng giá trị trong danh sách ("Trễ Vai " -> "trễ vai").
 * Giá trị lạ vẫn giữ nhưng ghi cảnh báo, để sản phẩm không âm thầm biến mất khỏi kết quả lọc.
 */
function normalize(allowed: string[], raw: string, ma: string, cot: string, issues: CellIssue[]): string {
  const v = clean(raw);
  if (!v) return "";
  const hit = allowed.find((a) => a.toLowerCase() === v.toLowerCase());
  if (!hit) issues.push({ trang: "SanPham", ma, cot, gia_tri: v, loi: `"${v}" không có trong danh sách` });
  return hit ?? v;
}

export interface ImportResult {
  san_pham: number;
  bien_the: number;
  bang_size: number;
  canh_bao: string[];
  o_loi: CellIssue[];
  /** Số món được đưa vào hàng đợi để tải ảnh / tạo vector. */
  dang_xu_ly: number;
}

/** Mỗi bảng: chuỗi CSV (link "Công bố lên web") hoặc mảng dòng {cột: giá trị} do Apps Script gửi. */
type Table = string | Row[] | undefined;
const rowsOf = (t: Table): Row[] =>
  typeof t === "string" ? parseCsv(t) : (t ?? []).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim(), String(v ?? "")])));

/** Ghi đè bản sao trong D1 từ 3 bảng (cùng cột như file mẫu data/bo-cot-thuoc-tinh-thoi-trang.xlsx). */
export async function importCatalog(
  env: Env, input: { san_pham: Table; bien_the?: Table; bang_size?: Table; thu_lai_loi?: boolean },
): Promise<ImportResult> {
  const issues: CellIssue[] = [];
  const seen = new Set<string>();
  const before = await loadDongBo(env);
  const sources = new Map<string, string>();

  const products: Row[] = [];
  const dips: Row[] = [];
  const details: Row[] = [];
  for (const r of rowsOf(input.san_pham)) {
    const ma = clean(r.ma_sp);
    if (!ma.startsWith("SP")) continue; // bỏ dòng ghi chú, dòng trống
    if (seen.has(ma)) { issues.push({ trang: "SanPham", ma, cot: "ma_sp", gia_tri: ma, loi: "trùng mã, bỏ dòng sau" }); continue; }
    const gia = toInt(r.gia_ban);
    if (gia === null) { issues.push({ trang: "SanPham", ma, cot: "gia_ban", gia_tri: clean(r.gia_ban), loi: "thiếu giá bán, bỏ qua món này" }); continue; }
    seen.add(ma);

    const src = clean(r.anh_chinh_url);
    sources.set(ma, src);
    const p: Row = { ma_sp: ma, ten_sp: clean(r.ten_sp), anh_chinh_url: servedImage(src, before.get(ma)) };
    for (const [col, allowed] of Object.entries(ENUM_VALUES)) p[col] = normalize(allowed, r[col], ma, col, issues);
    for (const [col, allowed] of Object.entries(MULTI_VALUES)) {
      const vals = [...new Set(splitList(r[col]).map((v) => normalize(allowed, v, ma, col, issues)))];
      p[col] = vals.join(", ");
      for (const v of vals) (col === "dip" ? dips : details).push({ ma_sp: ma, [col]: v });
    }
    p.mo_ta_tu_do = clean(r.mo_ta_tu_do);
    p.trang_thai = normalize(TRANG_THAI, r.trang_thai || "đang bán", ma, "trang_thai", issues);
    products.push({ ...p, gia_ban: gia as any, gia_goc: toInt(r.gia_goc) as any });
  }

  if (!products.length) throw new Error("Không có sản phẩm hợp lệ nào, giữ nguyên dữ liệu cũ");

  const variantRows = rowsOf(input.bien_the);
  for (const r of variantRows) {
    const ma = clean(r.ma_sp);
    if (ma.startsWith("SP") && !seen.has(ma)) {
      issues.push({ trang: "BienThe", ma: clean(r.ma_bien_the) || ma, cot: "ma_sp", gia_tri: ma, loi: "mã sản phẩm không có trong SanPham" });
    }
  }
  const variants = variantRows
    .filter((r) => seen.has(clean(r.ma_sp)))
    .map((r) => ({
      ma_bien_the: clean(r.ma_bien_the), ma_sp: clean(r.ma_sp), mau: clean(r.mau),
      size: clean(r.size), ton_kho: (toInt(r.ton_kho) ?? 0) as any,
    }));
  const sizes = rowsOf(input.bang_size)
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
  const dang_xu_ly = await planJobs(env, products, sources, before, input.thu_lai_loi);

  return {
    san_pham: products.length, bien_the: variants.length, bang_size: sizes.length,
    canh_bao: issues.slice(0, 100).map((i) => `${i.ma}.${i.cot}: ${i.loi}`), o_loi: issues.slice(0, 500), dang_xu_ly,
  };
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
