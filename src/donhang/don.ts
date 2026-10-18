import { vnd } from "../dinhdang";
import { docHoiThoai } from "../hoithoai";
import type { DonNhap, Env } from "../types";
import { maDon } from "./kiemtra";
import { kiemTraLaiMon, layNhap, luuNhap, xoaNhap } from "./nhap";

export type KetQuaXacNhan =
  | { kq: "da_tao"; ma_don: string }
  /** Bấm lại trên nháp đã thành đơn. */
  | { kq: "da_co"; ma_don: string }
  /** Nháp không còn là nháp mới nhất (hoặc đã hết hạn); kèm nháp hiện tại nếu có. */
  | { kq: "cu"; nhap: DonNhap | null }
  /** Có món hết hàng / đổi giá kể từ lúc soạn: đã soạn nháp mới từ các món còn lại (null nếu không còn món nào). */
  | { kq: "thay_doi"; loi: string[]; nhap: DonNhap | null };

async function donTheoNhap(env: Env, nhapId: string): Promise<string | null> {
  return (await env.DB.prepare("SELECT ma_don FROM don_hang WHERE nhap_id = ?").bind(nhapId).first<{ ma_don: string }>())?.ma_don ?? null;
}

/**
 * Khách bấm "Xác nhận đặt hàng" trên tóm tắt đơn có id `nhapId`. Chỉ nháp mới nhất mới thành đơn; trước khi ghi
 * thì đối chiếu lại kho và giá. Bấm hai lần (kể cả cùng lúc) chỉ ra một đơn nhờ cột nhap_id UNIQUE.
 */
export async function xacNhanDon(env: Env, khach: string, nhapId: string): Promise<KetQuaXacNhan> {
  const daCo = await donTheoNhap(env, nhapId);
  if (daCo) return { kq: "da_co", ma_don: daCo };
  const nhap = await layNhap(env, khach);
  if (!nhap || nhap.id !== nhapId) return { kq: "cu", nhap };

  const { mon, loi } = await kiemTraLaiMon(env, nhap.mon);
  for (const m of mon) {
    const cu = nhap.mon.find((c) => c.ma_sp === m.ma_sp && c.size === m.size && c.mau === m.mau);
    if (cu && cu.don_gia !== m.don_gia) loi.push(`[${m.ma_sp}] giá đổi từ ${vnd(cu.don_gia)} thành ${vnd(m.don_gia)}`);
  }
  if (loi.length) {
    if (!mon.length) {
      await xoaNhap(env, khach);
      return { kq: "thay_doi", loi, nhap: null };
    }
    const moi: DonNhap = {
      ...nhap, id: crypto.randomUUID().slice(0, 8), mon, tao_luc: Date.now(),
      tien_hang: mon.reduce((s, m) => s + m.don_gia * m.so_luong, 0),
    };
    await luuNhap(env, khach, moi);
    return { kq: "thay_doi", loi, nhap: moi };
  }

  const hoiThoai = JSON.stringify(await docHoiThoai(env, khach));
  const now = Date.now();
  const homNay = maDon(new Date(now), 0).slice(0, 10); // "DH-YYMMDD-"
  let stt = ((await env.DB.prepare("SELECT count(*) c FROM don_hang WHERE ma_don LIKE ?").bind(`${homNay}%`).first<{ c: number }>())?.c ?? 0) + 1;
  for (let lan = 0; lan < 5; lan++, stt++) {
    const ma = maDon(new Date(now), stt);
    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO don_hang (ma_don, khach, nhap_id, ten, sdt, dia_chi, ghi_chu, tien_hang, trang_thai, hoi_thoai, tao_luc, cap_nhat)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Mới', ?, ?, ?)`,
        ).bind(ma, khach, nhap.id, nhap.ten, nhap.sdt, nhap.dia_chi, nhap.ghi_chu, nhap.tien_hang, hoiThoai, now, now),
        ...mon.map((m, i) => env.DB.prepare(
          "INSERT INTO don_hang_mon (ma_don, stt, ma_sp, ten_sp, size, mau, so_luong, don_gia) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(ma, i + 1, m.ma_sp, m.ten_sp, m.size, m.mau, m.so_luong, m.don_gia)),
      ]);
      await xoaNhap(env, khach);
      return { kq: "da_tao", ma_don: ma };
    } catch (err) {
      if (!/constraint/i.test(String(err))) throw err;
      // Lần bấm kia đã ghi xong đơn này; còn không thì trùng mã đơn với khách khác cùng lúc: lấy số kế tiếp.
      const roi = await donTheoNhap(env, nhapId);
      if (roi) return { kq: "da_co", ma_don: roi };
    }
  }
  throw new Error("Không cấp được mã đơn sau 5 lần thử");
}
