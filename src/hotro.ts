import { chuanHoaSdt, ngayVN } from "./donhang/kiemtra";
import { docHoiThoai } from "./hoithoai";
import type { DongHoiThoai, Env } from "./types";

/** Trong khoảng này, khách nhờ nhân viên thêm lần nữa thì gộp vào yêu cầu cũ thay vì tạo dòng mới trên Sheets. */
const GOP_GIAY = 24 * 3600;
const HOI_THOAI_TOI_DA = 45_000;

/**
 * Khách cần nhân viên: ghi yêu cầu vào bảng ho_tro để Apps Script kéo về trang HoTro và gửi email cho shop.
 * Gọi lại trong 24 giờ (VD khách vừa gửi thêm số điện thoại) thì cập nhật yêu cầu cũ.
 */
export async function chuyenNhanVien(
  env: Env, khach: string, args: { ly_do?: string; sdt?: string },
): Promise<{ ok: true; ma: string; cap_nhat_yeu_cau_cu: boolean } | { loi: string }> {
  const lyDo = String(args.ly_do ?? "").trim();
  if (!lyDo) return { loi: "cần ly_do: khách cần nhân viên giúp việc gì" };
  const sdtGoc = String(args.sdt ?? "").trim();
  const sdt = sdtGoc ? chuanHoaSdt(sdtGoc) : "";
  if (sdt === null) return { loi: `số điện thoại ${sdtGoc} không đúng (cần 10 số, bắt đầu bằng 0): hỏi lại khách` };

  const now = Date.now();
  const hoiThoai = JSON.stringify(await docHoiThoai(env, khach));
  const cu = await env.DB.prepare("SELECT ma, ly_do, sdt FROM ho_tro WHERE khach = ? AND tao_luc > ? ORDER BY tao_luc DESC LIMIT 1")
    .bind(khach, now - GOP_GIAY * 1000).first<{ ma: string; ly_do: string; sdt: string }>();
  if (cu) {
    const lyDoMoi = cu.ly_do.split("\n").includes(lyDo) ? cu.ly_do : `${cu.ly_do}\n${lyDo}`;
    await env.DB.prepare("UPDATE ho_tro SET ly_do = ?, sdt = ?, hoi_thoai = ?, cap_nhat = ? WHERE ma = ?")
      .bind(lyDoMoi, sdt || cu.sdt, hoiThoai, now, cu.ma).run();
    return { ok: true, ma: cu.ma, cap_nhat_yeu_cau_cu: true };
  }

  const homNay = `HT-${ngayVN(now)}-`;
  let stt = ((await env.DB.prepare("SELECT count(*) c FROM ho_tro WHERE ma LIKE ?").bind(`${homNay}%`).first<{ c: number }>())?.c ?? 0) + 1;
  for (let lan = 0; lan < 5; lan++, stt++) {
    const ma = homNay + String(stt).padStart(3, "0");
    try {
      await env.DB.prepare(
        "INSERT INTO ho_tro (ma, khach, ly_do, sdt, hoi_thoai, tao_luc, cap_nhat) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(ma, khach, lyDo, sdt, hoiThoai, now, now).run();
      return { ok: true, ma, cap_nhat_yeu_cau_cu: false };
    } catch (err) {
      if (!/constraint/i.test(String(err))) throw err; // trùng mã với khách khác cùng lúc: lấy số kế tiếp
    }
  }
  throw new Error("Không cấp được mã yêu cầu hỗ trợ sau 5 lần thử");
}

/** Một dòng trang HoTro trên Google Sheets. */
export interface HoTroChoSheet {
  ma: string;
  thoi_gian: string;
  kenh: string;
  khach: string;
  sdt: string;
  ly_do: string;
  hoi_thoai: string;
}

function gioVN(ms: number): string {
  const d = new Date(ms + 7 * 3600_000).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} ${d.slice(11, 16)}`;
}

function hoiThoaiChoSheet(h: DongHoiThoai[]): string {
  const s = h.map((d) => `${d.vai === "khach" ? "Khách" : "Bot"}: ${d.chu}`).join("\n");
  return s.length <= HOI_THOAI_TOI_DA ? s : "…" + s.slice(s.length - HOI_THOAI_TOI_DA + 1);
}

/** Yêu cầu mới hoặc vừa cập nhật từ mốc `tu` (mili giây, tính cả đúng mốc), như /admin/don-hang. */
export async function hoTroThayDoiTu(env: Env, tu: number): Promise<{ yeu_cau: HoTroChoSheet[]; con_tro: number }> {
  const { results } = await env.DB.prepare("SELECT * FROM ho_tro WHERE cap_nhat >= ? ORDER BY cap_nhat LIMIT 200")
    .bind(tu).all<Record<string, any>>();
  const yeu_cau = results.map((r): HoTroChoSheet => ({
    ma: r.ma,
    thoi_gian: gioVN(r.tao_luc),
    kenh: String(r.khach).startsWith("tg:") ? "Telegram" : String(r.khach).startsWith("fb:") ? "Messenger" : "Thử",
    khach: r.khach,
    sdt: r.sdt,
    ly_do: r.ly_do,
    hoi_thoai: hoiThoaiChoSheet(JSON.parse(r.hoi_thoai)),
  }));
  return { yeu_cau, con_tro: results.length ? Number(results[results.length - 1].cap_nhat) : tu };
}
