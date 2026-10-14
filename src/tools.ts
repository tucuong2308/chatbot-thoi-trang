import { embedText } from "./gemini";
import { runSelect, SqlError } from "./sql";
import type { Env } from "./types";
import { rankIds } from "./vectors";

/** Khai báo công cụ theo định dạng function calling của Gemini. */
export const TOOL_DECLARATIONS = [
  {
    name: "tim_san_pham",
    description:
      "Tìm sản phẩm để gợi ý cho khách. Viết câu SELECT trả về cột ma_sp của các món thỏa điều kiện cứng; " +
      "công cụ tự bỏ món ngừng bán hoặc hết hàng, rồi xếp hạng theo độ gần nghĩa với mo_ta_tim_kiem.",
    parameters: {
      type: "OBJECT",
      properties: {
        sql: { type: "STRING", description: "Câu SELECT trên bảng san_pham (có thể JOIN/EXISTS bảng khác), phải có cột ma_sp" },
        mo_ta_tim_kiem: {
          type: "STRING",
          description: "Mô tả đầy đủ món khách muốn bằng tiếng Việt, gồm cả ý không lọc được bằng cột (tôn dáng, che bụng, sang...)",
        },
        so_luong: { type: "INTEGER", description: "Số món trả về, mặc định 6, tối đa 10" },
      },
      required: ["sql", "mo_ta_tim_kiem"],
    },
  },
  {
    name: "truy_van",
    description:
      "Chạy một câu SELECT bất kỳ để trả lời câu hỏi về dữ liệu: bảng size, tồn kho theo size/màu của một mã, " +
      "đếm số mẫu, khoảng giá, các giá trị đang có... Trả về tối đa 50 dòng.",
    parameters: {
      type: "OBJECT",
      properties: { sql: { type: "STRING", description: "Câu SELECT" } },
      required: ["sql"],
    },
  },
];

const PRODUCT_FIELDS = [
  "ma_sp", "ten_sp", "gia_ban", "gia_goc", "gioi_tinh", "danh_muc", "kieu_sp", "kieu_co", "tay_ao", "do_dai", "dang",
  "chat_lieu", "hoa_tiet", "mau_chinh", "phong_cach", "dip", "chi_tiet", "mo_ta_tu_do",
];

/** Bỏ trường rỗng và cắt chuỗi quá dài để phản hồi gửi lại model gọn. */
function compact(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([, v]) => v !== null && v !== "")
      .map(([k, v]) => [k, typeof v === "string" && v.length > 400 ? v.slice(0, 400) + "…" : v]),
  );
}

async function timSanPham(env: Env, args: { sql: string; mo_ta_tim_kiem?: string; so_luong?: number }) {
  const rows = await runSelect(env, args.sql, 500);
  if (rows.length && !("ma_sp" in rows[0])) throw new SqlError("Câu SQL phải trả về cột ma_sp");
  const ids = [...new Set(rows.map((r) => String(r.ma_sp ?? "")).filter(Boolean))];
  if (!ids.length) {
    return {
      tong_so_khop: 0,
      goi_y: "Không có món nào khớp. Nới bớt điều kiện phụ (giữ loại hàng, giới tính, giá) rồi gọi lại; nhớ nói với khách đã nới điều kiện nào.",
    };
  }

  // Chỉ giữ món đang bán và còn ít nhất một biến thể có hàng.
  const { results } = await env.DB.prepare(
    `SELECT p.*,
       (SELECT group_concat(size, ', ') FROM (SELECT DISTINCT size FROM bien_the b WHERE b.ma_sp = p.ma_sp AND b.ton_kho > 0)) AS size_con_hang,
       (SELECT group_concat(mau, ', ') FROM (SELECT DISTINCT mau FROM bien_the b WHERE b.ma_sp = p.ma_sp AND b.ton_kho > 0 AND b.mau <> '')) AS mau_con_hang
     FROM san_pham p
     WHERE p.ma_sp IN (SELECT value FROM json_each(?)) AND coalesce(p.trang_thai, '') IN ('', 'đang bán')`,
  ).bind(JSON.stringify(ids)).all<Record<string, unknown>>();
  const available = new Map(results.filter((r) => r.size_con_hang).map((r) => [String(r.ma_sp), r]));
  let order = ids.filter((id) => available.has(id));
  if (!order.length) {
    return { tong_so_khop: 0, het_hang_hoac_ngung_ban: ids.length, goi_y: "Các món khớp đều đã hết hàng hoặc ngừng bán." };
  }

  let xep_hang = "theo thứ tự câu SQL";
  let scores = new Map<string, number>();
  if (args.mo_ta_tim_kiem) {
    try {
      const ranked = await rankIds(env, await embedText(env, args.mo_ta_tim_kiem), order);
      order = ranked.ids;
      scores = ranked.scores;
      xep_hang = scores.size ? "theo độ gần nghĩa với mo_ta_tim_kiem" : xep_hang + " (chưa có vector)";
    } catch (err) {
      console.error("Xếp hạng theo nghĩa lỗi, giữ thứ tự SQL", err);
    }
  }

  const k = Math.min(Math.max(args.so_luong ?? 6, 1), 10);
  return {
    tong_so_khop: order.length,
    het_hang_hoac_ngung_ban: ids.length - order.length,
    xep_hang,
    san_pham: order.slice(0, k).map((id) => {
      const r = available.get(id)!;
      return compact({
        ...Object.fromEntries(PRODUCT_FIELDS.map((f) => [f, r[f]])),
        size_con_hang: r.size_con_hang,
        mau_con_hang: r.mau_con_hang,
        diem: scores.has(id) ? Number(scores.get(id)!.toFixed(4)) : undefined,
      });
    }),
  };
}

async function truyVan(env: Env, args: { sql: string }) {
  const rows = await runSelect(env, args.sql, 50);
  return { so_dong: rows.length, dong: rows.map(compact) };
}

/** Chạy một công cụ. Lỗi SQL được trả lại cho model dưới dạng { loi } để nó tự sửa câu lệnh. */
export async function runTool(env: Env, name: string, args: any): Promise<Record<string, unknown>> {
  try {
    if (name === "tim_san_pham") return await timSanPham(env, args);
    if (name === "truy_van") return await truyVan(env, args);
    return { loi: `Không có công cụ ${name}` };
  } catch (err) {
    if (err instanceof SqlError) return { loi: err.message };
    throw err;
  }
}
