import type { DongHoiThoai, Env } from "./types";

/** Hội thoại của đơn: 20 lượt gần nhất (40 tin). Tách khỏi lịch sử 10 tin gửi cho model để không tốn thêm token. */
const SO_TIN = 40;
const GIU_GIAY = 7 * 24 * 3600;

export async function docHoiThoai(env: Env, khach: string): Promise<DongHoiThoai[]> {
  return (await env.SHOP_KV.get<DongHoiThoai[]>(`log:${khach}`, "json")) ?? [];
}

export async function ghiHoiThoai(env: Env, khach: string, vai: DongHoiThoai["vai"], chu: string) {
  const h = [...(await docHoiThoai(env, khach)), { vai, chu, luc: Date.now() }].slice(-SO_TIN);
  await env.SHOP_KV.put(`log:${khach}`, JSON.stringify(h), { expirationTtl: GIU_GIAY });
}
