import { env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { cacMon, donCuaKhach, huyDon, kiemTraHuy, xacNhanDon } from "../../src/donhang/don";
import { soanDon } from "../../src/donhang/nhap";
import { napMau } from "./setup";

let A = "";
beforeEach(async () => {
  await napMau(env);
  await env.DB.batch([env.DB.prepare("DELETE FROM don_hang"), env.DB.prepare("DELETE FROM don_hang_mon")]);
  const r = await soanDon(env, "fb:1", { mon: [{ ma_sp: "SP1", size: "M", mau: "Đỏ", so_luong: 2 }], ten: "Lan", sdt: "0912345678", dia_chi: "12 Lê Lợi, Huế" });
  if (!r.ok) throw new Error(r.loi.join("; "));
  const x = await xacNhanDon(env, "fb:1", r.nhap.id);
  if (x.kq !== "da_tao") throw new Error(x.kq);
  A = x.ma_don;
});
const trangThai = async () => (await env.DB.prepare("SELECT trang_thai, huy_luc FROM don_hang WHERE ma_don = ?").bind(A).first<Record<string, any>>())!;

it("khách khác không thấy, không hủy được đơn", async () => {
  expect(await kiemTraHuy(env, "fb:2", A)).toEqual({ ok: false, loi: `không tìm thấy đơn ${A}` });
  expect((await huyDon(env, "fb:2", A)).ok).toBe(false);
  expect((await trangThai()).trang_thai).toBe("Mới");
  expect(await donCuaKhach(env, "fb:2")).toEqual([]);
});

it("chủ đơn hủy được một lần", async () => {
  expect(await kiemTraHuy(env, "fb:1", A)).toMatchObject({ ok: true, don: { ma_don: A, trang_thai: "Mới", tien_hang: 600000 } });
  expect(await huyDon(env, "fb:1", A)).toEqual({ ok: true });
  const t = await trangThai();
  expect(t.trang_thai).toBe("Khách hủy");
  expect(t.huy_luc).not.toBeNull();
  expect(await huyDon(env, "fb:1", A)).toEqual({ ok: false, loi: `đơn ${A} đã hủy trước đó` });
  expect(await kiemTraHuy(env, "fb:1", A)).toEqual({ ok: false, loi: `đơn ${A} đã hủy trước đó` });
});

it("mã không tồn tại", async () => {
  expect(await huyDon(env, "fb:1", "DH-000000-999")).toEqual({ ok: false, loi: "không tìm thấy đơn DH-000000-999" });
});

it("tra đơn của khách và định dạng các món", async () => {
  await huyDon(env, "fb:1", A);
  expect((await donCuaKhach(env, "fb:1"))[0]).toMatchObject({ ma_don: A, trang_thai: "Khách hủy", cac_mon: "SP1 · M · Đỏ × 2" });
  expect(cacMon([{ ma_sp: "SP1", size: "M", mau: "Đỏ", so_luong: 2 }, { ma_sp: "SP2", size: "S", mau: "", so_luong: 1 }]))
    .toBe("SP1 · M · Đỏ × 2; SP2 · S × 1");
});
