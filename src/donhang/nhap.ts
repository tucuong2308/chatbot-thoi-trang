import type { DonNhap, Env, MonDat } from "../types";
import { boDau, chuanHoaSdt, loiDiaChi, tomTatDon } from "./kiemtra";

/** Số chiếc tối đa mỗi dòng; khách cần hơn thì chuyển nhân viên (thường là khách sỉ). */
const TOI_DA_MOI_MON = 5;
const GIU_NHAP_GIAY = 7 * 24 * 3600;

export interface YeuCauMon {
  ma_sp: string;
  size: string;
  mau?: string;
  so_luong?: number;
}

export interface YeuCauSoan {
  mon: YeuCauMon[];
  ten?: string;
  sdt?: string;
  dia_chi?: string;
  ghi_chu?: string;
}

interface BienThe { ma_sp: string; size: string; mau: string; ton_kho: number }

const nhanBienThe = (v: { size: string; mau: string }) => (v.mau ? `${v.size}/${v.mau}` : v.size);
const moTa = (v: { size: string; mau: string }) => `size ${v.size}${v.mau ? ` màu ${v.mau}` : ""}`;

/**
 * Đối chiếu từng dòng với kho và giá hiện tại. Trả về các dòng mua được (size, màu viết như trong kho, giá mới,
 * dòng trùng biến thể đã gộp) và câu lỗi cho từng dòng bị bỏ. Dùng cả lúc soạn nháp lẫn lúc khách bấm xác nhận.
 */
export async function kiemTraLaiMon(env: Env, yeuCau: YeuCauMon[]): Promise<{ mon: MonDat[]; loi: string[] }> {
  const loi: string[] = [];
  const codes = [...new Set(yeuCau.map((m) => m.ma_sp.trim().toUpperCase()))];
  const [sp, bt] = await env.DB.batch([
    env.DB.prepare(
      `SELECT ma_sp, ten_sp, gia_ban FROM san_pham
       WHERE upper(ma_sp) IN (SELECT value FROM json_each(?1)) AND coalesce(trang_thai, '') IN ('', 'đang bán')`,
    ).bind(JSON.stringify(codes)),
    env.DB.prepare(
      `SELECT ma_sp, coalesce(size, '') size, coalesce(mau, '') mau, ton_kho FROM bien_the
       WHERE upper(ma_sp) IN (SELECT value FROM json_each(?1))`,
    ).bind(JSON.stringify(codes)),
  ]);
  const products = new Map((sp.results as { ma_sp: string; ten_sp: string; gia_ban: number }[]).map((p) => [p.ma_sp.toUpperCase(), p]));
  const variants = bt.results as unknown as BienThe[];

  const gop = new Map<string, MonDat & { ton_kho: number }>();
  for (const m of yeuCau) {
    const code = m.ma_sp.trim().toUpperCase();
    const p = products.get(code);
    if (!p) {
      loi.push(`[${code}] không có trong danh mục hoặc đã ngừng bán`);
      continue;
    }
    const tag = `[${p.ma_sp}]`;
    const cua = variants.filter((v) => v.ma_sp === p.ma_sp);
    const conHang = cua.filter((v) => v.ton_kho > 0);
    const con = `còn: ${conHang.map(nhanBienThe).join(", ") || "không còn biến thể nào"}`;
    const size = (m.size ?? "").trim().toLowerCase();
    const cungSize = cua.filter((v) => v.size.toLowerCase() === size);
    let chon: BienThe | undefined;
    if (m.mau?.trim()) {
      const mau = boDau(m.mau);
      chon = cungSize.find((v) => boDau(v.mau) === mau);
      if (!chon) { loi.push(`${tag} không có size ${m.size} màu ${m.mau}; ${con}`); continue; }
      if (chon.ton_kho <= 0) { loi.push(`${tag} ${moTa(chon)} đã hết; ${con}`); continue; }
    } else {
      const conCungSize = cungSize.filter((v) => v.ton_kho > 0);
      if (!cungSize.length) { loi.push(`${tag} không có size ${m.size}; ${con}`); continue; }
      if (!conCungSize.length) { loi.push(`${tag} size ${cungSize[0].size} đã hết; ${con}`); continue; }
      // Món có nhiều màu thì luôn hỏi màu, kể cả khi size đó chỉ còn một màu: khách có thể đang muốn màu đã hết.
      if (new Set(cua.map((v) => v.mau)).size > 1) {
        loi.push(`${tag} cần chọn màu, còn hàng: ${conCungSize.map((v) => v.mau).join(", ")}`);
        continue;
      }
      chon = conCungSize[0];
    }
    const soLuong = m.so_luong ?? 1;
    if (!Number.isInteger(soLuong) || soLuong < 1) { loi.push(`${tag} số lượng phải là số nguyên từ 1`); continue; }
    const key = `${p.ma_sp}|${chon.size}|${chon.mau}`;
    const cu = gop.get(key);
    if (cu) cu.so_luong += soLuong;
    else gop.set(key, { ma_sp: p.ma_sp, ten_sp: p.ten_sp, size: chon.size, mau: chon.mau, so_luong: soLuong, don_gia: p.gia_ban, ton_kho: chon.ton_kho });
  }

  const mon: MonDat[] = [];
  for (const { ton_kho, ...d } of gop.values()) {
    if (d.so_luong > TOI_DA_MOI_MON) loi.push(`[${d.ma_sp}] tối đa ${TOI_DA_MOI_MON} chiếc mỗi món; cần nhiều hơn thì chuyển nhân viên`);
    else if (d.so_luong > ton_kho) loi.push(`[${d.ma_sp}] ${moTa(d)} chỉ còn ${ton_kho}`);
    else mon.push(d);
  }
  return { mon, loi: [...new Set(loi)] };
}

/**
 * Soạn đơn nháp từ những gì bot đã hỏi được. Gom mọi lỗi để bot hỏi khách một lần; có lỗi thì không lưu gì.
 * Thành công thì thay đơn nháp cũ (nếu có) bằng nháp mới với id mới.
 */
export async function soanDon(
  env: Env, khach: string, yc: YeuCauSoan,
): Promise<{ ok: true; nhap: DonNhap; tom_tat: string } | { ok: false; loi: string[] }> {
  const loi: string[] = [];
  const { mon, loi: loiMon } = await kiemTraLaiMon(env, yc.mon ?? []);
  if (!(yc.mon ?? []).length) loi.push("chưa có món nào");
  loi.push(...loiMon);

  const ten = (yc.ten ?? "").trim();
  if (!ten) loi.push("thiếu họ tên người nhận");
  const sdtGoc = (yc.sdt ?? "").trim();
  const sdt = sdtGoc ? chuanHoaSdt(sdtGoc) : null;
  if (!sdtGoc) loi.push("thiếu số điện thoại");
  else if (!sdt) loi.push(`số điện thoại ${sdtGoc} không đúng (cần 10 số, bắt đầu bằng 0)`);
  const diaChi = (yc.dia_chi ?? "").trim();
  const loiDc = diaChi ? loiDiaChi(diaChi) : "thiếu địa chỉ giao hàng";
  if (loiDc) loi.push(diaChi ? `địa chỉ: ${loiDc}` : loiDc);

  if (loi.length || !sdt) return { ok: false, loi };
  const nhap: DonNhap = {
    id: crypto.randomUUID().slice(0, 8),
    mon,
    ten,
    sdt,
    dia_chi: diaChi,
    ghi_chu: (yc.ghi_chu ?? "").trim(),
    tien_hang: mon.reduce((s, m) => s + m.don_gia * m.so_luong, 0),
    tao_luc: Date.now(),
  };
  await luuNhap(env, khach, nhap);
  return { ok: true, nhap, tom_tat: tomTatDon(nhap) };
}

export async function luuNhap(env: Env, khach: string, nhap: DonNhap) {
  await env.SHOP_KV.put(`nhap:${khach}`, JSON.stringify(nhap), { expirationTtl: GIU_NHAP_GIAY });
}

export async function layNhap(env: Env, khach: string): Promise<DonNhap | null> {
  return env.SHOP_KV.get<DonNhap>(`nhap:${khach}`, "json");
}

export async function xoaNhap(env: Env, khach: string) {
  await env.SHOP_KV.delete(`nhap:${khach}`);
}
