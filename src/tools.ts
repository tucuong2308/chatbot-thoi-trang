import { donCuaKhach, kiemTraHuy } from "./donhang/don";
import { soanDon, type YeuCauSoan } from "./donhang/nhap";
import { embedText } from "./gemini";
import { ANH_TOI_DA, judgeImages } from "./images";
import { runSelect, SqlError } from "./sql";
import type { DonNhap, Env } from "./types";
import { channelScores, type Kenh } from "./vectors";

/** Khai báo công cụ theo định dạng function calling của Gemini. */
export const TOOL_DECLARATIONS = [
  {
    name: "tim_san_pham",
    description:
      "Tìm sản phẩm để gợi ý. Lọc cứng bằng sql (không bắt buộc), rồi xếp hạng theo nghĩa bằng một hoặc hai kênh: " +
      "theo_mo_ta (so với mô tả chữ của sản phẩm) và theo_anh (so với ảnh sản phẩm). Tự bỏ món ngừng bán, hết hàng. " +
      "Trả về các món đứng đầu kèm điểm từng kênh, và ma_sp_con_lai để xem ảnh tiếp nếu cần.",
    parameters: {
      type: "OBJECT",
      properties: {
        sql: {
          type: "STRING",
          description: "Câu SELECT trả về cột ma_sp (có thể ORDER BY để ưu tiên). Bỏ trống = mọi món đang bán",
        },
        theo_mo_ta: {
          type: "STRING",
          description: "Ý về công dụng, cảm nhận, dịp, vóc dáng (VD 'đầm kín đáo thanh lịch đi đám cưới'). Không ghi giá, size, phủ định",
        },
        theo_anh: {
          type: "STRING",
          description: "Ý về vẻ ngoài nhìn thấy được (VD 'họa tiết hoa nhỏ kiểu vintage', 'tối giản, trơn, nhìn sang')",
        },
        uu_tien: {
          type: "STRING",
          enum: ["mo_ta", "anh", "can_bang"],
          description: "Khi dùng cả hai kênh: kênh nào quan trọng hơn. Mặc định can_bang",
        },
        so_luong: { type: "INTEGER", description: "Số món trả về, mặc định 6, tối đa 10" },
      },
    },
  },
  {
    name: "xem_anh",
    description:
      `Tự nhìn ảnh từng sản phẩm để kiểm tra yêu cầu mà thuộc tính và điểm không phân định được (che bụng, kín đáo, ` +
      `nhìn sang, giống kiểu khách tả...). Mỗi lần tối đa ${ANH_TOI_DA} mã. ` +
      `Mất khoảng 10-30 giây; khách sẽ được nhắn chờ (loi_nhan_cho) trước khi xem.`,
    parameters: {
      type: "OBJECT",
      properties: {
        ma_sp: { type: "ARRAY", items: { type: "STRING" }, description: "Các mã cần xem, lấy từ kết quả tim_san_pham" },
        yeu_cau: { type: "STRING", description: "Điều cần kiểm tra trên ảnh, viết rõ như dặn một nhân viên" },
        loi_nhan_cho: {
          type: "STRING",
          description: "Câu nhắn khách chờ một chút, VD 'Dạ chị chờ em xíu, em xem kỹ từng mẫu cho chị nhé'",
        },
      },
      required: ["ma_sp", "yeu_cau"],
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
  {
    name: "soan_don",
    description:
      "Soạn đơn nháp khi khách muốn mua, với TOÀN BỘ các món và thông tin người nhận đã hỏi được. Kiểm tra kho, size, màu, " +
      "số điện thoại, địa chỉ. Trả { loi: [...] } nếu còn thiếu/sai (hỏi khách đúng chỗ đó), hoặc { ok: true } và shop tự gửi " +
      "tóm tắt đơn kèm nút Xác nhận cho khách. Gọi lại với toàn bộ đơn mới mỗi khi khách thêm, bớt, đổi món.",
    parameters: {
      type: "OBJECT",
      properties: {
        mon: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              ma_sp: { type: "STRING" },
              size: { type: "STRING" },
              mau: { type: "STRING", description: "Bỏ trống nếu món chỉ có một màu" },
              so_luong: { type: "INTEGER", description: "Mặc định 1" },
            },
            required: ["ma_sp", "size"],
          },
        },
        ten: { type: "STRING", description: "Họ tên người nhận" },
        sdt: { type: "STRING", description: "Số điện thoại người nhận" },
        dia_chi: { type: "STRING", description: "Địa chỉ giao hàng đúng như khách gõ" },
        ghi_chu: { type: "STRING" },
      },
      required: ["mon"],
    },
  },
  {
    name: "xem_don",
    description: "Các đơn hàng gần nhất của khách đang nhắn (mã đơn, các món, tiền hàng, trạng thái Mới / Khách hủy).",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "yeu_cau_huy_don",
    description:
      "Khách muốn hủy một đơn: kiểm tra đơn có hủy được không. Nếu được, shop gửi khách nút 'Xác nhận hủy'; đơn chỉ bị hủy khi khách bấm nút.",
    parameters: {
      type: "OBJECT",
      properties: { ma_don: { type: "STRING", description: "VD DH-261018-001, lấy từ xem_don nếu khách không nói" } },
      required: ["ma_don"],
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
      .filter(([, v]) => v !== null && v !== "" && v !== undefined)
      .map(([k, v]) => [k, typeof v === "string" && v.length > 400 ? v.slice(0, 400) + "…" : v]),
  );
}

/** Các món trong `ids` đang bán và còn ít nhất một biến thể có hàng, kèm size/màu còn hàng. Giữ thứ tự của `ids`. */
async function available(env: Env, ids: string[] | null): Promise<Record<string, any>[]> {
  const where = ids ? "p.ma_sp IN (SELECT value FROM json_each(?1))" : "1";
  const stmt = env.DB.prepare(
    `SELECT p.*,
       (SELECT group_concat(size, ', ') FROM (SELECT DISTINCT size FROM bien_the b WHERE b.ma_sp = p.ma_sp AND b.ton_kho > 0)) AS size_con_hang,
       (SELECT group_concat(mau, ', ') FROM (SELECT DISTINCT mau FROM bien_the b WHERE b.ma_sp = p.ma_sp AND b.ton_kho > 0 AND b.mau <> '')) AS mau_con_hang
     FROM san_pham p
     WHERE ${where} AND coalesce(p.trang_thai, '') IN ('', 'đang bán')`,
  );
  const { results } = await (ids ? stmt.bind(JSON.stringify(ids)) : stmt).all<Record<string, any>>();
  const rows = results.filter((r) => r.size_con_hang);
  if (!ids) return rows;
  const byId = new Map(rows.map((r) => [String(r.ma_sp), r]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

const card = (r: Record<string, any>) =>
  compact({
    ...Object.fromEntries(PRODUCT_FIELDS.map((f) => [f, r[f]])), size_con_hang: r.size_con_hang, mau_con_hang: r.mau_con_hang,
    ...(laDoTreEm(r) ? { tre_em: true } : {}),
  });

/**
 * Đồ trẻ em: dữ liệu chỉ ghi gioi_tinh nam / nữ, nên nhận ra qua tên (Girls, Boys, Kids...) hoặc danh mục.
 * Chưa nhận ra thì bot từng gợi ý chân váy bé gái cho người lớn đi làm.
 */
const TRE_EM = /\b(kids?|kidswear|girls?|girl's|boys?|boy's|infants?|baby|babies|toddlers?|teens?)\b|trẻ em|bé gái|bé trai/i;
export const laDoTreEm = (r: Record<string, any>) => TRE_EM.test(`${r.ten_sp ?? ""} ${r.danh_muc ?? ""} ${r.gioi_tinh ?? ""}`);
/** Khách nhắc tới trẻ con trong yêu cầu tìm thì mới đưa đồ trẻ em vào kết quả. */
const TIM_CHO_TRE = /\b(kids?|girls?|boys?|baby|teens?)\b|trẻ em|trẻ con|(^|[^\p{L}])bé([^\p{L}]|$)|con gái|con trai|cho con|cháu/iu;

const round3 = (n: number | undefined) => (n === undefined ? undefined : Math.round(n * 1000) / 1000);

async function timSanPham(
  env: Env, args: { sql?: string; theo_mo_ta?: string; theo_anh?: string; uu_tien?: string; so_luong?: number },
) {
  // Tạo vector câu hỏi song song với bước SQL thay vì chờ SQL xong mới gọi (bớt khoảng 0,5-1 giây mỗi lần tìm).
  const embeds = Promise.all((["mo_ta", "anh"] as const).map(async (kenh) => {
    const text = kenh === "mo_ta" ? args.theo_mo_ta : args.theo_anh;
    if (!text?.trim()) return [kenh, null] as const;
    try { return [kenh, await embedText(env, text)] as const; } catch (err) { return [kenh, err as Error] as const; }
  }));

  let ids: string[] | null = null;
  if (args.sql?.trim()) {
    const rows = await runSelect(env, args.sql, 500);
    if (rows.length && !("ma_sp" in rows[0])) throw new SqlError("Câu SQL phải trả về cột ma_sp");
    ids = [...new Set(rows.map((r) => String(r.ma_sp ?? "")).filter(Boolean))];
    if (!ids.length) {
      return { tong_so_khop: 0, goi_y: "SQL không ra món nào. Nới điều kiện ít quan trọng nhất rồi gọi lại, và nói với khách đã nới gì." };
    }
  }
  const tatCa = await available(env, ids);
  const choTre = TIM_CHO_TRE.test(`${args.sql ?? ""} ${args.theo_mo_ta ?? ""} ${args.theo_anh ?? ""}`);
  const rows = choTre ? tatCa : tatCa.filter((r) => !laDoTreEm(r));
  const daBoTreEm = tatCa.length - rows.length;
  if (!rows.length) {
    return { tong_so_khop: 0, het_hang_hoac_ngung_ban: ids?.length ?? 0, goi_y: "Các món khớp đều đã hết hàng hoặc ngừng bán." };
  }

  // Điểm từng kênh, rồi gộp bằng RRF có trọng số (điểm chữ và điểm ảnh khác thang đo nên không cộng thẳng).
  const queries: Partial<Record<Kenh, number[]>> = {};
  const errors: string[] = [];
  for (const [kenh, v] of await embeds) {
    if (v instanceof Error) errors.push(`kênh ${kenh}: ${v.message}`);
    else if (v) queries[kenh] = v;
  }
  const order = rows.map((r) => String(r.ma_sp));
  const scores = await channelScores(env, order, queries);
  const weight: Record<Kenh, number> = args.uu_tien === "mo_ta" ? { mo_ta: 1, anh: 0.3 }
    : args.uu_tien === "anh" ? { mo_ta: 0.3, anh: 1 } : { mo_ta: 1, anh: 1 };
  const fused = new Map<string, number>();
  const stats: Record<string, unknown> = {};
  for (const kenh of Object.keys(queries) as Kenh[]) {
    const ranked = order.filter((id) => scores.get(id)?.[kenh] !== undefined)
      .sort((a, b) => scores.get(b)![kenh]! - scores.get(a)![kenh]!);
    ranked.forEach((id, rank) => fused.set(id, (fused.get(id) ?? 0) + weight[kenh] / (60 + rank)));
    const vals = ranked.map((id) => scores.get(id)![kenh]!);
    if (vals.length) {
      stats[kenh] = { cao_nhat: round3(vals[0]), thu_5: round3(vals[Math.min(4, vals.length - 1)]), trung_vi: round3(vals[vals.length >> 1]) };
    }
  }
  const pos = new Map(order.map((id, i) => [id, i]));
  const sorted = fused.size
    ? [...order].sort((a, b) => (fused.get(b) ?? 0) - (fused.get(a) ?? 0) || pos.get(a)! - pos.get(b)!)
    : order;

  const byId = new Map(rows.map((r) => [String(r.ma_sp), r]));
  const k = Math.min(Math.max(args.so_luong ?? 6, 1), 10);
  return {
    tong_so_khop: sorted.length,
    da_bo_do_tre_em: daBoTreEm || undefined,
    het_hang_hoac_ngung_ban: ids ? ids.length - sorted.length : undefined,
    xep_hang: fused.size ? `theo kênh ${Object.keys(queries).join(" + ")}` : "theo thứ tự câu SQL",
    diem_cac_kenh: Object.keys(stats).length ? stats : undefined,
    loi_xep_hang: errors.length ? errors : undefined,
    san_pham: sorted.slice(0, k).map((id) => ({
      ...card(byId.get(id)!),
      diem_mo_ta: round3(scores.get(id)?.mo_ta),
      diem_anh: round3(scores.get(id)?.anh),
    })),
    ma_sp_con_lai: sorted.slice(k, k + 60),
  };
}

async function xemAnh(env: Env, args: { ma_sp: string[]; yeu_cau: string; loi_nhan_cho?: string }, ctx: ToolContext) {
  const wanted = [...new Set(args.ma_sp ?? [])];
  const rows = await available(env, wanted.slice(0, ANH_TOI_DA));
  if (!rows.length) return { loi: "Không có mã nào hợp lệ (đang bán, còn hàng) để xem ảnh" };
  await ctx.notifyWait(args.loi_nhan_cho);
  const { ket_qua, khong_doc_duoc_anh } = await judgeImages(env, rows.map((r) => ({ ma_sp: String(r.ma_sp), anh_chinh_url: r.anh_chinh_url })), args.yeu_cau);
  const byId = new Map(rows.map((r) => [String(r.ma_sp), r]));
  const hop = ket_qua.filter((r) => r.hop);
  return {
    da_xem: ket_qua.length,
    bo_qua_vi_vuot_gioi_han: wanted.length > ANH_TOI_DA ? wanted.slice(ANH_TOI_DA) : undefined,
    khong_doc_duoc_anh: khong_doc_duoc_anh.length ? khong_doc_duoc_anh : undefined,
    hop: hop.map((r) => ({ ...card(byId.get(r.ma_sp)!), nhan_xet_anh: r.ly_do })),
    khong_hop: ket_qua.filter((r) => !r.hop).map((r) => ({ ma_sp: r.ma_sp, nhan_xet_anh: r.ly_do })),
  };
}

async function truyVan(env: Env, args: { sql: string }) {
  const rows = await runSelect(env, args.sql, 50);
  // Câu SELECT tự do không lọc món ngừng bán / hết hàng: gắn cờ để model không đem món đó ra gợi ý.
  const ids = [...new Set(rows.map((r) => String(r.ma_sp ?? "")).filter(Boolean))];
  const sellable = new Set(ids.length ? (await available(env, ids)).map((r) => String(r.ma_sp)) : []);
  return {
    so_dong: rows.length,
    dong: rows.map((r) => compact(r.ma_sp ? { ...r, dang_ban_va_con_hang: sellable.has(String(r.ma_sp)) } : r)),
  };
}

export interface ToolContext {
  /** Nhắn khách chờ (chỉ gửi một lần mỗi lượt), gọi trước việc chậm như xem ảnh. */
  notifyWait: (text?: string) => Promise<void>;
  /** Khách đang nhắn, VD fb:<PSID>. */
  khach: string;
  /** soan_don thành công: bot sẽ gửi tóm tắt đơn và nút xác nhận. */
  onNhap: (nhap: DonNhap, tom_tat: string) => void;
  /** yeu_cau_huy_don hợp lệ: bot sẽ gửi nút xác nhận hủy. */
  onYeuCauHuy: (ma_don: string) => void;
}

const VI_DU_SOAN_DON = JSON.stringify({
  mon: [{ ma_sp: "SP123", size: "M", mau: "đen", so_luong: 1 }], ten: "Nguyễn Văn A", sdt: "0912345678", dia_chi: "12 Lê Lợi, Quận 1, TP HCM",
});

/**
 * Model hay gọi soan_don sai theo vài kiểu cố định (đo khi chat thử: mất 2 vòng gọi lại mỗi đơn). Đổi về đúng dạng
 * thay vì báo lỗi: món viết phẳng (ma_sp, size ở ngoài), tên trường người nhận khác, số lượng dạng chữ.
 */
export function chuanHoaSoanDon(args: any): YeuCauSoan {
  const a = { ...(args ?? {}) };
  if (!Array.isArray(a.mon) && a.mon && typeof a.mon === "object") a.mon = [a.mon];
  if (!Array.isArray(a.mon) && a.ma_sp) a.mon = [{ ma_sp: a.ma_sp, size: a.size, mau: a.mau, so_luong: a.so_luong }];
  if (Array.isArray(a.mon)) {
    a.mon = a.mon.map((m: any) => ({
      ...m,
      ...(m?.size != null ? { size: String(m.size) } : {}),
      ...(m?.so_luong != null ? { so_luong: Number(m.so_luong) || 1 } : {}),
    }));
  }
  a.ten ??= a.nguoi_nhan ?? a.ho_ten ?? a.ten_nguoi_nhan;
  a.sdt ??= a.so_dien_thoai ?? a.dien_thoai;
  a.dia_chi ??= a.dia_chi_giao ?? a.dia_chi_nhan;
  return a;
}

async function soanDonTool(env: Env, raw: any, ctx: ToolContext) {
  const args = chuanHoaSoanDon(raw);
  const mon = args.mon as unknown;
  if (!Array.isArray(mon) || mon.some((m) => typeof m?.ma_sp !== "string" || typeof m?.size !== "string")) {
    return { loi: [`mon phải là mảng các món, mỗi món có ma_sp và size dạng chữ (mau, so_luong nếu có). Ví dụ gọi đúng: ${VI_DU_SOAN_DON}`] };
  }
  const r = await soanDon(env, ctx.khach, args);
  if (!r.ok) return { loi: r.loi };
  ctx.onNhap(r.nhap, r.tom_tat);
  // Không trả tóm tắt cho model: shop tự gửi, model chỉ cần mời khách kiểm tra và bấm xác nhận.
  return { ok: true, tien_hang: r.nhap.tien_hang, so_mon: r.nhap.mon.length };
}

async function yeuCauHuyTool(env: Env, args: { ma_don: string }, ctx: ToolContext) {
  const r = await kiemTraHuy(env, ctx.khach, String(args.ma_don ?? "").trim().toUpperCase());
  if (!r.ok) return { loi: r.loi };
  ctx.onYeuCauHuy(r.don.ma_don);
  return { ok: true, don: r.don };
}

/** Chạy một công cụ. Lỗi SQL được trả lại cho model dưới dạng { loi } để nó tự sửa câu lệnh. */
export async function runTool(env: Env, name: string, args: any, ctx: ToolContext): Promise<Record<string, unknown>> {
  try {
    if (name === "tim_san_pham") return await timSanPham(env, args);
    if (name === "xem_anh") return await xemAnh(env, args, ctx);
    if (name === "truy_van") return await truyVan(env, args);
    if (name === "soan_don") return await soanDonTool(env, args, ctx);
    if (name === "xem_don") return { don: await donCuaKhach(env, ctx.khach) };
    if (name === "yeu_cau_huy_don") return await yeuCauHuyTool(env, args, ctx);
    return { loi: `Không có công cụ ${name}` };
  } catch (err) {
    if (err instanceof SqlError) return { loi: err.message };
    throw err;
  }
}
